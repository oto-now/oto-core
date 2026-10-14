// Publication d'un nœud (E03-S03, AC29 à AC33, N22, N46) : en trois temps, branches explicites par
// genre. (1) Préparer : l'écriture exigée d'abord (`requireNodeLevel`, action `publish` ; écrire publie,
// fiche D135, E11-S02 : en-tête d'un tableau compris, HN-E11S02-17), puis le
// tampon du brouillon, ses blocs lus une fois, les contrôles du genre publié, les liens extraits ; un
// refus ici garde le brouillon et n'appelle pas `publish_node`. (2) Publier : `publish_node`, atomique
// (garde de révision, instantané, liens, brouillon effacé). (3) Dériver : ligne d'un Contexte au
// contenu changé (E11-S03) ; purge des colonnes retirées d'un tableau (E07-S04). Sans lui, la publication serait mêlée
// à l'écriture du brouillon.
//
// Repris de la maquette (`mcp-test/src/proto/services/write.ts` l. 139-191) : la publication qui
// incrémente la révision et la ligne des règles changées. Retiré : la publication en plusieurs
// requêtes (→ `publish_node`), l'incrément manuel de `rules_version` (→ déclencheur), `triggers` et
// `neighbors` (P37).
import { splitSections } from "../../schemas"
import { requireNodeLevel, unknownPath } from "../access"
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { fromDatabaseError, inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { procedureAdvice } from "../procedure-advice"
import { checkProcedureBlocks, procedurePublicationError } from "../procedures-check"
import { finishTablePublication, prepareTablePublication, type TablePublication } from "../tables/evolution-publish"
import { samePublishedContent } from "./diff"
import type { DocBlock } from "./document"
import { prepareLinks } from "./links"
import type { NodeRow } from "./lookup"
import { followTitle } from "./rename"
import { currentRevision, loadBlocks, loadDraft, snapshotBlocks } from "./store"

/**
 * `table` : ce que la publication d'un en-tête de tableau a changé et ses avertissements (E07-S04) ;
 * `renamed` : le chemin a suivi le titre publié (E05-S10, AC-b12), l'ancien restant un alias.
 */
export type PublishResult = {
  revision: number
  sections: number
  blocks: number
  rulesChanged: boolean
  warnings: string[]
  table?: TablePublication
  renamed?: { from: string; to: string }
}

/** Le brouillon a bougé depuis son tampon ; `details.revision`, la révision du nœud (AC37). */
function changedWhilePublishing(path: string, revision: number): PlatformError {
  return new PlatformError(
    "stale_revision",
    `stale revision: ${path} changed while publishing (its draft was saved meanwhile). Nothing was published. Read it again with draft: true, then retry.`,
    { revision },
  )
}

/**
 * Traduction d'un refus de `publish_node` (§ Contrat, point 4, N41) : `stale_revision` (un `PT409`,
 * lu par `errors.ts`) → la révision a avancé, ou le brouillon a bougé (tampon de M02) ; `55000` →
 * rien à publier ; `P0002` et `23503` → introuvable ; `42501` après la décision du service → `forbidden`.
 */
async function publishFailure(db: PlatformDb, node: NodeRow, baseRevision: number, error: { code?: string }): Promise<PlatformError> {
  if (error.code === "55000") return new PlatformError("invalid_arguments", `Nothing to publish: ${node.path} has no pending draft.`)
  if (error.code === "P0002" || error.code === "23503") return new PlatformError("not_found", unknownPath(node.path))
  const translated = fromDatabaseError(error, "publish_node")
  if (translated.code !== "stale_revision") return translated
  const revision = (await currentRevision(db, node.id)) ?? node.revision
  if (revision === baseRevision) return changedWhilePublishing(node.path, revision)
  return new PlatformError(
    "stale_revision",
    `stale revision: ${node.path} is at revision ${revision}, not ${baseRevision}. Nothing was published. Read it again, then retry.`,
    { revision },
  )
}

/**
 * `publish_node` par la face SQL, arguments nommés comme PostgREST les passait (la surcharge au tampon,
 * M02), dans l'ordre de sa signature ; sans `p_links` pour un tableau, dont les liens ne changent pas. Le
 * tampon repasse par un texte : une `Date` perdrait ses microsecondes, et `publish_node` le compare à
 * l'égalité, et `p_links` passe par `sql.json` (`supabase-patterns.md § Couplage à Supabase (ADR-012)`,
 * `timestamptz` et paramètres `jsonb`).
 */
async function publishDraft(db: PlatformDb, node: NodeRow, publication: { baseRevision: number; stamp: string; links: Json | null }): Promise<number> {
  const { baseRevision, stamp, links } = publication
  const [row] = await db
    .tx((sql) =>
      links === null
        ? sql<{ revision: number }[]>`
            select platform.publish_node(p_node => ${node.id}, p_base_revision => ${baseRevision}, p_draft_stamp => ${stamp}::text::timestamptz) as revision`
        : sql<{ revision: number }[]>`
            select platform.publish_node(p_node => ${node.id}, p_base_revision => ${baseRevision}, p_draft_stamp => ${stamp}::text::timestamptz, p_links => ${sql.json(links)}) as revision`,
    )
    .catch(async (error: { code?: string }) => {
      throw await publishFailure(db, node, baseRevision, error)
    })
  if (!row) throw new PlatformError("internal", "Internal error.")
  return row.revision
}

/**
 * Un Contexte publié change ce que `context` sert (E11-S03, AC-a7, H28) : sa première publication, ou des blocs
 * publiés différents de ceux de la révision précédente (son instantané, `node_versions`), comparés comme la
 * garde du `ctx` les compare ; une republication à l'identique ne périme aucune conversation.
 */
async function contextChanged(db: PlatformDb, node: NodeRow, revision: number, blocks: readonly DocBlock[]): Promise<boolean> {
  if (node.kind !== "context") return false
  if (revision <= 1) return true
  const [previous] = await inTransaction(
    db,
    "publish: previous version",
    (sql) => sql<{ blocks: Json }[]>`select blocks from platform.node_versions where node_id = ${node.id} and revision = ${revision - 1}`,
  )
  return !previous || !samePublishedContent(snapshotBlocks(previous.blocks), blocks)
}

/**
 * Publie le brouillon d'un nœud (N22) : exige l'écriture (E11-S02) avant toute lecture du brouillon et tout
 * appel à `publish_node` ; lit le tampon du brouillon avant les contrôles et le passe en
 * `p_draft_stamp` (N46, E03-S06 N9) ; `draftStamp` (l'écran) exige en plus que le
 * brouillon n'ait pas bougé depuis sa lecture. Un tableau se publie sans `p_links` (ses liens ne
 * changent pas) ; `confirmRemove` y confirme l'effacement des colonnes retirées (E07-S04, AC8).
 */
export async function publishNode(
  db: PlatformDb,
  identity: Identity,
  node: NodeRow,
  options: { baseRevision: number; draftStamp?: string; confirmRemove?: boolean },
): Promise<PublishResult> {
  await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "publish")
  // (1) Préparer.
  const draft = await loadDraft(db, node.id)
  if (!draft) throw new PlatformError("invalid_arguments", `Nothing to publish: ${node.path} has no pending draft.`)
  if (options.draftStamp !== undefined && options.draftStamp !== draft.stamp) throw changedWhilePublishing(node.path, node.revision)
  const kind = draft.kind ?? node.kind
  const blocks = kind === "table" ? [] : await loadBlocks(db, node.id, "draft")
  // Contrôles propres au genre publié : `procedure` → blocs du brouillon lus ci-dessus, tous les
  // problèmes d'un coup (E03-S06) ; `table` → l'en-tête du brouillon contrôlé sur les lignes, et les
  // valeurs restées sous le nom d'une colonne ajoutée purgées (E07-S04). Les liens sont relus sous
  // les droits du publieur, sur les mêmes blocs, et donnent `p_links` et les avertissements (E03-S07).
  if (kind === "procedure") {
    const refusals = await checkProcedureBlocks(db, identity, blocks)
    if (refusals.length > 0) throw procedurePublicationError(node.path, refusals, identity.org.prefix)
  }
  const table = kind === "table" ? await prepareTablePublication(db, identity, node, { meta: draft.meta, confirmRemove: options.confirmRemove === true }) : null
  const links = kind === "table" ? null : await prepareLinks(db, identity, node, blocks)
  // (2) Publier, sur le tampon lu en (1) : un brouillon écrit depuis n'est jamais publié (`PT409`, M02).
  // Seule dans sa transaction : `publish_node` est atomique, et ses refus relisent la base après elle.
  const revision = await publishDraft(db, node, { baseRevision: options.baseRevision, stamp: draft.stamp, links: links?.pLinks ?? null })
  // (3) Dériver : un Contexte publié à un contenu neuf périme les conversations qui l'ont reçu (H28, P39,
  // E11-S03) ; avertissements des liens et des blocs `reference` (E03-S07) ; purge des colonnes retirées
  // d'un tableau et avertissements de son en-tête (E07-S04).
  const rulesChanged = await contextChanged(db, node, revision, blocks)
  const evolved = await finishTablePublication(db, identity, node, table)
  // (4) L'adresse suit un titre changé par le brouillon publié, pour l'écran comme pour un assistant
  // (AC-b12, HN-E05S10e-5) ; sans titre en attente, rien à relire.
  const renamed = draft.title !== null && draft.title !== node.title ? await followTitle(db, identity, node) : null
  return {
    revision,
    sections: splitSections(blocks).length - 1,
    blocks: blocks.length,
    rulesChanged,
    warnings: [...(links?.warnings ?? []), ...(evolved?.texts ?? []), ...(kind === "procedure" ? procedureAdvice(blocks) : [])],
    ...(evolved ? { table: evolved } : {}),
    ...(renamed ? { renamed } : {}),
  }
}
