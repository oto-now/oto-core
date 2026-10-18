// L'organisation O des AC d'E01-S04 et d'E01-S07, en mémoire (E01-S07) : tables de la base simulée
// (`simulated-db.ts`), faits du calcul pur et identités, sans base. Mêmes personnes, équipes, nœuds
// et comptes que `buildReferenceOrg` (`plateforme.ts`) et les ajouts de la story E01-S07 ; des ids
// lisibles, qui nomment dans un échec ce qu'ils désignent. Les tables contiennent aussi P, une autre
// organisation de Léa : une ligne d'ailleurs revient dès qu'elle répond aux filtres.
// Les personnes viennent de `REFERENCE_PEOPLE` ; leurs noms, le nom d'O, les équipes et leurs
// responsables redisent `buildReferenceOrg` : doublon laissé jusqu'à M02, `plateforme.ts` n'étant pas
// un fichier d'ajout (HN-E01S07-20).
import {
  ACCESS_LEVELS,
  ACCOUNT_LEVELS,
  ancestorPaths,
  type AccountRuleFact,
  type NodeFact,
  type Owner,
  type RuleFact,
} from "../../packages/plateforme/server/access-levels"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { REFERENCE_PEOPLE } from "./plateforme"
import type { RpcHandler, Row, Tables } from "./simulated-db"

export const ORG = { id: "org-acme", slug: "acme", name: "Acme Test", prefix: "acme", host: "acme.test" } as const

/** Les personnes d'E01-S04, puis S et T (équipe plateforme). */
const PERSONS = [...REFERENCE_PEOPLE, "s", "t"] as const
export type Person = (typeof PERSONS)[number]

type PersonData = { id: string; email: string; name: string; role: "admin" | "member" | null; staff: boolean }

/** Ada admin ; S : équipe plateforme, accès en cours, non membre ; T : de même, et membre simple sans équipe (fiche D17). */
export const PEOPLE: Record<Person, PersonData> = {
  ada: { id: "user-ada", email: "ada.martin@acme.test", name: "Ada Martin", role: "admin", staff: false },
  claire: { id: "user-claire", email: "claire.morel@acme.test", name: "Claire Morel", role: "member", staff: false },
  lea: { id: "user-lea", email: "lea.roux@acme.test", name: "Léa Roux", role: "member", staff: false },
  paul: { id: "user-paul", email: "paul.girard@acme.test", name: "Paul Girard", role: "member", staff: false },
  marc: { id: "user-marc", email: "marc.petit@acme.test", name: "Marc Petit", role: "member", staff: false },
  s: { id: "user-s", email: "sam.staff@oto.test", name: "Sam Staff", role: null, staff: true },
  t: { id: "user-t", email: "theo.staff@oto.test", name: "Théo Staff", role: "member", staff: true },
}

const TEAM_KEYS = ["ventes", "support"] as const
type TeamKey = (typeof TEAM_KEYS)[number]

/** Ventes : responsable Claire, Léa membre ; Support : responsable Paul. Le responsable est membre, au rôle `lead` (E05-S13). */
export const TEAMS: Record<TeamKey, { id: string; slug: string; name: string; lead: Person; members: Person[] }> = {
  ventes: { id: "team-ventes", slug: "ventes", name: "Ventes", lead: "claire", members: ["claire", "lea"] },
  support: { id: "team-support", slug: "support", name: "Support", lead: "paul", members: ["paul"] },
}

const orgOwner: Owner = { kind: "org", teamId: null, userId: null }
const teamOwner = (key: TeamKey): Owner => ({ kind: "team", teamId: TEAMS[key].id, userId: null })
const userOwner = (person: Person): Owner => ({ kind: "user", teamId: null, userId: PEOPLE[person].id })

/** Les nœuds de O et leur propriétaire explicite (absent : hérité, H52). */
const NODES: [string, Owner?][] = [
  ["guide", orgOwner],
  ["private"],
  ["contexte"],
  ["annonces"],
  ["ventes", teamOwner("ventes")],
  ["ventes/contexte"],
  ["ventes/devis"],
  ["ventes/devis/modele"],
  ["ventes/tarifs", teamOwner("ventes")],
  ["ventes/zone", teamOwner("support")],
  ["ventes/zone/doc"],
  ["ventes/x", userOwner("lea")],
  ["ventes/x/y"],
  ["support", teamOwner("support")],
  ["support/contexte"],
  ["support/faq"],
  ...PERSONS.filter((person) => PEOPLE[person].role).map((person): [string, Owner] => [`private/${person}`, userOwner(person)]),
  ["private/claire/notes"],
]

