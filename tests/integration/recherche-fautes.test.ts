// @vitest-environment node
// Fautes de frappe dans le contenu (E01-S13, partie b : AC-b1 à AC-b8), mots d'une personne oubliée
// (fiche D19 A), et extrait d'un bloc jusqu'à sa fin (AC-b10, fiche D43 B), en suites portables
// (`sqlConfigured` : le projet Supabase, ou le Postgres nu du job `bare-postgres`). Acme sur O (`seedAcme`), plus des pages dont un mot n'est que
// dans un bloc, et un bloc de P, l'autre organisation de Léa. `search_content` est appelée sous la
// personne (`ref.db`, face SQL du paquet) ; la fonction d'avant, celle de la ligne de base d'E01-S09 gardée
// dans `fixtures/search-content-avant.sql` depuis que la ligne de base V1 l'a repliée (E01-S12 partie d),
// recréée dans `pg_temp`, l'est sous le même appelant, dans la transaction annulée où les deux versions se
// comparent (`adminAsCaller`).
import fs from "fs"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { withAnonSession } from "../../packages/plateforme/server/sql"
import { NEVER_EXPORTED, TABLES } from "../../scripts/lib/org-transfer.mjs"
import { blockUuid, OTHER_ORG, type ContentNode, type Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { adminAsCaller } from "../helpers/admin-sql"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"
import { seedAcme } from "./fixtures/acme-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const ROLLBACK = new Error("rollback")

const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

/** La fonction d'avant, recréée sous un autre nom dans `pg_temp` : elle n'existe que pour la connexion qui la crée. */
const BEFORE = fs.readFileSync(path.resolve(__dirname, "fixtures/search-content-avant.sql"), "utf8").replace(
  /platform\.search_content\(/i,
  "pg_temp.search_content_before(",
)

/** Le mot « facture » n'est que dans le paragraphe : ni le titre ni le résumé ne le portent (AC-b1). */
const RAPPELS: ContentNode = { path: "ventes/rappels", title: "Rappels aux clients", summary: "Les rappels envoyés chaque semaine." }
const RAPPEL_TEXT = "Chaque facture en retard reçoit un rappel."
/** « prose », plus proche de « prosp » que tout mot qui commence par lui (AC-b3). */
const COURRIERS: ContentNode = { path: "ventes/courriers", title: "Courriers", summary: "Modèles de lettres." }
/**
 * « zanzibor », seul mot de O proche de « zanzibra » ; P, l'autre organisation de Léa, porte
 * « zanzibar », aussi proche, et premier dans l'ordre alphabétique (AC-b5).
 */
const DEPOT: ContentNode = { path: "ventes/depot", title: "Dépôt", summary: "Le dépôt de la tournée." }
/** Un mot que seul Support lit (AC-b6). */
const NUIT: ContentNode = { path: "support/incidents_nuit", title: "Incidents de nuit", summary: "Consignes pour les nuits." }
/**
 * Un mot du seul espace personnel de Marc, sans voisin dans O : son oubli l'emporte (fiche D19 A,
 * HN-E01S13-20). Marc ne sert qu'à ce test, qui le consomme.
 */
const CARNET: ContentNode = { path: "private/marc/carnet", title: "Carnet", summary: "Mes notes." }
/** Brouillon jamais publié, puis publié (AC-b7). */
const TOURNEES: ContentNode = { path: "ventes/tournees_ete", status: "draft", revision: 0, title: "Planification estivale", summary: "Calendrier caniculaire des livraisons." }
/** Le paragraphe de la grille d'Acme (`acme.ts`), dont l'extrait s'arrêtait avant « : 250 € HT. » (N31 d'E03-S02, AC-b10). */
const GRILLE = "conseil/grille_tarifaire_2026"
/**
 * Après le fragment, huit mots, puis neuf ; puis un texte qui porte déjà des marques `**`, où le
 * fragment ne se retrouve pas (AC-b10, HN-E01S13-7).
 */
const FORFAITS: { node: ContentNode; text: string }[] = [
  { node: { path: "ventes/forfait_huit", title: "Grille A", summary: "Tarifs de l'équipe." }, text: "Tarif du forfait intermittent 1 2 3 4 5 6 7 8" },
  { node: { path: "ventes/forfait_neuf", title: "Grille B", summary: "Tarifs de l'équipe." }, text: "Tarif du forfait intermittent 1 2 3 4 5 6 7 8 9" },
  { node: { path: "ventes/forfait_gras", title: "Grille C", summary: "Tarifs de l'équipe." }, text: "Le **tarif** du forfait intermittent : 250 € HT." },
]

type Hit = {
  node_id: string
  path: string
  title: string
  summary: string
  kind: string
  match: string
  block_id: string | null
  block_type: string | null
  block_key: string | null
  column_name: string | null
  snippet: string
  rank: number
  block_total?: number | null
}

const paths = (hits: Hit[]) => [...new Set(hits.map((hit) => hit.path))]

/** L'extrait de la ligne de bloc d'un chemin. */
const blockSnippet = (hits: Hit[], path: string) => hits.find((hit) => hit.path === path && hit.match === "block")?.snippet

/**
 * `after`, où l'extrait d'un bloc qui prolonge celui de `before` (même rang) de huit mots au plus,
 * jusqu'à la fin du bloc (AC-b10, fiche D43 B), redevient celui de `before` : le reste se compare tel quel.
 */
function withoutExtensions(after: Hit[], before: Hit[]): Hit[] {
  // `block_total` (1.2.1), que la fonction d'avant ne rend pas, est retiré de la comparaison.
  return after.map((full, index) => {
    const hit = { ...full }
    delete hit.block_total
    const former = before[index]
    if (!former || hit.match !== "block" || !hit.snippet.startsWith(former.snippet)) return hit
    const words = hit.snippet.slice(former.snippet.length).split(/\s+/).filter(Boolean).length
    return words >= 1 && words <= 8 ? { ...hit, snippet: former.snippet } : hit
  })
}

describe.skipIf(!ready)(
  ready ? "typos in the content, portable" : `typos in the content, portable (${skipReason})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let ref: ReferenceOrgSql
    let rappel: string

    /** `search_content` sous la personne, par la face SQL du paquet. */
    async function search(person: Person, org: string, query: string): Promise<Hit[]> {
      return (await ref.db(person)).tx(async (sql) => [...(await sql<Hit[]>`select * from platform.search_content(${org}, ${query})`)])
    }

    /** Les lignes des deux versions, sous la même personne, pour chaque demande. */
    function compare(person: Person, queries: readonly string[]) {
      return adminAsCaller(seed.admin, ref.people[person].id, [BEFORE], async (tx) => {
        const outcomes: { query: string; before: Hit[]; after: Hit[] }[] = []
        for (const query of queries) {
          const before = await tx<Hit[]>`select * from pg_temp.search_content_before(${ref.org.id}, ${query})`
          const after = await tx<Hit[]>`select * from platform.search_content(${ref.org.id}, ${query})`
          outcomes.push({ query, before: [...before], after: [...after] })
        }
        return outcomes
      })
    }

    /** Le mot du lexique de O qu'une correction ajouterait à `term` (HN-E01S13-1), ou `null`. */
    async function closest(term: string): Promise<string | null> {
      const [row] = await seed.admin<{ word: string }[]>`
        select l.word from platform.lexicon l
         where l.org_id = ${ref.org.id} and extensions.similarity(l.word, ${term}) >= 0.3
         order by extensions.similarity(l.word, ${term}) desc, abs(char_length(l.word) - char_length(${term})), l.word
         limit 1`
      return row?.word ?? null
    }

    /** Les mots du lexique de l'organisation, parmi `words`. */
    async function known(org: string, words: string[]): Promise<string[]> {
      const rows = await seed.admin<{ word: string }[]>`
        select word from platform.lexicon where org_id = ${org} and word in ${seed.admin(words)} order by word`
      return rows.map((row) => row.word)
    }

    beforeAll(async () => {
      seed = seedWithAdmin()
      ref = await seedAcme(seed)
      await ref.addNodes([RAPPELS, COURRIERS, DEPOT, NUIT, TOURNEES, CARNET, ...FORFAITS.map((forfait) => forfait.node)])
      await ref.addBlocks(CARNET.path, "published", [{ type: "paragraph", text: "Une fleur zygomorphe dans le jardin." }])
      for (const { node, text } of FORFAITS) await ref.addBlocks(node.path, "published", [{ type: "paragraph", text }])
      ;[rappel] = await ref.addBlocks(RAPPELS.path, "published", [{ type: "paragraph", text: RAPPEL_TEXT }])
      await ref.addBlocks(COURRIERS.path, "published", [{ type: "paragraph", text: "Une prose soignée pour chaque courrier." }])
      await ref.addBlocks(DEPOT.path, "published", [{ type: "paragraph", text: "Le zanzibor ferme à midi." }])
      await ref.addBlocks(NUIT.path, "published", [{ type: "paragraph", text: "Signaler toute escarbille près du compteur." }])
      await ref.write({
        blocks: [{ id: blockUuid(0x13001), state: "published", org_id: OTHER_ORG.id, node_id: OTHER_ORG.node.id, position: 1024, type: "paragraph", text: "Le zanzibar du dossier." }],
      })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await seed?.cleanup()
    }, SETUP_TIMEOUT)

    it("should find by its paragraph, for factrue, the page whose paragraph alone holds facture, the snippet highlighting facture, where the former function found nothing (AC-b1)", async () => {
      const [{ before, after }] = await compare("lea", ["factrue"])
      expect(before).toEqual([])
      expect(after).toContainEqual(
        expect.objectContaining({ path: RAPPELS.path, match: "block", block_id: rappel, block_type: "paragraph", snippet: expect.stringContaining("Chaque **facture** en retard") }),
      )
    })

    it("should give the rows, order and snippets of the former function to requests whose every word the lexicon holds, a block snippet extended to its end aside (AC-b2, AC-b10)", async () => {
      const queries = ["relance les devis en attente", "prospects à Valbrune", "Boulangerie des Tilleuls", "autoconsommation collective", "escalader un incident", "compte rendu du rendez-vous"]
      // Seul un mot de lettres, de cinq au moins, peut être corrigé : chacun est connu.
      const unknown = await seed.admin<{ word: string }[]>`
        select w as word from unnest(${queries}::text[]) q, unnest(string_to_array(platform.norm_words(q), ' ')) w
         where w ~ '^[a-z]{5,40}$' and not exists (select 1 from platform.lexicon l where l.org_id = ${ref.org.id} and l.word = w)`
      expect(unknown).toEqual([])
      const outcomes = await compare("ada", queries)
      for (const { query, before, after } of outcomes) {
        expect(before.length, query).toBeGreaterThan(0)
        expect(withoutExtensions(after, before), query).toEqual(before)
      }
    })

    it("should give grille tarifaier, found as typed by the trigrams of a title, the rows and rank of the former function, though tarifaier has a correction (AC-b2)", async () => {
      // Corrigé dès la première passe, « tarifaier » ajouterait « tarifaire », que porte le titre de la
      // grille : un terme couvert de plus, et le rang montait d'une tranche à l'autre (AC25 d'E01-S06).
      // La correction ne sert qu'en dernier recours (HN-E01S13-1).
      expect(await closest("tarifaier")).toBe("tarifaire")
      const [{ before, after }] = await compare("lea", ["grille tarifaier"])
      expect(before.find((hit) => hit.path === GRILLE)).toMatchObject({ match: "title", rank: expect.any(Number) })
      expect(withoutExtensions(after, before)).toEqual(before)
    })

    it("should find for rappel factrue the paragraph that holds rappel and facture, and it alone, before any fallback to one of the words (HN-E01S13-1, second pass)", async () => {
      // Tels quels, les deux termes ne trouvent rien : l'ancienne se rabattait sur l'un d'eux, le titre
      // des rappels en tête. Chaque terme ou sa correction, tous ensemble, trouvent le seul paragraphe.
      const [{ before, after }] = await compare("lea", ["rappel factrue"])
      expect(before[0]).toMatchObject({ path: RAPPELS.path, match: "title" })
      expect(after).toEqual([
        expect.objectContaining({ path: RAPPELS.path, match: "block", block_id: rappel, snippet: expect.stringContaining("**facture** en retard reçoit un **rappel**") }),
      ])
    })

    it("should not correct a last word that begins a known word: prosp finds prospects by its prefix as before, never the closer prose (AC-b3)", async () => {
      // La correction, si elle avait lieu, ajouterait « prose », que Léa lirait.
      expect(await closest("prosp")).toBe("prose")
      const [{ before, after }] = await compare("lea", ["prosp"])
      expect(withoutExtensions(after, before)).toEqual(before)
      expect(paths(after)).toEqual(expect.arrayContaining(["ventes/qualifier_prospects", "ventes/suivi_prospects"]))
      expect(paths(after)).not.toContain(COURRIERS.path)
    })

    it("should never correct a word of fewer than five letters (AC-b4)", async () => {
      // « fact », que suit un mot inconnu : corrigé, il trouverait le paragraphe de « facture ».
      expect(await closest("fact")).toBe("facture")
      const [{ before, after }] = await compare("lea", ["fact zzzz"])
      expect({ before, after }).toEqual({ before: [], after: [] })
    })

    it("should correct a request of O by a word of O, never by the word of P, another organisation of Léa, that would come first (AC-b5)", async () => {
      expect(paths(await search("lea", ref.org.id, "zanzibra"))).toEqual([DEPOT.path])
      expect(paths(await search("lea", ref.other.id, "zanzibra"))).toEqual([OTHER_ORG.node.path])
    })

    it("should give no row, as a request without result, when the corrected word is only in a node the caller does not read (AC-b6)", async () => {
      expect(await search("lea", ref.org.id, "escarbile")).toEqual([])
      expect(paths(await search("paul", ref.org.id, "escarbile"))).toEqual([NUIT.path])
    })

    it("should add the words of a node and of its blocks once published, never those of a draft block (AC-b7)", async () => {
      const node = ref.nodeId(TOURNEES.path)
      const words = ["caniculaire", "estivale", "hivernale"]
      await seed.admin`select platform.open_draft(${node})`
      await seed.admin`insert into platform.blocks (node_id, state, position, type, text) values (${node}, 'draft', 1024, 'paragraph', 'Une tournée hivernale aussi.')`
      expect(await known(ref.org.id, words)).toEqual([])
      await seed.admin`select platform.publish_node(${node}, 0)`
      expect(await known(ref.org.id, words)).toEqual(words)
    })

    it("should fill the lexicon from the published content, as lexicon_rebuild does (AC-b7)", async () => {
      // `lexicon_rebuild` (qui remplissait chaque organisation à la migration d'E01-S13, et que `forget_user`
      // appelle), rejouée ici sur le lexique de O vidé, dans une transaction annulée : les mots que les
      // déclencheurs ont posés.
      const rebuilt: { before: string[]; after: string[] } = { before: [], after: [] }
      await seed.admin
        .begin(async (tx) => {
          const wordsOfO = async () => (await tx<{ word: string }[]>`select word from platform.lexicon where org_id = ${ref.org.id} order by word`).map((row) => row.word)
          rebuilt.before = await wordsOfO()
          await tx`delete from platform.lexicon where org_id = ${ref.org.id}`
          await tx`select platform.lexicon_rebuild(${ref.org.id})`
          rebuilt.after = await wordsOfO()
          throw ROLLBACK
        })
        .catch((error: unknown) => {
          if (error !== ROLLBACK) throw error
        })
      expect(rebuilt.before.length).toBeGreaterThan(0)
      expect(rebuilt.after).toEqual(rebuilt.before)
    })

    it("should take away the words of a forgotten person's personal space: none left in the lexicon, no correction toward them (fiche D19 A)", async () => {
      // Avant l'oubli : le mot est connu, et sa faute trouve le carnet pour Marc, qui lit son espace.
      expect(await known(ref.org.id, ["zygomorphe"])).toEqual(["zygomorphe"])
      expect(paths(await search("marc", ref.org.id, "zygomorfe"))).toEqual([CARNET.path])
      await seed.admin`select platform.forget_user(${ref.people.marc.id})`
      expect({ known: await known(ref.org.id, ["zygomorphe"]), closest: await closest("zygomorfe") }).toEqual({ known: [], closest: null })
      expect(await search("lea", ref.org.id, "zygomorfe")).toEqual([])
    })

    it("should end the snippet of the grille paragraph with 250 € HT. for participant supplémentaire, where the former function cut it (AC-b10)", async () => {
      const [{ before, after }] = await compare("lea", ["participant supplémentaire"])
      expect({ before: blockSnippet(before, GRILLE), after: blockSnippet(after, GRILLE) }).toEqual({
        before: expect.stringMatching(/Par \*\*participant\*\* \*\*supplémentaire\*\*$/),
        after: expect.stringMatching(/Par \*\*participant\*\* \*\*supplémentaire\*\* : 250 € HT\.$/),
      })
    })

    it("should extend a snippet by eight words at most, never nine, and keep it when the fragment is not found back in the block (AC-b10, HN-E01S13-7)", async () => {
      const [{ before, after }] = await compare("lea", ["forfait intermittent"])
      const [eight, nine, marked] = FORFAITS.map(({ node }) => ({ before: blockSnippet(before, node.path), after: blockSnippet(after, node.path) }))
      expect({ eight, nine }).toEqual({
        eight: { before: "Tarif du **forfait** **intermittent**", after: "Tarif du **forfait** **intermittent** 1 2 3 4 5 6 7 8" },
        nine: { before: "Tarif du **forfait** **intermittent**", after: "Tarif du **forfait** **intermittent**" },
      })
      // Quatre mots restent après le fragment (« : 250 € HT. ») ; sans les marques du texte, il serait prolongé.
      expect(marked.before).toMatch(/\*\*intermittent\*\*$/)
      expect(marked.after).toBe(marked.before)
    })

    it("should keep the lexicon closed: row level security, no row read by authenticated, no privilege for anon, no write granted, left out of the export (AC-b8)", async () => {
      const [table] = await seed.admin<{ rls: boolean; rows: number }[]>`
        select c.relrowsecurity as rls, (select count(*)::int from platform.lexicon where org_id = ${ref.org.id}) as rows
          from pg_catalog.pg_class c where c.oid = 'platform.lexicon'::regclass`
      expect(table.rls).toBe(true)
      expect(table.rows).toBeGreaterThan(0)
      const ada = await ref.db("ada")
      const read = await ada.tx(async (sql) => (await sql<{ rows: number }[]>`select count(*)::int as rows from platform.lexicon where org_id = ${ref.org.id}`)[0].rows)
      expect(read).toBe(0)
      await expect(ada.tx((sql) => sql`insert into platform.lexicon (org_id, word) values (${ref.org.id}, 'intrus')`)).rejects.toMatchObject({ code: "42501" })
      await expect(withAnonSession((sql) => sql`select word from platform.lexicon limit 1`)).rejects.toMatchObject({ code: "42501" })
      const grants = await seed.admin<{ grantee: string; privilege: string }[]>`
        select grantee, privilege_type as privilege from information_schema.role_table_grants
         where table_schema = 'platform' and table_name = 'lexicon' and grantee in ('anon', 'authenticated') order by 1, 2`
      expect(grants).toEqual([{ grantee: "authenticated", privilege: "SELECT" }])
      expect({ exported: TABLES.some((spec) => spec.name === "lexicon"), never: NEVER_EXPORTED.includes("lexicon") }).toEqual({ exported: false, never: true })
    })
  },
)
