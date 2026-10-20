// Les gestes du rail et du panneau « Partager » (E05-S10, parties e et d, ADR-013) : ranger un nœud entre
// ses frères, le dupliquer, le mettre à la corbeille et l'en restaurer, prévoir ce qu'un déplacement change,
// changer l'accès général, lire ses liens, partager sur le web. Un schéma pour l'écran, qui borne ce qu'il
// envoie, et pour l'API, qui le valide ; les types de sortie sont ceux que rendent les services. Sans ce
// fichier, chaque route validerait son corps à sa façon.
import * as z from "zod/v4"
import type { Language } from "./brand"
import { nodePathSchema } from "./nodes"
import { ACCESS_LEVEL_NAMES } from "./rules"

/** Un nœud désigné par son chemin : corbeille, restauration, duplication, liens, lien public d'un nœud. */
export const nodePathBodySchema = z.strictObject({ path: nodePathSchema })

export type NodePathBody = z.infer<typeof nodePathBodySchema>

/**
 * L'entrée de `node.discard_draft` et de `node.trash` derrière `call` (E11-S02, AC-d1, AC-e1) : le nœud par
 * son chemin, décrit pour le contrat que `read` sert (`mcp-patterns.md § 3`).
 */
export const nodePathArgsSchema = z.strictObject({
  path: nodePathSchema.describe("Path of the page, procedure, Contexte or table, e.g. ventes/salons."),
})

export type NodePathArgs = z.infer<typeof nodePathArgsSchema>

/**
 * `POST nodes/position` (AC-b9) : le nœud se range juste après son frère `after`, en tête avec `null`.
 * Les frères sont les enfants d'un même parent ; changer de parent passe par `nodes/move`.
 */
export const placeNodeSchema = z.strictObject({ path: nodePathSchema, after: nodePathSchema.nullable() })

export type PlaceNodeInput = z.infer<typeof placeNodeSchema>

/** `GET nodes/impact?path=&new_path=` (AC-b7) : le déplacement dont on veut l'effet, comme `nodes/move`. */
export const moveImpactQuerySchema = z.strictObject({ path: nodePathSchema, new_path: nodePathSchema })

/** L'accès général d'un nœud (AC-b13, ADR-014) : toute l'organisation, à un niveau, ou les personnes ajoutées seulement. */
export const GENERAL_ACCESS = ["organisation", "restricted"] as const

export type GeneralAccess = (typeof GENERAL_ACCESS)[number]

/**
 * `POST nodes/access` (AC-b13) : `level`, le niveau de toute l'organisation (`read` par défaut ; `manage`,
 * l'accès complet, à l'administrateur, D4 ; `none` ferme une page qu'un dossier au-dessus ouvre, 1.4.13), avec
 * `organisation` seulement.
 */
export const generalAccessSchema = z
  .strictObject({ path: nodePathSchema, access: z.enum(GENERAL_ACCESS), level: z.enum(ACCESS_LEVEL_NAMES).optional() })
  .refine((input) => input.access === "organisation" || input.level === undefined, { message: "level goes with access organisation only.", path: ["level"] })

/** `POST shares` (AC-d1) : le lien public d'un nœud, créé ou changé ; `include_children` : les sous-contenus aussi. */
export const shareNodeSchema = z.strictObject({ path: nodePathSchema, include_children: z.boolean().optional() })

export type ShareNodeInput = z.infer<typeof shareNodeSchema>

/** `GET shares?path=` : le lien public d'un nœud ; sans `path`, les liens actifs de l'organisation (admin, AC-d7). */
export const sharesQuerySchema = z.strictObject({ path: nodePathSchema.optional() })

/** Un jeton de lien public : 32 octets en base64url, 43 caractères (ADR-013 § 1). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * `GET public/<jeton>?path=` : un contenu que le lien couvre ; sans `path`, le contenu partagé. Un lien
 * public circule : les paramètres qu'on lui ajoute (`utm_source`…) sont ignorés, pas refusés.
 */
export const publicReadQuerySchema = z.object({ path: nodePathSchema.optional() })

/** Un membre dont l'accès change avec un déplacement : son nom, son niveau avant et après (0 à 3). */
export type AccessChange = { userId: string; name: string; before: 0 | 1 | 2 | 3; after: 0 | 1 | 2 | 3 }

