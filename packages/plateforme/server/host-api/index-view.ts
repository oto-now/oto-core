// L'index des fonctions de l'hôte (`fonctions-d-un-hote.md` § Index) : ce que la personne voit de l'API de l'hôte de son
// organisation, filtré par sa liste (`visibility.ts`). Deux vues, un seul calcul : le bloc de `context`, borné à 3 000
// caractères (une ligne par famille, puis les fonctions proches de la demande), et la partie de `read functions`, entière,
// groupée par famille, `summary` compris. Aucun outil MCP de plus (ADR-002) : le bloc est un contenu de `context`. Sans ce
// module, l'assistant ne saurait pas quelles fonctions de l'hôte existent sans lire tout le catalogue.
import type { CatalogFunction } from "../catalog/define"
import { searchFunctions } from "../catalog/registry"
import { formatCount } from "../nodes/document"
import type { HostIndexEntry } from "./document"
import type { HostVisibility } from "./visibility"

/** Au plus, en caractères, le bloc de `context`. */
export const HOST_INDEX_MAX = 3_000
/** Au plus, les fonctions proches de la demande dans le bloc. */
export const HOST_INDEX_CLOSEST = 8
/** Au plus, en caractères, la ligne d'une famille dans le bloc. */
export const FAMILY_LINE_MAX = 600
/** Au plus, en caractères, le titre de l'API dans un texte servi. */
const TITLE_MAX = 100

/** Les fonctions de l'hôte que la personne voit, au catalogue : celles dont le nom du document est dans sa liste. */
export function visibleHostFunctions(hostFunctions: readonly CatalogFunction[], visibility: HostVisibility): CatalogFunction[] {
  if (visibility.kind !== "visible") return []
  const served = new Set(visibility.host.imported.index.filter((entry) => visibility.names.has(entry.operationId)).map((entry) => entry.served))
  return hostFunctions.filter((fn) => served.has(fn.name))
}

/** Les fonctions visibles de l'index, par famille, dans l'ordre de `x-oto.families` ; une famille sans fonction visible est omise. */
function visibleFamilies(visibility: Extract<HostVisibility, { kind: "visible" }>): { label: string; key: string; entries: HostIndexEntry[] }[] {
  const { families, index } = visibility.host.imported
  return families
    .map((family) => ({ ...family, entries: index.filter((entry) => entry.family === family.key && visibility.names.has(entry.operationId)) }))
    .filter((family) => family.entries.length > 0)
}

const titleOf = (visibility: Exclude<HostVisibility, { kind: "none" }>): string => visibility.host.imported.title.slice(0, TITLE_MAX)

/** La ligne d'une liste indisponible : sa raison, et que `call` part quand même vers l'hôte, qui décide. */
function unavailableLine(visibility: Extract<HostVisibility, { kind: "unavailable" }>, prefix: string): string {
  const title = titleOf(visibility)
  return `Functions of ${title} unavailable: ${visibility.reason} ${prefix}_call still reaches ${title}, which decides.`
}

/** Ce que `find` ajoute quand la liste de la personne est indisponible ; `null` sinon. */
export function hostUnavailableNotice(visibility: HostVisibility, prefix: string): string | null {
  return visibility.kind === "unavailable" ? unavailableLine(visibility, prefix) : null
}

/**
 * La ligne d'une famille : son libellé, puis les noms servis de ses fonctions visibles. Au-delà de `FAMILY_LINE_MAX`, les
 * derniers noms sont comptés (« … and 12 more ») : jamais un nom coupé.
 */
function familyLine(label: string, entries: readonly HostIndexEntry[]): { text: string; cut: boolean } {
  const line = (names: readonly string[], more: number) => `- ${label}: ${names.join(", ")}${more > 0 ? ` … and ${more} more` : ""}`
  const names = entries.map((entry) => entry.served)
  let kept = names.length
  while (kept > 1 && line(names.slice(0, kept), names.length - kept).length > FAMILY_LINE_MAX) kept -= 1
  return { text: line(names.slice(0, kept), names.length - kept), cut: kept < names.length }
}

