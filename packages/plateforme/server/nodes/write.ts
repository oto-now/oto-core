// `write` et `POST /api/platform/nodes` (E03-S03, AC19 à AC34) : création, opérations par section et
// par bloc, brouillon partagé (`open_draft`, blocs `draft`, `node_drafts`), garde de révision, genre,
// provenance, publication par `publishNode`, par défaut (écrire publie, fiche D135, E11-S02 ; `publish:
// false` garde le brouillon). L'écriture est exigée sur le nœud, ou sur le parent pour
// une création (`access.ts`), avant toute écriture (H123) ; un chemin occupé par un nœud invisible est
// refusé avant l'insertion (N31). Branche `table` (E07-S04) : création d'un tableau, et son en-tête
// écrit par patch dans `node_drafts.meta` (`tables/evolution.ts`). Sans lui, rien ne s'écrit.
//
// Repris de la maquette (`mcp-test/src/proto/services/write.ts` l. 50-52, 58-89, 91-99, 101-127) :
// format du chemin, création en brouillon à la révision 0, garde de révision qui rend l'état actuel,
// brouillon gardé par son horodatage. Retiré : `teamForPath` (→ propriétaire hérité, H52), `triggers`
// et `neighbors` (P37), le brouillon en colonne du nœud (→ `node_drafts` et blocs `draft`).
import { writeNodeBodySchema, type WriteNodeBody } from "../../schemas"
import type { TableHeader, TableHeaderPatch } from "../../schemas/tables"
import { ACCESS_LEVELS, describeOwner, requireNodeLevel, reservedTo, type AccessLevel, type Owner } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import { FUNCTIONS_PATH } from "../find"
import { HELP_PATH } from "../help"
import type { Identity } from "../identity"
import { wellFormed } from "../journal"
import { JOURNAL_PATH } from "../../schemas/journal"
import { changesHeader, currentHeader, headerChangeText, missingHeader, readHeaderPatch, targetHeader } from "../tables/evolution"
import type { ToolOutput } from "../tool-output"
import { placeBlocks } from "./document"
import { BLOCKS_MAX, OPS_MAX } from "./limits"
import type { WorkBlock } from "./op-kit"
import { applyOps } from "./ops"
import { publishNode, type PublishResult } from "./publish"
import { renamedLine } from "./rename"
import { freePath, lastSegment, UNTITLED_SEGMENT } from "./segments"
import { closestExisting, findNode, lookupAlias, lookupNode, movedNotice, notAvailable, parentPath, refuseUnderRoot, ROOT_PATH, type NodeRow } from "./lookup"
import { loadBlocks, loadDraft, openDraft, publishedMeanwhile, saveDraft, type DraftRow } from "./store"
import { staleState } from "./read-format"
import { ownerOf, teamOf } from "./view"
import { withCurrentLinks } from "./current-links"
import { insertNode, provenanceOf, savedResult, type Saved, type WriteOrigin } from "./write-result"
import { attachFiles, refuseFilesOnCreate } from "./write-files"
import { keepAuthorCtx, writeAtomically, writesAtomically } from "./write-atomic"

export type { WriteOrigin } from "./write-result"

/**
 * L'entrée validée par le corps de l'API, sur-ensemble de l'entrée de `write` (N40, N45), chaque chaîne
 * sans moitié de paire de substitution (`wellFormed`, AC28, N21 ; `supabase-patterns.md § Error Handling`).
 */
function parseBody(input: unknown): WriteNodeBody {
  const parsed = writeNodeBodySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  return wellFormed(parsed.data)
}

/**
 * Le mode tolérant de l'analyse (E10-S01, AC-a2) : demandé par le corps de l'API seulement ; le MCP ne le porte jamais.
 * Un `.md` déposé par lien (E10-S02, AC-f7) se lit toujours ainsi, sous la provenance de l'assistant (`origin.file`).
 */
function tolerantFor(body: WriteNodeBody, origin: WriteOrigin): boolean {
  return origin.kind === "human" ? body.tolerant === true : origin.file !== undefined
}

