// Ce que l'hôte déclare de ses personnes (`pseudonymisation.md` § Ce que l'hôte déclare) : des sortes, chacune avec deux
// fonctions lues dans sa base, jamais par le paquet. La pseudonymisation est active pour toute organisation d'un hôte
// qui déclare au moins une sorte. Une déclaration mal formée lève `TypeError` au chargement de la route,
// comme `registerDataPolicy`, et non `CatalogRegistrationError` : l'importer de `catalog/erp` ferait entrer ce module
// dans un cycle d'import avec le registre (`tests/unit/import-cycles.test.ts`), puisque le journal, que le registre
// atteint, lit ce module. Sans ce module, le paquet n'aurait aucune personne à remplacer.
import { KIND_PATTERN, RESERVED_KINDS } from "./token"

export type SensitiveOrg = { id: string; slug: string }

export type SensitiveValues = {
  lastName?: string
  firstNames?: string
  emails?: readonly string[]
  phones?: readonly string[]
  addresses?: readonly string[]
  /** Toute autre désignation, prise telle quelle (nom d'usage, raison sociale, référence de dossier). */
  aliases?: readonly string[]
}

export type SensitiveEntity = {
  id: string
  values: SensitiveValues
  /** Corps du jeton fourni par l'hôte, opaque, unique, non séquentiel conseillé (`c-12`) ; exigé pour toute la sorte si `tokens: "reference"`. */
  reference?: string
}

export type SensitiveKind = {
  /** ASCII minuscule, 2 à 10 caractères, hors des sortes réservées (`email`, `phone`, `iban`, `nir`, `card`, `name`). */
  kind: string
  /** `"hmac"` (défaut) ou `"reference"`. */
  tokens?: "hmac" | "reference"
  list(org: SensitiveOrg): Promise<readonly SensitiveEntity[]>
  /** `null` : l'entité n'existe plus ; seule source d'une réidentification (J4). */
  read(org: SensitiveOrg, id: string): Promise<SensitiveValues | null>
}

let declared: readonly SensitiveKind[] = []
/** Change à chaque déclaration : un dictionnaire bâti sous une autre déclaration se rebâtit. */
let version = 0

function kindProblem(kind: SensitiveKind, seen: Set<string>): string | null {
  if (typeof kind?.kind !== "string" || !KIND_PATTERN.test(kind.kind)) return `kind ${String(kind?.kind)}: a kind is 2 to 10 lowercase ASCII letters or digits, starting with a letter.`
  if (RESERVED_KINDS.has(kind.kind)) return `kind ${kind.kind}: reserved for the values found by their form (${[...RESERVED_KINDS].join(", ")}).`
  if (seen.has(kind.kind)) return `kind ${kind.kind}: declared twice.`
  if (kind.tokens !== undefined && kind.tokens !== "hmac" && kind.tokens !== "reference") return `kind ${kind.kind}: tokens is "hmac" or "reference".`
  if (typeof kind.list !== "function" || typeof kind.read !== "function") return `kind ${kind.kind}: list(org) and read(org, id) are both required.`
  return null
}

/** Déclare les sortes de l'hôte ; `null` ou une liste vide éteint la pseudonymisation. Remplace la déclaration précédente. */
export function registerSensitiveEntities(kinds: readonly SensitiveKind[] | null): void {
  const next = kinds ?? []
  if (!Array.isArray(next)) throw new TypeError("registerSensitiveEntities: a list of kinds, or null.")
  const seen = new Set<string>()
  for (const kind of next) {
    const problem = kindProblem(kind, seen)
    if (problem) throw new TypeError(`registerSensitiveEntities: ${problem}`)
    seen.add(kind.kind)
  }
  declared = [...next]
  version += 1
}

/** Le numéro de la déclaration courante. */
export function declarationVersion(): number {
  return version
}

/** Les sortes déclarées ; vide : la pseudonymisation est éteinte. */
export function sensitiveKinds(): readonly SensitiveKind[] {
  return declared
}
