// Partage public d'un contenu par lien (E05-S10 partie d, ADR-013) : un lien `/p/<jeton>` par nœud,
// créé, changé (« Inclure les sous-contenus ») ou désactivé par qui a l'accès complet au contenu (niveau 3,
// action `share`, décidé avant la requête) ; ni la structure de l'arbre ni un contenu de l'espace « Privé »
// d'une autre personne ne se partagent ; les liens actifs de l'organisation listés et désactivés par
// son administrateur (AC-d7) ; la lecture publique, hors session, par `public_node_by_token` sous `anon`
// (ADR-013 § 4), bornée au jeton, à l'organisation de l'adresse et à ce que l'auteur du lien lit. Le jeton :
// 32 octets tirés ici, jamais dérivés du nœud (ADR-013 § 1). Sans ce module, un contenu ne se partage pas
// hors de l'organisation.
import { randomBytes } from "node:crypto"
import {
  fileIdSchema,
  nodePathSchema,
  SHARE_TOKEN_PATTERN,
  shareNodeSchema,
  type OrgShareView,
  type PublicNodeView,
  type ShareView,
} from "../schemas"
import { ACCESS_LEVELS, isOrgAdmin, nodeLevels, requireNodeLevel, type Owner } from "./access"
import { createAnonPlatformDb, type PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { changedMeanwhile, inTransaction, invalidInput, isPlatformError, PlatformError } from "./errors"
import { resolveOrg, type Identity } from "./identity"
import { organisationLanguage } from "./language"
import { parseId, requireAdmin, type Mutation } from "./members"
import { findNode, unknownNode, type NodeRow } from "./nodes/lookup"
import { structureOf } from "./nodes/move"
import { ownerOf, teamOf } from "./nodes/view"
import type { Tx } from "./sql"

type ShareRow = { id: string; node_id: string; token: string; include_children: boolean; created_by: string | null; created_at: string }

/** Liens actifs listés au plus pour l'administrateur (la borne d'une lecture de la face SQL). */
const SHARES_LISTED = 1_000

/** Un jeton neuf : 32 octets aléatoires en base64url, 43 caractères (ADR-013 § 1). */
function newToken(): string {
  return randomBytes(32).toString("base64url")
}

/** Un contenu public introuvable : la même réponse pour un jeton inconnu, désactivé ou hors de portée (AC-d5). */
function publicNotFound(): PlatformError {
  return new PlatformError("not_found", "Not found.")
}

async function activeShare(sql: Tx, orgId: string, nodeId: string): Promise<ShareRow | null> {
  const [row] = await sql<ShareRow[]>`
    select id, node_id, token, include_children, created_by, to_json(created_at) #>> '{}' as created_at
      from platform.node_shares where org_id = ${orgId} and node_id = ${nodeId} and revoked_at is null`
  return row ?? null
}

/**
 * Le lien actif d'un nœud par son chemin, dans la transaction `sql` d'un service qui a déjà décidé l'accès complet
 * (`node.access`, `viewerLevel` 3 de `nodeRulesIn`) ; `null` sans lien. Sans jeton : la lecture ne le sert pas.
 */
export async function activeShareAt(sql: Tx, orgId: string, path: string): Promise<{ includeChildren: boolean; createdAt: string } | null> {
  const [row] = await sql<{ include_children: boolean; created_at: string }[]>`
    select s.include_children, to_json(s.created_at) #>> '{}' as created_at
      from platform.node_shares s join platform.nodes n on n.id = s.node_id
     where s.org_id = ${orgId} and n.org_id = ${orgId} and n.path = ${path} and n.deleted_at is null and s.revoked_at is null`
  return row ? { includeChildren: row.include_children, createdAt: row.created_at } : null
}

async function shareView(db: PlatformDb, identity: Identity, node: NodeRow, row: ShareRow): Promise<ShareView> {
  const author = row.created_by ? (await memberDirectory(db, identity.org.id)).find((entry) => entry.userId === row.created_by) : undefined
  return { id: row.id, path: node.path, token: row.token, includeChildren: row.include_children, createdAt: row.created_at, createdByName: author?.name ?? null }
}

/** Le nœud d'un lien, lu par `findNode`, dont la personne a l'accès complet (`share`) ; sinon le refus d'`access.ts`. */
async function managedNode(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow> {
  const found = await findNode(db, identity, path)
  if (!found) throw unknownNode(path, identity.org.prefix)
  if (found.level < ACCESS_LEVELS.manage) await requireNodeLevel(db, identity, { id: found.node.id, path: found.node.path }, "share")
  return found.node
}

/**
 * Ce qui ne se partage pas sur le web (HN-E05S10e-19), dit avant toute écriture : la structure de l'arbre
 * (la racine, `private`, un espace personnel, un Contexte, le dossier d'une équipe), dont les sous-contenus
 * couvrent des équipes ou des espaces entiers ; un contenu de l'espace « Privé » d'une autre personne,
 * que seul son propriétaire publie. Rend le propriétaire effectif du nœud, que la suite relit.
 */
async function refuseUnshareable(db: PlatformDb, identity: Identity, node: NodeRow): Promise<Owner | null> {
  const structure = await structureOf(db, identity, node)
  if (structure) {
    const reasons: Record<typeof structure.kind, string> = {
      root: "it is the root of the tree.",
      private: "it holds the personal spaces.",
      space: "it is a personal space; share the pages inside it instead.",
      context: "it is a Contexte; share the pages beside it instead.",
      team: "it is the folder of a team; share the pages inside it instead.",
    }
    throw new PlatformError("invalid_arguments", `${node.path} cannot be shared on the web: ${reasons[structure.kind]}`)
  }
  const owner = await ownerOf(db, node.id)
  if (owner?.kind === "user" && owner.userId !== identity.user.id) {
    throw new PlatformError("forbidden", `${node.path} is in the private space of another person: only its owner shares it on the web.`)
  }
  return owner
}

/** Le lien public actif d'un nœud (AC-d1), `null` sans lien ; réservé à qui a l'accès complet. */
export async function nodeShare(db: PlatformDb, identity: Identity, path: unknown): Promise<ShareView | null> {
  const parsed = nodePathSchema.safeParse(path)
  if (!parsed.success) throw invalidInput(parsed.error)
  const node = await managedNode(db, identity, parsed.data)
  const row = await inTransaction(db, "shares: node", (sql) => activeShare(sql, identity.org.id, node.id))
  return row ? shareView(db, identity, node, row) : null
}

/**
 * Crée le lien public d'un nœud, ou change son `include_children` (AC-d1) : l'accès complet exigé, puis
 * ce qui ne se partage pas refusé (`refuseUnshareable`), avant toute requête ; un lien actif par nœud
 * (index partiel) : une création concurrente relit celui qui a gagné. Rend le lien et s'il vient d'être
 * créé.
 */
export async function shareNode(db: PlatformDb, identity: Identity, input: unknown): Promise<Mutation<{ share: ShareView; created: boolean }>> {
  const parsed = shareNodeSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const node = await managedNode(db, identity, parsed.data.path)
  const teamId = teamOf(await refuseUnshareable(db, identity, node))
  const wanted = parsed.data.include_children
  const { row, created } = await inTransaction(db, "shares: save", async (sql) => {
    const current = await activeShare(sql, identity.org.id, node.id)
    if (current) {
      if (wanted === undefined || wanted === current.include_children) return { row: current, created: false }
      // Qui règle le lien en devient l'auteur : la lecture publique ne sert que ce qu'il lit (HN-E05S10e-20).
      const [updated] = await sql<{ id: string }[]>`
        update platform.node_shares set include_children = ${wanted}, created_by = ${identity.user.id}
         where id = ${current.id} and revoked_at is null returning id`
      if (!updated) throw changedMeanwhile("shareNode", current.id, `The link of ${node.path} changed meanwhile: reload it and try again.`)
      return { row: { ...current, include_children: wanted, created_by: identity.user.id }, created: false }
    }
    const [inserted] = await sql<{ id: string }[]>`
      insert into platform.node_shares (org_id, node_id, token, include_children, created_by)
      values (${identity.org.id}, ${node.id}, ${newToken()}, ${wanted ?? false}, ${identity.user.id})
      on conflict do nothing
      returning id`
    const saved = await activeShare(sql, identity.org.id, node.id)
    if (!saved) throw changedMeanwhile("shareNode", node.id, `The link of ${node.path} changed meanwhile: reload it and try again.`)
    return { row: saved, created: Boolean(inserted) }
  })
  return { data: { share: await shareView(db, identity, node, row), created }, target: node.path, teamId }
}

/**
 * Désactive un lien public (AC-d1, AC-d7) : l'administrateur de l'organisation pour tout lien ; sinon
 * l'accès complet au contenu. Un lien d'un contenu que la personne ne voit pas répond comme un lien
 * inconnu (H68). Un lien déjà désactivé : `conflict`.
 */
export async function revokeShare(db: PlatformDb, identity: Identity, shareId: unknown): Promise<Mutation<{ id: string; path: string }>> {
  const id = parseId(shareId, "link")
  const unknownShare = () => new PlatformError("not_found", `No public link ${id} in ${identity.org.name}.`)
  const [share] = await inTransaction(db, "shares: read", (sql) => sql<{ id: string; node_id: string; path: string }[]>`
    select s.id, s.node_id, n.path from platform.node_shares s join platform.nodes n on n.id = s.node_id
     where s.id = ${id} and s.org_id = ${identity.org.id} and s.revoked_at is null`)
  if (!share) throw unknownShare()
  if (!isOrgAdmin(identity)) {
    await requireNodeLevel(db, identity, { id: share.node_id, path: share.path }, "share").catch((refusal: unknown) => {
      throw isPlatformError(refusal) && refusal.code === "not_found" ? unknownShare() : refusal
    })
  }
  const revoked = await inTransaction(db, "shares: revoke", (sql) => sql`
    update platform.node_shares set revoked_at = now() where id = ${id} and org_id = ${identity.org.id} and revoked_at is null returning id`)
  if (revoked.length === 0) throw changedMeanwhile("revokeShare", id, "This link changed meanwhile: reload the list and try again.")
  return { data: { id, path: share.path }, target: share.path, teamId: teamOf(await ownerOf(db, share.node_id)) }
}

/**
 * Les liens publics actifs de l'organisation (AC-d7), pour son administrateur : contenu, auteur, date,
 * le plus récent d'abord ; jamais le jeton. Un contenu que l'administrateur ne lit pas (un espace privé,
 * D5) garde son espace (`private/<handle>`) et perd son titre (D44).
 */
export async function listShares(db: PlatformDb, identity: Identity): Promise<OrgShareView[]> {
  requireAdmin(identity, "list the public links")
  const rows = await inTransaction(db, "shares: list", (sql) => sql<(Omit<ShareRow, "token"> & { path: string; title: string })[]>`
    select s.id, s.node_id, s.include_children, s.created_by, to_json(s.created_at) #>> '{}' as created_at, n.path, n.title
      from platform.node_shares s join platform.nodes n on n.id = s.node_id
     where s.org_id = ${identity.org.id} and s.revoked_at is null and n.deleted_at is null
     order by s.created_at desc, s.id limit ${SHARES_LISTED}`)
  const [levels, directory] = await Promise.all([nodeLevels(db, identity, rows.map((row) => row.node_id)), memberDirectory(db, identity.org.id)])
  const names = new Map(directory.map((entry) => [entry.userId, entry.name]))
  return rows.map((row) => {
    const readable = (levels.get(row.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read
    const space = /^private\/[^/]+/.exec(row.path)?.[0] ?? "private"
    return {
      id: row.id,
      path: readable ? row.path : space,
      title: readable ? row.title : null,
      includeChildren: row.include_children,
      createdAt: row.created_at,
      createdByName: row.created_by ? (names.get(row.created_by) ?? null) : null,
    }
  })
}

type PublicRow = {
  root: PublicNodeView["root"]
  include_children: boolean
  node: Omit<PublicNodeView["node"], "updatedAt"> & { updated_at: string }
  blocks: PublicNodeView["blocks"]
  table: PublicNodeView["table"]
  children: PublicNodeView["children"]
  links: PublicNodeView["links"]
}

/** L'organisation de l'adresse d'une lecture publique ; une adresse qui n'en sert aucune : `not_found`, la même réponse. */
function publicOrg(db: PlatformDb, host: string | null) {
  return resolveOrg(db, host).catch((error: unknown) => {
    throw isPlatformError(error) && error.code === "unknown_org" ? publicNotFound() : error
  })
}

/**
 * Le contenu d'un lien public (ADR-013 § 3, § 4 ; AC-d2 à AC-d5), hors session : l'organisation de
 * l'adresse (`org_by_host`), puis `public_node_by_token` sous `anon`, bornée au jeton ; `path` : un
 * contenu dessous, que le lien couvre avec « Inclure les sous-contenus », par son chemin ou un ancien
 * chemin. Seul ce que l'auteur du lien lit à l'instant est servi (la fonction le décide, par le calcul
 * de la recherche, `node_level_of` pour l'auteur, le corps de `node_level_for`). Un jeton mal formé, inconnu, désactivé, d'une autre organisation,
 * un contenu à la corbeille, jamais publié, hors de portée ou que l'auteur ne lit plus : `not_found`, la
 * même réponse, sans dire lequel.
 */
export async function readPublicNode(host: string | null, token: string, path?: string | null): Promise<PublicNodeView> {
  if (!SHARE_TOKEN_PATTERN.test(token)) throw publicNotFound()
  const target = path === undefined || path === null ? null : nodePathSchema.safeParse(path)
  if (target && !target.success) throw publicNotFound()
  const db = createAnonPlatformDb()
  const org = await publicOrg(db, host)
  const [row] = await inTransaction(db, "public: read", (sql) => sql<{ view: PublicRow | null }[]>`
    select platform.public_node_by_token(${org.id}, ${token}, ${target?.data ?? null}) as view`)
  const view = row?.view
  if (!view) throw publicNotFound()
  const { updated_at: updatedAt, ...node } = view.node
  return {
    root: view.root,
    includeChildren: view.include_children,
    node: { ...node, updatedAt },
    blocks: view.blocks,
    table: view.table ?? null,
    children: view.children,
    links: view.links,
    // La langue de l'organisation de l'adresse, lue dans sa marque, sans requête (E11-S05, AC-d3).
    language: organisationLanguage(org),
  }
}

/** Un fichier joint servi par un lien public (E10-S02, AC-c5) : de quoi composer sa clé (`objectKey`) et le montrer. */
export type PublicFile = { orgId: string; id: string; name: string; mime: string; size: number; nodePath: string }

type PublicFileRow = { id: string; name: string; mime: string; size: number | string; node_path: string }

/**
 * Un fichier joint servi par un lien public (ADR-016 § 7, ADR-017 § 5 ; E10-S02, AC-c5), hors session :
 * l'organisation de l'adresse, puis `public_file_by_token` sous `anon`, bornée au jeton. Seul un fichier `ready`
 * cité par un bloc publié d'un nœud que le lien couvre et que son auteur lit à l'instant est servi (la fonction le
 * décide, sous la règle de `public_node_by_token`). Un jeton ou un identifiant mal formé, inconnu, désactivé, d'une
 * autre organisation, un fichier cité par un seul brouillon ou hors du périmètre : `not_found`, la même réponse.
 */
export async function readPublicFile(host: string | null, token: string, fileId: string): Promise<PublicFile> {
  if (!SHARE_TOKEN_PATTERN.test(token) || !fileIdSchema.safeParse(fileId).success) throw publicNotFound()
  const db = createAnonPlatformDb()
  const org = await publicOrg(db, host)
  const [row] = await inTransaction(db, "public: file", (sql) => sql<{ file: PublicFileRow | null }[]>`
    select platform.public_file_by_token(${org.id}, ${token}, ${fileId}) as file`)
  const file = row?.file
  if (!file) throw publicNotFound()
  return { orgId: org.id, id: file.id, name: file.name, mime: file.mime, size: Number(file.size), nodePath: file.node_path }
}