/**
 * Les opérations d'un appel (fiche D153) : une écriture de l'écran (porte `POST nodes`) en porte autant qu'une page a de
 * blocs au plus, pour qu'une sélection de blocs se supprime ou se déplace en une écriture (E11-S17, AC-a6, AC-a8) ;
 * un assistant, 50. Décidé par la porte, jamais par le corps.
 */
function opsMaxFor(origin: WriteOrigin): number {
  return origin.kind === "human" ? BLOCKS_MAX : OPS_MAX
}

/** Un `.md` déposé par lien (E10-S02, AC-f7, AC-f8) : écrit entier, sans borne de section, et qui remplace tout le corps. */
function uploadedFile(origin: WriteOrigin): { replace: boolean } | undefined {
  return origin.kind === "agent" ? origin.file : undefined
}

/** À qui demander (H68) : la partie « à qui » d'`access.ts` pour le propriétaire effectif, lu une fois par l'appelant. */
async function whoToAsk(db: PlatformDb, identity: Identity, owner: Owner | null): Promise<string> {
  return owner ? describeOwner(db, identity, owner) : "its managers"
}

/** Racine (H50), chemin du journal (E05-S05) et espaces personnels (H61, N29), avant toute lecture ; relu par `upload.link` (E10-S02, AC-f1). */
export function checkPath(identity: Identity, path: string): void {
  // Un nœud à ce chemin masquerait le journal que `read` y sert (AC12 d'E05-S05, HN-E05S05-8).
  if (path === JOURNAL_PATH) throw new PlatformError("invalid_arguments", "journal is reserved: it serves the call journal. Choose another path.")
  // E11-S19 (AC-e3) : `read` y liste les fonctions que la personne peut appeler.
  if (path === FUNCTIONS_PATH) throw new PlatformError("invalid_arguments", "functions is reserved: it lists the functions you can run. Choose another path.")
  // 1.4.3 : `read` y sert le guide de la plateforme.
  if (path === HELP_PATH) throw new PlatformError("invalid_arguments", "help is reserved: it serves the platform guide. Choose another path.")
  refuseUnderRoot(path)
  const space = /^private\/([^/]+)$/.exec(path)
  const handle = identity.member.profile.handle
  if (space && space[1] !== handle) {
    // Le compte et l'organisation de l'appel disent la cause : un connecteur ouvert sous un autre compte ou vers
    // une autre organisation (le handle est propre à chacune), ou une identité sans handle (accès de l'équipe plateforme).
    const signedIn = `this connection is signed in as ${identity.user.email} in ${identity.org.name}`
    const own = handle ? `, where your personal space is private/${handle}` : "; you have no personal space here"
    throw new PlatformError("forbidden", `private/${space[1]} is not your personal space: ${signedIn}${own}.`)
  }
}

/**
 * Un titre sans `base_revision` sur son propre espace (`private/<handle>`) : l'assistant voulait y créer une page,
 * pas renommer l'espace ; le refus `stale_revision` le lui dit.
 */
function pageInOwnSpace(identity: Identity, node: NodeRow, body: WriteNodeBody): string {
  const handle = identity.member.profile.handle
  const meant = handle !== undefined && node.path === `private/${handle}` && body.title !== undefined && body.base_revision === undefined
  return meant ? ` ${node.path} is your personal space itself: to create a page in it, write at ${node.path}/<page>.` : ""
}

function checkOneLine(body: WriteNodeBody): void {
  if (/[\r\n]/.test(body.title ?? "") || /[\r\n]/.test(body.summary ?? "")) {
    throw new PlatformError("invalid_arguments", "title and summary hold on one line (no line break).")
  }
}

const KIND_LABELS: Record<string, string> = { page: "page", procedure: "procedure", context: "context page", table: "table" }