export const nodeId = (path: string): string => `node:${path}`

const ACCOUNT_KEYS = ["org", "ventes", "claire"] as const
export type AccountKey = (typeof ACCOUNT_KEYS)[number]

export const ACCOUNTS: Record<AccountKey, { id: string; label: string; owner: Owner }> = {
  org: { id: "account:mail-org", label: "Mail Org", owner: orgOwner },
  ventes: { id: "account:mail-ventes", label: "Mail Ventes", owner: teamOwner("ventes") },
  claire: { id: "account:mail-claire", label: "Mail Claire", owner: userOwner("claire") },
}

/**
 * P : une autre organisation, dont Léa est aussi membre (HN-E01S07-17). Ses chemins répètent ceux de O
 * (`guide`, `ventes`) : une lecture des faits qui oublierait l'organisation prendrait ses nœuds pour
 * les ancêtres de ceux de O. Des règles y donnent la gestion à Léa : sans la garde de l'organisation,
 * elle l'aurait depuis l'adresse de O. Toute base simulée de O la contient.
 */
export const OTHER_ORG = {
  id: "org-other",
  host: "other.test",
  root: "other:node:guide",
  node: { id: "other:node:ventes", path: "ventes" },
  account: { id: "other:account:mail", label: "Mail Other" },
  /** Une invitation de P, ouverte, adressée à Léa (E01-S07 AC17, AC18). */
  invitation: "5f9cab8d-6b7e-4fbc-8d3e-cfbaa9b8c7d7",
} as const

/** Les lignes de P, neuves à chaque appel : un test peut retoucher ses tables. */
function otherOrgRows(): Tables {
  const P = OTHER_ORG
  const toLea = { subject_team_id: null, subject_user_id: PEOPLE.lea.id, level: "manage" }
  return {
    orgs: [{ id: P.id, slug: "other", name: "Other Test", prefix: "other", host: P.host, brand: {}, settings: {}, flags: {} }],
    members: [{ org_id: P.id, user_id: PEOPLE.lea.id, role: "member", profile: { name: PEOPLE.lea.name, handle: "lea" } }],
    nodes: [
      { id: P.root, org_id: P.id, path: "guide", ...ownerColumns(orgOwner) },
      { id: P.node.id, org_id: P.id, path: P.node.path, ...ownerColumns(undefined) },
    ],
    accounts: [{ id: P.account.id, org_id: P.id, connector: "mail", label: P.account.label, ...ownerColumns(orgOwner) }],
    access_rules: [
      { id: "rule:other:ventes:lea", org_id: P.id, node_id: P.node.id, account_id: null, ...toLea },
      { id: "rule:other:mail:lea", org_id: P.id, node_id: null, account_id: P.account.id, ...toLea },
    ],
    invitations: [
      {
        id: P.invitation,
        org_id: P.id,
        email: PEOPLE.lea.email,
        role: "member",
        team_id: null,
        invited_by: null,
        created_at: "2026-09-24T09:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        accepted_at: null,
        declined_at: null,
        revoked_at: null,
      },
    ],
  }
}

/** Une règle (H82) : sur un nœud (par chemin) ou un compte, pour une équipe, une personne ou toute l'organisation (ADR-014). */
export type RuleSpec = {
  node?: string
  account?: AccountKey
  team?: TeamKey
  user?: Person
  org?: true
  /** `sensitive` ne vaut que sur un compte (`access_rules_level_check`). */
  level: keyof typeof ACCOUNT_LEVELS
}

const targetOf = (spec: RuleSpec): string => (spec.node !== undefined ? nodeId(spec.node) : ACCOUNTS[spec.account ?? "org"].id)

const subjectOf = (spec: RuleSpec) => ({
  targetId: targetOf(spec),
  teamId: spec.team ? TEAMS[spec.team].id : null,
  userId: spec.user ? PEOPLE[spec.user].id : null,
  org: spec.org === true,
})

