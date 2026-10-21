// Parties de `read` au-delà de 45 000 caractères (E03-S03, AC14, AC15, N2, N3) : le corps coupé à une
// fin de ligne, chaque partie servie avec son curseur, le plafond mesuré sur `structuredContent`
// sérialisé. Un curseur se lie au nœud, à la requête et à l'empreinte du texte complet : il ne sert
// que le texte d'où il vient. Le sujet coupé est un nœud, ou un fichier en transit lu par `file` seul, sans chemin, auquel
// le curseur se lie de même. Fichier à part de `read.ts` pour la borne de 300 lignes.
import { filePath, type ReadNodeInput } from "../../schemas"
import { PlatformError } from "../errors"
import { MAX_DATA_CHARS, MAX_RESULT_CHARS, serializedLength, type ToolOutput } from "../tool-output"
import type { NodeRow } from "./lookup"
import { callArguments, type Served } from "./read-body"
import { cutPages, decodeCursor, encodeCursor, fingerprint } from "./read-format"

/** Marge sous le plafond : les nombres d'une partie (`part`, `parts`) ne sont connus qu'après la coupe. */
const MARGIN = 200

/** Ce que `read` coupe : un nœud, ou un fichier en transit (`path` nul, titre : son nom), désigné par `file`. */
export type PageSubject = Pick<NodeRow, "id" | "title"> & { path: string | null }

export type PageRequest = {
  input: ReadNodeInput
  node: PageSubject
  prefix: string
  header: string
  served: Served
  data: Record<string, unknown>
  nextActions: string[]
  teamId: string | null
}

/**
 * Les données en champs sous `MAX_DATA_CHARS` : le plan, les enfants, puis les blocs `reference` et
 * les liens (E03-S07) raccourcis au besoin (N2).
 */
function fitted(data: Record<string, unknown>): Record<string, unknown> {
  const room = MAX_DATA_CHARS - MARGIN
  const fit = { ...data }
  for (const field of ["outline", "children", "references", "links_out", "links_in"]) {
    const value = fit[field]
    let list: unknown[] = Array.isArray(value) ? value : []
    while (JSON.stringify(fit).length > room && list.length > 0) {
      list = list.slice(0, Math.floor(list.length / 2))
      fit[field] = list
    }
  }
  return fit
}

function fits(text: string, data: Record<string, unknown>, nextActions: string[]): boolean {
  return JSON.stringify({ ...data, text, next_actions: nextActions }).length <= MAX_RESULT_CHARS
}

/**
 * La requête sans le curseur : nœud, mode, section, brouillon, références, écart (N3). Le chemin est
 * celui du nœud, pas celui demandé : une lecture par un ancien chemin se poursuit par le nouveau, que
 * sert l'appel de la partie suivante (E03-S07, AC7).
 */
function requestKey(input: ReadNodeInput, node: PageSubject): string {
  // `file` (E10-S02, AC-d2) n'entre dans la clé que donné : les curseurs d'une lecture sans fichier ne changent pas.
  const file = input.file === undefined ? [] : [input.file]
  return fingerprint(JSON.stringify([node.path, input.section ?? null, input.outline ?? false, input.since_revision ?? null, input.draft ?? false, input.refs ?? false, ...file]))
}

function stale(node: PageSubject): PlatformError {
  return new PlatformError(
    "invalid_arguments",
    `This cursor no longer matches ${node.path ?? `file ${node.id}`} (it changed, or the request differs): read again without cursor.`,
  )
}

/**
 * Un curseur illisible, d'un autre nœud ou d'une autre requête (mode, section, brouillon, références)
 * est refusé avant de servir quoi que ce soit (AC14) ; l'empreinte du texte se vérifie à la coupe.
 */
export function checkCursor(input: ReadNodeInput, node: PageSubject): void {
  if (input.cursor === undefined) return
  const cursor = decodeCursor(input.cursor)
  if (!cursor || cursor.node !== node.id || cursor.request !== requestKey(input, node)) throw stale(node)
}

/**
 * Le résultat de `read` : entier s'il tient sous 45 000 caractères sérialisés, sinon la partie que
 * demande le curseur (la première sans curseur), coupée à une fin de ligne, suivie de la ligne qui dit
 * comment lire la suite ; `structuredContent` porte alors `next_cursor`, `part` et `parts`.
 */
export function paginate(request: PageRequest): ToolOutput {
  const { input, node, prefix, served } = request
  const footer = served.footer.join("\n")
  const data = fitted(request.data)
  // Un fichier en transit entre au journal par son adresse seule, jamais par son nom.
  const base = { nextActions: request.nextActions, target: node.path ?? filePath(node.id), teamId: request.teamId }
  const whole = [request.header, served.body, footer].filter((part) => part !== "").join("\n\n")
  if (input.cursor === undefined && fits(whole, data, request.nextActions)) return { text: whole, data, ...base }

  const key = requestKey(input, node)
  const print = fingerprint(served.body)
  const tokenFor = (part: number) => encodeCursor({ node: node.id, request: key, text: print, part })
  const call = (part: number) =>
    `${prefix}_read ${callArguments({ path: node.path ?? undefined, section: input.section, outline: input.outline, since_revision: input.since_revision, draft: input.draft, refs: input.refs, file: input.file, cursor: tokenFor(part) })}`
  const continued = (part: number, parts: number) => `Continued (part ${part} of ${parts}): read the rest with ${call(part + 1)}.`
  const shortHeader = (part: number, parts: number) => `# ${node.title} (continued, part ${part} of ${parts})`

  const frame = JSON.stringify({ ...data, text: "", next_actions: request.nextActions, next_cursor: tokenFor(999), part: 999, parts: 999 }).length
  const room = MAX_RESULT_CHARS - frame - MARGIN
  const tail = Math.max(serializedLength(`\n\n${continued(999, 999)}`), serializedLength(footer === "" ? "" : `\n\n${footer}`))
  const first = room - serializedLength(`${request.header}\n\n`) - tail
  const next = room - serializedLength(`${shortHeader(999, 999)}\n\n`) - tail
  const parts = cutPages(served.body, first, next)

  let part = 1
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor)
    if (!cursor || cursor.node !== node.id || cursor.request !== key || cursor.text !== print || cursor.part > parts.length) throw stale(node)
    part = cursor.part
  }
  const last = part === parts.length
  const head = part === 1 ? request.header : shortHeader(part, parts.length)
  const end = last ? footer : continued(part, parts.length)
  const text = [head, parts[part - 1], end].filter((chunk) => chunk !== "").join("\n\n")
  return {
    text,
    data: { ...data, next_cursor: last ? null : tokenFor(part + 1), part, parts: parts.length },
    ...base,
    continuation: last ? undefined : `Read the rest with ${call(part + 1)}.`,
  }
}
