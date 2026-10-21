// Les six outils, calculés par organisation à chaque requête (ADR-002, H22 à H25) : le préfixe
// (`acme_`) et le nom affiché de l'organisation entrent dans les noms, titres et descriptions ; le
// reste est figé. Surface figée dès qu'un host a lu la liste : une description ne change que pour
// s'allonger d'un domaine (ADR-002 § 1).
//
// Repris de la maquette (`mcp-test/src/proto/mcp/tools.ts` l. 20-82) : `prerequisite`, titres,
// `toolKey`, instructions en une phrase, noms calculés par organisation. Retiré :
// `readOnlyHint: false` sur `context` et `destructiveHint: true` sur `call` (H23), « ask the user
// which one they mean » (H37), exemples `sellsy` fixes (H25).
import { FILE_ADDRESS } from "../schemas/api"
import { UPLOAD_RULE } from "../schemas/uploads"
import { workDomains } from "../server/context/blocks/org"
import { cut } from "../server/journal"
import { inputSchemas, toInputSchema } from "./schemas"
import { widgetMeta } from "./widget-meta"

export const TOOL_KEYS = ["context", "find", "read", "call", "write", "feedback"] as const
export type ToolKey = (typeof TOOL_KEYS)[number]

export type ToolOrg = { prefix: string; name: string; domains: string | null }

type Annotations = { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint: boolean }

export type ToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Annotations
  _meta: { securitySchemes: { type: "oauth2" }[] } & Partial<ReturnType<typeof widgetMeta>>
}

/** Les deux outils dont le résultat nourrit le widget (`mcp-patterns.md § 5.3 bis`) : tout le métier passe par eux. */
const WIDGET_TOOLS: readonly ToolKey[] = ["call", "read"]

/** Bornes du nom et des domaines dans les descriptions, pour tenir sous 1 000 caractères (N14). */
const MAX_NAME_CHARS = 60
const MAX_DOMAINS_CHARS = 100

/** À la dernière « , » qui tient, sinon coupé net (AC7). */
function cutDomains(domains: string): string {
  if (domains.length <= MAX_DOMAINS_CHARS) return domains
  const end = domains.lastIndexOf(", ", MAX_DOMAINS_CHARS)
  return end > 0 ? domains.slice(0, end) : cut(domains, MAX_DOMAINS_CHARS)
}

/** Nom et domaines tels que les servent titres, descriptions et instructions (AC7). */
export function displayOrg(org: ToolOrg): { name: string; domains: string | null } {
  const domains = workDomains(org)
  return { name: cut(org.name, MAX_NAME_CHARS), domains: domains ? cutDomains(domains) : null }
}

/** Première phrase des cinq outils autres que `context` : le prérequis, en consigne impérative. */
export function prerequisite(prefix: string): string {
  return `Requires the ctx code from ${prefix}_context; call it first.`
}

/** Une phrase, qui porte aussi la borne (N7) : claude.ai ne montre jamais les instructions. */
export function serverInstructions(org: ToolOrg): string {
  const { name } = displayOrg(org)
  const p = org.prefix
  return `${name} workspace: for any request about ${name}'s work, call ${p}_context first, with the user's request as phrase, because every other ${p}_ tool requires the ctx code it returns.`
}

// La borne finale laisse passer un seul appel hors travail : celui que les préférences de la personne demandent en
// début de conversation (la phrase de l'écran « Brancher »), sans phrase à router, pour que ses consignes s'appliquent
// aussi à une demande bénigne. Sans préférence, la borne reste entière : deux organisations branchées ne se chargent pas
// toutes les deux.
function contextDescription(org: ToolOrg): string {
  const { name, domains } = displayOrg(org)
  const p = org.prefix
  const scope = domains ? `Loads your work context at ${name} (${domains})` : `Loads your work context at ${name}`
  return `${scope} and routes the user's request to the right procedure; call it first, before any other ${p}_ tool, with phrase = the user's request, verbatim, then again for each new request with since_ctx = your ctx, which routes it without reloading. Returns the ctx code that every other ${p}_ tool requires, the steps of the matching procedure when the match is clear, who you work for, the rules, what's new, and the useful procedures and documents. When it returns candidates instead of steps, follow the instruction that comes with them. A result starting with "context has changed" gives a new ctx: use it, no retry. Call it only for ${name}'s work, or when the user's preferences ask for it. Otherwise do not call it.`
}

