// Un connecteur décrit de test (moteur des connecteurs décrits), écrit à la main dans la forme que rend la fabrique du
// dépôt `connectors` : le paquet n'importe aucun connecteur réel. Il porte de quoi exercer chaque part du moteur :
// authentification `bearer`, en-tête constant, listes en query (`brackets`), argument encodé en JSON, pagination par
// curseur, sortie taillée, refus propre à une fonction, contrôle avant l'appel (`equal_sums`) et sur la réponse
// (`non_empty`), constantes, `PUT`, `DELETE` à corps, fonction sensible et sonde. Et ses variantes : sous le
// consentement d'une personne, à compte rattaché (`hostedConnector`), avec un faux port du branchement hébergé, et à
// table d'erreurs qui marque le compte (`markingConnector`), avec une marque gardée en mémoire ; à fonctions qui ont
// leur délai propre (`timedConnector`) ; enfin à lot payant soumis puis relevé (`billedConnector`), coût à l'élément,
// quantité relue et travail asynchrone ; à dépôt d'un fichier en transit en corps multipart (`uploadConnector`) ; et à
// fonctions qui rendent un fichier (`fileConnector`), par adresse, par corps et en base64.
import type { AccountMark, AccountMarkReason } from "../../packages/plateforme/schemas"
import type { AccountMarker, ConsentCredential, StoredToken, TokenStore } from "../../packages/plateforme/server/connectors/auth"
import type { ConnectorDefinition, ConnectorFunctionDefinition, HostedLinkProvider } from "../../packages/plateforme/server/connectors/definition"
import { PlatformError } from "../../packages/plateforme/server/errors"

const ID = { type: "string", pattern: "^[a-z0-9_-]{1,40}$" }

const PAGES = {
  all_pages: { type: "boolean", description: "Read the following pages too, up to max_pages (at most 3)." },
  max_pages: { type: "integer", minimum: 1, maximum: 3, default: 3, description: "Pages read when all_pages is true." },
}

