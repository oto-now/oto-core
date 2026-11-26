// Le secret et les réglages d'un compte réel (`connecteurs-et-comptes.md` § Comptes à plusieurs champs et réglages) :
// la saisie par qui gère le compte (`setAccountSecret`, de l'écran Connecteurs ou d'un service), qui fusionne avec ce
// qui est posé ; le compte ouvert pour un appel (`liveCredential`, lu par `runCall` et par la sonde, `probe.ts`). Les
// champs sont contrôlés contre la déclaration du connecteur, chiffrés ensemble (`vault.ts`) ; les réglages restent en
// clair ; le jeton d'un échange est chiffré à part (`token_ciphertext`), pour qu'un renouvellement n'écrase jamais une
// saisie. Ses écritures (secret, réglages, jetons, droits accordés, état, marque) courent sous le rôle du serveur
// (`inTransaction(…, "server")`), seul à pouvoir les faire, après la décision du service. Sans ce module, un compte ne
// porterait qu'un jeton posé par l'outillage. Rien du secret n'est jamais rendu, ni par un résultat, ni par un refus,
// ni par un log.
import { mergeCredential } from "../../cli/vault.mjs"
import type { AccountMode, ConnectorAccountForm } from "../../schemas"
import { accountSecretSchema } from "../../schemas/connectors"
import { describeOwner } from "../access"
import { declaredConnector, declaredConnectors, type DeclaredAccess, type DeclaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { accountAccess } from "./accesses"
import { formOwnerKinds } from "./account-owners"
import { managedAccount, refuseLinkedId, summary, type AccountOwner, type AccountSummary } from "./accounts"
import { requiredFields, type AccountCredential, type ConsentCredential, type StoredToken, type TokenStore } from "./auth"
import { accountMode } from "./modes"
import { accountMarker, keyRefuser, type CredentialUse, type MarkRemedy } from "./account-marker"
import type { ConnectWhere } from "./connect-link"
import { reconnectRefuser, reconnectSaid } from "./consent-accounts"
import { accountFieldNames, hostFieldsOf, readHostFields } from "./host-fields"
import { accountSettings, settingValueProblem } from "./settings"
import { decryptCredential, decryptToken, encryptCredential, encryptToken, type OpenedCredential } from "./vault"

/** Ce que l'appel lit d'un compte résolu pour l'ouvrir ; `access` : celui qu'il retient, pour un connecteur à plusieurs. */
export type CallAccount = { id: string; label: string; access?: string; mode: AccountMode; owner: AccountOwner }

/** Le chiffré du secret, les réglages, les champs posés, la version de la dernière saisie et la marque d'un compte. */
type SecretRow = { secret: string | null; settings: Record<string, string>; secret_fields: string[]; secret_updated_at: string | null; mark: unknown }

function secretRow(db: PlatformDb, service: string, id: string): Promise<SecretRow | undefined> {
  return inTransaction(db, `${service}: account_secret`, (sql) => sql<SecretRow[]>`
    select platform.account_secret(${id}) as secret, a.settings, a.secret_fields, to_json(a.secret_updated_at) #>> '{}' as secret_updated_at,
           a.health -> 'mark' as mark
      from platform.accounts a where a.id = ${id}`).then(([row]) => row)
}


/** Le connecteur déclaré d'un compte réel ; un connecteur que l'hôte ne déclare plus n'a ni champs ni réglages. */
function declaredOf(connector: string): DeclaredConnector {
  const declared = declaredConnector(connector)
  if (!declared) throw new PlatformError("invalid_arguments", `Connector ${connector} is not declared by this application: its accounts have no fields to set.`)
  return declared
}

/** Les champs d'un secret ouvert ; un secret v1 (un seul champ) se range sous le dernier champ qu'exige l'authentification. */
function fieldsOf(declared: DeclaredAccess, opened: OpenedCredential): Record<string, string> {
  if ("fields" in opened) return opened.fields
  return { [requiredFields(declared.auth).at(-1) ?? declared.definition.credential[0].name]: opened.single }
}

/** Les réglages saisis, contrôlés contre la déclaration ; une adresse perd son `/` final. */
export function checkedSettings(declared: DeclaredAccess, given: Record<string, string | null>): Record<string, string | null> {
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
 * l'écriture est refusée (`stale_revision`). Le dernier test du compte (`lastProbe`) s'efface : il portait sur l'ancienne
 * saisie ; un jeton renouvelé (consentement, échange) n'y touche pas. Rien du secret n'est rendu. Refus : inconnu ou invisible (`not_found`),
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
  const declared = accountAccess(declaredOf(row.connector), { label: row.label, access: row.access })
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
  // Le dernier test portait sur l'ancienne saisie : il s'efface avec elle, dans la même transaction (`lastProbe` à `null`).
  const updated = await inTransaction(db, "setAccountSecret: accounts update", async (sql) => {
    const written = await sql`
      update platform.accounts
         set secret_ciphertext = ${ciphertext}, secret_fields = ${Object.keys(fields).sort()}::text[], settings = ${sql.json(nextSettings)},
             secret_updated_at = now(), token_ciphertext = null, token_expires_at = null
       where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz
       returning id`
    if (written.length > 0) await sql`select platform.forget_account_probe(${id})`
    return written
  }, "server")
  // Aucune ligne après la décision : une autre saisie a été écrite depuis la lecture qui fonde la fusion.
  if (updated.length === 0) {
    console.error(`[platform] setAccountSecret: account ${id} changed since its secret was read`)
    throw new PlatformError("stale_revision", `Account « ${row.label} » was changed meanwhile. Reload it and enter its secret again.`)
  }
  return summary(row)
}

/**
 * Le formulaire du compte de chaque connecteur réel déclaré, tiré de sa déclaration, un par accès pour un connecteur à
 * plusieurs (`access`, son nom et son libellé) : les propriétaires qu'admettent les `modes` de l'accès
 * (`formOwnerKinds`), si sa sonde se joue (`probe`), les champs du secret que garde un compte (jamais ceux de l'hôte),
 * puis les réglages ; ce que l'écran Connecteurs montre pour créer un compte réel ou en saisir le secret. Un accès dont
 * les `modes` n'admettent ni `byo_user` ni `byo_org` (`platform` seul, servi par la clé de l'hôte) n'en a pas. Un accès
 * `oauth2_user` (`consent`) n'a ni champ ni réglage : chacun y connecte son compte par son consentement. Un connecteur à
 * `accountIdentity` (`hosted`) se branche par la personne, si l'hôte en a fourni le port (`ready`). Sans lecture de
 * base, sans rôle exigé : aucun secret n'y figure.
 */
export function connectorAccountForms(): ConnectorAccountForm[] {
  return declaredConnectors().flatMap(({ accesses }) =>
    accesses.flatMap(({ name, label: accessLabel, definition, hostedLinks, probe }) => {
      const ownerKinds = formOwnerKinds(definition)
      if (ownerKinds.length === 0) return []
      return [
        {
          connector: definition.name,
          label: definition.label,
          ...(name !== null && accessLabel !== null ? { access: { name, label: accessLabel } } : {}),
          consent: definition.auth.kind === "oauth2_user",
          ...(definition.accountIdentity ? { hosted: { ready: hostedLinks !== null } } : {}),
          ownerKinds,
          probe: { available: probe !== null, balance: definition.probe?.balance !== undefined },
          fields: definition.credential.filter((field) => field.holder !== "host").map(({ name: field, label, secret }) => ({ name: field, label, secret })),
          settings: (definition.settings ?? []).map((setting) => (setting.type === "choice" ? { ...setting, choices: [...setting.choices] } : { ...setting })),
        },
      ]
    }),
  )
}

/** Le jeton d'un échange, lu et écrit sur la ligne du compte, chiffré à part du secret saisi. */
export function tokenStore(db: PlatformDb, accountId: string): TokenStore {
  return {
    async read() {
      const [row] = await inTransaction(db, "tokenStore: account_token", (sql) => sql<{ token: string | null; expires_at: string | null; scopes: string[] | null }[]>`
        select platform.account_token(${accountId}) as token, to_json(a.token_expires_at) #>> '{}' as expires_at, a.granted_scopes as scopes
          from platform.accounts a where a.id = ${accountId}`)
      if (!row?.token) return null
      return { token: decryptToken(accountId, row.token), expiresAt: row.expires_at ? new Date(row.expires_at) : null, ...(row.scopes ? { scopes: row.scopes } : {}) }
    },
    async write({ token, expiresAt, scopes }: StoredToken) {
      const ciphertext = encryptToken(accountId, token)
      // Des droits dits remplacent ceux du compte ; sans eux (un échange, un compte de service sans niveaux), rien n'y touche.
      await inTransaction(db, "tokenStore: accounts update", (sql) => sql`
        update platform.accounts set token_ciphertext = ${ciphertext}, token_expires_at = ${expiresAt}, granted_scopes = coalesce(${scopes ?? null}::text[], granted_scopes)
         where id = ${accountId}`, "server")
    },
  }
}

/** Le premier champ du compte exigé par l'authentification qui manque, nommé par son libellé ; `null` : aucun. */
export function missingField(declared: DeclaredAccess, present: readonly string[]): string | null {
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
async function consentOpener(
  db: PlatformDb,
  remedy: MarkRemedy,
  declared: Pick<DeclaredAccess, "definition" | "application">,
  row: SecretRow | undefined,
): Promise<() => Promise<AccountCredential>> {
  const { definition, application } = declared
  if (!application) throw applicationMissing(definition.label)
  const { account, own } = remedy
  if (!row?.secret) throw await remedy.refuse(`Account « ${account.label} » is not connected yet.`)
  const ciphertext = row.secret
  const id = account.id
  let version = row.secret_updated_at
  const mark = accountMarker(db, row.mark, remedy)
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
             where id = ${id}`, "server")
          return
        }
        const secret = encryptCredential(id, { refresh_token: rotated })
        const [written] = await inTransaction(db, "consent: rotated", (sql) => sql<{ version: string }[]>`
          update platform.accounts
             set secret_ciphertext = ${secret}, secret_fields = ${["refresh_token"]}::text[], secret_updated_at = now(),
                 token_ciphertext = ${access}, token_expires_at = ${token.expiresAt}, granted_scopes = coalesce(${scopes}::text[], granted_scopes)
           where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz
           returning to_json(secret_updated_at) #>> '{}' as version`, "server")
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
           where id = ${id} and secret_updated_at is not distinct from ${version}::text::timestamptz`, "server")
        console.error(`[platform] connector ${definition.name}: the consent of account ${id} no longer holds, account to connect again`)
        return remedy.refuse(reconnectSaid(definition.name, account.label, reason, own))
      },
    }
    return { fields: {}, settings: {}, tokens: tokenStore(db, id), consent, mark }
  }
}

/**
 * Le consentement ouvert du compte personnel `account` de l'appelant, hors de tout connecteur déclaré : celui de l'API de
 * l'hôte de son organisation (`host-api/consent.ts`), avec le connecteur vu par le moteur et le client de consentement
 * de l'instance. Mêmes renouvellement, rotation et passage à reconnecter qu'un compte `oauth2_user` (`consentOpener`).
 */
export async function ownConsentCredential(
  where: ConnectWhere,
  account: CallAccount,
  access: Pick<DeclaredAccess, "definition" | "application">,
): Promise<AccountCredential> {
  const { db, identity } = where
  const row = await secretRow(db, "ownConsentCredential", account.id)
  const who = () => describeOwner(db, identity, account.owner)
  const refuse = reconnectRefuser(where, access.definition.name, account, true)
  const remedy: MarkRemedy = { account, own: true, reconnect: true, hostKey: false, use: "call", who, refuse, refuseKey: keyRefuser(where, access.definition.name, account) }
  return (await consentOpener(db, remedy, access, row))()
}

/**
 * Le compte d'un appel à un connecteur réel déclaré, lu après sa résolution et avant tout récapitulatif ; rend de quoi
 * l'ouvrir pour `run` seul, au dernier moment, par l'accès qu'il retient (`accountAccess`). Refus nommés, la fonction
 * non appelée (`not_enabled`, qui dit à qui demander) : un compte simulé ; un compte d'un connecteur à plusieurs accès
 * qui n'en retient pas, ou un que la déclaration ne porte plus ; un compte sans secret, ou sans un champ qu'exige l'authentification ; un réglage
 * manquant ou devenu invalide ; un compte `oauth2_user` sans consentement, ou sans l'application OAuth de l'hôte ; un
 * champ de l'hôte qu'il n'a pas fourni ; un compte d'un connecteur à `accountIdentity` sans identifiant chez le tiers
 * (`linked_id`), ou dont l'identifiant ne suit plus le motif. Un compte sans secret mène à la saisie de sa clé
 * (`accountKeyRefusal`, `reason: no_account`, geste `key`) ; un consentement ou un compte rattaché à reconnecter, à son
 * geste (`connectRefusal`). Les champs de l'hôte (`holder: host`) se lisent à
 * l'ouverture et s'ajoutent à ceux du compte ; l'identifiant va à l'adresse de base, jamais à un argument. Un compte
 * marqué (clé refusée, crédits épuisés) n'est pas refusé ici : il s'ouvre avec sa marque, que l'appel pose ou lève, et
 * dont le refus dépend de `use` (`markRefusal`).
 */
export async function liveCredential(where: ConnectWhere, account: CallAccount, connector: string, use: CredentialUse): Promise<() => Promise<AccountCredential>> {
  const { db, identity } = where
  const who = () => describeOwner(db, identity, account.owner)
  if (account.mode === "simule") {
    throw new PlatformError(
      "not_enabled",
      `Account « ${account.label} » is simulated, but ${connector} is a live connector: it runs on live accounts only. Ask ${await who()} to connect a live account.`,
    )
  }
  const connectorDeclared = declaredConnector(connector)
  if (!connectorDeclared) {
    console.error(`[platform] call: live connector ${connector} is not declared`)
    throw new PlatformError("internal", "Internal error.")
  }
  // Le compte s'ouvre et se signe par l'accès qu'il retient, jamais par un autre.
  const declared = accountAccess(connectorDeclared, account)
  const row = await secretRow(db, "liveCredential", account.id)
  const own = account.owner.kind === "user" && account.owner.userId === identity.user.id
  const consent = declared.auth.kind === "user_consent"
  // Un consentement et un compte rattaché se reconnectent ; un autre compte sans champ à lui signe avec la clé de
  // l'hôte (`holder: host`).
  const reconnect = consent || declared.definition.accountIdentity !== undefined
  const hostKey = accountFieldNames(declared.definition).length === 0
  const remedy: MarkRemedy = { account, own, reconnect, hostKey, use, who, refuse: reconnectRefuser(where, connector, account, own), refuseKey: keyRefuser(where, connector, account) }
  if (consent) {
    // Un compte partagé (règle d'accès) sert aussi à d'autres que sa personne : seule elle peut le (re)connecter.
    return consentOpener(db, remedy, declared, row)
  }
  if (!row) {
    console.error(`[platform] liveCredential: account ${account.id} resolved but not read back`)
    throw new PlatformError("internal", "Internal error.")
  }
  // Un compte sans champ à lui (tous fournis par l'hôte) n'a pas de secret : il n'en exige pas.
  if (!row.secret && !hostKey) throw await remedy.refuseKey("no_account", `Account « ${account.label} » has no secret yet.`)
  readHostFields(declared, identity.org)
  const linkedId = declared.definition.accountIdentity ? await linkedIdOf(db, account, declared, remedy.refuse) : undefined
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
  const mark = accountMarker(db, row.mark, remedy)
  return async () => {
    const fields = ciphertext ? fieldsOf(declared, decryptCredential(account.id, ciphertext)) : {}
    await refuseMissing(Object.keys(fields))
    return { fields: { ...fields, ...readHostFields(declared, identity.org) }, settings: checked.settings, tokens: tokenStore(db, account.id), mark, ...(linkedId !== undefined ? { linkedId } : {}) }
  }
}

/**
 * L'identifiant chez le tiers du compte d'un connecteur à `accountIdentity` (`linked_id`), lu par
 * `platform.account_linked_id` (jamais accordé en lecture à `authenticated`) et recontrôlé contre le motif déclaré.
 * Aucun : le compte n'est pas branché (`not_enabled`, « connect your account ») ; hors motif : à reconnecter.
 */
async function linkedIdOf(db: PlatformDb, account: CallAccount, declared: DeclaredAccess, refuse: MarkRemedy["refuse"]): Promise<string> {
  const accountIdentity = declared.definition.accountIdentity
  if (!accountIdentity) {
    console.error(`[platform] liveCredential: ${declared.definition.name} has no accountIdentity`)
    throw new PlatformError("internal", "Internal error.")
  }
  const [row] = await inTransaction(db, "liveCredential: account_linked_id", (sql) => sql<{ linked_id: string | null }[]>`
    select platform.account_linked_id(${account.id}) as linked_id`)
  const label = declared.definition.label
  if (!row?.linked_id) throw await refuse(`Account « ${account.label} » is not connected to ${label} yet.`)
  if (!new RegExp(accountIdentity.pattern).test(row.linked_id)) {
    console.error(`[platform] connector ${declared.definition.name}: account ${account.id} has a linked id out of its pattern`)
    throw await refuse(`Account « ${account.label} » must be connected again to ${label}.`)
  }
  return row.linked_id
}
