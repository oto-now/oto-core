// Champs du MCP admin et des opérations d'organisation (E08-S02) : une source pour la validation des
// opérations d'`admin_org` et d'`admin_team` (mcp/), les services de `server/admin/` et l'API du
// tableau de bord (E08-S03). Sans ce fichier, chaque porte bornerait slug, préfixe et adresse à sa
// façon, et une organisation créée par l'une serait refusée par l'autre.
//
// Repris d'Oto (`capabilities/orgs/core.py` l. 26-27) : un nom d'organisation de 1 à 80 caractères
// nettoyé ; (`org_store/orgs.py` l. 107-123) : une adresse normalisée, forme invalide refusée.
// Retiré : la marque dérivée du tenant, le quota d'organisations.
import * as z from "zod/v4"
import { brandInputSchema, themeSchema } from "./brand"

/** Slug : étiquette DNS de 2 à 40 caractères, pour `<slug>.<base>` (E09-S02, N18) ; le check de `create_org`. */
export const orgSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, "2 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit")

/** Nom d'une organisation : 1 à 80 caractères, espaces retirés (le check de `create_org`). */
const orgNameSchema = z.string().trim().min(1).max(80)

/** Préfixe des outils : le check de `platform.orgs.prefix` (ADR-002 § 3). */
export const toolPrefixSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]{1,11}$/, "2 to 12 lowercase letters or digits, starting with a letter")

/** Étiquettes DNS séparées par des points, 253 caractères au plus : le check de `org_domains.host` (H10). */
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/**
 * Adresse d'une organisation : en minuscules, sans schéma, port ni chemin (H10) ; `localhost` admis.
 * Refusée plutôt que réparée : `resolveOrg` retire le port d'une adresse appelée, une adresse
 * rattachée n'en porte jamais.
 */
export const hostSchema = z.string().trim().toLowerCase().regex(HOST_PATTERN, "an address without scheme, port or path, e.g. app.acme.com")

/** Domaines de travail, en anglais, cités par la description de `<prefix>_context` ; vide = retirer (N10). */
const workDomainsSchema = z.string().trim().max(200)

/** Seuil ou écart de routage d'une organisation (ADR-003 § 2, N12). */
const routingValueSchema = z.number().min(0).max(1)

/** Email d'une personne : en minuscules, 254 caractères au plus. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

/** Motif d'un accès plateforme (fiche D2) : 500 caractères au plus, le check de `platform_grants.reason`. */
const accessReasonSchema = z.string().trim().max(500)

const SETTING_KEYS = ["name", "domains", "display_name", "theme", "logo_url", "routing_threshold", "routing_gap"] as const

type SettingKey = (typeof SETTING_KEYS)[number]

const NOTHING_TO_UPDATE = `Nothing to update: pass at least one of ${SETTING_KEYS.join(", ")}.`

// Marque aux règles d'E09-S01 (`brandInputSchema`) : une chaîne vide retire le nom affiché ou le logo.
// Plus de ton (P39) : il s'écrit dans le Contexte de l'organisation.
const settingFields = {
  name: orgNameSchema.optional(),
  domains: workDomainsSchema.optional(),
  display_name: brandInputSchema.shape.display_name.optional(),
  theme: themeSchema.optional(),
  logo_url: brandInputSchema.shape.logo_url.optional(),
  routing_threshold: routingValueSchema.optional(),
  routing_gap: routingValueSchema.optional(),
}

/** Au moins un réglage : sans lui, rien à écrire (AC17). `null` compte : il retire une valeur. */
function someSetting(value: Partial<Record<SettingKey, unknown>>): boolean {
  return SETTING_KEYS.some((key) => value[key] !== undefined)
}

/** Réglages d'une organisation : nom, domaines de travail, marque, seuils de routage (AC17). */
export const orgSettingsSchema = z.object(settingFields).refine(someSetting, { message: NOTHING_TO_UPDATE })

export type OrgSettings = z.output<typeof orgSettingsSchema>