/** Les fonctions du connecteur `name`, au nom qualifié `<name>.<fonction>`. */
function functions(name: string): ConnectorFunctionDefinition[] {
  const empty = { pathParams: [], query: {}, body: {}, headers: {} }
  return [
    {
      name: `${name}.get_company`,
      connector: name,
      class: "read",
      act: false,
      description: "Get the company the key belongs to, and the key's scopes.",
      schema: { type: "object", additionalProperties: false, properties: {} },
      examples: [{ title: "Company and scopes", input: {} }],
      refusals: [],
      request: { method: "GET", path: "/me", ...empty },
    },
    {
      name: `${name}.list_contacts`,
      connector: name,
      class: "read",
      act: false,
      description: "List the contacts, one page at a time. Pass next_cursor as cursor for the next page.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          filter: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: { enum: ["city"] }, value: { type: "string" } } } },
          ...PAGES,
        },
      },
      examples: [{ title: "Contacts in Lyon", input: { filter: [{ field: "city", value: "Lyon" }] } }],
      refusals: [],
      request: { method: "GET", path: "/contacts", pathParams: [], query: { limit: "limit", cursor: "cursor", tags: "tags", filter: "filter" }, body: {}, headers: {}, constants: { query: { view: "full" } }, encode: { filter: "json" } },
      pagination: { kind: "cursor", requestParam: "cursor", next: "next_cursor", more: "has_more", maxPages: 3 },
      output: { items: "items", strip: ["secret_note"] },
    },
    {
      name: `${name}.get_contact`,
      connector: name,
      class: "read",
      act: false,
      description: "Get one contact by its id, with its email.",
      schema: { type: "object", additionalProperties: false, required: ["contact_id"], properties: { contact_id: ID } },
      examples: [{ title: "One contact", input: { contact_id: "c-42" } }],
      refusals: [
        { code: "contact_not_found", when: 404, message: "No contact with this id." },
        { code: "email_missing", when: "email is empty in the response", message: "The contact has no email." },
      ],
      expect: [{ kind: "non_empty", refusal: "email_missing", path: "email" }],
      request: { method: "GET", path: "/contacts/{contact_id}", pathParams: ["contact_id"], query: {}, body: {}, headers: {} },
      output: { projection: ["id", "name", "email"] },
    },
    {
      name: `${name}.rename_contact`,
      connector: name,
      class: "write",
      act: false,
      description: "Rename a contact.",
      schema: { type: "object", additionalProperties: false, required: ["contact_id", "name"], properties: { contact_id: { type: "string" }, name: { type: "string", minLength: 1 } } },
      examples: [{ title: "Rename", input: { contact_id: "c-42", name: "Ada" } }],
      refusals: [],
      request: { method: "PUT", path: "/contacts/{contact_id}", pathParams: ["contact_id"], query: {}, body: { name: "name" }, headers: {} },
    },
    {
      name: `${name}.untag_contact`,
      connector: name,
      class: "write",
      act: false,
      description: "Remove a tag from a contact, saying why.",
      schema: { type: "object", additionalProperties: false, required: ["tag_id", "reason"], properties: { tag_id: ID, reason: { type: "string" } } },
      examples: [{ title: "Remove a duplicate tag", input: { tag_id: "t-1", reason: "duplicate" } }],
      refusals: [],
      request: { method: "DELETE", path: "/tags/{tag_id}", pathParams: ["tag_id"], query: {}, body: { reason: "reason" }, headers: {} },
    },
    {
      name: `${name}.post_entry`,
      connector: name,
      class: "sensitive",
      act: true,
      description: "Post a balanced accounting entry: it cannot be deleted.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["label", "lines"],
        properties: {
          label: { type: "string", minLength: 1 },
          lines: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { debit: { type: "string", pattern: "^-?[0-9]+(\\.[0-9]+)?$" }, credit: { type: "string", pattern: "^-?[0-9]+(\\.[0-9]+)?$" } },
            },
          },
        },
      },
      examples: [{ title: "A balanced entry", input: { label: "Fees", lines: [{ debit: "15.00" }, { credit: "15" }] } }],
      refusals: [{ code: "entry_unbalanced", when: "total debits differ from total credits", message: "The entry is not balanced: total debits must equal total credits." }],
      checks: [{ kind: "equal_sums", refusal: "entry_unbalanced", items: "lines", fields: ["debit", "credit"] }],
      request: {
        method: "POST",
        path: "/entries",
        pathParams: [],
        query: {},
        body: { label: "label", lines: "lines" },
        headers: {},
        constants: { body: { draft: false }, headers: { "Crm-Mode": "strict" } },
      },
      confirm: { summary: 'Post entry "{label}": it cannot be deleted.' },
    },
  ]
}

/** Le connecteur décrit de test, sous le nom `name` (un nom propre au passage pour une suite sur base réelle). */
export function describedConnector(name = "crm"): ConnectorDefinition {
  return {
    name,
    label: "Crm",
    baseUrl: "https://crm.example.test/v2",
    auth: { kind: "bearer", token: "api_key" },
    credential: [{ name: "api_key", label: "API key", secret: true }],
    timeoutMs: 5_000,
    queryArrays: "brackets",
    headers: { "Crm-Version": "2026-10" },
    errors: [
      { status: 400, code: "invalid_request", message: "Crm rejected the request as invalid.", retryable: false },
      { status: [401, 403], code: "access_rejected", message: "Crm refused access: the key is invalid or lacks the scope.", retryable: false },
      { status: 404, code: "not_found", message: "No such object in Crm.", retryable: false },
      { status: 429, code: "rate_limited", message: "Crm request rate exceeded: retry later.", retryable: true },
      { status: [500, 502, 503], code: "upstream_unavailable", message: "Crm is temporarily unavailable: retry later.", retryable: true },
    ],
    probe: { function: `${name}.get_company`, nonEmpty: ["scopes"] },
    functions: functions(name),
  }
}

/**
 * Le connecteur de test dont la sonde (`get_company`) et la liste paginée (`list_contacts`) ont leur délai propre,
 * `timeoutMs`, à la place de celui du connecteur (5 s) ; les autres fonctions gardent celui du connecteur.
 */
