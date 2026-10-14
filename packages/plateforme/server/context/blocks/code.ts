// Bloc 1 de `context` : le code `ctx` et la consigne de le repasser (H27), puis ce que le routage a
// trouvé pour la phrase (E03-S02) : la procédure servie et les autres candidats, ou les candidats entre
// lesquels l'assistant choisit (E11-S16, H37 amendée). Repris de la maquette
// (`mcp-test/src/proto/services/context.ts` l. 67-89) : lignes servies, candidats toujours visibles,
// refus de deviner ; retiré : la consigne unique « Ask the user which procedure they mean » (H37).
// E05-S12 (retour 2, AC-9, AC-10) : les règles de l'espace, entre la consigne du code et la ligne du routage.
// Repris d'Oto (`oto_mcp/capabilities/orgs/instructions.py`) : l'idée d'un texte de règles servi à l'agent ;
// retiré : un guide à lire d'abord, modifiable par organisation (architecture § 10) — ici une section fixe.
import { SERVED_RULES } from "../../../schemas"
import { boundedList } from "../../errors"
import { clip, MAX_TARGET_CHARS } from "../../journal"
import { formatScore, wordsInCommon, type Candidate, type RequestKind, type RoutingSettings } from "../../routing"
import type { ContextBlock } from "../engine"
import { hintLines, type RoutingHints } from "../hints"

/**
 * « Règles Oto » (E05-S12, AC-9, AC-10, HN-E05S12-7, -8) : le texte de la story, mot pour mot, que JB peut
 * encore corriger ici seulement ; 1.4.3 : les pointeurs vers les références (`functions`, `help`, contrats, `table.schema`)
 * et les pièges qui coûtent le plus (titre qui déplace le chemin, `node.move`, `contexte`, outils sans préfixe) ; `<p>` devient le préfixe de l'organisation, rien d'autre ne varie. Sans
 * lui, l'assistant ne lit nulle part comment l'espace fonctionne (la notice n'est plus servie, § 10). E05-S13
 * (AC-16) : l'en-tête vient de `SERVED_RULES`, que l'écran relit ; exporté pour le test qui compte ses règles contre
 * leur traduction à l'écran.
 */
export const WORKSPACE_RULES = `${SERVED_RULES.title}
- Six tools: <p>_context (first, once per conversation), <p>_find, <p>_read, <p>_call, <p>_write, <p>_feedback. Every tool but <p>_context needs the ctx above.
- Usual order: context, then find to locate, read to learn (a content, or the contract of a function), call or write to act, feedback when a tool, a procedure or an instruction was unclear, missing or wrong.
- Every content has a path (e.g. <team>/<page>) and a kind: page (text in blocks), table (rows, through <p>_call table.rows, table.aggregate and table.write), procedure (steps to follow, each call in a call block) or context (the sections below: already served, read one only when it says it was cut).
- Spaces: the organisation's contents sit at the root, a team's under its folder (<team>/...), yours under private/<handle>/, served to you only.
- Access is set per content, for the organisation, a team or a person: read, write or manage. A refusal says who to ask: never work around it.
- <p>_write publishes at once; publish: false keeps an unpublished draft. To edit, pass base_revision = the revision you read, or the one your last write returned.
- A renamed or moved content keeps its old path: it still leads there.
- In a text, [[path]] or [[path|title]] links to another content; name the tools without the organisation prefix (read, write, find, call), so the text stays right in another organisation.
- A function that sends, deletes or pays first returns a summary and does nothing: show it, get the user's explicit yes, then call again with confirm: true.
- When a request matches a procedure, its steps come right after this part: follow them in order. Otherwise the closest procedures are listed there: use the one that fits, or search; ask the user when nothing fits.
- <p>_read with path journal shows what was done, call by call: trust it over memory.
- Reference: <p>_read path functions lists every function (path <function>: its contract); path help is the platform guide (pages and blocks, tables, procedures, paths, import and export), one section at a time; read path write.procedure or write.table before writing one, and <p>_call table.schema before writing rows.
- Publishing a new title moves the path; to reorganise, <p>_call node.move, never recreate then trash. contexte is the context page of the organisation, a team or your space: give no other page that name.
- Never invent a path, a figure or a result: read it, or say you could not.`

/** La section des règles pour l'organisation de préfixe `prefix`. */
export function workspaceRules(prefix: string): string {
  return WORKSPACE_RULES.replaceAll("<p>", prefix)
}

type CodeBlockInput = {
  prefix: string
  code: string
  phrase?: string
  /** Candidats montrés, triés ; `null` : le routage n'a pas abouti (AC18, N30). */
  candidates: readonly Candidate[] | null
  served: Candidate | null
  /** `requestKind(phrase)` ; `null` sans phrase. */
  kind: RequestKind | null
  /** Seuil et écart de l'organisation (E11-S19, AC-d1) ; `null` sans phrase. */
  settings?: RoutingSettings | null
  /**
   * `context` léger (E11-S19, AC-c1, AC-c2) : le code d'où l'on repart et les Contextes changés depuis ; les règles ne
   * sont pas redites, la ligne de `sinceLine` les remplace.
   */
  since?: { code: string; changed: readonly string[] }
  /** Sans procédure servie (1.4.3) : les fonctions qui répondent à la demande et la section du guide la plus proche. */
  hints?: RoutingHints
}

