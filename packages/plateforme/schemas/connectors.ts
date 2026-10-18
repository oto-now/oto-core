// Schémas des services connecteurs (E04-S01) : activer ou désactiver un connecteur, lister ses
// comptes utilisables, créer et désactiver un compte. Sans ce fichier, `activateConnector`,
// `listUsableAccounts`, `createAccount` et `disableAccount` n'auraient pas de validation partagée,
// que les écrans d'E08-S03 reprendront (forms-patterns.md § Principe, H02). `zod/v4`, comme tout
// schemas/ (P1). Les arguments des fonctions `mail.*` restent dans `server/connectors/simulated/`.
import * as z from "zod/v4"
import type { AccountLevelName } from "./rules"

/** La contrainte de `connector_activations.connector` (E01-S06). */
const CONNECTOR_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

const ACCOUNT_MODES = ["simule", "sandbox", "reel"] as const

const ACCOUNT_OWNER_KINDS = ["org", "team", "user"] as const

const connectorNameSchema = z
  .string()
  .trim()
  .regex(CONNECTOR_NAME_PATTERN, "Connector: lowercase letters, digits and _, starting with a letter, 40 characters max, e.g. mail")

/** Libellé rogné, 1 à 80 caractères ; unique sans casse dans l'organisation (index d'E01-S06, N12). */
const accountLabelSchema = z.string().trim().min(1).max(80)

/** `simule` pour un connecteur simulé, `reel` pour un connecteur réel (H85) ; `sandbox` n'est pas encore admis. */
const accountModeSchema = z.enum(ACCOUNT_MODES)

export type AccountMode = z.infer<typeof accountModeSchema>

/** Le connecteur visé : l'activer, le désactiver, lister ses comptes utilisables. */
export const connectorRefSchema = z.object({ connector: connectorNameSchema })

/**
 * `team_id` est exigé pour un compte d'équipe et refusé ailleurs. Un compte personnel est celui de
 * la personne qui le crée : aucun champ ne désigne quelqu'un d'autre (N15). Une porte qui reçoit un
 * slug d'équipe (MCP admin, E08-S06) le résout en `team_id` avant d'appeler le service.
 */
export const createAccountSchema = z
  .object({
    connector: connectorNameSchema,
    owner_kind: z.enum(ACCOUNT_OWNER_KINDS),
    team_id: z.uuid().optional(),
    label: accountLabelSchema,
    mode: accountModeSchema.default("simule"),
  })
  .superRefine((account, context) => {
    if (account.owner_kind === "team" && !account.team_id) {
      context.addIssue({ code: "custom", path: ["team_id"], message: "team_id is required for a team account" })
    }
    if (account.owner_kind !== "team" && account.team_id) {
      context.addIssue({ code: "custom", path: ["team_id"], message: "team_id is only for a team account" })
    }
  })

export const disableAccountSchema = z.object({ account_id: z.uuid() })

/** Le chemin d'un écran de l'hôte où revenir après un consentement : relatif, jamais vers une autre adresse. */
const returnPathSchema = z
  .string()
  .max(500)
  .regex(/^\/(?![/\\])[\x21-\x7E]*$/, "a path of this address, starting with a single /")

/**
 * Le consentement d'une personne à un connecteur `oauth2_user` (`startConnectorConsent`, `POST connector-consent`) :
 * le connecteur, et l'écran de l'hôte où revenir ensuite (`return_to`, l'écran Connecteurs par défaut).
 */
export const connectorConsentSchema = z.object({ connector: connectorNameSchema, return_to: returnPathSchema.optional() }).strict()
export type ConnectorConsentInput = z.input<typeof connectorConsentSchema>

/** Le retour du tiers sur l'adresse de retour (`GET connector-consent/callback`) : la query qu'il pose. */
export const connectorConsentReturnSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  code: z.string().min(1).max(4000).optional(),
  error: z.string().max(200).optional(),
})

/**
 * Le branchement hébergé du compte d'une personne à un connecteur à `accountIdentity` (`startHostedLink`,
 * `POST hosted-link`) : la même saisie que le consentement, le connecteur et l'écran de l'hôte où revenir.
 */
export const hostedLinkSchema = connectorConsentSchema
export type HostedLinkInput = z.input<typeof hostedLinkSchema>

/**
 * Le retour du branchement hébergé (`GET hosted-link/callback`) : la demande, que le paquet a mise dans l'adresse de
 * retour ; le reste de la query (l'indice du tiers) est lu à part, sous liste blanche.
 */
export const hostedLinkReturnSchema = z.object({ request: z.uuid() })

/** Le nom d'un champ du secret ou d'un réglage, comme la déclaration d'un connecteur l'écrit. */
const accountKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "a field or setting name: lowercase letters, digits and _")

/**
 * Une saisie du secret et des réglages d'un compte réel, posée par qui le gère (`setAccountSecret`, écran Connecteurs,
 * `POST admin/accounts/<id>/secret`) : des champs du secret et des réglages, chacun une valeur, ou `null` (ou vide)
 * pour l'effacer ; un nom absent garde ce qui est posé. Jamais rendu, ni par le service ni par un refus (un problème
 * de saisie nomme son chemin, jamais la valeur). Le corps de la route s'écrit sous `secret`, que le journal masque.
 */