/** Une place de l'arbre telle qu'un déplacement la voit : son espace (organisation, équipe, privé) et son propriétaire. */
export type PlaceView = { space: "all" | "team" | "private"; owner: string }

/**
 * L'effet d'un déplacement (AC-b7) : `changes` quand quelqu'un gagne, perd ou change d'accès, ou que le
 * propriétaire change ; les membres concernés (20 au plus par liste, puis leur total).
 */
export type MoveImpact = {
  path: string
  newPath: string
  changes: boolean
  before: PlaceView
  after: PlaceView
  gained: AccessChange[]
  lost: AccessChange[]
  changed: AccessChange[]
  totals: { gained: number; lost: number; changed: number }
}

/** Un élément de la corbeille (AC-b11) : un nœud mis à la corbeille avec ce qui était dessous. */
export type TrashItem = {
  path: string
  title: string
  kind: string
  deletedAt: string
  /** Nœuds partis avec lui, lui compris. */
  count: number
  /** Date de sa purge : 30 jours après sa mise à la corbeille. */
  purgeAt: string
}

/** Un lien public (AC-d1) : le jeton n'est rendu qu'à qui gère le nœud. */
export type ShareView = {
  id: string
  path: string
  token: string
  includeChildren: boolean
  createdAt: string
  createdByName: string | null
}

/** Un lien actif de l'organisation pour l'admin (AC-d7) : jamais le jeton ; titre et chemin d'un espace privé coupés. */
export type OrgShareView = {
  id: string
  path: string
  title: string | null
  includeChildren: boolean
  createdAt: string
  createdByName: string | null
}

/** Un bloc publié d'une page publique : ni auteur, ni provenance, ni révision. */
export type PublicBlock = {
  id: string
  type: string
  position: number | null
  key: string | null
  text: string | null
  data: Record<string, unknown>
}

/**
 * Les lignes d'un tableau que sert une page publique, au plus : la borne de `public_node_by_token`
 * (`migrations/20260928100000_platform_base_v1.sql`), que la page dit (E11-S05, AC-d1 ; portage § 6).
 */
export const PUBLIC_TABLE_ROWS_MAX = 500

/**
 * Un tableau d'une page publique (E01-S12 partie c, décision de JB du 2026-09-28) : ses colonnes, nom et
 * type ; ses lignes publiées, triées par clé, `PUBLIC_TABLE_ROWS_MAX` au plus (`truncated` au-delà) : la clé et
 * les valeurs des colonnes déclarées, ni provenance, ni réservation, ni auteur.
 */
export type PublicTable = {
  columns: { name: string; type: string }[]
  rows: { key: string; cells: Record<string, unknown> }[]
  truncated: boolean
}

/**
 * Ce que montre la page publique (ADR-013 § 3) : le contenu partagé (`root`), le contenu lu, ses blocs
 * publiés, ses enfants publiés quand le lien les couvre, et ses liens dont la cible est couverte :
 * `path`, le chemin que cite le bloc ; `to`, l'adresse actuelle de la cible, où mène la page (AC-d4 : les
 * autres liens se rendent en texte). Rien que ce que l'auteur du lien lit.
 */
export type PublicNodeView = {
  root: { path: string; title: string }
  includeChildren: boolean
  node: { path: string; title: string; summary: string; kind: string; revision: number; meta: Record<string, unknown>; updatedAt: string }
  blocks: PublicBlock[]
  /** Un tableau : ses colonnes et ses lignes (ses lignes ne sont pas dans `blocks`) ; `null` sinon. */
  table: PublicTable | null
  children: { path: string; title: string; kind: string }[]
  links: { path: string; to: string }[]
  /**
   * La langue de l'organisation (`organisationLanguage`) : le séparateur et la décimale du `.csv` que la page
   * compose (E11-S05, AC-d3, HN-E11S05-11) ; ADR-013 § 4, une donnée de l'organisation, pas du nœud.
   */
  language: Language
}

/** Les liens d'un nœud pour ses encarts « Cite » et « Cité dans » (E11-S05, AC-e1) : champs de `read` (`links_out`, `links_in`, leurs totaux). */
export type NodeLinksView = {
  links_out: { path: string; key?: string; title?: string; status: "ok" | "missing" | "moved"; moved_to?: string; key_found?: boolean }[]
  links_in: { path: string; title: string }[]
  links_out_total: number
  links_in_total: number
}