export function timedConnector(timeoutMs: number, name = "crm"): ConnectorDefinition {
  const base = describedConnector(name)
  const timed = [`${name}.get_company`, `${name}.list_contacts`]
  return { ...base, functions: base.functions.map((fn) => (timed.includes(fn.name) ? { ...fn, timeoutMs } : fn)) }
}

/**
 * Le connecteur de test dont la table d'erreurs marque le compte : les crédits épuisés sous un 200 (une erreur dans le
 * corps), l'autorisation expirée sous un 400 (un code dans le corps, avant le 400 ordinaire), la clé refusée sur un 401 ;
 * un 403 (un droit manque) ne marque rien.
 */
export function markingConnector(name = "crm"): ConnectorDefinition {
  const base = describedConnector(name)
  return {
    ...base,
    errors: [
      { status: 200, body: { path: "error.code", equals: ["NO_CREDITS"] }, code: "no_credits", message: "Crm credits are spent.", retryable: false, marksAccount: "quota_exhausted" },
      { status: 400, body: { path: "error.code", equals: [190, 102] }, code: "authorization_expired", message: "Crm no longer accepts this authorization.", retryable: false, marksAccount: "credential_rejected" },
      { status: 400, code: "invalid_request", message: "Crm rejected the request as invalid.", retryable: false },
      { status: 401, code: "key_rejected", message: "Crm refused the key.", retryable: false, marksAccount: "credential_rejected" },
      { status: 403, code: "scope_missing", message: "Crm refused: the key lacks the scope.", retryable: false },
      { status: 429, code: "rate_limited", message: "Crm request rate exceeded: retry later.", retryable: true },
    ],
  }
}

/** La marque d'un compte gardée par le test à la place de la ligne du compte ; `sets` relève chaque écriture demandée. */
export function memoryMark(initial: AccountMark | null = null, who = "team Ventes (lead: Claire Morel)"): AccountMarker & { sets: (AccountMarkReason | null)[] } {
  const sets: (AccountMarkReason | null)[] = []
  const marker = {
    sets,
    current: initial,
    effect: null as AccountMarker["effect"],
    async set(reason: AccountMarkReason | null) {
      sets.push(reason)
      if ((marker.current?.reason ?? null) === reason) return
      marker.current = reason === null ? null : { reason, at: new Date().toISOString() }
      marker.effect = reason === null ? "lifted" : "marked"
    },
    async remedy() {
      return `Account « Crm Ventes » is marked since ${marker.current?.at}. Ask ${who}.`
    },
  }
  return marker
}

/** L'application OAuth de test d'un connecteur à consentement : identifiant et secret tirés par le test. */
export const TEST_APPLICATION = { clientId: "client-test", clientSecret: "secret-test" }

/**
 * Le connecteur décrit de test sous le consentement d'une personne (`oauth2_user`), de la forme que rend la fabrique :
 * sans champ, l'identité lue par `get_company` (son `email`), rotation du jeton de rafraîchissement.
 */
export function consentConnector(name = "crm"): ConnectorDefinition {
  return {
    ...describedConnector(name),
    credential: [],
    auth: {
      kind: "oauth2_user",
      authorizeUrl: "https://login.crm.example.test/authorize",
      tokenUrl: "https://login.crm.example.test/token",
      clientAuth: "body",
      scopes: ["offline_access", "contacts.read"],
      authorizeParams: { prompt: "select_account" },
      refresh: "refresh_token",
      rotates: true,
      expiresInDefault: 3600,
      identity: { function: `${name}.get_company`, path: "email" },
    },
  }
}

/** Les droits exigés de chaque fonction du connecteur de test à niveaux, par nom court. */
const FUNCTION_SCOPES: Record<string, string[]> = {
  get_company: ["contacts.read"],
  list_contacts: ["contacts.read"],
  get_contact: ["contacts.read"],
  rename_contact: ["contacts.write"],
  untag_contact: ["contacts.write"],
  post_entry: ["entries.write"],
}

/**
 * Le connecteur à consentement de test sous des niveaux d'accès, de la forme que rend la fabrique : `read` et `full`,
 * un droit qui en couvre un autre (`scopeImplies`), les droits exigés de chaque fonction, et l'identité lue à une
 * adresse complète (le service d'identité commun d'un fournisseur), avec ses droits.
 */
