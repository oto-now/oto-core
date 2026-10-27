// @vitest-environment node
// Routage de `context` (E03-S02 : AC1 à AC5, AC7, AC17, AC18) : le mélange, les bonus, la décision et la
// question de données en fonctions pures ; `rankCandidates`, `context` (par `connectDeps`) et `find` sur la
// base réelle (E01-S10, lot t1-e2b2), Acme semée sur O (`seedAcme`, `tests/integration/fixtures/acme-sql.ts`),
// sous le client de la personne (`ref.db`). `route_candidates` et `search_content` y
// sont servies par le test (`watchDb`, `tests/helpers/spy-t1-e2b2.ts`) : elles rendent ce que le test leur fait
// rendre, lignes interdites comprises, et le service prouve qu'il les filtre
// (`security-patterns.md § Droits dans le service`) ; leur classement réel est le sujet de
// `tests/integration/routing.test.ts` et de `tests/integration/search-content.test.ts`. Les niveaux, le
// bonus d'usage (journal), le réglage de O, la révision de la procédure décidée et les Contextes viennent de la base.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { connectDeps } from "../helpers/mcp"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"
import { ORG, OTHER_ORG, PEOPLE, TEAMS, type Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { callsFunction, touches, watchDb, type DbCall, type WatchOptions } from "../helpers/spy-t1-e2b2"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { acmeNode, acmeSearchRow, candidate, NO_CATALOG, simulatedBlockId } from "../integration/fixtures/acme"
import { seedAcme } from "../integration/fixtures/acme-sql"
import type { McpDeps } from "../../packages/plateforme/mcp/server"
import { buildContext } from "../../packages/plateforme/server/context"
import { find } from "../../packages/plateforme/server/find"
import {
  applyBonuses,
  blendScore,
  decide,
  isDataQuestion,
  loadRoutingSettings,
  rankCandidates,
  requestKind,
  routingSettings,
  wordsInCommon,
  type Components,
} from "../../packages/plateforme/server/routing"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const DAY_MS = 86_400_000
/** La consigne d'une panne, au préfixe de l'organisation (jetable sur la base réelle). */
const internal = (prefix: string) => `Internal error. Retry once, then report it with ${prefix}_feedback (type error).`

afterEach(() => {
  vi.restoreAllMocks()
})

/** Une ligne de journal de `person`, `days` jours avant maintenant, en identifiants simulés (`ref.write` les traduit). */
function journalRow(person: Person, target: string | null, days: number, orgId: string = ORG.id): Row {
  const ts = new Date(Date.now() - days * DAY_MS).toISOString()
  return { org_id: orgId, user_id: PEOPLE[person].id, method: "tools/call", target, ts }
}

type AcmeDbOptions = {
  /** Les lignes de `route_candidates`, pour toute demande, ou selon la demande. */
  route?: Row[] | ((query: unknown) => Row[])
  search?: (query: unknown) => Row[]
  journal?: Row[]
  fail?: WatchOptions["fail"]
  /** `orgs.settings` de O ; sans lui, `{}` (réglage par défaut). */
  settings?: Row
}

const rpcCalls = (calls: DbCall[], name: string) => calls.filter((call) => call.kind === "rpc" && call.name === name)

/** La valeur liée à l'égalité `<colonne> = ${…}` d'une requête de la face SQL ; `undefined` sans elle. */
function boundTo(call: Extract<DbCall, { kind: "sql" }>, column: string): unknown {
  const before = call.text.split("?")
  const index = before.findIndex((part) => new RegExp(`\\b${column}\\s*=\\s*$`).test(part))
  return index === -1 ? undefined : call.values[index]
}

describe("blendScore (AC1 ; E11-S04 AC-b1)", () => {
  it("should weigh the summary or the title, the best formulation and the lexemes (all, then the title's), halve a single lexeme, and stay within [0, 1]", () => {
    const none = { s_summary: 0, s_title: 0, s_phrase: 0, lexical: 0, lexical_title: 0, query_lexemes: 3 }
    expect(blendScore({ s_summary: 1, s_title: 0.5, s_phrase: 1, lexical: 1, lexical_title: 1, query_lexemes: 4 })).toBe(1)
    expect(blendScore({ ...none, s_title: 0.8, lexical: 0.5 })).toBeCloseTo(0.25 * 0.8 + 0.45 * 0.75 * 0.5)
    expect(blendScore({ ...none, s_summary: 0.9, s_title: 0.2, s_phrase: 0.6, query_lexemes: 2 })).toBeCloseTo(0.25 * 0.9 + 0.3 * 0.6)
    expect(blendScore({ ...none, lexical_title: 1 })).toBeCloseTo(0.45 * 0.25)
    expect(blendScore(none)).toBe(0)
    const single = blendScore({ ...none, s_summary: 0.4, lexical: 1, lexical_title: 1, query_lexemes: 1 })
    const pair = blendScore({ ...none, s_summary: 0.4, lexical: 1, lexical_title: 1, query_lexemes: 2 })
    expect(pair - single).toBeCloseTo(0.45 / 2)
  })
})

describe("applyBonuses (AC2)", () => {
  it("should add 0.03 for the person's team and 0.03 for a recent use, capped at 1", () => {
    expect(applyBonuses(0.5, { team: false, usage: false })).toBe(0.5)
    expect(applyBonuses(0.5, { team: true, usage: false })).toBeCloseTo(0.53)
    expect(applyBonuses(0.5, { team: true, usage: true })).toBeCloseTo(0.56)
    expect(applyBonuses(0.99, { team: true, usage: true })).toBe(1)
  })
})

describe("decide and routingSettings (AC3)", () => {
  it("should serve the first at the threshold with the set gap, nothing otherwise, and fall back key by key", () => {
    const settings = { threshold: 0.65, gap: 0.25 }
    expect(decide([candidate("a", 0.75), candidate("b", 0.5)], settings)?.path).toBe("a")
    expect(decide([candidate("a", 0.75), candidate("b", 0.5 + 2 ** -10)], settings)).toBeNull()
    expect(decide([candidate("a", 0.65)], settings)?.path).toBe("a")
    expect(decide([candidate("a", 0.649)], settings)).toBeNull()
    expect(decide([], settings)).toBeNull()

    expect(routingSettings({})).toEqual({ threshold: 0.65, gap: 0.1 })
    expect(routingSettings({ routing: { threshold: 0.8 } })).toEqual({ threshold: 0.8, gap: 0.1 })
    expect(routingSettings({ routing: { threshold: 1.5, gap: 0.2 } })).toEqual({ threshold: 0.65, gap: 0.2 })
    expect(routingSettings({ routing: { threshold: "0.9", gap: -0.1 } })).toEqual({ threshold: 0.65, gap: 0.1 })
  })
})

describe("isDataQuestion (AC4)", () => {
  it("should tell a data question from an action", () => {
    const questions = [
      "Combien de prospects avons-nous à Valbrune, et lesquels ?",
      "combien de devis en attente",
      "Qui n'a toujours pas répondu à nos propositions commerciales",
      "Quels sont nos tarifs d'étude",
      "Où en est le pipe",
      "Est-ce qu'il reste des prospects",
      "Est-ce qu’il reste des prospects",
      "Y a-t-il des devis en attente",
      "la grille tarifaire ?",
    ]
    const actions = [
      "Relance les devis en attente.",
      "prospects",
      "Qualifie les prospects à traiter",
      "Quittance à envoyer",
      "Commente ce devis",
      "Quelconque action",
    ]
    for (const phrase of questions) expect(isDataQuestion(phrase), phrase).toBe(true)
    for (const phrase of actions) expect(isDataQuestion(phrase), phrase).toBe(false)
  })

  // E11-S04 (AC-b2) : « comment » et les formules de demande quittent les questions de données.
  it("should tell a how question and a polite request from a data question", () => {
    const kinds = ["Comment je crée un projet ?", "Peux-tu ajouter une tâche ?", "Est-ce que tu peux relancer les devis ?", "Est-ce qu'il reste des prospects", "Relance les devis en attente."]
    expect(kinds.map(requestKind)).toEqual(["how", "request", "request", "data", "action"])
    expect(isDataQuestion("Comment je crée un projet ?")).toBe(false)
  })

  // E11-S19 (AC-d3, HN-E11S19-6) : un verbe d'édition en tête, ou à l'infinitif après une formule de demande ; « ajoute »
  // et les suppressions n'en sont pas (`node.trash`, `table.delete_rows`, en-tête d'un tableau : golden PD2, TB3, TDN1).
  it("should tell a request to change a text, alone or after a request formula, from a creation or a deletion", () => {
    const edits = ["Corrige le tarif de la grille", "Mets à jour la page des horaires ?", "Peux-tu remplacer ce paragraphe ?", "Est-ce que tu peux reformuler la phrase sur les délais", "Renomme la page des tarifs"]
    for (const phrase of edits) expect(requestKind(phrase), phrase).toBe("edit")
    expect(["Ajoute une tâche", "Peux-tu ajouter une tâche ?", "Changement de fournisseur ?"].map(requestKind)).toEqual(["action", "request", "data"])
    expect(["Supprime la page ventes/essai", "Retire la colonne ville", "Efface le projet Alpha", "Peux-tu supprimer le projet Alpha ?"].map(requestKind)).toEqual([
      "action",
      "action",
      "action",
      "request",
    ])
  })

  // E11-S19 (`security-patterns.md § Validation des inputs`) : une phrase hostile de 2 000 caractères, la borne de
  // `phrase`, lue en temps linéaire par les motifs du genre et par les mots en commun.
  it("should read a hostile phrase of 2,000 characters in less than a second", () => {
    const hostile = [
      `${"peux-tu ".repeat(250)}`,
      `qu'est-ce que ${"je ".repeat(662)}`,
      `mets à jour${" à".repeat(995)}`,
      "é".repeat(2000),
      `${"relancer ".repeat(222)}xx`,
    ].map((phrase) => phrase.slice(0, 2000))
    const summary = { title: "t".repeat(200), summary: `${"relance ".repeat(24)}` }
    for (const phrase of hostile) {
      const started = performance.now()
      requestKind(phrase)
      wordsInCommon(phrase, summary)
      expect(performance.now() - started, phrase.slice(0, 30)).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })

  // E11-S19 (AC-d4, HN-E11S19-7) : la personne sujet et un tiers objet, avant le verbe ; « j'ai à faire » reste une donnée (TD4).
  it("should tell a question about what to do to someone from a data question", () => {
    for (const phrase of ["Qu'est-ce que je lui réponds ?", "Qu’est-ce qu’on leur dit ?", "Que dois-je lui répondre ?"]) {
      expect(requestKind(phrase), phrase).toBe("action")
    }
    for (const phrase of ["Qu'est-ce que j'ai à faire aujourd'hui ?", "Qu'est-ce que je dois faire aujourd'hui ?", "Que lui avons-nous facturé ?"]) {
      expect(isDataQuestion(phrase), phrase).toBe(true)
    }
  })
})

// E11-S19 (AC-d2, HN-E11S19-5) : les mots de la demande trouvés dans le titre ou le résumé d'une candidate.
describe("wordsInCommon", () => {
  const ticket = { title: "Traiter un ticket SAV", summary: "Répond au client qui écrit au support." }

  it("should give the words of the request found in the title or the summary, without case, accents or ending, once each", () => {
    expect(wordsInCommon("Traite ce TICKET et réponds au client, au client", ticket)).toEqual(["traite", "ticket", "réponds", "client"])
  })

  it("should leave out short words and words that only share four letters", () => {
    expect(wordsInCommon("sav au support", ticket)).toEqual(["support"])
    expect(wordsInCommon("les tickets de caisse", { title: "Tick", summary: "Caisier." })).toEqual([])
  })
})

describe.skipIf(!sqlConfigured)(portable("routing on the real database, Acme on O"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedAcme(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  // Chaque test pose son journal et son réglage : ceux d'un autre ne comptent jamais dans ses bonus ni dans sa décision.
  afterEach(async () => {
    await seed.admin`delete from platform.journal where org_id in ${seed.admin([ref.org.id, ref.other.id])}`
    await ref.write({ orgs: [{ id: ORG.id, settings: {} }] })
  })

  /**
   * Une ligne de `route_candidates` pour un nœud d'Acme, sous ses identifiants réels ; l'équipe propriétaire
   * effective est Ventes par défaut. La formulation vaut le texte (`s_phrase` = le plus grand du résumé et
   * du titre) et le titre porte les lexèmes du nœud (`lexical_title` = `lexical`) : le mélange d'E11-S04 y
   * vaut, pour un résumé au moins égal au titre, celui d'avant (0,55 et 0,45), et les scores attendus
   * restent ceux des filtres, bonus et coupes que ces tests prouvent.
   */
  function routeRow(path: string, components: Omit<Components, "s_phrase" | "lexical_title">, ownerTeamId: string | null = TEAMS.ventes.id): Row {
    const { title, summary, kind } = acmeNode(path)
    const derived = { s_phrase: Math.max(components.s_summary, components.s_title), lexical_title: components.lexical }
    return { node_id: ref.nodeId(path), path, title, summary, kind, owner_team_id: ownerTeamId === null ? null : ref.id(ownerTeamId), ...components, ...derived }
  }

  /**
   * Le client de `person` sur Acme, `route_candidates` et `search_content` rendant les lignes données, quel
   * que soit l'appelant (nœuds sous leur identifiant réel) ; le journal et le réglage de O donnés sont
   * écrits sur la base, et retirés après le test.
   */
  async function acmeDb(person: Person, options: AcmeDbOptions = {}) {
    if (options.journal) await ref.write({ journal: options.journal })
    if (options.settings) await ref.write({ orgs: [{ id: ORG.id, settings: options.settings }] })
    const found = (row: Row): Row => ({ ...row, node_id: ref.nodeId(String(row.path)) })
    return watchDb(await ref.db(person), {
      rpc: {
        route_candidates: (args) => (typeof options.route === "function" ? options.route(args.p_query) : (options.route ?? [])),
        search_content: (args) => (options.search?.(args.p_query) ?? []).map(found),
      },
      fail: options.fail,
    })
  }

  function mcpDeps(db: McpDeps["db"], person: Person): McpDeps {
    const identity = ref.identityOf(person)
    return { db, org: identity.org, caller: { kind: "member", identity }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" }
  }

  describe("decide at the organisation's setting (AC3)", () => {
    it("should route at the setting read in orgs.settings", async () => {
      // `context` décide au réglage lu dans `orgs.settings` : 0,81 serait servi au seuil par défaut (0,65), pas à 0,9.
      const { db } = await acmeDb("claire", {
        route: [routeRow("ventes/relance_devis", { s_summary: 0.6, s_title: 0.5, lexical: 1, query_lexemes: 3 })],
        settings: { routing: { threshold: 0.9 } },
      })
      const routed = await buildContext(db, ref.identityOf("claire"), { phrase: "relance les devis" }, { userAgent: null })
      expect(routed.data).toMatchObject({ served: null, candidates: [{ path: "ventes/relance_devis", score: 0.81 }] })
    })
  })

  describe("rankCandidates (AC5)", () => {
    it("should call route_candidates once, drop unreadable nodes before the cut, add the bonuses and keep scores ≥ 0.30", async () => {
      const { db, calls } = await acmeDb("claire", {
        route: [
          // Support : invisible de Claire, le meilleur score ; retiré avant la coupe.
          // Depuis E01-S13 (AC-a2), `route_candidates` ne le rend plus à Claire ; la doublure le rend : le filtre prouvé est celui du service.
          routeRow("support/escalade_incident", { s_summary: 1, s_title: 1, lexical: 1, query_lexemes: 3 }, TEAMS.support.id),
          routeRow("ventes/relance_devis", { s_summary: 0.9, s_title: 0.5, lexical: 1, query_lexemes: 3 }),
          routeRow("ventes/relance_prospects", { s_summary: 0.5, s_title: 0.3, lexical: 0.5, query_lexemes: 2 }),
          // 0,2825 avec l'équipe : un bonus d'usage compté à tort le ferait montrer.
          routeRow("ventes/point_pipeline", { s_summary: 0.05, s_title: 0, lexical: 0.5, query_lexemes: 2 }),
          routeRow("conseil/preparer_rdv", { s_summary: 0.6, s_title: 0.2, lexical: 0.5, query_lexemes: 2 }, null),
        ],
        journal: [
          journalRow("claire", "ventes/relance_prospects", 2),
          journalRow("claire", "ventes/point_pipeline", 31),
          journalRow("lea", "ventes/point_pipeline", 1),
          journalRow("claire", "ventes/point_pipeline", 1, OTHER_ORG.id),
          journalRow("claire", null, 1),
        ],
      })
      const claire = ref.identityOf("claire")

      const ranked = await rankCandidates(db, claire, { query: "relance les devis", limit: 3 })
      expect(ranked.map(({ path, score }) => [path, Number(score.toFixed(4))])).toEqual([
        ["ventes/relance_devis", 0.975],
        ["ventes/relance_prospects", 0.56],
        ["conseil/preparer_rdv", 0.555],
      ])
      expect(ref.readable(rpcCalls(calls, "route_candidates"))).toEqual([
        { kind: "rpc", name: "route_candidates", args: { p_org: ORG.id, p_query: "relance les devis", p_kind: "procedure", p_limit: 50 } },
      ])
      // La lecture du journal filtrée sur l'organisation et la personne, dans la requête (face SQL, lot e2b).
      const journal = calls.find((call) => touches(call, "journal"))
      expect(ref.readable(journal?.kind === "sql" ? { org_id: boundTo(journal, "org_id"), user_id: boundTo(journal, "user_id") } : null)).toEqual({
        org_id: ORG.id,
        user_id: PEOPLE.claire.id,
      })
      expect((await rankCandidates(db, claire, { query: "relance les devis", limit: 1 })).map((candidate) => candidate.path)).toEqual([
        "ventes/relance_devis",
      ])
    })
  })

  // 2026-10-27 (JB) : `context` ne sert plus les étapes ; la procédure décidée, en tête des cinq plus proches, se lit par `read`.
  describe("context lists the closest procedures, the best match first (AC7)", () => {
    it("should list the decided procedure first, to read, then the other close ones, never its steps nor its draft, with data and journal target", async () => {
      const path = "ventes/relance_devis"
      // Un brouillon ouvert, que la base rend à qui la lit : rien n'en est servi.
      await ref.openDraft(path)
      await ref.addBlocks(path, "draft", [{ type: "paragraph", text: "BROUILLON : une étape en cours d'écriture." }])
      try {
        const { db } = await acmeDb("claire", {
          route: [
            routeRow(path, { s_summary: 1, s_title: 0.7, lexical: 1, query_lexemes: 3 }),
            routeRow("ventes/relance_prospects", { s_summary: 0.45, s_title: 0.4, lexical: 0.33, query_lexemes: 3 }),
            routeRow("ventes/qualifier_prospects", { s_summary: 0.4, s_title: 0.3, lexical: 0.33, query_lexemes: 3 }),
            // Quatrième candidat de score ≥ 0,30 (0,34) : cinq au plus sont montrés depuis le 2026-10-27.
            routeRow("ventes/point_pipeline", { s_summary: 0.3, s_title: 0.2, lexical: 0.33, query_lexemes: 3 }),
          ],
        })
        const session = await connectDeps(mcpDeps(db, "claire"))
        const phrase = "relance les devis en attente"
        const { text, result } = await session.call("context", { phrase })

        const relance = acmeNode(path)
        const [code] = text.split("\n\n## ")
        // E11-S19 (AC-d2) : les mots de la demande trouvés dans chacune.
        const reason = (otherPath: string) => {
          const words = wordsInCommon(phrase, acmeNode(otherPath))
          return words.length > 0 ? `words in common: ${words.join(", ")}` : "no word in common"
        }
        const line = (otherPath: string, score: string, mark = "") => `- ${otherPath} — ${acmeNode(otherPath).title}: ${acmeNode(otherPath).summary} (${mark}${score}; ${reason(otherPath)})`
        const prefix = ref.org.prefix
        expect(code.slice(code.indexOf("Request « "))).toBe(
          [
            `Request « ${phrase} »: closest procedures, the best match first:`,
            line(path, "1.00", "best match; "),
            line("ventes/relance_prospects", "0.43"),
            line("ventes/qualifier_prospects", "0.40"),
            line("ventes/point_pipeline", "0.34"),
            `If the request is about « ${relance.title} », read ${path} with ${prefix}_read {"path": "${path}"}, then follow its steps in order (if it is about another one listed, read and follow that one instead). ` +
              `Each \`\`\`call block in it holds <function> <arguments JSON>: run it with ${prefix}_call {"function": "<function>", "arguments": <arguments JSON>}, replacing each "<…>" value with the real one. ` +
              "Ask the user's explicit approval before anything that sends, or that changes data beyond the steps of the procedure the user asked for.",
          ].join("\n"),
        )
        // Ni étapes, ni brouillon, ni liste des procédures utiles.
        for (const absent of ["## Procedure ", "### Étapes", "sellsy.list_estimates", "BROUILLON", "Procedures you can run"]) expect(text).not.toContain(absent)
        expect(result.structuredContent).toMatchObject({
          served: { path: "ventes/relance_devis", revision: 1, score: 1 },
          candidates: [
            { path: "ventes/relance_devis", title: relance.title, kind: "procedure", score: 1 },
            { path: "ventes/relance_prospects", title: acmeNode("ventes/relance_prospects").title, kind: "procedure", score: 0.43 },
            { path: "ventes/qualifier_prospects", title: acmeNode("ventes/qualifier_prospects").title, kind: "procedure", score: 0.4 },
            { path: "ventes/point_pipeline", title: acmeNode("ventes/point_pipeline").title, kind: "procedure", score: 0.34 },
          ],
          data_question: false,
        })
        expect(session.journal.at(-1)?.target).toBe("ventes/relance_devis")
      } finally {
        await seed.admin`delete from platform.blocks where node_id = ${ref.nodeId(path)} and state = 'draft'`
        await seed.admin`delete from platform.node_drafts where node_id = ${ref.nodeId(path)}`
      }
    })
  })

  describe("filtering by the service (AC17)", () => {
    it("should never give Paul a ventes/ node, row or usage bonus that the database returns", async () => {
      const valbrune = (key: string, index: number) =>
        acmeSearchRow("ventes/suivi_prospects", {
          match: "block",
          block_id: simulatedBlockId(index),
          block_type: "row",
          block_key: key,
          column_name: "ville",
          snippet: "ville: **Valbrune**",
          rank: 0.1,
        })
      const { db } = await acmeDb("paul", {
        route: (query) =>
          query === "Valbrune"
            ? []
            : [
                // Ventes, que Paul ne lit pas : `route_candidates` ne la lui rend plus depuis E01-S13 (AC-a2) ; la doublure la rend.
                routeRow("ventes/relance_devis", { s_summary: 1, s_title: 0.8, lexical: 1, query_lexemes: 3 }),
                routeRow("support/reponse_ticket", { s_summary: 0.5, s_title: 0.2, lexical: 0.5, query_lexemes: 2 }, TEAMS.support.id),
              ],
        search: (query) =>
          query === "Valbrune"
            ? [valbrune("P-003", 701), valbrune("P-001", 702)]
            : [
                acmeSearchRow("ventes/relance_devis", { snippet: "**Relancer** les **devis** en attente", rank: 2.6 }),
                acmeSearchRow("ventes/relance_prospects", { snippet: "**Relancer** les prospects à traiter", rank: 2.5 }),
                acmeSearchRow("ventes/modele_relance", { match: "summary", snippet: "Le modèle d'email de **relance** d'un **devis**", rank: 1.4 }),
                // Quatrième nœud, que Paul lit : le filtre de niveau passe avant la borne de trois nœuds.
                acmeSearchRow("support/faq", { match: "block", block_id: simulatedBlockId(703), block_type: "paragraph", snippet: "**Relance** du fournisseur", rank: 0.1 }),
              ],
        journal: [journalRow("lea", "support/reponse_ticket", 1)],
      })
      const paul = ref.identityOf("paul")

      const ranked = await rankCandidates(db, paul, { query: "relance les devis en attente", limit: 3 })
      expect(ranked.map(({ path, score }) => [path, Number(score.toFixed(4))])).toEqual([["support/reponse_ticket", 0.53]])

      const session = await connectDeps(mcpDeps(db, "paul"))
      const context = await session.call("context", { phrase: "relance les devis en attente" })
      // E03-S08 : le Contexte de Tout le monde, que Paul lit, cite `ventes/suivi_prospects` dans son Lexique ;
      // du contenu écrit, pas un chemin servi par le service : aucune autre ligne ne nomme Ventes.
      expect(context.text.split("\n").filter((line) => line.includes("ventes/"))).toEqual([acmeNode("contexte").blocks[3].text])
      expect(context.result.structuredContent).toMatchObject({ served: null, candidates: [{ path: "support/reponse_ticket", score: 0.53 }] })

      const byWords = await find(db, paul, { query: "relance devis" }, NO_CATALOG)
      expect(byWords.text).not.toContain("ventes/")
      // `find` classe comme `context` : la procédure du Support, que le routage rend à Paul, s'ajoute à la page trouvée.
      expect(byWords.data).toMatchObject({ matches: [{ path: "support/reponse_ticket" }, { path: "support/faq" }], more_nodes: 0 })
      const byRow = await find(db, paul, { query: "Valbrune" }, NO_CATALOG)
      expect(byRow.text).toBe("No match for « Valbrune ». Ask the user to rephrase or to say what they are looking for; do not guess.")
    })
  })

  describe("failures (AC18)", () => {
    it("should answer find with the internal instruction when search_content fails, never the database message", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const { db } = await acmeDb("claire", {
        fail: (call) => (callsFunction(call, "search_content") ? { code: "57014", message: "timeout on platform.blocks" } : null),
      })
      const session = await connectDeps(mcpDeps(db, "claire"))
      const { code } = await session.openContext()
      const failed = await session.call("find", { ctx: code, query: "grille tarifaire" })
      expect(failed.isError).toBe(true)
      expect(failed.text).toBe(internal(ref.org.prefix))
      expect(session.journal.at(-1)?.error).toBe(`internal: ${internal(ref.org.prefix)}`)
      expect(log).toHaveBeenCalledWith("[platform] find: search_content", "57014")
    })

    it("should still answer context without steps nor candidates when route_candidates fails or the served procedure cannot be read (N30)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const route = [
        routeRow("ventes/relance_devis", { s_summary: 1, s_title: 0.7, lexical: 1, query_lexemes: 3 }),
        routeRow("ventes/relance_prospects", { s_summary: 0.45, s_title: 0.4, lexical: 0.33, query_lexemes: 3 }),
      ]
      // Revue du cycle 2 : la procédure décidée (1.00, écart net) mais illisible faisait demander à l'utilisateur de choisir.
      const failures = {
        "routing failed": await acmeDb("claire", { route, fail: (call) => (callsFunction(call, "route_candidates") ? { code: "57014" } : null) }),
        // La relecture de la révision de la procédure décidée (`servedRevision`, 2026-10-27).
        "procedure read failed": await acmeDb("claire", {
          route,
          fail: (call) => (call.kind === "sql" && /select revision from platform\.nodes where id = /.test(call.text) ? { code: "57014" } : null),
        }),
      }
      for (const [failure, { db }] of Object.entries(failures)) {
        const session = await connectDeps(mcpDeps(db, "claire"))
        const { text, result, isError } = await session.call("context", { phrase: "relance les devis en attente" })
        expect(isError, failure).toBe(false)
        expect(text.split("\n\n")[0].split("\n").at(-1), failure).toBe(
          `Request « relance les devis en attente »: no procedure could be matched right now. ${ref.org.prefix}_find can search pages, tables and functions.`,
        )
        expect(text, failure).not.toContain("(best match;")
        expect(result.structuredContent, failure).toMatchObject({ served: null, candidates: [], data_question: false })
        expect(session.journal.at(-1)?.target, failure).toBe("relance les devis en attente")
        expect(log).toHaveBeenCalledWith(`[platform] context: ${failure}`, expect.anything())
      }
    })

    it("should fall back to the default settings and to no usage bonus when their reads fail", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      // Le réglage posé en base (seuil 0,9) n'est pas lu : sa lecture échoue.
      const settingsDown = await acmeDb("claire", { settings: { routing: { threshold: 0.9 } }, fail: (call) => (touches(call, "orgs") ? { code: "57014" } : null) })
      expect(await loadRoutingSettings(settingsDown.db, ref.org.id)).toEqual({ threshold: 0.65, gap: 0.1 })
      expect(log).toHaveBeenCalledWith("[platform] routing: orgs.settings read failed", "57014")

      const { db } = await acmeDb("claire", {
        route: [routeRow("ventes/relance_prospects", { s_summary: 0.5, s_title: 0.3, lexical: 0.5, query_lexemes: 2 })],
        journal: [journalRow("claire", "ventes/relance_prospects", 1)],
        fail: (call) => (touches(call, "journal") ? { code: "57014" } : null),
      })
      const ranked = await rankCandidates(db, ref.identityOf("claire"), { query: "relance les prospects", limit: 3 })
      expect(ranked.map(({ score }) => Number(score.toFixed(4)))).toEqual([0.53])
      expect(log).toHaveBeenCalledWith("[platform] routing: journal read failed", "57014")
    })
  })
})
