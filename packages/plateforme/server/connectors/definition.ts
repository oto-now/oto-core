// La définition d'un connecteur décrit, telle que l'hôte la déclare au paquet (`registerConnectors`,
// `connecteurs-et-comptes.md` § Moteur des connecteurs décrits) : des données structurelles, sans code, que le moteur
// exécute. Le paquet ne dépend d'aucun dépôt de connecteurs : ce type est le sien, de même forme que la sortie de la
// fabrique du dépôt `connectors` (`ts/src/types.ts`), qu'un hôte lui passe telle quelle ; un connecteur propre à
// l'hôte s'écrit à la main dans cette même forme. Ce qui n'y figure pas (version, modes, quota, exposition) est
// ignoré. Aucun secret ici : `auth` nomme des champs de `credential`, les valeurs viennent du compte à l'appel ; celles
// d'un consentement (`oauth2_user`) viennent de la personne qui a consenti et de l'application OAuth de l'hôte.

/** L'application OAuth d'un connecteur `oauth2_user`, fournie par l'hôte (jamais lue de l'environnement par le paquet). */
export type OAuthApplication = { readonly clientId: string; readonly clientSecret: string }

export type ConnectorFunctionClass = "read" | "write" | "sensitive"

export type ConnectorHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** Un JSON Schema 2020-12, validé tel quel et servi tel quel par `read`. */
export type ConnectorJsonSchema = { readonly [key: string]: unknown }

export type ConnectorJsonValue = string | number | boolean | null | readonly ConnectorJsonValue[] | { readonly [key: string]: ConnectorJsonValue }

/**
 * Qui fournit un champ du credential. `account` (par défaut) : saisi avec le compte, chiffré avec lui. `host` : fourni par
 * l'hôte, une fois pour toutes ses organisations (`registerConnectors`, `hostCredentials`), lu à chaque appel ; jamais
 * gardé sur un compte, montré ni saisissable.
 */
export type ConnectorCredentialHolder = "account" | "host"

/**
 * Un champ du credential ; un compte garde, chiffrés ensemble, tous les champs que déclare son connecteur dont `holder`
 * est `account` ; l'hôte fournit les siens.
 */
export type ConnectorCredentialField = { readonly name: string; readonly label: string; readonly secret: boolean; readonly holder?: ConnectorCredentialHolder }

/**
 * L'identité d'un compte rattaché chez un tiers qui héberge les comptes de ses utilisateurs : l'identifiant du compte
 * chez le tiers (`accounts.linked_id`), qui satisfait `pattern` (expression ancrée), cité par la seule adresse de base,
 * après l'hôte, sous `{name}`. Aucun argument ne le porte : il vient du compte que la résolution a désigné.
 */
export type ConnectorAccountIdentity = { readonly name: string; readonly label: string; readonly pattern: string }

/**
 * Le lecteur des champs `holder: host` d'un connecteur, fourni par l'hôte (son environnement, son coffre) : appelé à
 * chaque appel, jamais gardé par le paquet.
 */
export type HostCredentialReader = () => Record<string, string>

/**
 * Le port du branchement hébergé d'un connecteur à `accountIdentity`, que l'hôte fournit à `registerConnectors`
 * (`hostedLinks`) : le paquet n'appelle le tiers que par lui. L'hôte le construit avec sa clé ; aucun champ de l'hôte ni
 * aucun secret n'y passe par le paquet. `createLink` : l'adresse du lien d'authentification hébergée du tiers, pour
 * une demande (`requestId`), à créer ou à reconnecter (`linkedId`, contrôlé par le paquet), revenant à `returnUrl`
 * (construite par le paquet) avant `expiresAt`. `listAccounts` : les comptes de la clé chez le tiers, toutes pages, du
 * bon fournisseur seulement, `createdAt` en ISO 8601 ou `null`. `probe` : la session d'un compte, vivante (avec le nom
 * de son titulaire), morte ou indisponible. Une méthode qui lève vaut `upstream_error`.
 */
export interface HostedLinkProvider {
  createLink(input: {
    requestId: string
    kind: "create" | "reconnect"
    linkedId?: string
    returnUrl: string
    expiresAt: Date
  }): Promise<{ url: string }>
  listAccounts(): Promise<Array<{ id: string; createdAt: string | null }>>
  probe(id: string): Promise<{ state: "alive"; label: string } | { state: "dead" } | { state: "unavailable" }>
}