/** La règle d'un nœud en fait du calcul pur ; `sensitive` n'existe pas sur un nœud. */
export function ruleFact(spec: RuleSpec): RuleFact {
  if (spec.level === "sensitive") throw new Error("a node rule has no sensitive level")
  return { ...subjectOf(spec), level: ACCESS_LEVELS[spec.level] }
}

/** La règle d'un compte en fait du calcul pur, sur l'échelle des comptes (`ACCOUNT_LEVELS`). */
export function accountRuleFact(spec: RuleSpec): AccountRuleFact {
  return { ...subjectOf(spec), level: ACCOUNT_LEVELS[spec.level] }
}

/** La règle en ligne d'`access_rules`. */
function ruleRow(spec: RuleSpec): Row {
  return {
    id: `rule:${targetOf(spec)}:${spec.team ?? spec.user ?? "org"}`,
    org_id: ORG.id,
    node_id: spec.node !== undefined ? nodeId(spec.node) : null,
    account_id: spec.node === undefined ? targetOf(spec) : null,
    subject_team_id: spec.team ? TEAMS[spec.team].id : null,
    subject_user_id: spec.user ? PEOPLE[spec.user].id : null,
    subject_org: spec.org === true,
    level: spec.level,
  }
}

/** Les nœuds de O en faits du calcul pur. */
export function nodeFacts(): NodeFact[] {
  return NODES.map(([path, owner]) => ({ id: nodeId(path), orgId: ORG.id, path, owner: owner ?? null }))
}

function ownerColumns(owner: Owner | undefined): Row {
  return { owner_kind: owner?.kind ?? null, owner_team_id: owner?.teamId ?? null, owner_user_id: owner?.userId ?? null }
}

/** Les tables de O, sans règle d'accès ; `rules` s'y ajoutent ; les lignes de P suivent celles de O. */
export function referenceTables(rules: RuleSpec[] = []): Tables {
  const other = otherOrgRows()
  const tables: Tables = {
    orgs: [{ id: ORG.id, slug: ORG.slug, name: ORG.name, prefix: ORG.prefix, host: ORG.host, brand: {}, settings: {}, flags: {} }],
    members: PERSONS.filter((person) => PEOPLE[person].role).map((person) => ({
      org_id: ORG.id,
      user_id: PEOPLE[person].id,
      role: PEOPLE[person].role,
      profile: { name: PEOPLE[person].name, handle: person },
    })),
    teams: TEAM_KEYS.map((key) => ({ id: TEAMS[key].id, org_id: ORG.id, slug: TEAMS[key].slug, name: TEAMS[key].name })),
    team_members: TEAM_KEYS.flatMap((key) =>
      TEAMS[key].members.map((person) => ({ team_id: TEAMS[key].id, user_id: PEOPLE[person].id, role: TEAMS[key].lead === person ? "lead" : "member" })),
    ),
    platform_staff: PERSONS.filter((person) => PEOPLE[person].staff).map((person) => ({ user_id: PEOPLE[person].id })),
    platform_grants: PERSONS.filter((person) => PEOPLE[person].staff).map((person) => ({
      id: `grant:${person}`,
      org_id: ORG.id,
      user_id: PEOPLE[person].id,
      revoked_at: null,
    })),
    nodes: NODES.map(([path, owner]) => ({ id: nodeId(path), org_id: ORG.id, path, ...ownerColumns(owner) })),
    accounts: ACCOUNT_KEYS.map((key) => ({
      id: ACCOUNTS[key].id,
      org_id: ORG.id,
      connector: "mail",
      label: ACCOUNTS[key].label,
      ...ownerColumns(ACCOUNTS[key].owner),
    })),
    access_rules: rules.map(ruleRow),
  }
  for (const [table, rows] of Object.entries(other)) tables[table] = [...(tables[table] ?? []), ...rows]
  return tables
}

function personById(userId: unknown): PersonData | undefined {
  return Object.values(PEOPLE).find((person) => person.id === userId)
}