/** Des `ops` sur un tableau, existant ou créé (AC27 ; E07-S04 AC2) : ses lignes s'écrivent par `table.write`. */
function tableHasNoSections(path: string, prefix: string): PlatformError {
  return new PlatformError("invalid_arguments", `${path} is a table: it has no sections. Write its rows with ${prefix}_call table.write.`)
}

/** Genre d'un nœud existant (AC27, N26, N27, P37) ; l'en-tête d'un tableau est lu par `readHeaderPatch` (E07-S04). */
function checkKinds(body: WriteNodeBody, node: NodeRow, prefix: string): void {
  if (node.kind === "table") {
    if (body.kind !== undefined && body.kind !== "table") throw new PlatformError("invalid_arguments", `${node.path} is a table: its kind cannot change.`)
    if ((body.ops?.length ?? 0) > 0) throw tableHasNoSections(node.path, prefix)
    return
  }
  if (node.kind === "context" && body.kind !== undefined) throw new PlatformError("invalid_arguments", `${node.path} is a context page: its kind cannot change.`)
  if (body.kind === "table") {
    throw new PlatformError("invalid_arguments", `A ${KIND_LABELS[node.kind] ?? node.kind} cannot become a table: create the table at a new path.`)
  }
  if (body.header !== undefined) {
    throw new PlatformError("invalid_arguments", `header applies only to tables; ${node.path} is a ${KIND_LABELS[node.kind] ?? node.kind}.`)
  }
}

/** Refus d'une révision absente ou périmée (AC21) : rien n'est écrit, l'état actuel est rendu. */
async function staleRevision(db: PlatformDb, node: NodeRow, base: number | undefined, note = ""): Promise<PlatformError> {
  const blocks = node.kind === "table" ? [] : await loadBlocks(db, node.id, "published")
  const first =
    base === undefined
      ? `stale revision: ${node.path} is at revision ${node.revision} and base_revision is missing.`
      : `stale revision: ${node.path} is at revision ${node.revision}, not ${base}.`
  return new PlatformError(
    "stale_revision",
    `${first} Nothing was written.${note} Current state:\n${staleState(node, blocks)}\nRead what you need, then write again with base_revision ${node.revision}.`,
    { revision: node.revision },
  )
}

/**
 * Une écriture ; pour un tableau (E07-S04), `patch` est son `header` lu (`readHeaderPatch`), et
 * `createdHeader`, l'en-tête cible d'une création, validé avant l'insertion du nœud (AC2).
 */
type Edit = {
  node: NodeRow
  level: AccessLevel
  created: boolean
  body: WriteNodeBody
  origin: WriteOrigin
  patch?: TableHeaderPatch | null
  createdHeader?: TableHeader
}

/**
 * L'en-tête cible d'un tableau écrit et ce que l'écriture y change (E07-S04, AC3, AC5) : le patch fusionné
 * sur l'en-tête du brouillon, sinon publié, validé avant toute écriture ; `null` sans en-tête à écrire.
 */
function tableHeaderEdit(edit: Edit, draft: DraftRow | null, prefix: string): { target: TableHeader; text: string } | null {
  if (!edit.patch || !changesHeader(edit.patch)) return null
  const pending = edit.created ? null : (draft?.meta ?? null)
  const base = edit.created ? null : currentHeader(edit.node, pending)
  const target = edit.createdHeader ?? targetHeader({ base, patch: edit.patch, path: edit.node.path, prefix, pending: pending !== null })
  return { target, text: headerChangeText(base, target) }
}

/**
 * Un en-tête de tableau enregistré par un autre entre la lecture du brouillon et la relecture de son
 * tampon (E07-S04, § Forme de `header`) : la fusion n'en est pas partie, l'écrire le perdrait. Refusé,
 * jamais perdu, journalisé d'abord (`security-patterns.md § Idempotence et mutations concurrentes`).
 */
function headerSavedMeanwhile(node: NodeRow): PlatformError {
  console.error(`[platform] nodes: draft of ${node.id} changed while writing (header)`)
  return new PlatformError(
    "stale_revision",
    `stale revision: ${node.path} changed while writing (its pending header was saved meanwhile). Nothing was written. Read it again with draft: true, then retry.`,
    { revision: node.revision },
  )
}