/**
 * Un réglage non secret d'un compte, saisi par qui le connecte et gardé en clair : `choice`, une valeur d'une liste
 * fermée (`default` à défaut) ; `text`, un texte qui satisfait `pattern` (expression ancrée) ; `url`, une adresse
 * `https://` libre. Un réglage n'est cité que par une adresse (`baseUrl`, `baseUrls`, `tokenUrl`, `tokenUrls`).
 */
export type ConnectorSetting =
  | { readonly name: string; readonly label: string; readonly type: "choice"; readonly choices: readonly string[]; readonly default?: string }
  | { readonly name: string; readonly label: string; readonly type: "text"; readonly pattern: string }
  | { readonly name: string; readonly label: string; readonly type: "url" }

/** Une adresse par valeur d'un réglage `choice`. */
export type ConnectorUrlsBySetting = { readonly setting: string; readonly values: { readonly [choice: string]: string } }

/** Le point de jeton d'un échange : une adresse (gabarit possible) ou une adresse par valeur d'un réglage `choice`. */
export type ConnectorTokenEndpoint = { readonly tokenUrl: string; readonly tokenUrls?: never } | { readonly tokenUrls: ConnectorUrlsBySetting; readonly tokenUrl?: never }

/**
 * Le renouvellement d'un consentement. `refresh_token` : la demande par jeton de rafraîchissement ; si `rotates`, chaque
 * réponse porte un nouveau jeton de rafraîchissement qui remplace l'ancien. `exchange` : le jeton d'accès courant,
 * envoyé dans `exchange.tokenParam` avec `grant_type` = `exchange.grantType`, contre un nouveau. `none` : le jeton vaut
 * jusqu'à expiration ou révocation, puis la personne consent de nouveau.
 */
export type ConnectorOAuthRefresh =
  | { readonly refresh: "refresh_token"; readonly rotates: boolean; readonly exchange?: never }
  | { readonly refresh: "exchange"; readonly exchange: { readonly grantType: string; readonly tokenParam: string }; readonly rotates?: never }
  | { readonly refresh: "none"; readonly rotates?: never; readonly exchange?: never }

/** Les droits que demande le consentement d'un niveau d'accès. */
export type ConnectorAccessLevel = { readonly scopes: readonly string[] }

/**
 * Les droits d'un consentement. Sans niveaux : `scopes`, qui est le niveau `full`. Avec niveaux (`accessLevels`, `full`
 * exigé, et `scopeImplies`, un droit qui en couvre d'autres) : chaque fonction déclare ses `scopes`. Le paquet n'applique
 * pas encore les niveaux : le consentement demande les droits de `full`, qui ne filtre rien.
 */
export type ConnectorOAuthScopes =
  | { readonly scopes?: readonly string[]; readonly accessLevels?: never; readonly scopeImplies?: never }
  | {
      readonly accessLevels: { readonly full: ConnectorAccessLevel; readonly [level: string]: ConnectorAccessLevel }
      readonly scopeImplies?: { readonly [scope: string]: readonly string[] }
      readonly scopes?: never
    }

/**
 * Qui a consenti, lu juste après le consentement : la valeur non vide au chemin `path` de la réponse nomme le compte.
 * Soit `function`, une lecture du connecteur sans argument requis, appelée avec `{}` ; soit `url`, une adresse complète
 * `https` fixe (le service d'identité commun d'un fournisseur), lue en `GET` avec le jeton d'accès, et `scopes`, les
 * droits qu'elle exige, que le consentement demande aussi.
 */
export type ConnectorConsentIdentity =
  | { readonly function: string; readonly path: string; readonly url?: never; readonly scopes?: never }
  | { readonly url: string; readonly path: string; readonly scopes: readonly string[]; readonly function?: never }

/**
 * Le consentement d'une personne (code d'autorisation, OAuth 2.0), de la forme que rend la fabrique. L'application OAuth
 * (identifiant et secret du client) n'est ni ici ni dans `credential` (vide) : l'hôte la fournit à `registerConnectors`.
 * `fromToken` : champs de la réponse de jeton gardés avec le compte.
 */
