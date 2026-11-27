// L'écriture d'un assistant qui publie, entière ou rien (E11-S18, AC-1 ; ADR-011 § 3 amendé) : création du nœud,
// brouillon, publication, adresse qui suit le titre et ligne du `ctx` de son auteur tiennent dans une seule transaction ;
// un refus l'annule, et son texte ne parle plus d'un brouillon gardé. L'écran garde son brouillon (il sauve la frappe
// d'une personne), comme `publish: false`, sauf pour le seul genre (`writesAtomically`). Fichier à part de `write.ts`, déjà au-delà de la borne de 300 lignes
// (`coding-standards.md § Complexité`).
import { acceptOwnContextWrite } from "../ctx"
import type { PlatformDb } from "../db"
import { inTransaction, isPlatformError, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { CONFIRM_REMOVE_LEAD, DISCARD_LEAD, DRAFT_KEPT } from "../tables/evolution-checks"
import type { ToolOutput } from "../tool-output"
import { findNode } from "./lookup"
import { loadDraft } from "./store"
import { contextChangedLine, type WriteAtPath, type WriteOrigin } from "./write-result"

/** Ce qu'une écriture atomique dit à la place d'un brouillon gardé ; et quand un brouillon d'avant l'appel reste. */
const NOTHING_WRITTEN = "Nothing was written."
const DRAFT_BEFORE_STAYS = "Nothing was written; the draft saved before this call stays."

/**
 * Une écriture d'assistant qui publie (HN-E11S18-1) : `write` du MCP, `upload.link`, `table.import`, `node.write_many` ;
 * et, par toute porte, une écriture publiée qui ne change que le genre (« Page ⇄ Procédure » de l'écran) : elle n'a
 * aucune frappe à sauver, et un brouillon gardé après un refus de publier ses blocs `call` porterait le genre refusé.
 */
export function writesAtomically(body: Pick<WriteAtPath, "publish" | "kind" | "ops" | "title" | "summary" | "header">, origin: WriteOrigin): boolean {
  if (body.publish === false) return false
  const kindOnly = body.kind !== undefined && (body.ops?.length ?? 0) === 0 && body.title === undefined && body.summary === undefined && body.header === undefined
  return origin.kind === "agent" || kindOnly
}

/**
 * La phrase du brouillon gardé réécrite : sans brouillon d'avant l'appel, « Nothing was written. », son renvoi à
 * `node.discard_draft` retiré ; avec lui (écrit par `publish: false` ou à l'écran), le brouillon qui reste, et le renvoi.
 */
function withoutKeptDraft(message: string, draftStays: boolean): string {
  const at = message.indexOf(DRAFT_KEPT)
  if (at === -1) return message
  let end = at + DRAFT_KEPT.length
  if (draftStays) return `${message.slice(0, at)}${DRAFT_BEFORE_STAYS}${message.slice(end)}`
  if (message.startsWith(DISCARD_LEAD, end)) {
    const close = message.indexOf("}.", end)
    end = close === -1 ? end : close + 2
  }
  return `${message.slice(0, at)}${NOTHING_WRITTEN}${message.slice(end)}`
}

/**
 * Un refus d'une écriture atomique (HN-E11S18-3) : rien n'est écrit, le texte le dit ; un retrait de colonne à
 * confirmer donne l'appel entier à refaire, son `header` augmenté de `confirm_remove`.
 */
function unwrittenRefusal(error: unknown, body: WriteAtPath, context: { prefix: string; draftStays: boolean }): unknown {
  if (!isPlatformError(error)) return error
  const { prefix } = context
  let message = withoutKeptDraft(error.message, context.draftStays)
  const confirm = message.indexOf(CONFIRM_REMOVE_LEAD)
  if (confirm !== -1) {
    const again = { ...body, header: { ...(body.header ?? {}), confirm_remove: true } }
    message = `${message.slice(0, confirm)}${CONFIRM_REMOVE_LEAD}${prefix}_write ${JSON.stringify(again)}.`
  }
  return message === error.message ? error : new PlatformError(error.code, message, error.details)
}

/**
 * L'écriture `run` dans une transaction, que reprend chaque transaction des services appelés (`db.tx`, même session) ;
 * un refus sort réécrit (`unwrittenRefusal`), après l'annulation. Sans point de sauvegarde (HN-E11S18-2) : une erreur de
 * la base (une course) interrompt la transaction, et le refus qui relirait la base après elle y devient une panne ;
 * l'écriture, annulée entière, se rejoue alors une fois, et dit l'état d'après la course.
 */
export async function writeAtomically<T>(db: PlatformDb, identity: Identity, body: WriteAtPath, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await inTransaction(db, "nodes: write and publish", () => run())
    } catch (error) {
      if (attempt === 1 && isPlatformError(error) && error.code === "internal") continue
      const draftStays = isPlatformError(error) && error.message.includes(DRAFT_KEPT) && (await draftBefore(db, identity, body.path))
      throw unwrittenRefusal(error, body, { prefix: identity.org.prefix, draftStays })
    }
  }
}

/** Un brouillon du nœud, relu après l'annulation : celui d'avant l'appel. Une panne de la relecture ne le suppose pas. */
async function draftBefore(db: PlatformDb, identity: Identity, path: string): Promise<boolean> {
  try {
    const found = await findNode(db, identity, path)
    return found !== null && (await loadDraft(db, found.node.id)) !== null
  } catch (error) {
    console.error("[platform] write: draft before the call not read", isPlatformError(error) ? error.code : error)
    return false
  }
}

/**
 * L'auteur d'un Contexte garde son `ctx` (E11-S18, AC-14, HN-E11S18-12 ; E11-S19, `acceptOwnContextWrite`) : après
 * l'écriture d'un assistant qui a changé un Contexte (`rules_changed`), la ligne de son code passe à la révision publiée,
 * et la réponse le dit. Hors de la transaction de l'écriture, qu'il ne défait jamais : sans code, quand le code ne
 * l'avait pas reçu à la révision d'avant, ou en panne (journalisée), la réponse garde la consigne de rappeler `context`.
 */
export async function keepAuthorCtx(db: PlatformDb, identity: Identity, origin: WriteOrigin, output: ToolOutput): Promise<ToolOutput> {
  const data = output.data ?? {}
  if (origin.kind !== "agent" || !origin.ctx || data.rules_changed !== true || typeof data.path !== "string" || typeof data.revision !== "number") return output
  const written = { ctx: origin.ctx, path: data.path, revision: data.revision }
  const kept = await acceptOwnContextWrite(db, identity, written).catch((error: unknown) => {
    console.error("[platform] write: ctx of the author not advanced", error instanceof Error ? error.message : error)
    return false
  })
  if (!kept) return output
  const prefix = identity.org.prefix
  return { ...output, text: output.text.replace(contextChangedLine(prefix, data.path, false), contextChangedLine(prefix, data.path, true)) }
}
