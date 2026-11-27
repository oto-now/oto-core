// « Revenir à cette version » (tiroir « Historique des versions ») : l'instantané d'une révision réécrit comme une
// révision de plus, par le brouillon et `publish_node`, jamais en réécrivant l'historique. Les blocs encore là gardent
// leur identifiant ; ceux créés depuis partent ; ceux retirés depuis reviennent comme des blocs neufs (la base ne
// laisse pas l'API poser `blocks.id`, `migrations/README.md`, Blocs). L'écriture est exigée avant toute requête
// d'écriture ; un tableau, dont les lignes n'ont pas d'historique, est refusé. Fichier à part de `history.ts`, qui ne
// fait que lire. Sans lui, revenir en arrière demanderait de recopier l'ancienne version à la main.
import { restoreRevisionSchema, type RestoreRevisionResult } from "../../schemas/node-history"
import { ACCESS_LEVELS, requireNodeLevel } from "../access"
import type { PlatformDb } from "../db"
import { invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { samePublishedContent } from "./diff"
import { loadSnapshots, readableNode } from "./history"
import type { NodeRow } from "./lookup"
import { publishNode } from "./publish"
import { loadBlocks, loadDraft, openDraft, publishedMeanwhile, saveDraft } from "./store"
import { ownerOf, teamOf } from "./view"
import { writeAtomically } from "./write-atomic"
import { provenanceOf } from "./write-result"

/** L'en-tête en attente qui ramène celui de la version : les seuls champs qui diffèrent. */
function restoredHeader(node: NodeRow, version: { title: string; summary: string; kind: string }): { title?: string; summary?: string; kind?: string } | null {
  const header = {
    ...(version.title === node.title ? {} : { title: version.title }),
    ...(version.summary === node.summary ? {} : { summary: version.summary }),
    ...(version.kind === node.kind ? {} : { kind: version.kind }),
  }
  return Object.keys(header).length > 0 ? header : null
}

/** Les refus d'avant toute écriture : un tableau, une révision lue périmée, la version courante. */
function checkRestore(node: NodeRow, input: { revision: number; base_revision: number }): void {
  if (node.kind === "table") {
    throw new PlatformError("invalid_arguments", `${node.path} is a table: its rows have no versions yet, and a table is not restored from its history.`)
  }
  if (input.base_revision !== node.revision) {
    throw new PlatformError("stale_revision", `stale revision: ${node.path} is at revision ${node.revision}, not ${input.base_revision}. Nothing was restored. Read its history again, then retry.`, { revision: node.revision })
  }
  if (input.revision >= node.revision) throw new PlatformError("invalid_arguments", `Revision ${input.revision} is the current version of ${node.path}: choose an earlier one.`)
}

/**
 * `POST nodes/restore` : la révision `revision` d'une page, d'une procédure ou d'un Contexte publiée de nouveau, sur la
 * révision lue (`base_revision`), entière ou rien (`writeAtomically`). Refusé sans le droit d'écrire (le refus dit à qui
 * demander), sur un tableau, sur un brouillon ouvert (il serait écrasé) et quand la version a déjà le contenu courant.
 */
export async function restoreRevision(db: PlatformDb, identity: Identity, input: unknown): Promise<{ data: RestoreRevisionResult; target: string; teamId: string | null }> {
  const parsed = restoreRevisionSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { revision } = parsed.data
  const found = await readableNode(db, identity, parsed.data.path)
  const { node } = found
  if (found.level < ACCESS_LEVELS.write) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "write")
  checkRestore(node, parsed.data)
  const version = (await loadSnapshots(db, node.id, [revision])).get(revision)
  if (!version) throw new PlatformError("not_found", `Unknown revision ${revision} of ${node.path}.`)
  const current = await loadBlocks(db, node.id, "published")
  const header = restoredHeader(node, version)
  if (!header && samePublishedContent(current, version.blocks)) {
    throw new PlatformError("invalid_arguments", `${node.path} already has the content of revision ${revision}: nothing to restore.`)
  }
  const data = await writeAtomically(db, identity, { path: node.path }, async () => {
    // L'ouverture du brouillon part dans la transaction de l'écriture, sous son verrou : un brouillon qu'elle trouve déjà
    // ouvert, même écrit pendant l'appel, serait écrasé, et refuse le retour ; le tampon garde l'en-tête en attente.
    const open = async (): Promise<string | null> => {
      const opened = await openDraft(db, node)
      if (!opened.created) {
        throw new PlatformError("conflict", `${node.path} has unpublished changes: publish or discard them, then restore revision ${revision}.`)
      }
      if (opened.baseRevision !== node.revision) throw publishedMeanwhile(node.path, opened.baseRevision)
      return header ? ((await loadDraft(db, node.id))?.stamp ?? null) : null
    }
    const saved = await saveDraft(db, {
      open,
      node,
      orgId: identity.org.id,
      userId: identity.user.id,
      current,
      next: version.blocks,
      header,
      stamp: null,
      provenance: provenanceOf(identity, { kind: "human" }),
      prefix: identity.org.prefix,
    })
    const published = await publishNode(db, identity, node, { baseRevision: node.revision, draftStamp: saved.stamp ?? undefined })
    return { path: published.renamed?.to ?? node.path, revision: published.revision, restored: revision }
  })
  return { data, target: data.path, teamId: teamOf(await ownerOf(db, node.id)) }
}