export type ConnectorOAuthUser = {
  readonly kind: "oauth2_user"
  readonly authorizeUrl: string
  readonly clientAuth: "body" | "basic"
  readonly authorizeParams?: { readonly [param: string]: string }
  readonly pkce?: "S256"
  readonly expiresInDefault?: number
  readonly identity: ConnectorConsentIdentity
  readonly fromToken?: readonly string[]
} & ConnectorTokenEndpoint &
  ConnectorOAuthRefresh &
  ConnectorOAuthScopes

/**
 * L'authentification : `api_key` (en en-tête ou en query), `bearer`, `basic`, `oauth2_client_credentials` et
 * `oauth2_user` (le consentement d'une personne) s'exécutent ; toute autre sorte (`none`) se déclare mais est refusée
 * nommément par `registerConnectors`. Chaque valeur qui désigne un secret nomme un champ de `credential`.
 */
export type ConnectorAuth =
  | { readonly kind: "api_key"; readonly in: "header"; readonly name: string; readonly prefix?: string; readonly key: string }
  | { readonly kind: "api_key"; readonly in: "query"; readonly name: string; readonly prefix?: never; readonly key: string }
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "basic"; readonly username: string; readonly password: string }
  | ({
      readonly kind: "oauth2_client_credentials"
      readonly tokenRequest: "json" | "form"
      readonly clientAuth: "body" | "basic"
      readonly clientId: string
      readonly clientSecret: string
      readonly scope?: string
      readonly expiresInDefault?: number
    } & ConnectorTokenEndpoint)
  | ConnectorOAuthUser
  | { readonly kind: string }

/**
 * Ce qu'une réponse du tiers révèle du compte, qui le marque jusqu'au premier appel réussi : la clé refusée
 * (`credential_rejected`) ou les crédits épuisés (`quota_exhausted`).
 */
export type ConnectorAccountMark = "credential_rejected" | "quota_exhausted"

/**
 * Une condition sur le corps JSON de la réponse : la valeur au chemin pointé `path` est égale (stricte) à l'une de
 * `equals`. Le refus se lit ainsi sous un statut qui ne le dit pas seul (une erreur GraphQL sous un 200, un code d'erreur
 * sous un 400).
 */
export type ConnectorBodyCondition = { readonly path: string; readonly equals: readonly (string | number | boolean)[] }

/**
 * Une ligne de la table d'erreurs : statut du tiers, refus nommé, message en anglais ; `body`, la condition sur le corps
 * sans laquelle la ligne ne s'applique pas ; `marksAccount`, la marque que pose la ligne sur le compte de l'appel. La
 * première ligne qui s'applique l'emporte.
 */
export type ConnectorApiError = {
  readonly status: number | readonly number[]
  readonly code: string
  readonly message: string
  readonly retryable?: boolean
  readonly body?: ConnectorBodyCondition
  readonly marksAccount?: ConnectorAccountMark
}

/**
 * Un refus propre à une fonction : `when` est un statut HTTP (il surcharge la table) ou une condition (contrôle) ;
 * `body` et `marksAccount`, comme une ligne de la table, avec un statut seulement.
 */
export type ConnectorRefusal = {
  readonly code: string
  readonly when: number | string
  readonly message: string
  readonly body?: ConnectorBodyCondition
  readonly marksAccount?: ConnectorAccountMark
}

export type ConnectorExample = { readonly title: string; readonly input: { readonly [argument: string]: unknown } }

/** Nom côté API → nom de l'argument. */
export type ConnectorArgumentMap = { readonly [apiName: string]: string }

export type ConnectorRequest = {
  readonly method: ConnectorHttpMethod
  /** Relatif à `baseUrl`, avec des `{param}` listés dans `pathParams`. */
  readonly path: string
  readonly pathParams: readonly string[]
  readonly query: ConnectorArgumentMap
  /** Corps JSON, quelle que soit la méthode. */
  readonly body: ConnectorArgumentMap
  readonly headers: ConnectorArgumentMap
  readonly constants?: {
    readonly query?: { readonly [apiName: string]: string | number | boolean }
    readonly body?: { readonly [apiName: string]: ConnectorJsonValue }
    readonly headers?: { readonly [header: string]: string }
  }
  /** Argument → `json` : sérialisé en chaîne avant d'être placé. */
  readonly encode?: { readonly [argument: string]: "json" }
}

