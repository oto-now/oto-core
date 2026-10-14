// Les liens d'une page importée recollés aux chemins d'arrivée (`node.import_tree`) : les `[[…]]` hors du code, la première
// ligne d'un bloc `reference`, les arguments d'un bloc `call` et les cellules d'un tableau qui valent un chemin ; puis les
// outils nommés avec le préfixe de l'organisation source, pris par celui de l'arrivée. `relink` rend le chemin d'arrivée
// d'un chemin de la source, `null` hors du périmètre ; `orphan` reçoit chaque lien laissé tel quel. Sans lui, une page
// importée pointerait vers les chemins de la source, une procédure appellerait ses tableaux, que la publication refuse, et
// un texte nommerait des outils que l'organisation d'arrivée n'a pas.
import { closesFence, linksIn, openingFence, type Fence } from "../../schemas/link-syntax"
import { isJsonObject } from "../json"

type Relink = (sourcePath: string) => string | null

/** Les six outils d'une organisation, les seuls noms que l'import renomme d'un préfixe à l'autre. */
const TOOLS = ["context", "find", "read", "write", "call", "feedback"] as const

/** Une mention `<préfixe>_<outil>` dans un texte, hors d'un nom plus long ; le préfixe borné, la lecture reste linéaire. */
const TOOL_MENTION = /(?:^|[^a-z0-9_])([a-z0-9]{2,20})_(context|find|read|write|call|feedback)(?![a-z0-9_])/g

/**
 * Les préfixes d'organisation avec lesquels un texte nomme des outils (`demo_read` → `demo`), chacun une fois. Un préfixe
 * compte quand il nomme deux outils différents, ou `context` ou `feedback`, qui ne se lisent pas ailleurs : un mot
 * comme `to_read`, `on_call` ou `auto_call`, seul, n'est pas un outil.
 */
export function toolPrefixesIn(text: string): string[] {
  const tools = new Map<string, Set<string>>()
  for (const match of text.matchAll(TOOL_MENTION)) tools.set(match[1], (tools.get(match[1]) ?? new Set()).add(match[2]))
  return [...tools].filter(([, named]) => named.size >= 2 || named.has("context") || named.has("feedback")).map(([prefix]) => prefix)
}

/** Un caractère d'un nom (`[A-Za-z0-9_]`) : une mention d'outil commence et finit hors d'un nom. */
const IN_NAME = /^[A-Za-z0-9_]$/

/**
 * Les mentions `<préfixe source>_<outil>` d'un texte prises par le préfixe d'arrivée (`demo_read` → `acme_read`), pour les
 * six outils seulement ; le texte, et le nombre de mentions réécrites. Un parcours par `indexOf`, en temps linéaire.
 */
export function rewritePrefixes(text: string, from: string, to: string): { text: string; count: number } {
  if (from === "" || from === to) return { text, count: 0 }
  const inName = (char: string | undefined) => char !== undefined && IN_NAME.test(char)
  const needle = `${from}_`
  let out = ""
  let at = 0
  let count = 0
  for (let found = text.indexOf(needle); found !== -1; found = text.indexOf(needle, found + needle.length)) {
    const after = found + needle.length
    const tool = TOOLS.find((one) => text.startsWith(one, after) && !inName(text[after + one.length]))
    if (inName(text[found - 1]) || tool === undefined) continue
    out += `${text.slice(at, found)}${to}_`
    at = after
    count++
  }
  return { text: out + text.slice(at), count }
}

/**
 * Le texte d'une cellule de tableau, recollé : une cellule qui vaut exactement le chemin d'un nœud importé prend son chemin
 * d'arrivée (`exact`, qui ne reconnaît que ces chemins : « lyon » n'est pas un chemin parce qu'un dossier importé pourrait
 * le contenir), un `[[…]]` dans une cellule suit `relink` ; `changed` dit si la valeur a bougé.
 */
export function relinkedCell(value: string, exact: Relink, relink: Relink): { value: string; changed: boolean } {
  const whole = exact(value)
  if (whole !== null) return { value: whole, changed: whole !== value }
  const rewritten = rewriteLinks(value, relink, () => {})
  return { value: rewritten, changed: rewritten !== value }
}

/** Le `[[…]]` d'une ligne avec son chemin remplacé, clé et libellé gardés tels qu'écrits. */
function rewriteLine(line: string, relink: Relink, orphan: (to: string) => void): string {
  const found = linksIn(line).filter((entry) => entry.link !== null)
  if (found.length === 0) return line
  let out = ""
  let at = 0
  for (const entry of found) {
    const link = entry.link
    if (!link) continue
    const target = relink(link.path)
    out += line.slice(at, entry.start)
    if (target === null) {
      orphan(link.path)
      out += line.slice(entry.start, entry.end)
    } else {
      const inner = line.slice(entry.start + 2, entry.end - 2)
      out += `[[${inner.replace(link.path, target)}]]`
    }
    at = entry.end
  }
  return out + line.slice(at)
}

/** Une valeur des arguments d'un appel, chaque chaîne qui vaut le chemin d'un nœud importé (`exact`) remplacée par son chemin d'arrivée. */
function relinkedValue(value: unknown, relink: Relink): unknown {
  if (typeof value === "string") return relink(value) ?? value
  if (Array.isArray(value)) return value.map((item) => relinkedValue(item, relink))
  if (isJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relinkedValue(item, relink)]))
  return value
}

/**
 * La ligne d'un bloc `call` (`<fonction> <arguments JSON>`) : un argument qui nomme un chemin du plan (`table`, `path`…)
 * prend le chemin d'arrivée ; sans lui, la procédure appellerait le tableau de la source, que la publication refuse.
 */
function rewriteCallLine(line: string, relink: Relink): string {
  const space = line.indexOf(" ")
  if (space === -1) return line
  try {
    const args: unknown = JSON.parse(line.slice(space + 1))
    return `${line.slice(0, space)} ${JSON.stringify(relinkedValue(args, relink))}`
  } catch {
    return line
  }
}

/**
 * Le markdown d'un nœud, ses liens recollés : chaque `[[…]]` hors du code vers un chemin du plan prend le chemin
 * d'arrivée, comme la première ligne d'un bloc de référence ; un argument d'un bloc `call` seulement quand il vaut le
 * chemin d'un nœud importé (`exact`, `relink` à défaut) ; un lien hors du périmètre reste tel quel.
 */
export function rewriteLinks(markdown: string, relink: Relink, orphan: (to: string) => void, exact: Relink = relink): string {
  let fence: Fence | null = null
  let referenceLine = false
  let callBody = false
  return markdown
    .split("\n")
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) {
          fence = null
          return line
        }
        if (callBody) return rewriteCallLine(line, exact)
        if (!referenceLine) return line
        referenceLine = false
        const [path = "", ...rest] = line.split(" ")
        const target = path ? relink(path) : null
        if (path && target === null) orphan(path)
        return target === null ? line : [target, ...rest].join(" ")
      }
      fence = openingFence(line, 3)
      if (fence) {
        referenceLine = fence.info.split(/\s+/)[0] === "reference"
        callBody = fence.info.split(/\s+/)[0] === "call"
        return line
      }
      return rewriteLine(line, relink, orphan)
    })
    .join("\n")
}
