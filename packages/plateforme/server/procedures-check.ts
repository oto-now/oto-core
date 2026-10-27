// Contrôle d'une procédure (E03-S06 ; ADR-011, H60, P37, P38) : les problèmes de ses blocs avant sa
// publication (R2, R4, R7 à R13 ; plus de borne de taille depuis le 2026-10-27), et le refus qui les liste tous. Le contrôle lit des blocs (types
// `call` et `code`, plus les lignes ```call de ce qu'un bloc rend tel quel), jamais le markdown (N1), et
// n'écrit rien. Ses textes viennent d'un client : chaque lecture y est en temps linéaire. Sans
// lui, une procédure se publie avec un appel que `call` refusera à chaque passage (banc E04, D4 : neuf
// refus et deux tickets). La publication (`nodes/publish.ts`) et l'écran (`procedures.ts`) l'appellent.
//
// Repris de la maquette (`mcp-test/src/proto/functions/table.ts` l. 193-195, 351-353) : l'état réservé
// à `table.claim`, qu'un contrôle propre à la fonction (`checkArgs`, E07-S02) refuse ; retiré : ce refus
// à l'appel seulement. Repris d'Oto (`capabilities/orgs/instructions.py` l. 83, 1077-1205) : une borne de
// taille chiffrée, un contrôle à l'enregistrement qui nomme l'élément ; retiré : les contrôles non
// bloquants (« enregistrée et cassée »), les slots, la bibliothèque et la copie.
import {
  callLocation,
  formatCallLocation,
  isPlaceholderValue,
  orderBlocks,
  sectionOfBlock,
  type ProcedureRefusal,
  type ProcedureRefusalKind,
} from "../schemas"
import { listItemTexts, tableCells } from "../schemas/blocks"
import { argumentNames, checkArguments } from "./catalog/arguments"
import type { CatalogFunction } from "./catalog/define"
import { assistantFunctions, findFunction, isActive } from "./catalog/registry"
import { loadActiveConnectors } from "./connectors/activations"
import type { PlatformDb } from "./db"
import { boundedList, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { cut } from "./journal"
import { formatCount, type DocBlock } from "./nodes/document"

/** Nom d'une fonction (règle 3) : `table.rows`, `mail.create_draft`, jamais `<p>_call`. */
const FUNCTION_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

/** Une clé ou une valeur citée dans un problème : sur une ligne, 60 caractères au plus. */
const QUOTED_MAX = 60

/** Options de `call` (H86, H84, H83) et clés de son enveloppe : jamais des arguments d'un bloc (R9, N11). */
const CALL_OPTIONS = new Set(["confirm", "team", "account"])
const ENVELOPE_KEYS = new Set(["ctx", "function", "arguments"])

/**
 * Une ligne rognée qui ouvre une clôture `call` (accents graves ou tildes, sans casse, tout blanc avant
 * `call` : l'analyse du markdown rogne l'info d'une clôture) : règle 6, N17.
 */
const CALL_FENCE = /^(?:`{3,}|~{3,})\s*call(?:\s|$)/i

/** Un saut de ligne comme l'analyse du markdown les lit (`\r\n`, `\r` ou `\n`, `markdown-parse.ts`). */
const LINE_BREAK = /\r\n?|\n/

/** Un bloc lu en base : son `id` est posé par la base, et seul ce qui est en base se publie. */
type StoredBlock = DocBlock & { id: string }

const stored = (block: DocBlock): block is StoredBlock => block.id !== null

type Scope = {
  db: PlatformDb
  identity: Identity
  blocks: readonly StoredBlock[]
  functions: readonly CatalogFunction[]
  active: ReadonlySet<string>
}

type Problem = { kind: ProcedureRefusalKind; message: string; element?: string }

/**
 * Un texte sur une ligne, un problème par ligne du refus : chaque suite de blancs qui porte un saut de
 * ligne devient une espace. Chaque caractère n'est lu qu'une fois : `\s*[\r\n]+\s*` était quadratique
 * sur une longue suite de blancs sans saut de ligne (revue d'E03-S06).
 */
const oneLine = (text: string) => text.replace(/\s+/g, (blanks) => (/[\r\n]/.test(blanks) ? " " : blanks))

/** Une clé, un chemin ou un message cité : coupé à 60 caractères d'abord, ce qui borne la suite. */
const quoted = (text: string) => oneLine(cut(text, QUOTED_MAX))

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** La valeur à un chemin d'arguments (`["rows", 0, "key"]`) ; `undefined` si le chemin n'y mène pas. */
function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined
    current = Reflect.get(current, key)
  }
  return current
}

const strings = (values: readonly unknown[]) => values.filter((value): value is string => typeof value === "string")

/**
 * Ce qu'un bloc rend tel quel (M05), où une ligne qui ouvre une clôture `call` se lirait comme un appel
 * (règle 6, N17) : texte, éléments, légende, texte alternatif et source d'une image, ton d'un encart.
 * Un bloc `code` rend sa langue sur la ligne qui ouvre sa clôture ; une langue qui porte un saut de
 * ligne ou un accent grave casse cette clôture (CommonMark, `markdown-parse.ts`), et son code se lit
 * alors lui aussi comme du texte.
 */
function renderedTexts(block: StoredBlock): string[] {
  const items: unknown[] = Array.isArray(block.data.items) ? block.data.items : []
  if (block.type === "code") {
    const language = typeof block.data.language === "string" ? block.data.language : ""
    return [`\`\`\`${language}`, ...(/[\r\n`]/.test(language) ? strings([block.text]) : [])]
  }
  if (block.type === "paragraph") return strings([block.text])
  if (block.type === "callout") return strings([block.text, block.data.tone])
  if (block.type === "image") return strings([block.text, block.data.alt, block.data.src])
  // E10-S04 (AC-a5) : un sous-élément, une cellule, un résumé ou un corps de repli se rendent tels quels aussi.
  if (block.type === "list") return listItemTexts(items)
  if (block.type === "checklist") return strings(items.map((item) => (isRecord(item) ? item.text : null)))
  if (block.type === "simple_table") return tableCells(block.data)
  if (block.type === "toggle") return strings([block.data.summary, block.text])
  return []
}

/** Un texte dont une ligne, rognée, ouvre une clôture `call`. */
const opensCallFence = (text: string) => text.split(LINE_BREAK).some((line) => CALL_FENCE.test(line.trim()))

/** R2 : un bloc `code` marqué `call`, ou un bloc qui rend une ligne ```call sans être un bloc `call` (règle 6, N3, N17). */
function fenceRefusals(blocks: readonly StoredBlock[], block: StoredBlock): ProcedureRefusal[] {
  if (!renderedTexts(block).some(opensCallFence)) return []
  const code = block.type === "code"
  const section = sectionOfBlock(blocks, block.id)
  const where = `${section === null ? "before the first heading" : `section « ${section} »`}, ${code ? "code" : "text"} block`
  const why = code ? "this code block is marked call but is plain code" : "this text holds a call fence but is plain text"
  const message = `${where}: ${why}, so it was never checked; write it as a call block`
  return [{ kind: "invalid_block", ...(section === null ? {} : { section }), block_id: block.id, message }]
}

/** R9 ou R10 : une clé que la fonction ne connaît pas, dans l'ordre des clés du bloc. */
function unknownKey(fn: CatalogFunction, key: string, keys: readonly string[], prefix: string): Problem {
  if (CALL_OPTIONS.has(key)) {
    const hint =
      key === "confirm"
        ? "say in the step's text to call again with confirm: true after the user's explicit approval"
        : "the team comes from where the procedure lives, and the account from that team or the organisation"
    return { kind: "unknown_key", element: key, message: `« ${key} » is an option of ${prefix}_call, not an argument of ${fn.name}; ${hint}` }
  }
  if (ENVELOPE_KEYS.has(key)) {
    return { kind: "unknown_key", element: key, message: `« ${key} » belongs to the ${prefix}_call envelope; write only the arguments of ${fn.name} in the block` }
  }
  const element = quoted(key)
  return { kind: "unknown_key", element, message: `${fn.name} has no argument « ${element} »; its arguments: ${boundedList(keys) || "none"}` }
}

type Issue = { path: PropertyKey[]; message: string; code: string }

/**
 * R12 : les valeurs littérales que le schéma refuse, dans l'ordre des clés du bloc ; un espace réservé
 * (règle 4), une clé absente (R11) et une clé inconnue (R9, R10) n'en donnent pas.
 */
function valueProblems(fn: CatalogFunction, args: Record<string, unknown>, issues: readonly Issue[]): Problem[] {
  const order = Object.keys(args)
  const rank = (issue: Issue) => (issue.path.length === 0 ? order.length : order.indexOf(String(issue.path[0])))
  return issues
    .filter((issue) => (issue.path.length === 0 ? issue.code !== "unrecognized_keys" : Object.hasOwn(args, String(issue.path[0]))))
    .filter((issue) => !isPlaceholderValue(valueAt(args, issue.path)))
    .sort((a, b) => rank(a) - rank(b))
    .map((issue): Problem => {
      const value = valueAt(args, issue.path)
      const got = value === undefined ? "" : ` (got ${cut(JSON.stringify(value), QUOTED_MAX)})`
      // Chemin et message coupés : une clé imbriquée inconnue, sans borne, entre dans les deux.
      const message = quoted(issue.message)
      if (issue.path.length === 0) return { kind: "invalid_value", message: `${fn.name} arguments: ${message}${got}` }
      const element = quoted(issue.path.map(String).join("."))
      return { kind: "invalid_value", element, message: `${fn.name} argument « ${element} »: ${message}${got}` }
    })
}

/** R9 à R12 d'un bloc : clés inconnues (ordre des clés), arguments requis absents (ordre du schéma), valeurs. */
function argumentProblems(fn: CatalogFunction, args: Record<string, unknown>, prefix: string): Problem[] {
  const keys = argumentNames(fn.schema)
  const checked = checkArguments(fn.schema, args)
  const issues: Issue[] = checked.success ? [] : checked.issues
  const missing = keys.filter((key) => !Object.hasOwn(args, key) && issues.some((issue) => issue.path[0] === key))
  return [
    ...Object.keys(args)
      .filter((key) => !keys.includes(key))
      .map((key) => unknownKey(fn, key, keys, prefix)),
    ...missing.map(
      (key): Problem => ({
        kind: "missing_argument",
        element: key,
        message: `${fn.name} needs argument « ${key} »; write "<…>" for a value known only when the procedure runs`,
      }),
    ),
    ...valueProblems(fn, args, issues),
  ]
}

/** Les problèmes d'un bloc `call`, dans l'ordre : R4, sinon R7, sinon R8, sinon ses arguments, sinon R13. */
async function callRefusals(scope: Scope, block: StoredBlock): Promise<ProcedureRefusal[]> {
  const { identity } = scope
  const location = callLocation(scope.blocks, block.id)
  const name = typeof block.data.function === "string" ? block.data.function : ""
  const refused = (problem: Problem): ProcedureRefusal => ({
    kind: problem.kind,
    ...(location.section === null ? {} : { section: location.section }),
    block: location.rank,
    ...(location.step === null ? {} : { step: location.step }),
    block_id: block.id,
    function: name,
    ...(problem.element === undefined ? {} : { element: problem.element }),
    message: oneLine(`${formatCallLocation(location)}: ${problem.message}`),
  })
  const prefix = identity.org.prefix
  if (!FUNCTION_NAME.test(name)) {
    return [refused({ kind: "invalid_block", message: `a call block starts with a function name such as table.rows, found « ${quoted(name)} »` })]
  }
  const fn = findFunction(scope.functions, name)
  if (!fn) return [refused({ kind: "unknown_function", message: `unknown function « ${name} »; ${prefix}_find with type function lists the functions` })]
  if (!isActive(fn, scope.active)) {
    const message = `${name} belongs to connector ${fn.connector}, which is not enabled for ${identity.org.name}; an administrator enables it on the dashboard`
    return [refused({ kind: "function_not_active", message })]
  }
  const args = isRecord(block.data.args) ? block.data.args : {}
  const problems = argumentProblems(fn, args, prefix)
  if (problems.length > 0) return problems.map(refused)
  const isPlaceholder = (path: readonly PropertyKey[]) => isPlaceholderValue(valueAt(args, path))
  const checked = (await fn.checkArgs?.({ db: scope.db, identity }, args, isPlaceholder)) ?? []
  return checked.map((problem) => refused({ kind: "check_failed", message: `${name}: ${problem}` }))
}

/**
 * Les problèmes d'une procédure (R2, R4, R7 à R13 ; R1, sa taille, retirée le 2026-10-27), sans écriture :
 * ses blocs dans l'ordre du document (`position`, `id`), chacun situé par `callLocation` et
 * `formatCallLocation` (M05), ou par `sectionOfBlock` hors d'un bloc `call`. Catalogue en mémoire,
 * connecteurs actifs relus pour l'appel (seulement s'il y a un bloc `call`), `checkArgs` de chaque
 * fonction. `[]` : rien à corriger.
 */
export async function checkProcedureBlocks(db: PlatformDb, identity: Identity, blocks: readonly DocBlock[]): Promise<ProcedureRefusal[]> {
  const ordered = orderBlocks(blocks.filter(stored))
  const refusals: ProcedureRefusal[] = []
  const calls = ordered.some((block) => block.type === "call")
  const active = calls ? await loadActiveConnectors(db, identity.org.id) : new Set<string>()
  const scope: Scope = { db, identity, blocks: ordered, functions: assistantFunctions(), active }
  for (const block of ordered) refusals.push(...(block.type === "call" ? await callRefusals(scope, block) : fenceRefusals(ordered, block)))
  return refusals
}

/**
 * Le refus d'une publication (AC2, AC3, N5) : tous les problèmes, 20 listés puis leur nombre, et
 * `details.refusals` complet pour l'écran ; servi en texte seul par le MCP (`formatError`). La dernière
 * ligne dit comment écrire une procédure en plusieurs appels, `write` publiant par défaut (E11-S02,
 * AC-b2, N28).
 */
export function procedurePublicationError(path: string, refusals: readonly ProcedureRefusal[], prefix: string): PlatformError {
  // `boundedList` borne la liste (`mcp-patterns.md § 4`) ; sa ligne de compte, seule ligne sans « - »,
  // prend la forme d'E03-S06 : « - … and <n> more. ».
  const problems = boundedList(
    refusals.map((refusal) => `- ${refusal.message}`),
    "\n",
  ).replace(/\n(… and \d+ more)$/, "\n- $1.")
  const message = [
    `Publication of ${path} refused: ${formatCount(refusals.length)} problem(s). The draft is kept; nothing was published.`,
    problems,
    `Fix them with ${prefix}_write (ops on the sections), then publish again. Format and rules: ${prefix}_read {"path": "write.procedure"}.`,
    "Writing it in several calls? Pass publish: false until the last one.",
  ].join("\n")
  return new PlatformError("invalid_arguments", message, { refusals: [...refusals] })
}