/** `update` d'`admin_org` : l'organisation visée et au moins un réglage. */
export const orgUpdateSchema = z.object({ org: orgSlugSchema, ...settingFields }).refine(someSetting, { message: NOTHING_TO_UPDATE })

const FORM_KEYS = ["name", "domains", "routing_threshold", "routing_gap"] as const

/**
 * « Réglages » du tableau de bord (E08-S03, AC3) : `orgSettingsSchema` restreint au nom, aux domaines
 * de travail et au routage, au moins un ; la marque passe par `PATCH brand` (E09-S01), un autre champ
 * est refusé. Sans lui, `PATCH admin/org` écrirait aussi la marque, par une seconde porte.
 */
export const orgSettingsFormSchema = z
  .strictObject({
    name: settingFields.name,
    domains: settingFields.domains,
    routing_threshold: settingFields.routing_threshold,
    routing_gap: settingFields.routing_gap,
  })
  .refine((value) => FORM_KEYS.some((key) => value[key] !== undefined), {
    message: `Nothing to update: pass at least one of ${FORM_KEYS.join(", ")}.`,
  })

export type OrgSettingsForm = z.output<typeof orgSettingsFormSchema>

/**
 * L'écran « Organisation » (E08-S03, AC2), tiré de `getOrg` (E08-S02) : `domains`, les domaines de
 * travail (chaîne vide : aucun) ; `hosts`, les adresses ; `tools`, les six noms préfixés ; `routing`,
 * le réglage tel qu'il est posé, `null` pour une valeur jamais réglée, que le routage remplace par
 * son défaut.
 */
export type OrgView = {
  name: string
  slug: string
  prefix: string
  tools: string[]
  hosts: string[]
  domains: string
  routing: { threshold: number | null; gap: number | null }
  contact: { name: string; email: string } | null
}

/** Un domaine d'email (`acme.fr`), en minuscules, sans `@` : celui que porte l'adresse vérifiée d'une personne. */
const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "an email domain such as acme.fr, without @")

/** Au plus autant de domaines admis par organisation. */
export const OPEN_ENTRY_DOMAINS_MAX = 20

/**
 * L'entrée sans invitation d'une organisation (`orgs.settings.open_entry`) : ouverte, elle fait entrer comme membre tout
 * compte vérifié de l'émetteur de l'hôte dont l'email est d'un de ces domaines ; au moins un domaine pour l'ouvrir.
 */
export const openEntrySchema = z
  .strictObject({ enabled: z.boolean(), email_domains: z.array(emailDomainSchema).max(OPEN_ENTRY_DOMAINS_MAX) })
  .refine((value) => !value.enabled || value.email_domains.length > 0, { path: ["email_domains"], message: "Name at least one email domain to open the entry." })

export type OpenEntry = z.infer<typeof openEntrySchema>

/**
 * L'inscription d'une organisation (E12-S01, ADR-023) : nom, slug et préfixe, contrôlés comme par `orgCreateSchema`, sans
 * adresse (celles de l'hôte, `OrgCreationHook`) ; deux temps. `accepted_terms` : la case des conditions de l'hôte, cochée
 * (`FormulaireDInscription` avec `conditions`), transmise à son `admit`, qui en garde la preuve.
 */