export function leveledConsentConnector(name = "crm"): ConnectorDefinition {
  const base = consentConnector(name)
  return {
    ...base,
    auth: {
      kind: "oauth2_user",
      authorizeUrl: "https://login.crm.example.test/authorize",
      tokenUrl: "https://login.crm.example.test/token",
      clientAuth: "body",
      authorizeParams: { prompt: "select_account" },
      refresh: "refresh_token",
      rotates: true,
      expiresInDefault: 3600,
      accessLevels: {
        read: { scopes: ["offline_access", "contacts.read"] },
        full: { scopes: ["offline_access", "contacts.write", "entries.write"] },
      },
      scopeImplies: { "contacts.write": ["contacts.read"] },
      identity: { url: "https://id.crm.example.test/v1/userinfo", path: "email", scopes: ["openid", "email"] },
    },
    functions: base.functions.map((fn) => ({ ...fn, scopes: FUNCTION_SCOPES[fn.name.slice(name.length + 1)] })),
  }
}

/** Le consentement d'un compte gardé par le test : `renewals` relève chaque renouvellement, `revocations` chaque raison. */
export function memoryConsent(refreshToken: string | null): ConsentCredential & { renewals: { token: string; rotated: string | null; scopes: string[] | null }[]; revocations: string[] } {
  const renewals: { token: string; rotated: string | null; scopes: string[] | null }[] = []
  const revocations: string[] = []
  const consent = {
    application: TEST_APPLICATION,
    refreshToken,
    renewals,
    revocations,
    renewed: async (token: StoredToken, rotated: string | null, scopes: string[] | null) => {
      renewals.push({ token: token.token, rotated, scopes })
      if (rotated) consent.refreshToken = rotated
    },
    revoked: async (reason: string) => {
      revocations.push(reason)
      return new PlatformError("not_enabled", `to connect again: ${reason}`)
    },
  }
  return consent
}

/** Le jeton d'un échange gardé par le test à la place de la ligne du compte ; `written` relève chaque écriture. */
export function memoryTokens(initial: StoredToken | null = null): TokenStore & { written: StoredToken[] } {
  let kept = initial
  const written: StoredToken[] = []
  return {
    written,
    read: async () => kept,
    write: async (token) => {
      kept = token
      written.push(token)
    },
  }
}

/** Le motif de l'identifiant d'un compte chez le tiers de test. */
export const HOSTED_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$"

/**
 * Le connecteur décrit de test à compte rattaché (`accountIdentity`), de la forme que rend la fabrique : la clé
 * `api_key` fournie par l'hôte (`holder: host`), l'identifiant du compte chez le tiers cité par l'adresse de base.
 */
export function hostedConnector(name = "crm"): ConnectorDefinition {
  const described = describedConnector(name)
  return {
    ...described,
    label: "Hosted Crm",
    baseUrl: "https://crm.example.test/v2/{account_id}",
    auth: { kind: "api_key", in: "header", name: "X-Api-Key", key: "api_key" },
    credential: [{ name: "api_key", label: "API key", secret: true, holder: "host" }],
    accountIdentity: { name: "account_id", label: "Account", pattern: HOSTED_ID_PATTERN },
  }
}

/** Un compte de la clé de test : son identifiant, sa date de création chez le tiers, sa sonde. */
export type FakeHostedAccount = { id: string; createdAt: string | null; probe: "alive" | "dead" | "unavailable" | "throws"; who?: string }

/**
 * Le faux port du branchement hébergé : les comptes de la clé (`accounts`, modifiables par le test), et le relevé de
 * chaque appel (`calls`). `fail` fait lever une méthode ; `url` remplace l'adresse rendue par `createLink`.
 */