/**
 * Le bloc « fonctions de l'hôte » de `context` (règle de troncature de `fonctions-d-un-hote.md` § Index), `null` sans API
 * servie ou sans fonction visible. Il porte une tête (comment appeler, où lire l'index entier), une ligne par famille, puis
 * les fonctions les plus proches de `phrase` (`searchFunctions` : score, puis nom ; 8 au plus) avec leur `summary`.
 * `cut` : un nom de famille compté ou une ligne retirée. S'il dépasse 3 000 caractères : les fonctions proches partent d'abord, la moins proche en premier, puis les familles,
 * la dernière en premier ; une dernière ligne dit ce qui n'est pas listé et renvoie à `read functions`. Déterministe :
 * même document, même liste, même demande, même texte.
 */
export function hostIndexBlock(visibility: HostVisibility, visible: readonly CatalogFunction[], phrase: string | undefined, prefix: string): { text: string; cut: boolean } | null {
  if (visibility.kind === "none") return null
  if (visibility.kind === "unavailable") return { text: unavailableLine(visibility, prefix), cut: false }
  const families = visibleFamilies(visibility)
  if (families.length === 0) return null
  const head = `Functions of ${titleOf(visibility)} open to you, by family (read a contract with ${prefix}_read {"path": "<function>"}, run it with ${prefix}_call; the whole index, with each summary: ${prefix}_read {"path": "functions"}):`
  const lined = families.map((family) => familyLine(family.label, family.entries))
  const familyLines = lined.map((line) => line.text)
  const entryOf = new Map(visibility.host.imported.index.map((entry) => [entry.served, entry]))
  const summaryOf = (name: string): string => {
    const entry = entryOf.get(name)
    if (!entry) throw new Error(`[platform] host api: ${name} is visible but not in the index`)
    return entry.summary
  }
  const closest = phrase === undefined ? [] : searchFunctions(visible, phrase, HOST_INDEX_CLOSEST).map(({ fn }) => `- ${fn.name}: ${summaryOf(fn.name)}`)
  const render = (familyCount: number, closestCount: number, notice: string | null) =>
    [head, ...familyLines.slice(0, familyCount), ...(closestCount > 0 ? ["Closest to the request:", ...closest.slice(0, closestCount)] : []), ...(notice ? [notice] : [])].join("\n")
  const whole = render(familyLines.length, closest.length, null)
  if (whole.length <= HOST_INDEX_MAX) return { text: whole, cut: lined.some((line) => line.cut) }
  const notice = (familyCount: number, closestCount: number) => {
    const missing = [
      ...(familyLines.length > familyCount ? [`${familyLines.length - familyCount} families`] : []),
      ...(closest.length > closestCount ? [`${closest.length - closestCount} close functions`] : []),
    ]
    return `[Index cut to ${formatCount(HOST_INDEX_MAX)} characters: ${missing.join(" and ")} not listed. Read them with ${prefix}_read {"path": "functions"}.]`
  }
  for (let closestCount = closest.length - 1; closestCount >= 0; closestCount -= 1) {
    const text = render(familyLines.length, closestCount, notice(familyLines.length, closestCount))
    if (text.length <= HOST_INDEX_MAX) return { text, cut: true }
  }
  for (let familyCount = familyLines.length - 1; familyCount >= 0; familyCount -= 1) {
    const text = render(familyCount, 0, notice(familyCount, 0))
    if (text.length <= HOST_INDEX_MAX) return { text, cut: true }
  }
  // La tête et la dernière ligne tiennent toujours (titre borné) : y arriver est un défaut du code.
  throw new Error("[platform] host api: the index head does not fit its bound")
}

/**
 * La partie de l'hôte dans `read functions` : entière, par famille, chaque fonction avec sa classe et son `summary` ;
 * une liste vide le dit, une liste indisponible dit sa raison. Rien sans API servie.
 */
export function hostCatalogLines(visibility: HostVisibility, prefix: string): string[] {
  if (visibility.kind === "none") return []
  if (visibility.kind === "unavailable") return [unavailableLine(visibility, prefix)]
  const families = visibleFamilies(visibility)
  if (families.length === 0) return [`No function of ${titleOf(visibility)} is open to you.`]
  return [
    `Functions of ${titleOf(visibility)} open to you, by family:`,
    ...families.flatMap((family) => [`${family.label}:`, ...family.entries.map((entry) => `- ${entry.served} (${entry.class}): ${entry.summary}`)]),
  ]
}