export const signupSchema = z.strictObject({
  name: orgNameSchema,
  org: orgSlugSchema,
  prefix: toolPrefixSchema,
  accepted_terms: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

export type SignupInput = z.infer<typeof signupSchema>

/**
 * Une organisation dont la personne est membre, pour la bascule du menu de l'entreprise : son nom, une de ses
 * adresses (`null` sans adresse), et si c'est celle de la requête.
 */
export type PersonOrganisation = { id: string; name: string; host: string | null; current: boolean }

/**
 * `create` d'`admin_org` : slug, nom, préfixe, première adresse facultative, premier administrateur exigé (décision du
 * 2026-10-14 : l'appelant lui-même, membre `admin` tout de suite, ou une autre adresse, invitée `admin`), deux temps (N8).
 */
export const orgCreateSchema = z.strictObject({
  org: orgSlugSchema,
  name: orgNameSchema,
  prefix: toolPrefixSchema,
  host: hostSchema.optional(),
  admin_email: emailSchema,
  confirm: z.boolean().optional(),
})

/** `add_admin` d'`admin_org` : l'organisation visée et l'email de l'administrateur à nommer, selon la règle de `create`. */
export const addAdminSchema = z.object({ org: orgSlugSchema, admin_email: emailSchema })

/** `add_host` et `remove_host` d'`admin_org` (seul `remove_host` passe en deux temps). */
export const hostOpSchema = z.object({ org: orgSlugSchema, host: hostSchema, confirm: z.boolean().optional() })

/** `grant_access` et `revoke_access` d'`admin_org` (seul `revoke_access` passe en deux temps). */
export const platformAccessSchema = z.object({
  org: orgSlugSchema,
  email: emailSchema,
  reason: accessReasonSchema.optional(),
  confirm: z.boolean().optional(),
})

// ------------------------------------------------------------------ Références (E08-S06, N1)
// Un propriétaire ou le sujet d'une règle s'écrit en une chaîne plate (`team:ventes`, `user:<email>`,
// `org`, `inherit`) : un identifiant long recopié par le modèle s'altère (banc E03), un slug ou un
// email non. Chaque schéma rend la référence lue, que `resolveRef` (`server/admin/context.ts`) résout.

type TeamRef = { kind: "team"; slug: string }
type UserRef = { kind: "user"; email: string }
/** Propriétaire d'un nœud : l'organisation, celui du parent (`inherit`), une équipe, une personne. */
export type OwnerRef = { kind: "org" } | { kind: "inherit" } | TeamRef | UserRef
/** Propriétaire d'un compte créé par l'équipe plateforme : un compte personnel se crée par son propriétaire (N13). */
type AccountOwnerRef = { kind: "org" } | TeamRef

/** Borne d'une référence : `user:` et un email de 254 caractères au plus y tiennent. */
const REF_MAX = 300

const OWNER_REF = "owner must be team:<slug>, user:<email>, org or inherit"
const ACCOUNT_OWNER_REF = "owner must be org or team:<slug>: a personal account is created by its owner, not by the platform team"
const SUBJECT_REF = "subject must be team:<slug> or user:<email>"

/** `team:<slug>` ou `user:<email>`, motif déjà vérifié ; l'email ramené en minuscules. */
function namedRef(text: string): TeamRef | UserRef {
  const value = text.slice("team:".length)
  return text.startsWith("team:") ? { kind: "team", slug: value } : { kind: "user", email: value.toLowerCase() }
}

/**
 * Une référence, texte du client (`security-patterns.md § Validation des inputs`) : bornée avant son
 * motif (`abort` : au-delà de `REF_MAX`, le motif ne lit rien), un motif ancré où chaque caractère n'a
 * qu'une lecture (un email : `[^@\s]+@[^@\s]+`, deux classes que sépare le seul `@`), un seul message.
 */
function refText(pattern: RegExp, message: string) {
  return z.string(message).trim().max(REF_MAX, { error: message, abort: true }).regex(pattern, message)
}

export const ownerRefSchema = refText(/^(org|inherit|team:[a-z0-9_-]+|user:[^@\s]+@[^@\s]+)$/, OWNER_REF).transform(
  (text): OwnerRef => (text === "org" ? { kind: "org" } : text === "inherit" ? { kind: "inherit" } : namedRef(text)),
)

export const accountOwnerRefSchema = refText(/^(org|team:[a-z0-9_-]+)$/, ACCOUNT_OWNER_REF).transform(
  (text): AccountOwnerRef => (text === "org" ? { kind: "org" } : { kind: "team", slug: text.slice("team:".length) }),
)

export const subjectRefSchema = refText(/^(team:[a-z0-9_-]+|user:[^@\s]+@[^@\s]+)$/, SUBJECT_REF).transform(namedRef)
