// Bornes du contenu lu et écrit par `nodes/` (E03-S03, N1, N2, N5, N6, N32) : un seul endroit, que les
// modules importent. Sans lui, chaque module réécrirait ses chiffres. Les plafonds des résultats
// (45 000 et 20 000) restent `MAX_RESULT_CHARS` et `MAX_DATA_CHARS` (`tool-output.ts`) ; la taille de
// page des lectures est une hypothèse sur PostgREST, déclarée dans `errors.ts` (N48).

/** Au-delà de ces caractères rendus, `read` sert le plan d'une page qui a des titres (N1). */
export const PAGE_FULL_MAX = 12_000

/** Texte d'une opération de `write` et caractères rendus d'une page : dans `schemas/nodes.ts`, que l'écran lit aussi (E10-S01). */
export { OP_TEXT_MAX, PAGE_MAX } from "../../schemas/nodes"

/** Opérations par appel de `write` d'un assistant ; une écriture de l'écran en porte jusqu'à `BLOCKS_MAX` (fiche D153). */
export const OPS_MAX = 50

/** Caractères rendus d'une section, sous-sections comprises. */
export const SECTION_MAX = 100_000

/** Blocs d'une page, d'une procédure ou d'un Contexte : dans `schemas/nodes.ts`, que l'écran lit aussi (E11-S17). */
export { BLOCKS_MAX } from "../../schemas/nodes"

/** Enfants listés par l'en-tête de `read` et par `loadNode` (N5). */
export const CHILDREN_SHOWN = 50

/** Titres cités au plus dans un refus, puis « and <n> more ». */
export const LISTED_MAX = 50

/** Fichiers joints nommés au plus sous le plan d'une page, puis « and <n> more » (`lecture-des-fichiers.md` : la borne de l'aperçu). */
export const OUTLINE_FILES_MAX = 20

/** Entrées du plan en champs de `read` (N2). */
export const OUTLINE_DATA_MAX = 100

/** Liens distincts d'une page publiée (E03-S07 AC3). */
export const LINKS_MAX = 1_000

/** Nœuds de l'arbre des écrans, après le filtre des niveaux (N32). */
export const TREE_MAX = 5_000

/** Écart des positions d'un document neuf, et en tête ou en fin (E01-S06 N7). */
export const POSITION_STEP = 1_024

/** Sous cet écart entre deux positions, le brouillon est renuméroté (E01-S06 N7). */
export const POSITION_EPSILON = 1e-6

/** Révisions citées au plus par un refus de `since_revision` (AC11). */
export const REVISIONS_LISTED = 20

/** Blocs écrits rendus au plus par opération dans la réponse de `write` (AC37). */
export const TOUCHED_BLOCKS_MAX = 20

// Bornes d'un bloc que `blockInputSchema` (`schemas/blocks.ts`, E01-S06) impose aussi : l'analyse et
// les opérations les disent dans leurs refus (AC3, AC23) avant que le schéma ne les juge.

/** Texte d'un titre, et titre d'une section créée par `add_section`. */
export const HEADING_TEXT_MAX = 200

/** Éléments d'une liste (sous-éléments compris) ou d'une `checklist`. */
export { LIST_ITEMS_MAX } from "../../schemas/blocks"

/** Nom de la fonction d'un bloc `call`. */
export const FUNCTION_NAME_MAX = 100

/** Adresse d'une image. */
export const IMAGE_SRC_MAX = 2_000

/** Chemin d'un bloc `reference` (H51). */
export const REFERENCE_PATH_MAX = 1_000

/** Liens entrants, et sortants, nommés au plus par l'en-tête de `read`, comptés après le filtre (E03-S07 AC4, N10). */
export const LINKS_SHOWN = 20

/** Blocs `reference` décrits au plus dans les données de `read` (E03-S07 AC11, N10). */
export const REFERENCES_DATA_MAX = 50