export const accountSecretInputSchema = z
  .object({
    secret: z.record(accountKeySchema, z.string().trim().max(10_000).nullable()).optional(),
    settings: z.record(accountKeySchema, z.string().trim().max(2_000).nullable()).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input.secret ?? {}).length + Object.keys(input.settings ?? {}).length > 0, "give at least one secret field or setting")

export type AccountSecretInput = z.input<typeof accountSecretInputSchema>

/** `accountSecretInputSchema` et le compte visé, tels que les reçoit le service. */
export const accountSecretSchema = z.object({ account_id: z.uuid(), input: accountSecretInputSchema })

/**
 * Un connecteur activable et son état dans l'organisation, tel que le rend `listConnectorsForOrg`
 * (E04-S01) et que le voient l'écran « Connecteurs » (E08-S03) et le MCP admin (E08-S06). Ici, et non
 * dans `server/` : l'écran, qui n'importe pas `server/`, le reçoit tel quel (H02, H03).
 */
export type OrgConnector = {
  connector: string
  state: "active" | "inactive"
  /** Actif : depuis quand ; inactif : `null`. */
  activatedAt: string | null
  /** Actif : qui l'a activé, nommé par `member_directory` (`null` hors de l'annuaire) ; inactif : `null`. */
  activatedBy: { userId: string; name: string | null } | null
  /** `class` : celle du catalogue (`FunctionClass` de `server/catalog/define.ts`), que ce type redit. */
  functions: { name: string; class: "read" | "write" | "sensitive" }[]
}

/**
 * Ce que coûte la désactivation d'un connecteur (E08-S03, AC5 ; repris par `admin_connector`, E08-S06) :
 * ses fonctions, les chemins des procédures publiées qui l'appellent dans un bloc `call` publié, et le
 * nombre de ses comptes, les uns et les autres comptés parmi ceux que l'appelant voit (H123).
 */
export type DeactivationImpact = { functions: string[]; procedures: string[]; accounts: number }

/** Ce qu'un appel a révélé d'un compte : la clé refusée, ou les crédits épuisés (`marksAccount` d'un connecteur). */
export type AccountMarkReason = "credential_rejected" | "quota_exhausted"

/**
 * La marque d'un compte (`accounts.health.mark`) : sa raison et sa date (ISO 8601), posée par l'appel qui l'a révélée,
 * levée au premier appel réussi. Le compte reste résolu et appelé.
 */
export type AccountMark = { reason: AccountMarkReason; at: string }

/**
 * Un compte de l'organisation, désactivé compris (E08-S03, AC6) : jamais de secret. Le propriétaire se
 * dit dans la langue de la porte (H05) : l'écran l'écrit en français, d'après son genre et le nom de
 * son équipe.
 */
export type AccountView = {
  id: string
  label: string
  connector: string
  owner: { kind: "org" | "team" | "user"; teamName?: string }
  mode: AccountMode
  status: "active" | "disabled" | "error"
  /** Ce que l'écran dit du secret, jamais sa valeur : les champs posés et la date de la dernière saisie. */
  secret?: { fields: string[]; updatedAt: string | null }
  /** Les réglages saisis, en clair (une région, une adresse). */
  settings?: Record<string, string>
  /** La raison d'un état `error` : un consentement à reconnecter. */
  statusReason?: string | null
  /** La marque du compte, sa raison et sa date : la clé refusée ou les crédits épuisés ; `null` : aucune. */
  mark?: AccountMark | null
  /** Le niveau de l'appelant sur le compte, décidé par le service : `manage` ouvre, entre autres, son journal des partages. */
  viewerLevel: Exclude<AccountLevelName, "none">
}

/**
 * Le formulaire d'un compte d'un connecteur réel déclaré, tiré de sa déclaration (`connectorAccountForms`) : les
 * champs du secret (saisie masquée pour un champ `secret`), puis les réglages. L'écran Connecteurs le lit pour créer un
 * compte réel et pour en saisir le secret, ou, pour un connecteur à consentement, pour proposer « Connecter mon compte ».
 */
export type ConnectorAccountForm = {
  connector: string
  label: string
  /** Vrai pour un connecteur `oauth2_user` : ni champ ni réglage, chacun y connecte son compte par son consentement. */
  consent?: boolean
  /**
   * Présent pour un connecteur à `accountIdentity` : chacun y branche son compte chez le tiers, jamais créé à la main ;
   * `ready` quand l'hôte a fourni le port du branchement.
   */
  hosted?: { ready: boolean }
  fields: { name: string; label: string; secret: boolean }[]
  settings: (
    | { name: string; label: string; type: "choice"; choices: string[]; default?: string }
    | { name: string; label: string; type: "text"; pattern: string }
    | { name: string; label: string; type: "url" }
  )[]
}