export function fakeHostedLinks(accounts: FakeHostedAccount[] = []) {
  const calls: { method: keyof HostedLinkProvider; input: unknown }[] = []
  const state = { accounts, fail: null as keyof HostedLinkProvider | null, url: "https://link.example.test/auth/abc" }
  const failing = (method: keyof HostedLinkProvider) => {
    if (state.fail === method) throw new TypeError("fetch failed: secret-key-123 at https://api.example.test")
  }
  const port: HostedLinkProvider = {
    async createLink(input) {
      calls.push({ method: "createLink", input })
      failing("createLink")
      return { url: state.url }
    },
    async listAccounts() {
      calls.push({ method: "listAccounts", input: null })
      failing("listAccounts")
      return state.accounts.map(({ id, createdAt }) => ({ id, createdAt }))
    },
    async probe(id) {
      calls.push({ method: "probe", input: id })
      failing("probe")
      const account = state.accounts.find((entry) => entry.id === id)
      if (!account || account.probe === "dead") return { state: "dead" }
      if (account.probe === "throws") throw new Error("probe exploded")
      if (account.probe === "unavailable") return { state: "unavailable" }
      return { state: "alive", label: account.who ?? `${id}@example.test` }
    },
  }
  return { port, calls, state }
}

/**
 * Le connecteur de test avec un lot payant : `submit_enrichment` coûte à l'élément (`contacts` × `fields`, en `fields`),
 * soumet un travail relevé par `get_enrichment` (identifiant `job.id` → `enrichment_id`, dix minutes), qui en dit la
 * quantité trouvée (`summary.found`).
 */
export function billedConnector(name = "crm"): ConnectorDefinition {
  const base = describedConnector(name)
  const list = (items: object) => ({ type: "array", minItems: 1, items })
  const submit: ConnectorFunctionDefinition = {
    name: `${name}.submit_enrichment`,
    connector: name,
    class: "write",
    act: true,
    description: "Submit contacts to enrich with the fields asked; collect the result with get_enrichment.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["contacts", "fields"],
      properties: { contacts: list({ type: "string" }), fields: list({ enum: ["email", "phone"] }) },
    },
    examples: [{ title: "Two contacts, email and phone", input: { contacts: ["c-1", "c-2"], fields: ["email", "phone"] } }],
    refusals: [],
    request: { method: "POST", path: "/enrichments", pathParams: [], query: {}, body: { contacts: "contacts", fields: "fields" }, headers: {} },
    cost: { per: "item", items: "contacts", times: "fields", unit: "fields", settle: { path: "summary.found" } },
    async: { collect: `${name}.get_enrichment`, jobId: { from: "job.id", to: "enrichment_id" }, withinMs: 600_000 },
  }
  const collect: ConnectorFunctionDefinition = {
    name: `${name}.get_enrichment`,
    connector: name,
    class: "read",
    act: false,
    description: "Read the state and the result of an enrichment.",
    schema: { type: "object", additionalProperties: false, required: ["enrichment_id"], properties: { enrichment_id: ID } },
    examples: [{ title: "One enrichment", input: { enrichment_id: "e-1" } }],
    refusals: [],
    request: { method: "GET", path: "/enrichments/{enrichment_id}", pathParams: ["enrichment_id"], query: {}, body: {}, headers: {} },
  }
  return { ...base, functions: [...base.functions, submit, collect] }
}

/**
 * Le connecteur de test qui dépose un fichier : `upload_document` envoie en `multipart/form-data` le fichier en transit
 * que nomme `file` (partie `document`), `folder_id` et `title` en parties texte, `source: "oto"` en constante ; un 422
 * est son refus nommé `document_rejected` ; le lien de la réponse est retiré.
 */
export function uploadConnector(name = "crm"): ConnectorDefinition {
  const base = describedConnector(name)
  const upload: ConnectorFunctionDefinition = {
    name: `${name}.upload_document`,
    connector: name,
    class: "write",
    act: true,
    description: "Upload a transit file of yours into a folder; the file is consumed once Crm accepts it.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["folder_id", "file"],
      properties: { folder_id: { type: "integer", minimum: 1 }, file: { type: "string", format: "uuid" }, title: { type: "string", maxLength: 255 } },
    },
    examples: [{ title: "A file into a folder", input: { folder_id: 7, file: "0f8fad5b-d9cb-469f-a165-70867728950e" } }],
    refusals: [{ code: "document_rejected", when: 422, message: "Crm refused this document." }],
    request: {
      method: "POST",
      path: "/folders/{folder_id}/documents",
      pathParams: ["folder_id"],
      query: {},
      body: { title: "title" },
      headers: {},
      files: { document: "file" },
      constants: { body: { source: "oto" } },
    },
    output: { strip: ["url"] },
  }
  return { ...base, functions: [...base.functions, upload] }
}

