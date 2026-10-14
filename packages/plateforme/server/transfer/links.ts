// Les liens d'une page importée recollés aux chemins d'arrivée (`node.import_tree`) : les `[[…]]` hors du code, la première
// ligne d'un bloc `reference` et les arguments d'un bloc `call`. `relink` rend le chemin d'arrivée d'un chemin de la source,
// `null` hors du périmètre ; `orphan` reçoit chaque lien laissé tel quel. Sans lui, une page importée pointerait vers les
// chemins de la source, et une procédure appellerait ses tableaux, que la publication refuse.
import { closesFence, linksIn, openingFence, type Fence } from "../../schemas/link-syntax"
import { isJsonObject } from "../json"

type Relink = (sourcePath: string) => string | null

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

/** Une valeur des arguments d'un appel, chaque chaîne qui est un chemin du plan remplacée par son chemin d'arrivée. */
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
 * d'arrivée, comme la première ligne d'un bloc de référence et les arguments d'un bloc `call` ; un lien hors du
 * périmètre reste tel quel.
 */
export function rewriteLinks(markdown: string, relink: Relink, orphan: (to: string) => void): string {
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
        if (callBody) return rewriteCallLine(line, relink)
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
