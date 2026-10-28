// @vitest-environment node
// Parité du calcul des niveaux en TypeScript et du SQL (E01-S07 AC30, HN-E01S07-13), sur une vraie base (H120 :
// la base est ici le sujet), en suite portable depuis la partie e1a d'E01-S10 (AC-x3, fiche D76 A : O et P
// de `seedReferenceOrg`, semées par la connexion d'administration ; chaque personne par `asCaller`, sans
// Supabase Auth). Le chemin de production des décisions — `nodeDecisions`, lecture des faits comprise, par
// la face SQL de la personne ; `nodeLevel` fait le même calcul sur la chaîne d'une seule cible
// (HN-E01S10-e1a-10) — égale `platform.node_level_for` sous la même session, pour chaque personne de O et
// chaque nœud, famille de règles par famille. Réduite aux nœuds par E01-S12 partie c : la recherche filtre
// encore les droits en SQL avant la coupe (E01-S13, `search_content`, `route_candidates`) ; le niveau d'un
// compte n'a plus de pendant en base, son calcul se prouve sans base.
// Aucun écart admis depuis E01-S08 (AC10, HN-E01S08-8) : sous la RLS d'isolation, les faits du service sont
// complets, et l'écart de HN-E01S07-4 (c), qui venait des ancêtres cachés par la RLS de niveau, a disparu.
// Les règles sont posées puis retirées par la connexion d'administration ; l'exactitude du calcul sur des
// faits complets est prouvée sans base (`tests/unit/access-levels.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeDecisions } from "../../packages/plateforme/server/access"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import type { Person, RuleSpec } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
// Huit familles, sept personnes en parallèle, deux transactions chacune (décisions des nœuds, niveaux de la
// base) : cible par cible, 64 transactions par personne et par famille sur le pool de cinq
// connexions du serveur prenaient 118 s sur le projet (2026-09-26), contre 17,2 s sous PostgREST (M02).
const PARITY_TIMEOUT = 120_000
const SUITE = "access parity"

const WHO = ["ada", "claire", "lea", "paul", "marc", "s", "t"] as const satisfies readonly Person[]
type Who = (typeof WHO)[number]

type Session = { db: PlatformDb; identity: Identity }
type Target = { id: string; name: string }

// Les familles de règles, en règles de O (`RuleSpec`).
const SCENARIOS: { name: string; rules: RuleSpec[] }[] = [
  { name: "no rule", rules: [] },
  {
    name: "closest rule",
    rules: [
      { node: "ventes", team: "support", level: "read" },
      { node: "ventes/devis", team: "support", level: "none" },
    ],
  },
  {
    name: "lead and person",
    rules: [
      { node: "ventes/devis", team: "ventes", level: "read" },
      { node: "ventes/devis", user: "claire", level: "read" },
    ],
  },
  // Règle de la racine (28/10) : comptée pour les contenus de l'organisation, ignorée sous une équipe, responsable compris.
  {
    name: "root",
    rules: [
      { node: "guide", team: "ventes", level: "read" },
      { node: "guide", team: "support", level: "none" },
      { node: "guide", user: "claire", level: "write" },
      { node: "guide", user: "lea", level: "none" },
      { node: "guide", org: true, level: "write" },
      { node: "annonces", org: true, level: "read" },
    ],
  },
  {
    name: "personal spaces",
    rules: [
      { node: "private", user: "ada", level: "manage" },
      { node: "private/claire", user: "lea", level: "read" },
    ],
  },
  {
    name: "hidden owner",
    rules: [
      { node: "private/claire/notes", user: "ada", level: "read" },
      { node: "ventes/zone/doc", team: "ventes", level: "read" },
    ],
  },
  {
    name: "residual gap",
    rules: [
      { node: "guide", user: "claire", level: "none" },
      { node: "ventes", team: "ventes", level: "write" },
    ],
  },
  // ADR-014 : la règle de toute l'organisation, au plus proche ; la personne puis ses équipes l'emportent
  // au même nœud ; elle ouvre sans rien retirer au propriétaire ; elle ne compte pas dans un espace personnel.
  {
    name: "organisation rules",
    rules: [
      { node: "guide", org: true, level: "write" },
      { node: "ventes", org: true, level: "read" },
      { node: "ventes/devis", org: true, level: "manage" },
      { node: "ventes/devis", team: "support", level: "read" },
      { node: "ventes/devis", user: "marc", level: "none" },
      { node: "ventes/zone", team: "ventes", level: "write" },
      { node: "ventes/zone/doc", org: true, level: "read" },
      { node: "private/claire", org: true, level: "write" },
      { node: "ventes/x/y", org: true, level: "write" },
    ],
  },
]

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let nodes: Target[] = []
  const sessions = new Map<Who, Session>()

  /**
   * Les niveaux que la base calcule pour chaque nœud, sous la session de la personne, en une transaction ;
   * 0 pour un nœud qu'elle ne lit pas (`sqlNodeLevel`).
   */
  async function sqlLevels(db: PlatformDb): Promise<Map<string, number>> {
    const rows = await db.tx((sql) => sql<{ id: string; level: number }[]>`
      select target.id,
             coalesce((select platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id)
                         from platform.nodes n where n.id = target.id), 0) as level
        from unnest(${nodes.map((node) => node.id)}::uuid[]) as target(id)`)
    return new Map(rows.map((row) => [row.id, row.level]))
  }

  /** Chaque cible de la personne : calcul et SQL, en parallèle ; rend les écarts, nommés. */
  async function gapsOf(scenario: string, who: Who): Promise<string[]> {
    const session = sessions.get(who)
    if (!session) throw new Error(`${who} has no session`)
    const { db, identity } = session
    const [decisions, sql] = await Promise.all([nodeDecisions(db, identity, nodes.map((node) => node.id)), sqlLevels(db)])
    const compared = nodes.map((target) => [target.name, decisions.get(target.id)?.level, sql.get(target.id)] as const)
    return compared.filter(([, ts, level]) => ts !== level).map(([name, ts, level]) => `${scenario}: ${who} ${name} ts=${ts} sql=${level}`)
  }


  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
    nodes = (await seed.admin<{ id: string; path: string }[]>`select id, path from platform.nodes where org_id = ${ref.org.id} order by path`).map(
      (row) => ({ id: row.id, name: row.path }),
    )
    for (const who of WHO) {
      const person = ref.people[who]
      const db = asCaller(person.id, person.email)
      sessions.set(who, { db, identity: await resolveIdentity(db, ref.org.host, { userId: person.id, email: person.email }) })
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  it(
    "should compute in TypeScript the levels the database computes, for every couple (AC30, E01-S08 AC10)",
    async () => {
      // Les cibles que les familles visent sont semées : une comparaison sans cible passerait à vide.
      expect(nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["guide", "private/claire/notes", "ventes/devis", "ventes/x/y", "ventes/zone/doc"]))
      const gaps: string[] = []
      for (const scenario of SCENARIOS) {
        const ids = await ref.addRules(scenario.rules)
        try {
          for (const personGaps of await Promise.all(WHO.map((who) => gapsOf(scenario.name, who)))) gaps.push(...personGaps)
        } finally {
          if (ids.length > 0) await seed.admin`delete from platform.access_rules where id in ${seed.admin(ids)}`
        }
      }
      expect(gaps).toEqual([])
    },
    PARITY_TIMEOUT,
  )
})