/** Le brouillon écrit : opérations appliquées en mémoire, `open_draft` au besoin, puis l'écriture (N18, N19). */
async function saveEdits(db: PlatformDb, identity: Identity, edit: Edit): Promise<Saved> {
  const { node, body } = edit
  const draft = edit.created ? null : await loadDraft(db, node.id)
  // Un tableau n'a pas de blocs de document : ses lignes (`row`) ne passent jamais par le brouillon (N27).
  const state = draft || edit.created ? "draft" : "published"
  const current = node.kind === "table" ? [] : await loadBlocks(db, node.id, state)
  const tolerant = tolerantFor(body, edit.origin)
  // Un `.md` déposé par lien qui remplace le corps s'applique à une page vide (E10-S02, AC-f8).
  const file = uploadedFile(edit.origin)
  // Les liens vers un nœud déplacé, pris à son chemin courant : l'écriture les enregistre, comme `read` les a servis.
  const base = file?.replace ? [] : await withCurrentLinks(db, identity, current)
  // Les fichiers cités, relus avant l'écriture (E10-S02, AC-d3).
  const applied = await attachFiles(db, identity, { node, current, created: edit.created, tolerant }, applyOps(base, body.ops ?? [], { path: node.path, revision: node.revision, tolerant, wholeFile: file !== undefined, opsMax: opsMaxFor(edit.origin), places: edit.origin.kind === "agent" ? edit.origin.places : undefined }))
  const next: WorkBlock[] = placeBlocks(applied.blocks)
  const header = edit.created ? null : pendingHeader(body, node)
  const table = node.kind === "table" ? tableHeaderEdit(edit, draft, identity.org.prefix) : null
  // Sans brouillon lu au départ : le tampon du brouillon ouvert, relu.
  const reread = async (): Promise<string | null> => {
    const again = body.draft_stamp === undefined && (header || table) ? await loadDraft(db, node.id) : null
    // L'en-tête cible part de l'en-tête publié : un en-tête en attente relu ici vient d'un autre.
    if (table && again?.meta) throw headerSavedMeanwhile(node)
    return body.draft_stamp ?? again?.stamp ?? null
  }
  // L'ouverture part dans la transaction de l'écriture (M32, HN-E01S10-b2-3) : un refus qui suit ne laisse
  // aucun brouillon ouvert.
  const open = async (): Promise<string | null> => {
    const opened = await openDraft(db, node)
    if (opened.baseRevision !== node.revision) throw publishedMeanwhile(node.path, opened.baseRevision)
    return reread()
  }
  // Une création a ouvert son brouillon dans sa propre transaction, qui tient aussi cette écriture.
  const stamp = draft ? (body.draft_stamp ?? draft.stamp) : edit.created ? await reread() : null
  const saved = await saveDraft(db, {
    ...(draft || edit.created ? {} : { open }),
    node,
    orgId: identity.org.id,
    userId: identity.user.id,
    current,
    next,
    header,
    meta: table?.target,
    stamp,
    provenance: provenanceOf(identity, edit.origin),
    prefix: identity.org.prefix,
  })
  return { blocks: saved.blocks, stamp: saved.stamp, touched: applied.touched, header, headerChange: table?.text, keptAsText: applied.keptAsText }
}

/** L'en-tête en attente (`node_drafts`) : titre, résumé, genre (page ↔ procédure, N26). */
function pendingHeader(body: WriteNodeBody, node: NodeRow): { title?: string; summary?: string; kind?: string } | null {
  const kind = node.kind === "table" ? undefined : body.kind
  const header = {
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.summary === undefined ? {} : { summary: body.summary }),
    ...(kind === undefined ? {} : { kind }),
  }
  return Object.keys(header).length > 0 ? header : null
}

