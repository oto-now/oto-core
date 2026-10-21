// @vitest-environment node
// Candidats du routage par index, droits avant la coupe (E01-S13, partie a : AC-a1, AC-a2, AC-a4), en
// suites portables (`sqlConfigured` : le projet Supabase, ou le Postgres nu du job `bare-postgres`).
// E11-S04 (lot a) : formulations du résumé, mots rares, titre à part, correction par le lexique, corbeille
// exclue avant la coupe, et les attributs de `route_candidates`, `search_content` et `lexicon_fix`.
// La fonction d'avant est celle de la ligne de base d'E01-S09, gardée dans
// `fixtures/route-candidates-avant.sql` depuis que la ligne de base V1 l'a repliée (E01-S12 partie d) :
// recréée dans `pg_temp`, dans la transaction annulée où les deux versions sont appelées sous le même
// appelant (le rôle `authenticated` et ses claims, comme le pose `server/sql.ts`). Le plan de la
// présélection est hors de `pnpm test` (AC-a3 : `tests/sql/route-candidates-plan.sql`).
import fs from "fs"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SHOW_THRESHOLD, TEAM_BONUS, USAGE_BONUS, WEIGHTS } from "../../packages/plateforme/server/routing"
import type { ContentNode, Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { adminAsCaller } from "../helpers/admin-sql"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SeededData, type TestSql } from "../helpers/sql"
import { seedAcme } from "./fixtures/acme-sql"
import { TODO_PROCEDURES } from "./fixtures/todo-routing.cases"
import { PILOT_ROUTING_CASES } from "./pilot-routing.cases"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
// Une soixantaine de demandes, chacune rendue par les deux fonctions : quelques secondes mesurées.
const COMPARE_TIMEOUT = 120_000

const SIGNATURE = "platform.route_candidates(uuid, text, text, integer)"

const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