/** Une fonction de lecture du connecteur de test qui rend un fichier, à un seul argument requis, entier. */
function fileFunction(name: string, at: { short: string; argument: string; path: string }, file: NonNullable<ConnectorFunctionDefinition["output"]>["file"], extra: Partial<ConnectorFunctionDefinition> = {}): ConnectorFunctionDefinition {
  const { short, argument, path } = at
  return {
    name: `${name}.${short}`,
    connector: name,
    class: "read",
    act: false,
    description: "Get a file of yours, kept 24 hours: the answer gives its file id, to pass as is to a function that takes a file. Never a link.",
    schema: { type: "object", additionalProperties: false, required: [argument], properties: { [argument]: { type: "integer", minimum: 0 } } },
    examples: [{ title: "One file", input: { [argument]: 42 } }],
    refusals: [],
    request: { method: "GET", path: `${path}/{${argument}}`, pathParams: [argument], query: {}, body: {}, headers: {} },
    output: { file },
    ...extra,
  }
}

/**
 * Le connecteur de test dont des fonctions rendent un fichier (`output.file`) : `get_call_recording`, l'adresse signée
 * d'un enregistrement dans la fiche d'un appel, téléchargée sans authentification ; `download_recording`, l'audio pour
 * corps, nommé par `Content-Disposition`, borné à 1 Ko ; `get_export`, un export en base64 nommé par un champ ;
 * `get_attachment`, une pièce en base64url bornée à 64 octets ; `get_archive`, une adresse téléchargée avec
 * l'authentification du compte, à l'origine de l'API seulement ; `get_slow_recording`, le corps sous un délai d'une seconde.
 */
export function fileConnector(name = "crm"): ConnectorDefinition {
  const base = describedConnector(name)
  return {
    ...base,
    functions: [
      ...base.functions,
      fileFunction(name, { short: "get_call_recording", argument: "call_id", path: "/calls" }, {
        from: "url",
        path: "call.recording",
        types: { mp3: ["audio/mpeg", "audio/mp3"] },
        name: { template: "call-{call_id}-recording.mp3" },
      }),
      fileFunction(name, { short: "download_recording", argument: "recording_id", path: "/recordings" }, {
        from: "body",
        types: { wav: ["audio/wav", "audio/x-wav", "audio/wave"], mp3: ["audio/mpeg"] },
        name: { header: "Content-Disposition", template: "recording-{recording_id}.wav" },
        maxBytes: 1024,
      }),
      fileFunction(name, { short: "get_export", argument: "export_id", path: "/exports" }, {
        from: "base64",
        path: "export.data",
        types: { csv: ["text/csv"], pdf: ["application/pdf"] },
        name: { path: "export.filename", template: "export-{export_id}.csv" },
      }),
      fileFunction(name, { short: "get_attachment", argument: "attachment_id", path: "/attachments" }, {
        from: "base64url",
        path: "data",
        types: { pdf: ["application/pdf"] },
        name: { template: "attachment-{attachment_id}.pdf" },
        maxBytes: 64,
      }),
      fileFunction(name, { short: "get_archive", argument: "archive_id", path: "/archives" }, {
        from: "url",
        path: "archive.url",
        auth: "account",
        types: { zip: ["application/zip"] },
        name: { header: "Content-Disposition", path: "archive.name", template: "archive-{archive_id}.zip" },
      }),
      fileFunction(
        name,
        { short: "get_slow_recording", argument: "recording_id", path: "/slow-recordings" },
        { from: "body", types: { mp3: ["audio/mpeg"] }, name: { template: "slow-{recording_id}.mp3" } },
        { timeoutMs: 1_000 },
      ),
    ],
  }
}