/**
 * Publie après l'écriture (ou seule) : le niveau écriture, déjà exigé, suffit (E11-S02, H63) ; un refus de
 * la publication garde le brouillon de l'écran (N28), jamais celui d'un assistant (E11-S18, AC-1).
 */
async function publishAfter(db: PlatformDb, identity: Identity, edit: Edit, saved: Saved | null): Promise<PublishResult> {
  const { node } = edit
  const draftStamp = saved ? (saved.stamp ?? undefined) : edit.body.draft_stamp
  // `confirm_remove` confirme l'effacement des colonnes retirées d'un tableau, jamais enregistré (E07-S04 AC8).
  return publishNode(db, identity, node, { baseRevision: node.revision, draftStamp, confirmRemove: edit.patch?.confirm_remove === true })
}

/**
 * Le brouillon écrit au besoin (`created` : déjà écrit, dans la transaction de la création), puis la
 * publication, sauf `publish: false` (E11-S02, AC-b1 ; le défaut se lit ici, HN-E11S02-21), hors de la
 * transaction de l'écriture : un refus de publier garde le brouillon de l'écran (AC29, N28) ; celui d'un assistant
 * annule toute l'écriture (`write-atomic.ts`, E11-S18, AC-1).
 */
async function finish(db: PlatformDb, identity: Identity, edit: Edit, created?: Saved): Promise<ToolOutput> {
  const { body, node } = edit
  const writes = (body.ops?.length ?? 0) > 0 || body.title !== undefined || body.summary !== undefined || body.kind !== undefined || changesHeader(edit.patch)
  const saved = created ?? (writes ? await saveEdits(db, identity, edit) : null)
  const published = body.publish !== false ? await publishAfter(db, identity, edit, saved) : null
  const owner = await ownerOf(db, node.id)
  const output = savedResult({ identity, edit, saved, published, teamId: teamOf(owner) })
  // E05-S10, AC-b12 : l'adresse a suivi le titre publié, pour l'écran comme pour un assistant (HN-E05S10e-5) ; le chemin
  // se choisit ensuite par `node.move` (E11-S18, AC-6).
  const renamed = published?.renamed
  if (!renamed) return output
  const choose = `To choose the path, call ${identity.org.prefix}_call node.move {"path": "${renamed.to}", "new_path": "<path>"}.`
  return {
    ...output,
    text: `${output.text}\n${renamedLine(renamed)} ${choose}`,
    data: { ...output.data, path: renamed.to, renamed_from: renamed.from },
    target: renamed.to,
  }
}

/**
 * Le `header` d'un tableau créé (E07-S04, AC2) : exigé, sans `ops`, lu puis fusionné sur un en-tête vide
 * et validé, avant toute lecture et toute écriture.
 */
function createdTable(body: WriteNodeBody, prefix: string): { patch: TableHeaderPatch; createdHeader: TableHeader } {
  const patch = readHeaderPatch(body, prefix, true)
  if (!patch) throw missingHeader(prefix)
  if ((body.ops?.length ?? 0) > 0) throw tableHasNoSections(body.path, prefix)
  return { patch, createdHeader: targetHeader({ base: null, patch, path: body.path, prefix }) }
}