/** La fonction d'avant, recréée sous un autre nom dans `pg_temp` : elle n'existe que pour la connexion qui la crée. */
const BEFORE = fs.readFileSync(path.resolve(__dirname, "fixtures/route-candidates-avant.sql"), "utf8").replace(
  /platform\.route_candidates\(/i,
  "pg_temp.route_candidates_before(",
)

type Row = {
  node_id: string
  path: string
  title: string
  summary: string
  kind: string
  owner_team_id: string | null
  s_summary: number
  s_title: number
  lexical: number
  query_lexemes: number
  /** Depuis E11-S04 seulement : la fonction d'avant ne les rend pas. */
  s_phrase?: number
  lexical_title?: number
}

/**
 * Les lignes rendues par les deux versions sous `person`, pour chaque demande, au genre `procedure` et
 * aux 50 lignes que demande le service (`rankCandidates`).
 */
async function compare(seed: SeededData, ref: ReferenceOrgSql, person: Person, queries: readonly string[]) {
  return adminAsCaller(seed.admin, ref.people[person].id, [BEFORE], async (tx) => {
    const outcomes: { query: string; before: Row[]; after: Row[] }[] = []
    for (const query of queries) {
      const before = await tx<Row[]>`select * from pg_temp.route_candidates_before(${ref.org.id}, ${query}, 'procedure', 50)`
      const after = await tx<Row[]>`select * from platform.route_candidates(${ref.org.id}, ${query}, 'procedure', 50)`
      outcomes.push({ query, before: [...before], after: [...after] })
    }
    return outcomes
  })
}

/** Les seuils de `pg_trgm` que la fonction pose le temps de l'appel (`pg_proc.proconfig`). */
async function preselection(sql: TestSql): Promise<Record<string, number>> {
  const rows = await sql<{ name: string; value: string }[]>`
    select split_part(c, '=', 1) as name, split_part(c, '=', 2) as value
      from pg_catalog.pg_proc p, unnest(p.proconfig) c
     where p.oid = ${SIGNATURE}::regprocedure and c like 'pg_trgm.%'`
  return Object.fromEntries(rows.map((row) => [row.name, Number(row.value)]))
}

describe.skipIf(!ready)(
  ready ? "route_candidates by index, rights before the cut, portable" : `route_candidates by index, rights before the cut, portable (${skipReason})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    describe("no displayable candidate lost (AC-a1)", () => {
      // Deux procédures dont seul le titre, contenu dans une demande mal tapée, les présélectionne :
      // aucun lexème commun, et leur titre est trop court pour ressembler à toute la demande.
      const TITLE_ONLY: ContentNode[] = [
        { path: "conseil/facturation", kind: "procedure", title: "Facturation", summary: "Émet et envoie les pièces comptables du mois, après accord." },
        { path: "support/astreinte", kind: "procedure", title: "Astreinte", summary: "Prévient la personne de garde d'une panne qui touche plusieurs sites." },
      ]
      const TYPOS = [
        "relnace les devis en atente",
        "qualifei les prospcts a traiter",
        "escalde un incidnet",
        "facturatoin des clients",
        "astrainte ce soir",
        "prépare mon rendez vous clinet",
      ]
      const LONG = `Il faudrait ${"vraiment ".repeat(60)}relancer les devis en attente et qualifier les prospects de la file avant la fin du mois.`
      const QUERIES = [...new Set([...PILOT_ROUTING_CASES.map((routingCase) => routingCase.phrase), ...TYPOS, "les de la", LONG, ""])]
      let seed: SeededData
      let ref: ReferenceOrgSql
      let threshold: number

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedAcme(seed)
        await ref.addNodes(TITLE_ONLY)
        threshold = (await preselection(seed.admin))["pg_trgm.similarity_threshold"]
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      // E11-S04 (AC-a6) : les composantes et le tri de la coupe changent ; la comparaison porte sur les chemins.
      it(
        "should return each path of the former function that holds a lexeme or a resemblance at the preselection threshold (AC-a1 ; E11-S04 AC-a6)",
        async () => {
          const [procedures] = await seed.admin<{ count: number }[]>`
            select count(*)::int as count from platform.nodes where org_id = ${ref.org.id} and kind = 'procedure' and status = 'published'`
          expect(procedures.count).toBeLessThanOrEqual(50)
          const outcomes = await compare(seed, ref, "ada", QUERIES)
          let kept = 0
          let dropped = 0
          for (const { query, before, after } of outcomes) {
            // Ada, administratrice de O, lit toutes les procédures : l'ancienne les rend toutes.
            expect(before, JSON.stringify(query)).toHaveLength(procedures.count)
            const displayable = before.filter((row) => row.lexical > 0 || row.s_summary >= threshold || row.s_title >= threshold)
            const returned = new Set(after.map((row) => row.path))
            expect(after.every((row) => before.some((former) => former.path === row.path)), JSON.stringify(query)).toBe(true)
            expect(displayable.filter((row) => !returned.has(row.path)).map((row) => row.path), JSON.stringify(query)).toEqual([])
            kept += displayable.length
            dropped += before.length - after.length
          }
          // La comparaison porte : des lignes gardées, et des lignes que la présélection écarte.
          expect(kept).toBeGreaterThan(0)
          expect(dropped).toBeGreaterThan(0)
          // Le titre contenu dans la demande, que seul le parcours des titres présélectionne.
          const titled = (query: string) => outcomes.find((outcome) => outcome.query === query)?.after.map((row) => row.path) ?? []
          expect([titled("facturatoin des clients"), titled("astrainte ce soir")]).toEqual([
            expect.arrayContaining(["conseil/facturation"]),
            expect.arrayContaining(["support/astreinte"]),
          ])
        },
        COMPARE_TIMEOUT,
      )
    })

    describe("rights before the cut (AC-a2)", () => {
      // Soixante procédures de Support, que Léa (Ventes) ne lit pas, portent la demande mot pour mot ;
      // la procédure de Ventes n'en porte qu'une partie.
      const QUERY = "relancer les factures impayées"
      const UNREADABLE: ContentNode[] = Array.from({ length: 60 }, (_, index) => ({
        path: `support/relance_${String(index + 1).padStart(2, "0")}`,
        kind: "procedure",
        title: "Relancer les factures impayées",
        summary: "Relance les factures impayées des clients, après accord de la personne.",
      }))
      const READABLE: ContentNode = { path: "ventes/encaissements", kind: "procedure", title: "Suivre les encaissements", summary: "Liste les factures en retard de paiement du mois." }
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedReferenceOrg(seed, { nodes: [...UNREADABLE, READABLE] })
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      it("should return the readable procedure and no unreadable one, where the former function cut it behind fifty unreadable ones (AC-a2)", async () => {
        const [{ before, after }] = await compare(seed, ref, "lea", [QUERY])
        expect(after.map((row) => row.path)).toEqual([READABLE.path])
        expect({ rows: before.length, readable: before.some((row) => row.path === READABLE.path), support: before.every((row) => row.path.startsWith("support/")) }).toEqual({
          rows: 50,
          readable: false,
          support: true,
        })
      })

      it("should return no row to a person outside the organisation, the function reading the nodes past the policies (HN-E01S13-10)", async () => {
        // Membre de P seulement. `security definer` depuis E01-S13, la fonction contrôle elle-même
        // l'appartenance ; Léa, membre de O, reçoit pour la même demande, sans genre, ce qu'elle lit.
        const outsider = seed.person()
        await seed.addMember(ref.other.id, outsider)
        const paths = (userId: string) =>
          adminAsCaller(seed.admin, userId, [], async (tx) => (await tx<Row[]>`select * from platform.route_candidates(${ref.org.id}, ${QUERY}, null, 50)`).map((row) => row.path))
        const [lea, outside] = [await paths(ref.people.lea.id), await paths(outsider.id)]
        expect({ lea: lea.includes(READABLE.path), outsider: outside }).toEqual({ lea: true, outsider: [] })
      })
    })

    describe("preselection threshold (AC-a4)", () => {
      let admin: TestSql

      beforeAll(() => {
        admin = testAdminSql()
      })

      afterAll(async () => {
        await admin?.end({ timeout: 5 })
      })

      it("should hold both pg_trgm thresholds of route_candidates equal to the lowest text score the service shows without a lexeme, bonuses included (AC-a4)", async () => {
        // Sans lexème commun, le service montre un candidat si (part du texte + part de la formulation) × texte
        // + bonus d'équipe + bonus d'usage ≥ 0,30 (E11-S04, AC-b1) : une formulation du résumé ne ressemble pas
        // plus à la demande que le résumé qui la porte, et une formulation contenue dans la demande partage ses
        // lexèmes (HN-E11S04-10).
        const lowest = Math.floor(((SHOW_THRESHOLD - TEAM_BONUS - USAGE_BONUS) / (WEIGHTS.text + WEIGHTS.phrase)) * 100) / 100
        expect(await preselection(admin)).toEqual({ "pg_trgm.similarity_threshold": lowest, "pg_trgm.word_similarity_threshold": lowest })
      })
    })

    // E11-S04 (lot a) : le jeu « todo » dans Ventes, que Léa lit ; une procédure de Support, qu'elle ne lit
    // pas, porte les mots rares de la demande ; une procédure de Ventes à la corbeille porte « ma todo ».
    describe("formulations, rare words, title, typos and trash (E11-S04)", () => {
      const inVentes = (node: (typeof TODO_PROCEDURES)[number]): ContentNode => ({
        path: `ventes/${node.path.slice("todo/".length)}`,
        kind: "procedure",
        title: node.title,
        summary: node.summary,
      })
      const TODO = TODO_PROCEDURES.map(inVentes)
      const UNREADABLE: ContentNode = {
        path: "support/archiver_un_projet",
        kind: "procedure",
        title: "Archiver un projet",
        summary: "Archive un projet de la todo et ses tâches. Se demande : « crée une archive du projet ».",
      }
      const TRASHED: ContentNode = { path: "ventes/ancienne_todo", kind: "procedure", title: "Voir ma todo", summary: "Se demande : « ma todo »." }
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedReferenceOrg(seed, { nodes: [...TODO, UNREADABLE, TRASHED] })
        await seed.admin`update platform.nodes set deleted_at = now() where id = ${ref.nodeId(TRASHED.path)}`
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      /** Les lignes de la nouvelle fonction pour `query`, sous `person`, par chemin. */
      async function rows(person: Person, query: string): Promise<Record<string, Row>> {
        const found = await adminAsCaller(seed.admin, ref.people[person].id, [], (tx) => tx<Row[]>`select * from platform.route_candidates(${ref.org.id}, ${query}, 'procedure', 50)`)
        return Object.fromEntries(found.map((row) => [row.path, row]))
      }

      it("should score 1 on a formulation said in full or held by the request, and keep a summary that merely holds the request under 0.6 (AC-a2)", async () => {
        const todo = await rows("lea", "ma todo")
        expect(todo["ventes/voir_mes_taches"].s_phrase).toBeCloseTo(1, 5)
        expect(todo["ventes/ajouter_une_tache"].s_phrase).toBeLessThan(0.6)
        // Le résumé d'« Ajouter une tâche » porte « ma todo » : sa ressemblance au résumé garde son calcul.
        expect(todo["ventes/ajouter_une_tache"].s_summary).toBeCloseTo(1, 5)
        const note = await rows("lea", "note que je dois relancer la Boulangerie des Tilleuls demain")
        expect(note["ventes/ajouter_une_tache"].s_phrase).toBeCloseTo(1, 5)
      })

      it("should weigh a lexeme by its rarity among the readable candidates, a node holding every lexeme scoring 1, the title counted apart (AC-a3, AC-a4, AC-a7)", async () => {
        const created = await rows("lea", "crée le projet Alpha")
        // Quatre candidates lisibles portent « projet », deux « cre », aucune « alpha » : 1 + ln(4/2), 1, 1.
        const rare = 1 + Math.log(2)
        expect(created["ventes/creer_un_projet"].lexical).toBeCloseTo((rare + 1) / (rare + 2), 5)
        for (const path of ["ventes/mettre_a_jour_une_tache", "ventes/voir_mes_taches"]) expect(created[path].lexical).toBeCloseTo(1 / (rare + 2), 5)
        expect([created["ventes/creer_un_projet"].lexical_title, created["ventes/ajouter_une_tache"].lexical_title]).toEqual([expect.any(Number), 0])
        expect(created["ventes/creer_un_projet"].lexical_title).toBeGreaterThan(0)
        // Ada lit la procédure de Support, qui porte « cre » et « projet » : ses poids changent (5 candidates,
        // 3 portent « cre ») ; ceux de Léa ne la comptent pas.
        const all = await rows("ada", "crée le projet Alpha")
        expect(all[UNREADABLE.path]).toBeDefined()
        expect(all["ventes/creer_un_projet"].lexical).toBeCloseTo((2 + Math.log(5 / 3)) / (3 + Math.log(5 / 3)), 5)
        expect(created[UNREADABLE.path]).toBeUndefined()
        // Un mot que toutes portent : chacune porte tous les lexèmes et vaut 1.
        expect(Object.values(await rows("lea", "ma todo")).map((row) => row.lexical)).toEqual([1, 1, 1, 1])
      })

      it("should correct a typo by the lexicon, the corrected lexeme counted as held, and the word count unchanged (AC-a5)", async () => {
        const fix = (word: string) => seed.admin<{ fix: string | null }[]>`select platform.lexicon_fix(${ref.org.id}, ${word}) as fix`.then(([row]) => row.fix)
        // « tacje » a une correction ; « tache » est dans le lexique ; « tacj » a moins de cinq lettres.
        expect([await fix("tacje"), await fix("tache"), await fix("tacj")]).toEqual(["tache", null, null])
        const typed = await rows("lea", "créé une tâcje pour essayer")
        // « cre » (deux candidates sur quatre), « tacj » corrigé en « tache » (toutes), « essai » (aucune).
        const rare = 1 + Math.log(2)
        expect(typed["ventes/ajouter_une_tache"]).toMatchObject({ query_lexemes: 3 })
        expect(typed["ventes/ajouter_une_tache"].lexical).toBeCloseTo((rare + 1) / (rare + 2), 5)
      })

      it("should never preselect a node in the trash (M58)", async () => {
        expect(Object.keys(await rows("ada", "ma todo"))).not.toContain(TRASHED.path)
      })
    })

    // E11-S04 (AC-a1, AC-a7, AC-a8) : les attributs et les privilèges des trois fonctions.
    describe("attributes of the functions (E11-S04)", () => {
      let admin: TestSql

      beforeAll(() => {
        admin = testAdminSql()
      })

      afterAll(async () => {
        await admin?.end({ timeout: 5 })
      })

      it("should keep route_candidates and search_content security definer, stable, with an empty search_path, run by authenticated only, and lexicon_fix run by no client role", async () => {
        const read = (signature: string) => admin<{ definer: boolean; volatility: string; config: string[]; grantees: string[] }[]>`
          select p.prosecdef as definer, p.provolatile::text as volatility, p.proconfig as config,
                 array(select a.grantee::regrole::text from aclexplode(p.proacl) a
                        where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner order by 1) as grantees
            from pg_catalog.pg_proc p where p.oid = ${signature}::regprocedure`.then(([row]) => row)
        expect(await read(SIGNATURE)).toMatchObject({ definer: true, volatility: "s", grantees: ["authenticated"] })
        expect((await read(SIGNATURE)).config).toContain('search_path=""')
        expect(await read("platform.search_content(uuid, text, text[], integer)")).toEqual({
          definer: true,
          volatility: "s",
          config: ['search_path=""', "pg_trgm.similarity_threshold=0.3"],
          grantees: ["authenticated"],
        })
        expect(await read("platform.lexicon_fix(uuid, text)")).toEqual({
          definer: false,
          volatility: "s",
          config: ['search_path=""', "pg_trgm.similarity_threshold=0.3"],
          grantees: [],
        })
      })
    })
  },
)
