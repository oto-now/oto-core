// La base des tests du MCP admin (`mcp-admin.ts`) sur une vraie base (E01-S10, lot t1-0) : les tables
// d'`adminTables()` (quatre organisations, leurs membres, les équipes d'acme, l'équipe plateforme et ses
// accès), et, sur demande, l'arbre d'acme d'`adminTree` (E08-S06), écrites par `writeTables`
// (`tests/helpers/reference-org-sql.ts`) sur la connexion d'administration, jetables et portables.
// Ce que rend la fonction : `AdminFixtureSql` ; `await deps(caller)` remplace `simulatedAdmin(caller).deps`
// pour `connectAdminMcp`, sous le client de l'appelant (`personDb`, `asCaller`).
//
// Écarts imposés par le schéma : sans l'arbre, `support/faq`, que la base simulée pose sans parent, a sa
// racine et le dossier de Support (lignes d'`adminTree`) ; avec l'arbre, Claire a le handle `claire`,
// sans lequel `private/claire` n'est l'espace de personne (`nodes_guard`). `is_staff()` est la vraie
// fonction : Sam et Théo sont l'équipe plateforme ; `isStaff: false` de la base simulée se joue avec une
// autre personne, ou en retirant la ligne de `platform_staff`. Les lignes d'`admin_journal` survivent à
// leur organisation (`on delete set null`) : `forgetJournal()` avant `seed.cleanup()`.
import type { AdminMcpDeps } from "../../packages/plateforme/mcp/admin/server"
import { ADMIN_ORIGIN, adminTables, adminTree, ORGS, PERSONS, type AdminPerson } from "./mcp-admin"
import { keysOf, mapRecord, personDb, simulatedIds, writeTables, type Directory, type SeededNamed } from "./reference-org-sql"
import type { Tables } from "./simulated-db"
import type { SeededData, SeededOrg } from "./sql"

type AdminOrg = keyof typeof ORGS

/** Les nœuds d'acme qu'écrit la fixture sans l'arbre : `support/faq` et ses parents. */
const WITHOUT_TREE: ReadonlySet<string> = new Set(["guide", "support", "support/faq"])

export type AdminFixtureSql = {
  persons: Record<AdminPerson, SeededNamed>
  /** acme « Acme Test », delta « Delta Test », demo « Démo », other « Other Test » : slug, préfixe et adresse jetables. */
  orgs: Record<AdminOrg, SeededOrg>
  /** L'identifiant réel d'un identifiant simulé semé (`TEAMS.ventes.id`, `NODES["ventes/tarifs"]`…) ; lève sinon. */
  id(simulated: string): string
  real<T>(value: T): T
  readable<T>(value: T): T
  /** Ce que `simulatedAdmin(caller).deps` rend, sous le client de l'appelant sur la base réelle (`personDb`). */
  deps(caller: AdminPerson): Promise<AdminMcpDeps>
  /** Écrit des lignes simulées de plus (règles, nœuds, comptes) : `writeTables`. */
  write(tables: Tables): Promise<void>
  /** Supprime les lignes d'`admin_journal` des personnes semées : à appeler avant `seed.cleanup()`. */
  forgetJournal(): Promise<void>
}

/** Les tables d'`adminTables()`, avec l'arbre d'acme (`tree`) ou `support/faq` et ses parents. */
function adminBase(tree: boolean): Tables {
  const tables = adminTables()
  // L'adresse de chaque organisation est celle, jetable, que `seed.createOrg` a posée.
  tables.org_domains = []
  const scratch: Tables = {}
  adminTree(scratch)
  if (!tree) return { ...tables, nodes: scratch.nodes.filter((row) => WITHOUT_TREE.has(String(row.path))) }
  adminTree(tables)
  const claire = tables.members.find((row) => row.user_id === PERSONS.claire.id)
  // `Object` rend l'objet `profile` de la ligne simulée (`{ name }`, `member` d'`adminTables`), typé `unknown` par `Row`.
  if (claire) claire.profile = { ...Object(claire.profile), handle: "claire" }
  return tables
}

/** La base des tests admin sur la base réelle ; `tree` : avec l'arbre d'acme d'`adminTree` (E08-S06). */
export async function seedAdminFixture(seed: SeededData, options: { tree?: boolean } = {}): Promise<AdminFixtureSql> {
  const ids = simulatedIds()
  // Rempli juste en dessous, une organisation par clé d'`ORGS`, chacune créée avant la suivante.
  const orgs = {} as Record<AdminOrg, SeededOrg>
  for (const key of keysOf(ORGS)) {
    orgs[key] = { ...(await seed.createOrg()), name: ORGS[key].name }
    ids.set(ORGS[key].id, orgs[key].id)
    ids.set(ORGS[key].host, orgs[key].host)
  }
  const persons = mapRecord(PERSONS, (person): SeededNamed => ({ ...seed.person(), name: person.name }))
  for (const person of keysOf(persons)) {
    ids.set(PERSONS[person].id, persons[person].id)
    ids.set(PERSONS[person].email, persons[person].email)
  }
  const directory: Directory = new Map(Object.values(persons).map((person) => [person.id, { email: person.email, name: person.name }]))
  const write = (tables: Tables) => writeTables(seed.admin, tables, ids, directory)
  await write(adminBase(options.tree ?? false))
  return {
    persons,
    orgs,
    id: ids.id,
    real: ids.real,
    readable: ids.readable,
    deps: async (caller) => ({
      db: await personDb(persons[caller]),
      caller: { userId: persons[caller].id, email: persons[caller].email },
      origin: ADMIN_ORIGIN,
      userAgent: "vitest",
      journal: [],
    }),
    write,
    async forgetJournal() {
      await seed.admin`delete from platform.admin_journal where user_id in ${seed.admin(Object.values(persons).map((person) => person.id))}`
    },
  }
}