/** `org_by_host` et `member_directory` sur les tables de la base simulée. */
export function referenceRpc(): Record<string, RpcHandler> {
  return {
    org_by_host: (args, tables) =>
      (tables.orgs ?? [])
        .filter((org) => org.host === args.p_host)
        .map((org) => ({ id: org.id, slug: org.slug, name: org.name, prefix: org.prefix, brand: org.brand, domains: null })),
    member_directory: (args, tables) =>
      (tables.members ?? [])
        .filter((member) => member.org_id === args.p_org)
        .map((member) => ({
          user_id: member.user_id,
          email: personById(member.user_id)?.email ?? null,
          name: personById(member.user_id)?.name ?? String(member.user_id),
          role: member.role,
          default_team_id: null,
          last_sign_in_at: null,
        })),
    // Propriétaire effectif (H52, E01-S07c) : le nœud, ou son ancêtre le plus proche, qui en porte un.
    node_owner: (args, tables) => {
      const nodes = tables.nodes ?? []
      const node = nodes.find((row) => row.id === args.p_node)
      if (!node) return []
      const path = String(node.path)
      const holder = [path, ...ancestorPaths(path).reverse()]
        .map((candidate) => nodes.find((row) => row.org_id === node.org_id && row.path === candidate && row.owner_kind !== null))
        .find((row) => row !== undefined)
      if (!holder) return []
      return [{ owner_kind: holder.owner_kind, owner_team_id: holder.owner_team_id, owner_user_id: holder.owner_user_id, owner_node_id: holder.id }]
    },
  }
}

/** L'équipe telle que l'identité de `person` la porte. */
export function teamOf(key: TeamKey, person: Person): IdentityTeam {
  const team = TEAMS[key]
  return { id: team.id, slug: team.slug, name: team.name, role: team.lead === person ? "lead" : "member" }
}

/**
 * Les équipes et les comptes de O sous des UUID, pour les services dont le schéma en exige un
 * (`teamId` d'`inviteSchema`, `team_id` et `account_id` des comptes) : `withUuids` remplace chaque id
 * lisible partout où il apparaît, tables et identités comprises (E01-S07 partie B).
 */
export const UUIDS: Record<string, string> = {
  [TEAMS.ventes.id]: "0a4f5d3e-1c2b-4a6d-9e8f-7a6b5c4d3e2f",
  [TEAMS.support.id]: "1b5e6c4f-2d3a-4b7e-8f9a-8b7c6d5e4f3a",
  [ACCOUNTS.org.id]: "2c6f7d5a-3e4b-4c8f-9a0b-9c8d7e6f5a4b",
  [ACCOUNTS.ventes.id]: "3d7a8e6b-4f5c-4d9a-8b1c-ad9e8f7a6b5c",
  [ACCOUNTS.claire.id]: "4e8b9f7c-5a6d-4eab-9c2d-bea9f8a7b6c6",
}

/** `value` (tables, identité) où chaque id de `UUIDS` devient son UUID : même forme, ids d'équipe et de compte changés. */
export function withUuids<T>(value: T): T {
  const text = Object.entries(UUIDS).reduce((json, [id, uuid]) => json.replaceAll(`"${id}"`, `"${uuid}"`), JSON.stringify(value))
  return JSON.parse(text)
}

/** L'identité que `resolveIdentity` rend à la personne dans O ; `overrides` la change (accès révoqué, équipe de plus). */
export function identityOf(person: Person, overrides: Partial<Identity> = {}): Identity {
  const data = PEOPLE[person]
  const member = data.role !== null
  return {
    org: { id: ORG.id, slug: ORG.slug, name: ORG.name, prefix: ORG.prefix, brand: {}, domains: null },
    user: { id: data.id, email: data.email, name: data.name },
    member: {
      role: data.role ?? "admin",
      profile: member ? { name: data.name, handle: person } : {},
    },
    teams: TEAM_KEYS.filter((key) => TEAMS[key].members.includes(person)).map((key) => teamOf(key, person)),
    isStaff: data.staff,
    viaGrant: data.staff && !member,
    hasOpenGrant: data.staff,
    ...overrides,
  }
}

// ------------------------------------------------------------------------ Contenu (E03-S03)
// Les pages de O en mémoire, pour les services de `nodes/` sur la base simulée : colonnes de `nodes`
// que ces services lisent, blocs publiés ou `draft`, brouillon ouvert, révisions ; `open_draft` et
// `publish_node` simulés comme la base les exécute (E01-S06), `node_owner` par `referenceRpc`, sans
// règle d'accès : un service qui filtre ou refuse le prouve lui-même.