/** Les mots de la demande trouvés dans une candidate (E11-S19, AC-d2) : ce qu'un auteur ajouterait au résumé. */
function scoreReason(phrase: string, candidate: Candidate): string {
  const words = wordsInCommon(phrase, candidate)
  return words.length > 0 ? `words in common: ${words.join(", ")}` : "no word in common"
}

/** Le réglage qui sert des étapes (E11-S19, AC-d1, H40) : seuil et écart de l'organisation. */
function servedFrom(settings: RoutingSettings | null | undefined): string {
  return settings ? ` (steps are served from a score of ${formatScore(settings.threshold)}, ${formatScore(settings.gap)} ahead of the next)` : ""
}

/**
 * Une candidate par ligne, avec son titre et son résumé (E11-S16, AC-a1) : l'assistant départage ce que le score
 * lexical ne sait pas départager (« Relancer les devis » et « Relancer les tickets »).
 */
function candidateLines(phrase: string, candidates: readonly Candidate[]): string {
  return candidates
    .map((candidate) => `- ${candidate.path} — ${candidate.title}: ${candidate.summary} (${formatScore(candidate.score)}; ${scoreReason(phrase, candidate)})`)
    .join("\n")
}

/**
 * La ligne du routage (AC7, AC8, AC18) : servie, candidats et consigne, rien, ou routage en panne. E11-S16 (décision
 * de JB) : l'assistant arbitre entre les candidates, sans consigne par genre de phrase ; seule une procédure servie
 * sur une demande « comment » garde de n'exécuter que sur demande.
 */
function routingLine({ prefix, phrase, candidates, served, kind, settings }: CodeBlockInput & { phrase: string }): string {
  // Phrase reprise, bornée comme la cible du journal (N4).
  const request = `Request « ${clip(phrase, MAX_TARGET_CHARS)} »`
  const search = `${prefix}_find can search pages, tables and functions.`
  if (candidates === null) return `${request}: no procedure could be matched right now. ${search}`
  if (served) {
    const others = candidates.filter((candidate) => candidate.path !== served.path)
    const matched = `${request} matches ${served.path} (score ${formatScore(served.score)}): its steps follow, if the request is about « ${served.title} ».`
    const tail =
      others.length > 0
        ? `\nOther candidates:\n${candidateLines(phrase, others)}\nIf the request is about one of them instead, read that one with ${prefix}_read and follow it rather than these steps.`
        : ""
    const how = kind === "how" ? "\nIt asks how: explain these steps, and run them only if the user asks." : ""
    return `${matched}${tail}${how}`
  }
  if (candidates.length > 0) {
    return `${request}: no clear match${servedFrom(settings)}. Closest procedures:\n${candidateLines(phrase, candidates)}\nRead the one that fits the request with ${prefix}_read, if any; otherwise search with ${prefix}_find or ask the user.`
  }
  const question = `It is a question: search with ${prefix}_find, ${prefix}_read or ${prefix}_call table.rows and answer it`
  if (kind === "data") return `${request}: no procedure matches. ${question}.`
  // E11-S19 (AC-d3, HN-E11S19-6) : la marche d'une édition, sans procédure générique.
  if (kind === "edit") {
    return `${request}: no procedure matches. It asks to change a content: search with ${prefix}_find for the exact words to change, not the document's title; each block found comes with its section and how to edit it with ${prefix}_write.`
  }
  return `${request}: no procedure matches. Say so instead of guessing; ${search}`
}

/** La ligne d'un `context` léger (E11-S19, AC-c1, AC-c2) : ce qui vaut encore du code d'où l'on repart. */
function sinceLine(since: { code: string; changed: readonly string[] }): string {
  if (since.changed.length === 0) return `Since ctx ${since.code}: nothing changed; the rules and contexts served with it still hold.`
  return `Since ctx ${since.code}: the rules and the other contexts served with it still hold; the changed contexts follow (${boundedList(since.changed)}).`
}

export function codeBlock(input: CodeBlockInput): ContextBlock {
  const { prefix, code, phrase, since } = input
  const lines = [
    `ctx: ${code}`,
    // Un Contexte changé ne refuse pas l'appel : son résultat commence par l'avis, le nouveau code et les Contextes changés.
    `Pass this ctx to every ${prefix}_ tool. If a result starts with "context has changed", it gives a new ctx and the changed contexts: read them and use the new ctx from then on; the call itself ran, do not repeat it.`,
    since ? sinceLine(since) : workspaceRules(prefix),
    "## This request",
    phrase
      ? routingLine({ ...input, phrase })
      : `No request given: call ${prefix}_context again with the user's request as phrase to get the matching procedure.`,
    ...(phrase && !input.served ? hintLines(input.hints, prefix) : []),
  ]
  return { name: "code", text: lines.join("\n") }
}