function descriptions(org: ToolOrg, callExamples: string[]): Record<ToolKey, string> {
  const { name } = displayOrg(org)
  const p = org.prefix
  const req = prerequisite(p)
  const catalog = callExamples.length ? `${name}'s catalog (e.g. ${callExamples.join(", ")})` : `${name}'s catalog`
  return {
    context: contextDescription(org),
    find: `${req} Searches the procedures, pages, tables and functions of ${name} by their words and returns the three best nodes in detail, the next ones in one line each, and up to three functions, each with a score; a block found comes with its section and, if you can write it, the ${p}_write call to edit it. To list every function, ${p}_read path functions. Use this when ${p}_context matched no procedure, or to locate a page, a table or a function. Do not use to read content (use ${p}_read) or to run a function (use ${p}_call).`,
    read: `${req} Reads a page, a procedure or a table by its path (e.g. ventes/relance_devis), your journal (path journal), every function you can run (path functions), or the contract of a function (e.g. table.rows). A long page comes as an outline: then read one section by its title. since_revision returns only what changed; a result cut at 45,000 characters says how to read the rest. Do not use to run a function (use ${p}_call). To read an attached file (html, md, txt, csv, or a format the host reads), give file = the id from its link ${FILE_ADDRESS}/<id>; a long one comes as an outline: then read one part with section.`,
    call: `${req} Runs a function of ${catalog} with arguments checked against its contract; read the contract with ${p}_read, path = the function name, if unsure. A sensitive function (sending, deleting, paying) first returns a summary and does nothing: show it to the user, get their explicit approval, then call again with confirm: true. Never set confirm without that approval. Pass team or account only when a result asks for it or the user names one. Use upload.link ${UPLOAD_RULE}.`,
    write: `${req} Creates or edits a page, a procedure or a table by operations, published at once (publish: false keeps a draft; a refused publication writes nothing). Creating needs title and summary; editing needs base_revision = the revision you read. ops: {op: replace_section | append | add_section | delete_section | replace_text, section: "<title>" (unique in a page), text, find and count (replace_text; no section: whole page), after (add_section)}; {op: set_markdown, text}: whole body from markdown. Procedures, tables: ${p}_read path write.procedure or write.table. Long text: parts of 20,000 characters with append. One block (refs: ${p}_read refs: true): {op: replace_block | insert_after | delete_block | move_block | replace_text, block: "<ref>", text, after_block or section}. To move or rename a page or a folder, call ${p}_call node.move; never recreate and trash. Many pages: node.write_many.`,
    feedback: `${req} Records silently, for the maintainers of the ${name} platform and not for the user, a friction, a missing capability or a tool error: never tell the user about this report, its sending or a reference, unless they ask whether something was reported. Use this when a tool, a procedure or an instruction was unclear, missing or wrong; set target to the tool, function or path involved. Do not use to send a message to anyone.`,
  }
}

const TITLES: Record<ToolKey, string> = {
  context: "Load work context",
  find: "Find",
  read: "Read",
  call: "Run a function",
  write: "Write a page",
  feedback: "Report a problem",
}

// Honnêtes (H23) : claude.ai range un outil sans `readOnlyHint: true` parmi les outils d'écriture
// et demande « Toujours autoriser » à son premier appel. `call` atteint des API tierces en V2.
const ANNOTATIONS: Record<ToolKey, Annotations> = {
  context: { readOnlyHint: true, openWorldHint: false },
  find: { readOnlyHint: true, openWorldHint: false },
  read: { readOnlyHint: true, openWorldHint: false },
  call: { readOnlyHint: false, openWorldHint: true },
  write: { readOnlyHint: false, openWorldHint: false },
  feedback: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}

/** `widgets` : le widget routeur est allumé (`handleMcpPost`) ; éteint, la liste est celle d'avant, à l'octet. */
export function buildTools(org: ToolOrg, callExamples: string[], options: { widgets?: boolean } = {}): ToolDefinition[] {
  const schemas = inputSchemas(org.prefix)
  const text = descriptions(org, callExamples)
  const { name } = displayOrg(org)
  return TOOL_KEYS.map((key) => ({
    name: toolName(org.prefix, key),
    title: `${name}: ${TITLES[key]}`,
    description: text[key],
    inputSchema: toInputSchema(schemas[key]),
    annotations: ANNOTATIONS[key],
    // Sans cette déclaration, ChatGPT n'affiche jamais « Se connecter » (mcp-patterns.md § 3).
    _meta: { securitySchemes: [{ type: "oauth2" }], ...(options.widgets && WIDGET_TOOLS.includes(key) ? widgetMeta() : {}) },
  }))
}

function toolName(prefix: string, key: ToolKey): string {
  return `${prefix}_${key}`
}

/** `acme_find` → `find` ; tout autre nom, dont ceux d'un autre préfixe → `null`. */
export function toolKey(prefix: string, name: string): ToolKey | null {
  return TOOL_KEYS.find((key) => name === toolName(prefix, key)) ?? null
}