/** Horodatage des lignes semées ; un test qui compare des dates les lit ici. */
export const CONTENT_AT = "2026-09-20T08:00:00.000000+00:00"

/** Un uuid lisible, distinct par ses 8 premiers caractères : la référence courte d'un bloc (`blockRef`). */
export function blockUuid(rank: number, tail = 0): string {
  return `${rank.toString(16).padStart(8, "0")}-0000-4000-8000-${tail.toString(16).padStart(12, "0")}`
}

export type ContentNode = {
  path: string
  kind?: "page" | "procedure" | "context" | "table"
  title?: string
  summary?: string
  status?: "draft" | "published"
  revision?: number
  owner?: Owner
}

/** Un chemin de Contexte de O (P39) : `contexte` et `<dossier>/contexte`. */
const isContextPath = (path: string) => path === "contexte" || path.endsWith("/contexte")

/**
 * Les tables de O complétées pour `nodes/` : chaque nœud reçoit parent (par chemin), genre, titre,
 * résumé, statut (publié, révision 1), dates ; `nodes` s'y ajoutent ou y précisent un nœud existant.
 */
export function contentTables(rules: RuleSpec[] = [], nodes: ContentNode[] = []): Tables {
  const tables = referenceTables(rules)
  for (const spec of nodes) {
    if (!tables.nodes.some((row) => row.id === nodeId(spec.path))) tables.nodes.push({ id: nodeId(spec.path), org_id: ORG.id, path: spec.path, ...ownerColumns(spec.owner) })
  }
  for (const row of tables.nodes) {
    const path = String(row.path)
    const spec = nodes.find((node) => node.path === path)
    const parentPath = path === "guide" ? null : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "guide"
    const parent = tables.nodes.find((candidate) => candidate.org_id === row.org_id && candidate.path === parentPath)
    Object.assign(row, {
      parent_id: parent?.id ?? null,
      kind: spec?.kind ?? (isContextPath(path) ? "context" : "page"),
      title: spec?.title ?? path,
      summary: spec?.summary ?? `Summary of ${path}.`,
      status: spec?.status ?? "published",
      revision: spec?.revision ?? 1,
      meta: {},
      created_by: null,
      updated_by: null,
      created_at: CONTENT_AT,
      updated_at: CONTENT_AT,
    })
  }
  Object.assign(tables, { blocks: [], node_drafts: [], node_versions: [], links: [] })
  return tables
}

/** Un bloc semé : la forme de `blockInputSchema`, son id et sa révision au besoin. */
export type SeedBlock = BlockInput & { id?: string; revision?: number }

let seededBlocks = 0

/** Des lignes de `blocks` à l'état donné, positions 1 024 × rang ; rend leurs ids, dans l'ordre. */
export function addBlocks(tables: Tables, path: string, state: "published" | "draft", blocks: SeedBlock[]): string[] {
  return blocks.map((block, index) => {
    const id = block.id ?? blockUuid(0x10000 + ++seededBlocks)
    tables.blocks.push({
      id,
      state,
      org_id: ORG.id,
      node_id: nodeId(path),
      position: 1024 * (index + 1),
      type: block.type,
      text: block.text ?? null,
      data: block.data ?? {},
      key: block.key ?? null,
      provenance: {},
      revision: block.revision ?? 1,
      created_by: null,
      updated_by: null,
      created_at: CONTENT_AT,
      updated_at: CONTENT_AT,
    })
    return id
  })
}

/** Le brouillon ouvert d'un nœud (`node_drafts`), sur sa révision, avec son en-tête en attente. */
export function openDraftRow(tables: Tables, path: string, header: { title?: string; summary?: string; kind?: string } = {}): void {
  const node = tables.nodes.find((row) => row.id === nodeId(path))
  tables.node_drafts.push({
    node_id: nodeId(path),
    base_revision: node?.revision ?? 0,
    title: header.title ?? null,
    summary: header.summary ?? null,
    kind: header.kind ?? null,
    meta: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  })
}

/** Une révision publiée dans `node_versions`, avec l'instantané de ses blocs (forme de `publish_node`). */
export function addVersion(tables: Tables, path: string, version: { revision: number; title: string; summary: string; kind?: string; blocks: Row[] }): void {
  tables.node_versions.push({ node_id: nodeId(path), revision: version.revision, title: version.title, summary: version.summary, kind: version.kind ?? "page", meta: {}, blocks: version.blocks, author: null, created_at: CONTENT_AT })
}

