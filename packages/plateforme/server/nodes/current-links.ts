// Les liens d'un document vers un chemin que le nœud cité a quitté (déplacement, renommage), réécrits au chemin courant :
// `read` sert le chemin courant, et l'écriture suivante de la page l'enregistre. Sans lui, le texte gardait l'ancien
// chemin : l'alias y menait toujours, mais l'assistant ne voyait pas où le nœud était, et recopiait l'ancien chemin. Le
// texte stocké d'une page qu'on n'écrit pas ne change pas : aucune écriture dans les pages d'autrui, aucun conflit.
import type { PlatformDb } from "../db"
import type { Identity } from "../identity"
import { isJsonObject } from "../json"
import { rewriteLinks } from "../transfer/links"
import type { DocBlock } from "./document"
import { resolveTargets } from "./link-resolution"
import { extractLinks } from "./links"

/** Les blocs lus tels quels : un `[[…]]` y est du code, pas un lien. */
const LITERAL = new Set(["code", "call", "mermaid"])

type Relink = (path: string) => string | null

const ignore = () => {}

/** Chaque chaîne d'une valeur, ses liens recollés ; le reste tel quel. */
function relinked(value: unknown, relink: Relink): unknown {
  if (typeof value === "string") return rewriteLinks(value, relink, ignore)
  if (Array.isArray(value)) return value.map((item) => relinked(item, relink))
  if (isJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relinked(item, relink)]))
  return value
}

/** Un bloc, ses liens recollés : son texte et les chaînes de son `data`, ou le chemin d'un bloc `reference`. */
function relinkBlock<B extends DocBlock>(block: B, relink: Relink): B {
  if (LITERAL.has(block.type)) return block
  if (block.type === "reference") {
    const path = typeof block.data.path === "string" ? relink(block.data.path) : null
    return path === null ? block : { ...block, data: { ...block.data, path } }
  }
  // `relinked` rend la même forme que `data`, chaînes réécrites seules : son type `unknown` ne le dit pas.
  return { ...block, text: typeof block.text === "string" ? rewriteLinks(block.text, relink, ignore) : block.text, data: relinked(block.data, relink) as B["data"] }
}

/**
 * Les blocs, chaque lien vers un ancien chemin pris au chemin courant de son nœud (alias suivis pour la personne, une
 * lecture pour tous les liens, `resolveTargets`) ; un lien vers un nœud invisible, ou absent, reste tel quel.
 */
export async function withCurrentLinks<B extends DocBlock>(db: PlatformDb, identity: Identity, blocks: readonly B[]): Promise<B[]> {
  const paths = [...new Set(extractLinks(blocks).links.map((link) => link.path))]
  if (paths.length === 0) return [...blocks]
  const resolved = await resolveTargets(db, identity, paths.map((path) => ({ path, key: null })))
  const moved = new Map(resolved.flatMap((target) => (target.status === "moved" && target.node ? [[target.path, target.node.path] as const] : [])))
  if (moved.size === 0) return [...blocks]
  const relink: Relink = (path) => moved.get(path) ?? null
  return blocks.map((block) => relinkBlock(block, relink))
}
