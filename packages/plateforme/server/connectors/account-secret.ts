// Le secret et les réglages d'un compte réel (`connecteurs-et-comptes.md` § Comptes à plusieurs champs et réglages) :
// la saisie par qui gère le compte (`setAccountSecret`, de l'écran Connecteurs ou d'un service), qui fusionne avec ce
// qui est posé ; le compte ouvert pour un appel (`liveCredential`, lu par `runCall` et par la sonde, `probe.ts`). Les
// champs sont contrôlés contre la déclaration du connecteur, chiffrés ensemble (`vault.ts`) ; les réglages restent en
// clair ; le jeton d'un échange est chiffré à part (`token_ciphertext`), pour qu'un renouvellement n'écrase jamais une
// saisie. Sans ce module, un compte ne porterait qu'un jeton posé par l'outillage. Rien du secret n'est jamais rendu,
// ni par un résultat, ni par un refus, ni par un log.
import { mergeCredential } from "../../cli/vault.mjs"
import type { AccountMarkReason, AccountMode, ConnectorAccountForm } from "../../schemas"
import { accountSecretSchema } from "../../schemas/connectors"
import { describeOwner } from "../access"
import { declaredConnector, declaredConnectors, type DeclaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { managedAccount, markOf, markWords, refuseLinkedId, summary, type AccountOwner, type AccountSummary } from "./accounts"
import { requiredFields, type AccountCredential, type AccountMarker, type ConsentCredential, type StoredToken, type TokenStore } from "./auth"
import { accountMode } from "./modes"
import { reconnectRefusal } from "./consent-accounts"
import { accountFieldNames, hostFieldsOf, readHostFields } from "./host-fields"
import { accountSettings, settingValueProblem } from "./settings"
import { decryptCredential, decryptToken, encryptCredential, encryptToken, type OpenedCredential } from "./vault"

/** Ce que l'appel lit d'un compte résolu pour l'ouvrir. */
type CallAccount = { id: string; label: string; mode: AccountMode; owner: AccountOwner }

/** Le chiffré du secret, les réglages, les champs posés, la version de la dernière saisie et la marque d'un compte. */
type SecretRow = { secret: string | null; settings: Record<string, string>; secret_fields: string[]; secret_updated_at: string | null; mark: unknown }

function secretRow(db: PlatformDb, service: string, id: string): Promise<SecretRow | undefined> {
  return inTransaction(db, `${service}: account_secret`, (sql) => sql<SecretRow[]>`
    select platform.account_secret(${id}) as secret, a.settings, a.secret_fields, to_json(a.secret_updated_at) #>> '{}' as secret_updated_at,
           a.health -> 'mark' as mark
      from platform.accounts a where a.id = ${id}`).then(([row]) => row)
}

/**
 * Ce qu'il faut pour dire à qui demander de lever une marque : le compte, si c'est celui de l'appelant, s'il se
 * reconnecte (un consentement, un compte rattaché) ou signe avec la seule clé de l'hôte, et qui le gère.
 */
type MarkRemedy = { account: CallAccount; own: boolean; reconnect: boolean; hostKey: boolean; who: () => Promise<string> }

/**
 * Le remède d'une marque : reconnecter un consentement ou un compte rattaché, faire vérifier la clé de l'hôte, poser
 * une clé neuve, racheter des crédits.
 */
async function remedyOf(reason: AccountMarkReason, remedy: MarkRemedy): Promise<string> {
  const { own, reconnect } = remedy
  if (reason === "credential_rejected" && reconnect) return own ? "Ask the user to connect it again (Connect my account)." : "Only its owner can connect it again: ask them."
  if (reason === "credential_rejected" && remedy.hostKey) return "The key is this application's: ask whoever runs this application to check it."
  const who = own ? "the user" : await remedy.who()
  return reason === "credential_rejected" ? `Ask ${who} to set a new key.` : `Ask ${who} to add credits.`
}

/**
 * La marque du compte d'un appel (`AccountMarker`) : la seule écriture de `accounts.health` est `platform.mark_account`,
 * qui pose ou lève la marque d'un compte d'une organisation de l'appelant, et rien d'autre ; elle garde la date d'une
 * marque reposée pour la même raison. Rien n'est écrit quand la marque lue ne change pas : un appel réussi sur un compte
 * sans marque ne touche pas la base.
 */
function accountMarker(db: PlatformDb, row: SecretRow, remedy: MarkRemedy): AccountMarker {
  const { account } = remedy
  const marker: AccountMarker = {
    current: markOf(row.mark),
    effect: null,
    async set(reason) {
      if ((marker.current?.reason ?? null) === reason) return
      const [written] = await inTransaction(db, "accountMarker: mark_account", (sql) => sql<{ changed: boolean; mark: unknown }[]>`
        select changed, mark from platform.mark_account(${account.id}, ${reason})`)
      marker.current = markOf(written?.mark)
      if (written?.changed) marker.effect = reason === null ? "lifted" : "marked"
    },
    async remedy() {
      const current = marker.current
      if (!current) {
        console.error(`[platform] accountMarker: account ${account.id} has no mark to tell`)
        throw new PlatformError("internal", "Internal error.")
      }
      return `Account « ${account.label} » is marked: ${markWords(current)}. ${await remedyOf(current.reason, remedy)}`
    },
  }
  return marker
}

/** Le connecteur déclaré d'un compte réel ; un connecteur que l'hôte ne déclare plus n'a ni champs ni réglages. */
function declaredOf(connector: string): DeclaredConnector {
  const declared = declaredConnector(connector)
  if (!declared) throw new PlatformError("invalid_arguments", `Connector ${connector} is not declared by this application: its accounts have no fields to set.`)
  return declared
}

/** Les champs d'un secret ouvert ; un secret v1 (un seul champ) se range sous le dernier champ qu'exige l'authentification. */
function fieldsOf(declared: DeclaredConnector, opened: OpenedCredential): Record<string, string> {
  if ("fields" in opened) return opened.fields
  return { [requiredFields(declared.auth).at(-1) ?? declared.definition.credential[0].name]: opened.single }
}

/** Les réglages saisis, contrôlés contre la déclaration ; une adresse perd son `/` final. */
function checkedSettings(declared: DeclaredConnector, given: Record<string, string | null>): Record<string, string | null> {
  const settings = declared.definition.settings ?? []
  const checked: Record<string, string | null> = {}
  for (const [name, raw] of Object.entries(given)) {
    const setting = settings.find((candidate) => candidate.name === name)
    if (!setting) throw new PlatformError("invalid_arguments", `Unknown setting ${name} of ${declared.definition.name}: its settings are ${settings.map((item) => item.name).join(", ") || "none"}.`)
    const value = raw === null || raw === "" ? null : setting.type === "url" ? raw.replace(/\/+$/, "") : raw
    const problem = value === null ? null : settingValueProblem(setting, value)
    if (problem) throw new PlatformError("invalid_arguments", `Setting ${setting.label} ${problem}.`)
    checked[name] = value
  }
  return checked
}

/**
 * Pose le secret et les réglages d'un compte réel : réservé à qui le gère (niveau 3, comme `disableAccount`), décidé
 * avant l'écriture. La saisie fusionne avec ce qui est posé : un champ ou un réglage absent est gardé, `null` ou vide
 * l'efface. Champs et réglages sont contrôlés contre la déclaration du connecteur ; les champs sont chiffrés ensemble,
 * et le jeton d'un échange est effacé (il découlait de l'ancienne saisie). Une saisie concurrente entre la lecture et
 * l'écriture est refusée (`stale_revision`). Rien du secret n'est rendu. Refus : inconnu ou invisible (`not_found`),
 * non géré (`forbidden`), compte simulé, connecteur non déclaré, champ ou réglage inconnu ou invalide, champ que
 * fournit l'hôte (`holder: host`), identifiant chez un tiers (`linked_id`) (`invalid_arguments`).
 */
export async function setAccountSecret(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountSummary> {
  refuseLinkedId(input, isJsonObject(input) && isJsonObject(input.input) ? input.input : null)
  const parsed = accountSecretSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const row = await managedAccount(db, identity, id, { service: "setAccountSecret", gesture: "Setting the secret of" })
  if (accountMode(row.mode) === "simule") throw new PlatformError("invalid_arguments", `Account « ${row.label} » is simulated: it has no secret.`)
  const declared = declaredOf(row.connector)
  if (declared.auth.kind === "user_consent") {
    throw new PlatformError("invalid_arguments", `Account « ${row.label} » holds the tokens of a person's consent: it has no secret to set. Connect it again instead.`)
  }
  const fieldNames = accountFieldNames(declared.definition)
  const secret = parsed.data.input.secret ?? {}
  const fromHost = hostFieldsOf(declared.definition).find((field) => Object.hasOwn(secret, field.name))
  if (fromHost) throw new PlatformError("invalid_arguments", `Field ${fromHost.name} of ${row.connector} is provided by this application, never set on an account.`)
  const unknown = Object.keys(secret).find((name) => !fieldNames.includes(name))
  if (unknown !== undefined) throw new PlatformError("invalid_arguments", `Unknown field ${unknown} of ${row.connector}: its fields are ${fieldNames.join(", ")}.`)
  const settings = checkedSettings(declared, parsed.data.input.settings ?? {})
  const current = await secretRow(db, "setAccountSecret", id)
  const previous = current?.secret ? fieldsOf(declared, decryptCredential(id, current.secret)) : {}
  const fields = mergeCredential(previous, secret)
  const nextSettings = mergeCredential(current?.settings ?? {}, settings)
  const ciphertext = Object.keys(fields).length > 0 ? encryptCredential(id, fields) : null
  const version = current?.secret_updated_at ?? null
  const updated = await inTransaction(db, "setAccountSecret: accounts update", (sql) => sql`
    update platform.accounts
       set secret_ciphertext = ${ciphertext}, secret_fields = ${Object.keys(fields).sort()}::text[], settings = ${sql.json(nextSettings)},
           secret_updated_at = now(), token_ciphertext = null, token_expires_at = null
     where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz
     returning id`)
  // Aucune ligne après la décision : une autre saisie a été écrite depuis la lecture qui fonde la fusion.
  if (updated.length === 0) {
    console.error(`[platform] setAccountSecret: account ${id} changed since its secret was read`)
    throw new PlatformError("stale_revision", `Account « ${row.label} » was changed meanwhile. Reload it and enter its secret again.`)
  }
  return summary(row)
}

/**
 * Le formulaire du compte de chaque connecteur réel déclaré, tiré de sa déclaration : les champs du secret que garde un
 * compte (jamais ceux de l'hôte), puis les réglages ; ce que l'écran Connecteurs montre pour créer un compte réel ou en
 * saisir le secret. Un connecteur `oauth2_user` (`consent`) n'a ni champ ni réglage : chacun y connecte son compte par
 * son consentement. Un connecteur à `accountIdentity` (`hosted`) se branche par la personne, si l'hôte en a fourni le
 * port (`ready`). Sans lecture de base.
 */
export function connectorAccountForms(): ConnectorAccountForm[] {
  return declaredConnectors().map(({ definition, hostedLinks }) => ({
    connector: definition.name,
    label: definition.label,
    consent: definition.auth.kind === "oauth2_user",
    ...(definition.accountIdentity ? { hosted: { ready: hostedLinks !== null } } : {}),
    fields: definition.credential.filter((field) => field.holder !== "host").map(({ name, label, secret }) => ({ name, label, secret })),
    settings: (definition.settings ?? []).map((setting) => (setting.type === "choice" ? { ...setting, choices: [...setting.choices] } : { ...setting })),
  }))
}

/** Le jeton d'un échange, lu et écrit sur la ligne du compte, chiffré à part du secret saisi. */
export function tokenStore(db: PlatformDb, accountId: string): TokenStore {
  return {
    async read() {
      const [row] = await inTransaction(db, "tokenStore: account_token", (sql) => sql<{ token: string | null; expires_at: string | null }[]>`
        select platform.account_token(${accountId}) as token, to_json(a.token_expires_at) #>> '{}' as expires_at
          from platform.accounts a where a.id = ${accountId}`)
      return row?.token ? { token: decryptToken(accountId, row.token), expiresAt: row.expires_at ? new Date(row.expires_at) : null } : null
    },
    async write({ token, expiresAt }: StoredToken) {
      const ciphertext = encryptToken(accountId, token)
      await inTransaction(db, "tokenStore: accounts update", (sql) => sql`
        update platform.accounts set token_ciphertext = ${ciphertext}, token_expires_at = ${expiresAt} where id = ${accountId}`)
    },
  }
}

/** Le premier champ du compte exigé par l'authentification qui manque, nommé par son libellé ; `null` : aucun. */
function missingField(declared: DeclaredConnector, present: readonly string[]): string | null {
  const own = accountFieldNames(declared.definition)
  const name = requiredFields(declared.auth).find((field) => own.includes(field) && !present.includes(field))
  return name === undefined ? null : (declared.definition.credential.find((field) => field.name === name)?.label ?? name)
}

/** Le refus d'un connecteur `oauth2_user` dont l'hôte n'a pas fourni l'application OAuth (`registerConnectors`). */
export function applicationMissing(label: string): PlatformError {
  console.error(`[platform] connector ${label}: no OAuth application given to registerConnectors`)
  return new PlatformError("not_enabled", `Connecting ${label} needs the OAuth application of this application, which is not configured. Ask whoever runs this application to configure it.`)
}

/**
 * Le consentement d'un compte `oauth2_user`, ouvert pour un appel : l'application OAuth de l'hôte, le jeton de
 * rafraîchissement (le secret du compte, `secret_ciphertext`), le jeton d'accès (`token_ciphertext`), et leurs
 * écritures. Un jeton de rafraîchissement rendu ne remplace celui qu'on a lu que s'il est encore en place
 * (`secret_updated_at` inchangé) ; sinon un autre renouvellement l'a déjà remplacé, et le sien est gardé. Un
 * consentement qui ne vaut plus passe le compte en `error`, la raison dans `status_reason`, sauf si une reconnexion
 * l'a déjà remplacé ; ses jetons restent, rien ne les purge. Le compte s'ouvre avec sa marque (`remedy` : le compte,
 * s'il est celui de l'appelant, et à qui demander).
 */
function consentOpener(db: PlatformDb, remedy: MarkRemedy, declared: DeclaredConnector, row: SecretRow | undefined): () => Promise<AccountCredential> {
  const { definition, application } = declared
  if (!application) throw applicationMissing(definition.label)
  const { account, own } = remedy
  if (!row?.secret) {
    const how = own ? `Ask the user to connect their ${definition.label} account` : "Only its owner can connect it: ask them"
    throw new PlatformError("not_enabled", `Account « ${account.label} » is not connected yet. ${how} (Connect my account).`)
  }
  const ciphertext = row.secret
  const id = account.id
  let version = row.secret_updated_at
  const mark = accountMarker(db, row, remedy)
  return async () => {
    const opened = decryptCredential(id, ciphertext)
    const fields = "fields" in opened ? opened.fields : {}
    const consent: ConsentCredential = {
      application,
      refreshToken: fields.refresh_token ?? null,
      async renewed(token, rotated, scopes) {
        const access = encryptToken(id, token.token)
        if (rotated === null) {
          await inTransaction(db, "consent: renewed", (sql) => sql`
            update platform.accounts set token_ciphertext = ${access}, token_expires_at = ${token.expiresAt}, granted_scopes = coalesce(${scopes}::text[], granted_scopes)
             where id = ${id}`)
          return
        }
        const secret = encryptCredential(id, { refresh_token: rotated })
        const [written] = await inTransaction(db, "consent: rotated", (sql) => sql<{ version: string }[]>`
          update platform.accounts
             set secret_ciphertext = ${secret}, secret_fields = ${["refresh_token"]}::text[], secret_updated_at = now(),
                 token_ciphertext = ${access}, token_expires_at = ${token.expiresAt}, granted_scopes = coalesce(${scopes}::text[], granted_scopes)
           where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz
           returning to_json(secret_updated_at) #>> '{}' as version`)
        if (!written) {
          console.error(`[platform] connector ${definition.name}: account ${id} renewed meanwhile, its newer refresh token kept`)
          return
        }
        version = written.version
        consent.refreshToken = rotated
      },
      async revoked(reason) {
        await inTransaction(db, "consent: revoked", (sql) => sql`
          update platform.accounts set status = 'error', status_reason = ${cut(reason, 500)}
           where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz`)
        console.error(`[platform] connector ${definition.name}: the consent of account ${id} no longer holds, account to connect again`)
        return reconnectRefusal(definition.name, account.label, reason, own)
      },
    }
    return { fields: {}, settings: {}, tokens: tokenStore(db, id), consent, mark }
  }
}

/**
 * Le compte d'un appel à un connecteur réel déclaré, lu après sa résolution et avant tout récapitulatif ; rend de quoi
 * l'ouvrir pour `run` seul, au dernier moment. Refus nommés, la fonction non appelée (`not_enabled`, qui dit à qui
 * demander) : un compte simulé ; un compte sans secret, ou sans un champ qu'exige l'authentification ; un réglage
 * manquant ou devenu invalide ; un compte `oauth2_user` sans consentement, ou sans l'application OAuth de l'hôte ; un
 * champ de l'hôte qu'il n'a pas fourni ; un compte d'un connecteur à `accountIdentity` sans identifiant chez le tiers
 * (`linked_id`), ou dont l'identifiant ne suit plus le motif. Les champs de l'hôte (`holder: host`) se lisent à
 * l'ouverture et s'ajoutent à ceux du compte ; l'identifiant va à l'adresse de base, jamais à un argument. Un compte
 * marqué (clé refusée, crédits épuisés) n'est pas refusé ici : il s'ouvre avec sa marque, que l'appel pose ou lève.
 */
export async function liveCredential(db: PlatformDb, identity: Identity, account: CallAccount, connector: string): Promise<() => Promise<AccountCredential>> {
  const who = () => describeOwner(db, identity, account.owner)
  if (account.mode === "simule") {
    throw new PlatformError(
      "not_enabled",
      `Account « ${account.label} » is simulated, but ${connector} is a live connector: it runs on live accounts only. Ask ${await who()} to connect a live account.`,
    )
  }
  const declared = declaredConnector(connector)
  if (!declared) {
    console.error(`[platform] call: live connector ${connector} is not declared`)
    throw new PlatformError("internal", "Internal error.")
  }
  const row = await secretRow(db, "liveCredential", account.id)
  const own = account.owner.kind === "user" && account.owner.userId === identity.user.id
  const consent = declared.auth.kind === "user_consent"
  // Un consentement et un compte rattaché se reconnectent ; un autre compte sans champ à lui signe avec la clé de
  // l'hôte (`holder: host`).
  const reconnect = consent || declared.definition.accountIdentity !== undefined
  const hostKey = accountFieldNames(declared.definition).length === 0
  const remedy: MarkRemedy = { account, own, reconnect, hostKey, who }
  if (consent) {
    // Un compte partagé (règle d'accès) sert aussi à d'autres que sa personne : seule elle peut le (re)connecter.
    return consentOpener(db, remedy, declared, row)
  }
  if (!row) {
    console.error(`[platform] liveCredential: account ${account.id} resolved but not read back`)
    throw new PlatformError("internal", "Internal error.")
  }
  // Un compte sans champ à lui (tous fournis par l'hôte) n'a pas de secret : il n'en exige pas.
  if (!row.secret && !hostKey) throw new PlatformError("not_enabled", `Account « ${account.label} » has no secret yet. Ask ${await who()} to set it.`)
  readHostFields(declared)
  const linkedId = declared.definition.accountIdentity ? await linkedIdOf(db, identity, account, declared) : undefined
  const checked = accountSettings(declared.definition, row.settings)
  if ("problem" in checked) {
    throw new PlatformError("not_enabled", `The ${checked.problem.label} setting of account « ${account.label} » ${checked.problem.reason}. Ask ${await who()} to set it.`)
  }
  const refuseMissing = async (present: readonly string[]) => {
    const missing = missingField(declared, present)
    if (missing) throw new PlatformError("not_enabled", `Account « ${account.label} » has no ${missing} yet. Ask ${await who()} to set it.`)
  }
  // Un secret v1 ne dit pas ses champs : il se contrôle une fois ouvert.
  if (row.secret_fields.length > 0) await refuseMissing(row.secret_fields)
  const ciphertext = row.secret
  const mark = accountMarker(db, row, remedy)
  return async () => {
    const fields = ciphertext ? fieldsOf(declared, decryptCredential(account.id, ciphertext)) : {}
    await refuseMissing(Object.keys(fields))
    return { fields: { ...fields, ...readHostFields(declared) }, settings: checked.settings, tokens: tokenStore(db, account.id), mark, ...(linkedId !== undefined ? { linkedId } : {}) }
  }
}

/**
 * L'identifiant chez le tiers du compte d'un connecteur à `accountIdentity` (`linked_id`), lu par
 * `platform.account_linked_id` (jamais accordé en lecture à `authenticated`) et recontrôlé contre le motif déclaré.
 * Aucun : le compte n'est pas branché (`not_enabled`, « connect your account ») ; hors motif : à reconnecter.
 */
async function linkedIdOf(db: PlatformDb, identity: Identity, account: CallAccount, declared: DeclaredConnector): Promise<string> {
  const accountIdentity = declared.definition.accountIdentity
  if (!accountIdentity) {
    console.error(`[platform] liveCredential: ${declared.definition.name} has no accountIdentity`)
    throw new PlatformError("internal", "Internal error.")
  }
  const [row] = await inTransaction(db, "liveCredential: account_linked_id", (sql) => sql<{ linked_id: string | null }[]>`
    select platform.account_linked_id(${account.id}) as linked_id`)
  const own = account.owner.kind === "user" && account.owner.userId === identity.user.id
  const remedy = async () => (own ? "Ask the user to connect their account (Connect my account)." : `Ask ${await describeOwner(db, identity, account.owner)} to connect it (Connect my account).`)
  const label = declared.definition.label
  if (!row?.linked_id) throw new PlatformError("not_enabled", `Account « ${account.label} » is not connected to ${label} yet. ${await remedy()}`)
  if (!new RegExp(accountIdentity.pattern).test(row.linked_id)) {
    console.error(`[platform] connector ${declared.definition.name}: account ${account.id} has a linked id out of its pattern`)
    throw new PlatformError("not_enabled", `Account « ${account.label} » must be connected again to ${label}. ${await remedy()}`)
  }
  return row.linked_id
}