let insertedRows = 0

/** Les valeurs que la base pose à l'insertion d'un bloc ou d'un nœud (option `defaults` de `simulatedDb`). */
export function contentDefaults(table: string, row: Row): Row {
  insertedRows++
  if (table === "blocks") return { id: blockUuid(0x20000 + insertedRows), revision: 1, created_at: CONTENT_AT, updated_at: CONTENT_AT, ...row }
  if (table === "nodes") {
    return { id: nodeId(String(row.path)), status: "draft", revision: 0, meta: {}, owner_kind: null, owner_team_id: null, owner_user_id: null, created_at: CONTENT_AT, updated_at: CONTENT_AT, ...row }
  }
  return row
}

function sameNode(nodeIdValue: unknown) {
  return (row: Row) => row.node_id === nodeIdValue
}

/**
 * `open_draft` et `publish_node` sur les tables de la base simulée, comme la base les exécute
 * (E01-S06), à joindre à `referenceRpc` (`node_owner`) ; leurs refus se jouent par l'option `fail` de
 * `simulatedDb`.
 */
export function contentRpc(): Record<string, RpcHandler> {
  return {
    open_draft: (args, tables) => {
      const node = tables.nodes.find((row) => row.id === args.p_node)
      const open = tables.node_drafts.find(sameNode(args.p_node))
      if (open) return [{ base_revision: open.base_revision, created: false }]
      tables.node_drafts.push({ node_id: args.p_node, base_revision: node?.revision ?? 0, title: null, summary: null, kind: null, meta: null, created_by: null, updated_by: null, created_at: CONTENT_AT, updated_at: CONTENT_AT })
      const published = tables.blocks.filter((row) => row.node_id === args.p_node && row.state === "published")
      if (node?.kind !== "table") tables.blocks.push(...published.map((row) => ({ ...structuredClone(row), state: "draft" })))
      return [{ base_revision: node?.revision ?? 0, created: true }]
    },
    publish_node: (args, tables) => {
      const node = tables.nodes.find((row) => row.id === args.p_node)
      const draft = tables.node_drafts.find(sameNode(args.p_node))
      if (!node || !draft) return null
      const drafted = tables.blocks.filter((row) => row.node_id === node.id && row.state === "draft")
      tables.blocks = [...tables.blocks.filter((row) => row.node_id !== node.id), ...drafted.map((row) => ({ ...row, state: "published" }))]
      Object.assign(node, {
        title: draft.title ?? node.title,
        summary: draft.summary ?? node.summary,
        kind: draft.kind ?? node.kind,
        status: "published",
        revision: Number(node.revision) + 1,
      })
      const snapshot = [...drafted].sort((a, b) => Number(a.position) - Number(b.position))
      addVersion(tables, String(node.path), { revision: Number(node.revision), title: String(node.title), summary: String(node.summary), kind: String(node.kind), blocks: snapshot })
      if (Array.isArray(args.p_links)) {
        tables.links = [...tables.links.filter((row) => row.source_node_id !== node.id), ...args.p_links.map((link: Row) => ({ source_node_id: node.id, source_block_id: link.block_id, target_path: link.path, target_key: link.key ?? null }))]
      }
      tables.node_drafts = tables.node_drafts.filter((row) => row.node_id !== node.id)
      return node.revision
    },
  }
}

// Anciens chemins (E03-S07) : les lignes de `node_aliases` que le déclencheur `nodes_aliases_on_move`
// (E01-S06) écrit au déplacement d'un nœud.

/** Date des alias semés par `aliasRow` : celle que sert la ligne « moved to ». */
export const ALIASED_AT = "2026-09-24T10:00:00.000000+00:00"

/** Une ligne de `node_aliases` : `oldPath` est un ancien chemin du nœud aujourd'hui à `path`, déplacé par `by`. */
export function aliasRow(oldPath: string, path: string, by: Person = "claire"): Row {
  return { org_id: ORG.id, old_path: oldPath, node_id: nodeId(path), created_by: PEOPLE[by].id, created_at: ALIASED_AT }
}