async function create(db: PlatformDb, identity: Identity, body: WriteNodeBody, origin: WriteOrigin): Promise<ToolOutput> {
  const { path } = body
  const kind = body.kind ?? "page"
  if (kind !== "table" && body.header !== undefined) throw new PlatformError("invalid_arguments", `header applies only to tables; ${path} is a ${KIND_LABELS[kind]}.`)
  if (body.title === undefined || body.summary === undefined) {
    throw new PlatformError("invalid_arguments", `${path} does not exist: give title and summary (one line, 200 characters max) to create it.`)
  }
  checkOneLine(body)
  const table = kind === "table" ? createdTable(body, identity.org.prefix) : {}
  const parentAt = parentPath(path) ?? ROOT_PATH
  const parent = await findNode(db, identity, parentAt)
  // Un parent atteint par un ancien chemin (E03-S07) : le chemin demandé ne suivrait pas le sien.
  if (parent?.movedFrom) {
    const redirected = `${parent.node.path}${path.slice(parentAt.length)}`
    // E11-S18 (AC-6) : un contenu à ranger ailleurs se déplace par `node.move`, il ne se recrée pas.
    const move = `to move an existing page there, call ${identity.org.prefix}_call node.move`
    throw new PlatformError("invalid_arguments", `Cannot create ${path}: ${parentAt} moved to ${parent.node.path}. Create ${redirected} instead; ${move}.`)
  }
  if (!parent) {
    const closest = (await closestExisting(db, identity, path)).path
    throw new PlatformError(
      "not_found",
      `Cannot create ${path}: its parent ${parentAt} does not exist. Closest existing page: ${closest}. Create ${parentAt} first, or choose a path under ${closest}.`,
    )
  }
  if (parent.level < ACCESS_LEVELS.write) {
    throw new PlatformError("forbidden", reservedTo("write", `under ${parentAt}`, await whoToAsk(db, identity, await ownerOf(db, parent.node.id))))
  }
  // Rien n'est écrit tant que les opérations ne sont pas passées (AC22) : elles s'appliquent d'abord à vide.
  const planned = applyOps([], body.ops ?? [], { path, tolerant: tolerantFor(body, origin), wholeFile: uploadedFile(origin) !== undefined, opsMax: opsMaxFor(origin) })
  refuseFilesOnCreate(planned.blocks, { path, tolerant: tolerantFor(body, origin) })
  const spec = { path, parent: parent.node, kind, title: body.title, summary: body.summary }
  // Le nœud, son brouillon et son contenu dans une seule transaction (E01-S10, AC-x4) : une création arrêtée
  // au milieu ne laisse ni nœud ni brouillon. Un nœud neuf hérite du propriétaire et des règles de son
  // parent : même niveau (H52, H66).
  const made = await inTransaction(db, "nodes: create", async () => {
    const node = await insertNode(db, identity, spec)
    await openDraft(db, node)
    const created: Edit = { node, level: parent.level, created: true, body, origin, ...table }
    return { edit: created, saved: await saveEdits(db, identity, created) }
  })
  return finish(db, identity, made.edit, made.saved)
}

/** Le segment d'une création depuis le rail : `sans_titre`, `sans_titre_2`… (HN-E05S10b-3). */
const UNTITLED_PATTERN = new RegExp(`^${UNTITLED_SEGMENT}(_[1-9][0-9]*)?$`)

/** Une création « Sans titre » (titre et résumé donnés, aucune révision de base), à un chemin de ce segment. */
function untitledCreation(body: WriteNodeBody): boolean {
  return body.base_revision === undefined && body.title !== undefined && body.summary !== undefined && UNTITLED_PATTERN.test(lastSegment(body.path))
}

/**
 * Une création « Sans titre » qu'aucune modification ne peut servir (M68) : l'adresse est l'ancien chemin d'un
 * nœud (le rail ne voit pas les alias : `sans_titre` d'un nœud renommé par son titre), ou celle d'un nœud qui ne
 * peut pas prendre le genre demandé (`checkKinds`) ; elle va au premier chemin libre, comme sous un nœud invisible.
 */
function createsElsewhere(body: WriteNodeBody, found: { node: NodeRow; movedFrom?: string }): boolean {
  const table = (body.kind ?? "page") === "table"
  return found.movedFrom !== undefined || found.node.kind === "context" || (found.node.kind === "table") !== table
}

/**
 * `write` et la route `nodes` (AC19 à AC34) : `input` validé par `writeNodeBodySchema` (N40), les
 * droits décidés avant toute écriture, la provenance posée selon la porte (`origin`, AC28).
 */