/** Suivie quand l'agent passe `all_pages` : `next` (chemin pointé de la réponse) va dans l'argument `requestParam`. */
export type ConnectorPagination = {
  readonly kind: "cursor" | "page"
  readonly requestParam: string
  readonly next: string
  readonly more?: string
  readonly maxPages: number
}

export type ConnectorOutput = {
  readonly items?: string
  readonly strip?: readonly string[]
  readonly projection?: readonly string[]
  /** La forme d'un enregistrement, que la fabrique écrit ; ignorée par le moteur. */
  readonly schema?: ConnectorJsonSchema
}

/** Contrôle des arguments avant l'appel : rien n'est envoyé s'il échoue. */
export type ConnectorCheck = {
  readonly kind: string
  readonly refusal: string
  readonly items: string
  readonly fields: readonly [string, string]
}

/** Contrôle de la réponse : le refus nommé au lieu de la réponse s'il échoue. */
export type ConnectorExpectation = { readonly kind: string; readonly refusal: string; readonly path: string }

export type ConnectorFunctionDefinition = {
  /** `<connecteur>.<fonction>`. */
  readonly name: string
  readonly connector: string
  readonly class: ConnectorFunctionClass
  /**
   * La fonction engage ou détruit (envoi, corbeille, archive, déplacement) : servie sous `<connecteur>_act.<fonction>`,
   * les autres sous `<connecteur>.<fonction>`. Jamais `true` pour `read`, jamais `false` pour `sensitive`.
   */
  readonly act: boolean
  /** Les droits que la fonction exige, tous : présents si et seulement si le connecteur a des niveaux d'accès. */
  readonly scopes?: readonly string[]
  readonly description: string
  /** Racine `type: object`, `additionalProperties: false`. */
  readonly schema: ConnectorJsonSchema
  readonly examples: readonly ConnectorExample[]
  readonly refusals: readonly ConnectorRefusal[]
  readonly checks?: readonly ConnectorCheck[]
  readonly expect?: readonly ConnectorExpectation[]
  readonly request: ConnectorRequest
  readonly pagination?: ConnectorPagination
  readonly output?: ConnectorOutput
  /** Gabarit du récapitulatif d'une fonction sensible, avec des `{argument}`. */
  readonly confirm?: { readonly summary: string }
}

export type ConnectorDefinition = {
  readonly name: string
  readonly label: string
  /**
   * Racine `https://` des chemins, sans `/` final ; gabarit possible sur les réglages (`https://{domain}.example.net`) et
   * sur l'identité du compte, après l'hôte (`https://api.example.com/v2/{account_id}`).
   */
  readonly baseUrl?: string
  /** Racine des chemins par valeur d'un réglage `choice` (une région), à la place de `baseUrl`. */
  readonly baseUrls?: ConnectorUrlsBySetting
  readonly auth: ConnectorAuth
  /** Vide pour `oauth2_user` : les jetons d'un consentement ne sont pas des champs. */
  readonly credential: readonly ConnectorCredentialField[]
  /** Présente pour un compte rattaché chez un tiers qui héberge les comptes de ses utilisateurs. */
  readonly accountIdentity?: ConnectorAccountIdentity
  readonly settings?: readonly ConnectorSetting[]
  readonly timeoutMs: number
  readonly queryArrays?: "repeat" | "brackets" | "comma"
  /** En-têtes constants de toute requête ; jamais l'en-tête d'authentification. */
  readonly headers?: { readonly [header: string]: string }
  /** Débit maximal du tiers, par compte : `requests` par fenêtre de `intervalMs`. */
  readonly rateLimit?: { readonly requests: number; readonly intervalMs: number }
  readonly errors: readonly ConnectorApiError[]
  /** Une lecture sans argument requis, appelée avec `{}` ; chaque chemin de `nonEmpty` doit être non vide. */
  readonly probe?: { readonly function: string; readonly nonEmpty: readonly string[] }
  readonly functions: readonly ConnectorFunctionDefinition[]
}