export async function writeNode(db: PlatformDb, identity: Identity, input: unknown, origin: WriteOrigin): Promise<ToolOutput> {
  const body = parseBody(input)
  // Un assistant qui publie écrit tout ou rien (E11-S18, AC-1) ; l'écran et `publish: false` gardent leur brouillon.
  if (!writesAtomically(body, origin)) return writeParsed(db, identity, body, origin)
  const output = await writeAtomically(db, identity, body, () => writeParsed(db, identity, body, origin))
  return keepAuthorCtx(db, identity, origin, output)
}

/** `writeNode` après la lecture du corps, dans la transaction d'une écriture atomique ou non. */
async function writeParsed(db: PlatformDb, identity: Identity, body: WriteNodeBody, origin: WriteOrigin): Promise<ToolOutput> {
  checkPath(identity, body.path)
  // Un ancien chemin se cherche aussi avant une création (E03-S07 AC15) : celui d'un nœud invisible
  // est refusé comme un chemin pris (N31), sans insertion ; celui d'un nœud visible le modifie (AC7).
  const current = await lookupNode(db, identity, body.path)
  const moved = current ? null : await lookupAlias(db, identity, body.path)
  const found = current ?? moved
  if (!found) return create(db, identity, body, origin)
  const untitled = untitledCreation(body)
  if (found.level === ACCESS_LEVELS.none && !untitled) throw notAvailable(body.path)
  if (untitled && (found.level === ACCESS_LEVELS.none || createsElsewhere(body, found))) {
    // Une création « Sans titre » du rail dont l'adresse est prise par un nœud qu'elle ne voit pas (à la
    // corbeille, ou invisible), par un ancien chemin ou par un nœud d'un genre qu'elle ne peut pas lui donner
    // (M68) va au premier chemin libre, sans borne (E01-S12 partie c, HN-E01S12c-11) ; le résultat dit ce
    // chemin (`data.path`). Sur un nœud courant qui peut prendre ce genre, elle reste une modification sans
    // révision, refusée (`stale_revision`) : un assistant qui oublie `base_revision` ne crée pas de doublon.
    const parent = parentPath(body.path) ?? ROOT_PATH
    return create(db, identity, { ...body, path: await freePath(db, identity, { parent, segment: UNTITLED_SEGMENT }) }, origin)
  }
  const output = await edit(db, identity, { ...found, body, origin })
  if (!moved) return output
  return { ...output, text: `${movedNotice(moved.movedFrom, moved.node, moved.movedAt)}\n${output.text}`, data: { ...output.data, moved_from: moved.movedFrom } }
}

/** Une modification d'un nœud existant (AC21 à AC34), atteint par son chemin ou un ancien chemin. */
async function edit(
  db: PlatformDb,
  identity: Identity,
  found: { node: NodeRow; level: AccessLevel; body: WriteNodeBody; origin: WriteOrigin },
): Promise<ToolOutput> {
  const { node, level, body, origin } = found
  const kind = node.kind === "table" && body.kind === "table" ? undefined : body.kind
  const edits = { ...body, kind }
  // L'en-tête d'un tableau est lu avant tout (E07-S04, AC4, AC5) ; `confirm_remove` seul n'écrit rien.
  const patch = node.kind === "table" ? readHeaderPatch(edits, identity.org.prefix) : null
  const header = node.kind === "table" ? changesHeader(patch) : edits.header !== undefined
  const writes = (edits.ops?.length ?? 0) > 0 || edits.title !== undefined || edits.summary !== undefined || kind !== undefined || header
  // Sans rien à écrire, `write` publie le brouillon en attente, sauf `publish: false` (E11-S02, AC-b3).
  if (!writes && edits.publish === false) throw new PlatformError("invalid_arguments", "Nothing to write: give ops, title, summary or header.")
  checkKinds(edits, node, identity.org.prefix)
  checkOneLine(edits)
  if (level < ACCESS_LEVELS.write) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, writes ? "write" : "publish")
  if (edits.base_revision !== node.revision) throw await staleRevision(db, node, edits.base_revision, pageInOwnSpace(identity, node, edits))
  return finish(db, identity, { node, level, created: false, body: edits, origin, patch })
}
