// @vitest-environment node
// Blocs code, personne, organisation et équipe de `context` (E03-S01, AC22, P39) : formats exacts
// de la section « Contrat MCP » de la story ; depuis E05-S12 (D109), les faits de la personne, de
// l'organisation et des équipes, en tête de la partie de leur Contexte.
// E03-S08 : Contextes, nouveautés, procédures utiles, contenus récents, aperçu, filtrage, pannes.
// Depuis E01-S10 (lot t1-c2), tout ce qui lit la base tourne sur une base réelle : l'organisation O de
// `reference-org.ts` et P, semées par la connexion d'administration, une graine par jeu de données
// (`seedReferenceTables`, `tests/helpers/reference-org-sql.ts`), lues sous la personne. La RLS n'y garde
// que l'isolation par organisation : la base rend les lignes interdites de O, et celles de P à qui en est
// membre ; le service prouve qu'il les filtre (`security-patterns.md § Droits dans le service`).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { candidate } from "../integration/fixtures/acme"
import { buildContext, previewContext } from "../../packages/plateforme/server/context"
import { codeBlock, workspaceRules } from "../../packages/plateforme/server/context/blocks/code"
import { contextBodies } from "../../packages/plateforme/server/context/blocks/contexts"
import { newsBlock, newsItems } from "../../packages/plateforme/server/context/blocks/news"
import { orgFacts } from "../../packages/plateforme/server/context/blocks/org"
import { personFacts } from "../../packages/plateforme/server/context/blocks/person"
import { proceduresBlock } from "../../packages/plateforme/server/context/blocks/procedures"
import { recentBlock } from "../../packages/plateforme/server/context/blocks/recent"
import { teamFacts } from "../../packages/plateforme/server/context/blocks/team"
import { CONTEXT_BUDGET } from "../../packages/plateforme/server/context/engine"
import { lastCtxAt } from "../../packages/plateforme/server/ctx"
import { fromDatabaseError, READ_PAGE_ROWS } from "../../packages/plateforme/server/errors"
import { day } from "../../packages/plateforme/server/nodes/read-format"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"
import type { Candidate, RequestKind } from "../../packages/plateforme/server/routing"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import {
  addBlocks,
  blockUuid,
  contentTables,
  nodeId,
  openDraftRow,
  ORG as O,
  OTHER_ORG,
  PEOPLE,
  TEAMS,
  type ContentNode,
  type Person,
  type RuleSpec,
} from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { seedWithAdmin, sqlConfigured, type SeededData, portable } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

// Une lecture en panne ne se provoque pas sur une base réelle partagée (AC13) : la panne se pose à la
// frontière des modules que lit l'assemblage de `context/index.ts`, dont les exports gardent leur forme
// d'une partie d'E01-S10 à l'autre ; hors d'AC13, chacun rend le vrai résultat.
vi.mock("../../packages/plateforme/server/context/blocks/contexts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/context/blocks/contexts")>()
  return { ...original, contextBodies: vi.fn(original.contextBodies) }
})
vi.mock("../../packages/plateforme/server/context/blocks/news", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/context/blocks/news")>()
  return { ...original, newsItems: vi.fn(original.newsItems) }
})
vi.mock("../../packages/plateforme/server/context/blocks/procedures", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/context/blocks/procedures")>()
  return { ...original, proceduresBlock: vi.fn(original.proceduresBlock) }
})
vi.mock("../../packages/plateforme/server/context/blocks/recent", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/context/blocks/recent")>()
  return { ...original, recentBlock: vi.fn(original.recentBlock) }
})
vi.mock("../../packages/plateforme/server/ctx", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/ctx")>()
  return { ...original, lastCtxAt: vi.fn(original.lastCtxAt) }
})

const ORG = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acme", brand: {}, domains: "sales, customer support, energy consulting" }
const VENTES: IdentityTeam = { id: "team-ventes", slug: "ventes", name: "Ventes", role: "lead" }
const CONSEIL: IdentityTeam = { id: "team-conseil", slug: "conseil", name: "Conseil", role: "member" }

function identity(fields: Partial<Identity> = {}): Identity {
  return {
    org: ORG,
    user: { id: "user-claire", email: "claire@example.test", name: "Claire Morel" },
    member: { role: "member", profile: { name: "Claire Morel", handle: "claire", language: "français" } },
    teams: [VENTES, CONSEIL],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
    ...fields,
  }
}

// ------------------------------------------------------------------------------------ Base réelle

/** Graines, sessions et lectures sur le projet partagé, sous la charge des autres agents. */
const REAL_BASE_TIMEOUT = 120_000

let seed: SeededData | undefined

/** La graine du fichier (`seedWithAdmin`), ouverte au premier jeu semé : sautées, les suites n'ouvrent aucune connexion. */
function theSeed(): SeededData {
  seed ??= seedWithAdmin()
  return seed
}

afterAll(async () => {
  // Organisations et personnes.
  await seed?.cleanup()
}, REAL_BASE_TIMEOUT)

/**
 * O et P semés sur la base réelle depuis leurs tables simulées (`seedReferenceTables`), une graine par jeu
 * de données, comme la base simulée repartait des siennes. Le journal s'écrit ensuite, l'outil de chaque
 * ligne sous le préfixe réel d'O (`t<hex>`, tiré par la graine) : les documents récents ne comptent que
 * `<préfixe>_read` et `<préfixe>_write`. `extra` : des identifiants réels choisis (`orderedIds`).
 */
async function seedO(tables: Tables, extra: Record<string, string> = {}): Promise<ReferenceOrgSql> {
  const { journal = [], ...rest } = tables
  const ref = await seedReferenceTables(theSeed(), rest, extra)
  const simulatedTool = `${O.prefix}_`
  const tool = (value: unknown) => (typeof value === "string" && value.startsWith(simulatedTool) ? `${ref.org.prefix}_${value.slice(simulatedTool.length)}` : value)
  if (journal.length > 0) await ref.write({ journal: journal.map((row) => ({ ...row, tool: tool(row.tool) })) })
  return ref
}

/**
 * Des identifiants réels pour des blocs simulés, rangés dans le même ordre : la base réelle tire chaque
 * identifiant au hasard, et une lecture par pages avance par identifiant ; un bloc que la graine connaît
 * déjà garde le sien (`extra` de `seedReferenceTables`). Préfixe tiré par passage : deux passages en même
 * temps sur le projet ne se croisent pas.
 */
function orderedIds(simulated: readonly string[]): Record<string, string> {
  const prefix = hex(4)
  return Object.fromEntries([...simulated].sort().map((id, rank) => [id, `${prefix}-0000-4000-8000-${rank.toString(16).padStart(12, "0")}`]))
}

/**
 * La ligne du routage et ses candidates (E11-S16, AC-a1) : la fin du bloc code, sous « ## This request » (E05-S12,
 * AC-9), jusqu'au bloc suivant.
 */
function routingLineOf(text: string): string {
  const title = "## This request\n"
  const start = text.indexOf(title) + title.length
  const end = text.indexOf("\n\n", start)
  return text.slice(start, end === -1 ? undefined : end)
}

describe("codeBlock", () => {
  const unmatched = { candidates: [], served: null, kind: "action" as const }
  /** Un résultat qui commence par « context has changed » porte le nouveau code et les Contextes changés ; l'appel a couru. */
  const PASS_LINE =
    'Pass this ctx to every acme_ tool. If a result starts with "context has changed", it gives a new ctx and the changed contexts: read them and use the new ctx from then on; the call itself ran, do not repeat it.'

  // E05-S12 (AC-9) : les règles de l'espace entre la consigne du code et la ligne du routage.
  it("should give the code, the instruction to pass it, the rules of the workspace, then the request", () => {
    expect(codeBlock({ prefix: "acme", code: "7K3Q-M2XA", phrase: "Relance les devis", ...unmatched })).toEqual({
      name: "code",
      text: [
        "ctx: 7K3Q-M2XA",
        PASS_LINE,
        workspaceRules("acme"),
        "## This request",
        "Request « Relance les devis »: no procedure matches. Say so instead of guessing; acme_find can search pages, tables and functions.",
      ].join("\n"),
    })
  })

  it("should ask for the request when none was given", () => {
    expect(codeBlock({ prefix: "acme", code: "7K3Q-M2XA", candidates: [], served: null, kind: null }).text.split("\n").at(-1)).toBe(
      "No request given: call acme_context again with the user's request as phrase to get the matching procedure.",
    )
  })

  // E11-S16 (AC-a1, AC-a3) : sans étape servie, les candidates par titre et résumé et une seule consigne,
  // quel que soit le genre de la phrase : l'assistant choisit celle qui correspond ; rien ne correspond, il le dit.
  it("should list the closest procedures by title and summary with one instruction for any request, and say when nothing matches (AC8)", () => {
    const candidates = [
      { ...candidate("ventes/relance_prospects", 0.62), title: "Relancer les prospects", summary: "Relance les prospects à traiter." },
      { ...candidate("ventes/qualifier_prospects", 0.6), title: "Qualifier les prospects", summary: "Complète les fiches des prospects." },
    ]
    const settings = { threshold: 0.65, gap: 0.1 }
    const routing = (phrase: string, fields: { candidates: Candidate[]; kind: RequestKind }) =>
      routingLineOf(codeBlock({ prefix: "acme", code: "7K3Q-M2XA", phrase, served: null, settings, ...fields }).text)
    // E11-S19 (AC-d2) : chaque candidate dit les mots de la demande trouvés dans son titre ou son résumé.
    const closest = (first: string, second: string) => [
      `- ventes/relance_prospects — Relancer les prospects: Relance les prospects à traiter. (0.62; ${first})`,
      `- ventes/qualifier_prospects — Qualifier les prospects: Complète les fiches des prospects. (0.60; ${second})`,
      "Read the one that fits the request with acme_read, if any; otherwise search with acme_find or ask the user.",
    ]
    const prospects = "words in common: prospects"
    // AC-a4 : la règle du routage renvoie aux candidates, au lieu de faire demander.
    expect(workspaceRules("acme")).toContain(
      "\n- When a request matches a procedure, its steps come right after this part: follow them in order. Otherwise the closest procedures are listed there: use the one that fits, or search; ask the user when nothing fits.\n",
    )
    const question = "Combien de prospects avons-nous à Valbrune, et lesquels ?"
    const cases = [
      ["prospects", "action", prospects, prospects],
      [question, "data", prospects, prospects],
      ["Comment je relance ?", "how", "words in common: relance", "no word in common"],
      ["Peux-tu relancer ?", "request", "words in common: relancer", "no word in common"],
    ] as const
    // E11-S19 (AC-d1) : le seuil et l'écart du réglage de l'organisation.
    const unclear = (phrase: string, threshold = "0.65", gap = "0.10") =>
      `Request « ${phrase} »: no clear match (steps are served from a score of ${threshold}, ${gap} ahead of the next). Closest procedures:`
    for (const [phrase, kind, first, second] of cases) {
      expect(routing(phrase, { candidates, kind })).toBe([unclear(phrase), ...closest(first, second)].join("\n"))
    }
    const strict = codeBlock({ prefix: "acme", code: "7K3Q-M2XA", phrase: "prospects", served: null, candidates, kind: "action", settings: { threshold: 0.8, gap: 0.2 } })
    expect(routingLineOf(strict.text).split("\n")[0]).toBe(unclear("prospects", "0.80", "0.20"))
    expect(routing(question, { candidates: [], kind: "data" })).toBe(
      `Request « ${question} »: no procedure matches. It is a question: search with acme_find, acme_read or acme_call table.rows and answer it.`,
    )
    expect(routing("donne-moi une recette de crêpes", { candidates: [], kind: "action" })).toBe(
      "Request « donne-moi une recette de crêpes »: no procedure matches. Say so instead of guessing; acme_find can search pages, tables and functions.",
    )
    expect(routing("x".repeat(250), { candidates: [], kind: "action" }).startsWith(`Request « ${"x".repeat(200)} »: no procedure`)).toBe(true)
    // E11-S19 (AC-d3) : une demande d'édition sans candidate dit la marche : les mots exacts par find, puis write.
    expect(routing("Corrige le tarif de la grille", { candidates: [], kind: "edit" })).toBe(
      "Request « Corrige le tarif de la grille »: no procedure matches. It asks to change a content: search with acme_find for the exact words to change, not the document's title; each block found comes with its section and how to edit it with acme_write.",
    )
  })

  // E11-S19 (AC-c1, AC-c2) : `context` léger, sans les règles ; la ligne dit ce qui vaut encore du code d'où l'on repart.
  it("should replace the rules by what still holds since the earlier ctx in a light context", () => {
    const light = (changed: string[]) =>
      codeBlock({ prefix: "acme", code: "7K3Q-M2XA", phrase: "Relance les devis", ...unmatched, since: { code: "AAAA-BBBB", changed } }).text.split("\n")
    expect(light([]).slice(0, 4)).toEqual([
      "ctx: 7K3Q-M2XA",
      PASS_LINE,
      "Since ctx AAAA-BBBB: nothing changed; the rules and contexts served with it still hold.",
      "## This request",
    ])
    expect(light(["contexte", "ventes/contexte"])[2]).toBe(
      "Since ctx AAAA-BBBB: the rules and the other contexts served with it still hold; the changed contexts follow (contexte, ventes/contexte).",
    )
  })

  // E11-S16 (AC-a2) : la procédure servie l'est si la demande porte sur son titre ; les autres candidates, par titre et
  // résumé, avec la consigne de lire plutôt celle qui correspond ; E11-S04 (AC-b3) : une demande « comment » explique.
  it("should serve the steps when the request is about their title, list the other candidates to read instead, and explain for a how question", () => {
    const served = { ...candidate("todo/creer_un_projet", 0.78), title: "Créer un nouveau projet", summary: "Crée un projet de la todo." }
    const task = { ...candidate("todo/ajouter_une_tache", 0.58), title: "Ajouter une tâche", summary: "Ajoute une tâche à ma todo." }
    const routing = (phrase: string, kind: RequestKind, candidates: Candidate[]) =>
      routingLineOf(codeBlock({ prefix: "demo", code: "7K3Q-M2XA", phrase, served, candidates, kind }).text)
    const how = "Comment je crée un projet ?"
    const asked = "Peux-tu créer un projet ?"
    const matched = (phrase: string) => `Request « ${phrase} » matches todo/creer_un_projet (score 0.78): its steps follow, if the request is about « Créer un nouveau projet ».`
    const others = [
      "Other candidates:",
      "- todo/ajouter_une_tache — Ajouter une tâche: Ajoute une tâche à ma todo. (0.58; no word in common)",
      "If the request is about one of them instead, read that one with demo_read and follow it rather than these steps.",
    ]

    expect(routing(asked, "request", [served, task])).toBe([matched(asked), ...others].join("\n"))
    expect(routing(how, "how", [served, task])).toBe([matched(how), ...others, "It asks how: explain these steps, and run them only if the user asks."].join("\n"))
    expect(routing(asked, "action", [served])).toBe(matched(asked))
  })
})

/** La phrase de langue des faits de la personne (E05-S11, AC-37). */
const REPLY_IN_FRENCH = "Reply in French unless the user writes in another language."

// E05-S12 (AC-1) : les faits de l'ancien bloc « You work for », en une ligne, sans perte.
describe("personFacts (AC22)", () => {
  it("should name the person, handle, role, teams with the lead mark, and the reply language", () => {
    expect(personFacts(identity())).toBe(`You: Claire Morel (claire), member of Acme Énergies. Teams: Ventes (lead), Conseil. ${REPLY_IN_FRENCH}`)
  })

  it.each([
    ["admin", "administrator of"],
    ["member", "member of"],
  ] as const)("should render the role %s as « %s <org> »", (role, words) => {
    const person = identity({ member: { role, profile: {} }, teams: [] })
    expect(personFacts(person)).toBe(`You: Claire Morel, ${words} Acme Énergies. Teams: none. ${REPLY_IN_FRENCH}`)
  })

  it("should leave out the handle when the profile has none", () => {
    const person = identity({ member: { role: "member", profile: {} } })
    expect(personFacts(person)).toBe(`You: Claire Morel, member of Acme Énergies. Teams: Ventes (lead), Conseil. ${REPLY_IN_FRENCH}`)
  })

  // AC-36, AC-37 : la langue du profil, sinon celle de l'organisation, sinon le français ; une valeur
  // enregistrée hors de `fr` et `en` ne compte pas.
  it.each([
    ["the profile language over the organisation's", "en", "fr", "English"],
    ["the organisation language without a profile language", undefined, "en", "English"],
    ["the organisation language over a profile language outside fr and en", "français", "en", "English"],
    ["French without either", undefined, undefined, "French"],
    ["French over an organisation language outside fr and en", undefined, "de", "French"],
  ])("should reply in %s", (_case, profileLanguage, orgLanguage, words) => {
    const person = identity({
      org: { ...ORG, brand: orgLanguage ? { language: orgLanguage } : {} },
      member: { role: "member", profile: profileLanguage ? { language: profileLanguage } : {} },
    })
    expect(personFacts(person).endsWith(` Reply in ${words} unless the user writes in another language.`)).toBe(true)
  })
})

// E05-S13 (AC-2, HN-E05S13-1) : les domaines restent dans la description de `context`, plus dans la ligne de faits.
describe("orgFacts", () => {
  it("should give the organisation alone, even with work domains", () => {
    expect(orgFacts(ORG)).toBe("Organisation: Acme Énergies.")
  })
})

describe.skipIf(!sqlConfigured)(portable("teamFacts (AC22)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  /** Claire : Ventes, qu'elle mène (son équipe par défaut), puis Support, que mène Paul. */
  const claireOf = (ref: ReferenceOrgSql) => ref.identityOf("claire", { teams: [ref.teamOf("ventes", "claire"), ref.teamOf("support", "claire")] })

  it("should give a line per team in the identity's order, with their lead's profile name", async () => {
    const ref = await seedO(oTables())
    const facts = await teamFacts(await ref.db("claire"), claireOf(ref))
    expect(facts).toEqual({ teams: ["Team Ventes. Lead: Claire Morel.", "Team Support. Lead: Paul Girard."], teamConnectors: [[], []], connectors: [] })
  })

  it("should leave out Lead: when the lead has no profile name", async () => {
    const tables = oTables()
    // Des profils sans nom ; le handle reste, que l'espace `private/<handle>` de chacun exige (`nodes_guard`).
    for (const lead of ["claire", "paul"] as const) {
      const member = tables.members.find((row) => row.org_id === O.id && row.user_id === PEOPLE[lead].id)
      if (member) member.profile = { handle: lead }
    }
    const ref = await seedO(tables)
    expect((await teamFacts(await ref.db("claire"), claireOf(ref))).teams).toEqual(["Team Ventes.", "Team Support."])
  })

  // E04-S01 N17 : sans équipe, les faits lisent encore les connecteurs actifs (aucun ici).
  it("should give no team line when the identity has none", async () => {
    const ref = await seedO(oTables())
    expect(await teamFacts(await ref.db("claire"), ref.identityOf("claire", { teams: [] }))).toEqual({ teams: [], teamConnectors: [], connectors: [] })
  })

  // E01-S07 AC20 : la base rend aussi à Léa, membre de P, les membres de P. Paul, responsable de Support, n'a de
  // nom de profil que dans P (son handle reste dans O, `nodes_guard`) : sans le filtre de l'organisation, ce nom
  // vient quel que soit l'ordre des lignes rendues, qu'aucune lecture ne fixe.
  it("should name the leads of the identity's teams in its organisation only, when the database holds members of another", async () => {
    const tables = oTables()
    const paul = tables.members.find((row) => row.org_id === O.id && row.user_id === PEOPLE.paul.id)
    if (paul) paul.profile = { handle: "paul" }
    tables.members.push({ org_id: OTHER_ORG.id, user_id: PEOPLE.paul.id, role: "member", default_team_id: null, profile: { name: "Paul d'ailleurs" } })
    const ref = await seedO(tables)
    expect((await teamFacts(await ref.db("lea"), leaOf(ref))).teams).toEqual(["Team Ventes. Lead: Claire Morel.", "Team Support."])
  })
})

describe.skipIf(!sqlConfigured)(portable("buildContext target (AC16, N31)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  /** O sans procédure : le routage ne trouve rien, et `orgs.settings` n'a pas de réglage (réglage par défaut). */
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    ref = await seedO(oTables())
  }, REAL_BASE_TIMEOUT)

  // Revue du cycle 1 : une moitié d'emoji en fin de cible faisait refuser tout le lot du journal.
  it("should journal the phrase cut at 200 characters, never inside an emoji", async () => {
    const phrase = `${"x".repeat(199)}😀 et la suite`
    const output = await buildContext(await ref.db("claire"), ref.identityOf("claire", { teams: [] }), { phrase }, { userAgent: null })
    expect(output.target).toBe("x".repeat(199))
  })

  // E03-S02, AC8 : sans étape servie, la cible est la phrase ; sans phrase, rien de routé.
  it("should serve no step and no candidate for an unmatched request, and null routing fields without a request (AC8)", async () => {
    const db = await ref.db("claire")
    const claire = ref.identityOf("claire", { teams: [] })
    const prefix = ref.org.prefix
    const unmatched = await buildContext(db, claire, { phrase: "donne-moi une recette de crêpes" }, { userAgent: null })
    expect(unmatched.data).toMatchObject({ served: null, candidates: [], data_question: false })
    expect(unmatched.target).toBe("donne-moi une recette de crêpes")
    // La question passe par `requestKind` jusqu'à la consigne « chercher et répondre » (banc, preuve 11).
    const question = "Combien de prospects avons-nous à Valbrune, et lesquels ?"
    const asked = await buildContext(db, claire, { phrase: question }, { userAgent: null })
    expect(asked.data).toMatchObject({ served: null, candidates: [], data_question: true })
    expect(routingLineOf(asked.text)).toBe(
      `Request « ${question} »: no procedure matches. It is a question: search with ${prefix}_find, ${prefix}_read or ${prefix}_call table.rows and answer it.`,
    )
    const none = await buildContext(db, claire, {}, { userAgent: null })
    expect(none.data).toEqual({ ctx: none.ctx, served: null, candidates: [], data_question: null })
  })
})

// ------------------------------------------------------------------------------------------ E03-S08

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Un horodatage `hours` heures avant maintenant : les fenêtres de 90 jours se comptent sur l'horloge. */
function ago(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

/** O et son contenu (E03-S03), plus les tables que lit E03-S08. */
function oTables(nodes: ContentNode[] = [], rules: RuleSpec[] = []): Tables {
  return { ...contentTables(rules, nodes), ctx: [], journal: [], connector_activations: [], node_aliases: [] }
}

/** Le bloc de niveau 2 du texte qui commence par `heading`, jusqu'au bloc de niveau 2 suivant. */
function section(text: string, heading: string): string | undefined {
  return text
    .split("\n\n## ")
    .map((part, index) => (index === 0 ? part : `## ${part}`))
    .find((part) => part.startsWith(heading))
}

/** Une version publiée (`node_versions`), comme `publish_node` l'écrit. */
function version(path: string, revision: number, title: string, at: string): Row {
  return { node_id: nodeId(path), revision, title, summary: `${title}.`, kind: "page", meta: {}, blocks: [], author: null, created_at: at }
}

let journalIds = 0

/** Une ligne de journal d'un appel d'outil de `person` (`<p>_read` sans erreur par défaut). */
function journalLine(person: Person, target: string, at: string, fields: Row = {}): Row {
  journalIds += 1
  return { id: journalIds, org_id: O.id, user_id: PEOPLE[person].id, team_id: null, method: "tools/call", tool: "acme_read", target, is_error: false, ts: at, ...fields }
}

/** Des blocs écrits par `person` à `at` (`blocks.updated_by`). */
function authored(tables: Tables, ids: string[], person: Person, at: string): void {
  for (const row of tables.blocks.filter((block) => ids.includes(String(block.id)))) Object.assign(row, { updated_by: PEOPLE[person].id, updated_at: at })
}

/** Léa, de Ventes (son équipe par défaut) et de Support. */
function leaOf(ref: ReferenceOrgSql): Identity {
  return ref.identityOf("lea", { teams: [ref.teamOf("ventes", "lea"), ref.teamOf("support", "lea")] })
}

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(portable("Contextes of the person (E03-S08, AC1)"), privatePending), { timeout: REAL_BASE_TIMEOUT }, () => {
  const RULE = `Règle : ${"chaque devis est relu avant envoi. ".repeat(28)}`.trim()
  const TEMPLATE = Array.from({ length: 10 }, (_, index) => `ligne ${index} du modèle de relance`).join("\n")
  const VENTES_HEAD = "## Context: team Ventes (ventes/contexte)\nTeam Ventes. Lead: Claire Morel."
  // E11-S03 (AC-b1) : plus de taille par partie, le Contexte de Ventes est servi entier, son bloc clôturé compris.
  const VENTES_WHOLE = `${VENTES_HEAD}\n### Règles\n\n${RULE}\n\n\`\`\`text\n${TEMPLATE}\n\`\`\``

  /** Les Contextes de O : publiés, un brouillon ouvert sur celui de Tout le monde, la racine publiée, un Contexte d'une équipe d'ailleurs. */
  function contextTables(rules: RuleSpec[] = [], space: Partial<ContentNode> = {}): Tables {
    const tables = oTables(
      [
        { path: "support/faq", title: "FAQ support", summary: "Réponses types." },
        { path: "private/lea/contexte", ...space },
        { path: "conseil", owner: { kind: "team", teamId: "team-conseil", userId: null } },
        { path: "conseil/contexte" },
      ],
      rules,
    )
    // Un Contexte n'existe qu'au chemin d'une équipe de l'organisation (`is_context_path`) : l'équipe Conseil, sans Léa.
    tables.teams.push({ id: "team-conseil", org_id: O.id, slug: "conseil", name: "Conseil", lead_user_id: null })
    addBlocks(tables, "guide", "published", [{ type: "paragraph", text: "Guide de l'organisation." }])
    addBlocks(tables, "contexte", "published", [
      { type: "heading", text: "Mission", data: { level: 1 } },
      { type: "paragraph", text: "Acme Test conçoit des opérations d'autoconsommation collective." },
      { type: "reference", data: { path: "support/faq" } },
      { type: "heading", text: "Règles", data: { level: 1 } },
      { type: "paragraph", text: "Aucun email n'est envoyé sans accord." },
    ])
    addBlocks(tables, "contexte", "draft", [{ type: "paragraph", text: "BROUILLON du contexte." }])
    openDraftRow(tables, "contexte", { title: "Titre en attente" })
    addBlocks(tables, "private/lea/contexte", "published", [
      { type: "heading", text: "Ton", data: { level: 1 } },
      { type: "paragraph", text: "Tutoiement, phrases courtes." },
      // E10-S04 (AC-b3) : sous `headingBase` 3, les niveaux 4 et 5 rendent six # au plus.
      { type: "heading", text: "Détail", data: { level: 4 } },
      { type: "heading", text: "Précision", data: { level: 5 } },
    ])
    addBlocks(tables, "ventes/contexte", "published", [
      { type: "heading", text: "Règles", data: { level: 1 } },
      { type: "paragraph", text: RULE },
      { type: "code", text: TEMPLATE, data: { language: "text" } },
    ])
    addBlocks(tables, "support/contexte", "published", [{ type: "paragraph", text: "Répondre sous 24 h ouvrées." }])
    addBlocks(tables, "conseil/contexte", "published", [{ type: "paragraph", text: "Réservé au Conseil." }])
    return tables
  }

  it("should serve everyone's, the personal, the default team's then the other team's published blocks, whole (AC1 ; E11-S03, AC-b1)", async () => {
    const ref = await seedO(contextTables())
    const lea = leaOf(ref)
    const { text } = await buildContext(await ref.db("lea"), lea, {}, { userAgent: null })
    const start = text.indexOf("## Context: ")
    // E05-S12 (AC-1) : chaque partie s'ouvre par sa ligne de faits ; plus aucun bloc personne, organisation ni équipe.
    expect(text.slice(0, start).endsWith(`${routingLineOf(text)}\n\n`)).toBe(true)
    expect(text.slice(start, text.indexOf("\n\n## What's new"))).toBe(
      [
        `## Context: everyone (contexte)\n${orgFacts(lea.org)}\n### Mission\n\nAcme Test conçoit des opérations d'autoconsommation collective.\n\n→ page: FAQ support — Réponses types. (support/faq)\n\n### Règles\n\nAucun email n'est envoyé sans accord.`,
        `## Context: you only (private/lea/contexte)\n${personFacts(lea)}\n### Ton\n\nTutoiement, phrases courtes.\n\n###### Détail\n\n###### Précision`,
        VENTES_WHOLE,
        "## Context: team Support (support/contexte)\nTeam Support. Lead: Paul Girard.\nRépondre sous 24 h ouvrées.",
      ].join("\n\n"),
    )
    for (const hidden of ["BROUILLON", "Titre en attente", "Guide de l'organisation", "conseil/contexte", "Réservé au Conseil", "Read the rest"]) {
      expect(text).not.toContain(hidden)
    }

    // Jamais publié (révision 0), ou illisible (règle `none` : niveau 0 calculé, la base rend le nœud) : la partie
    // garde son en-tête et ses faits, sans corps (E05-S12, AC-3).
    const hidden = await seedO(contextTables([{ node: "support/contexte", user: "lea", level: "none" }], { status: "draft", revision: 0 }))
    const hiddenLea = leaOf(hidden)
    const served = (await buildContext(await hidden.db("lea"), hiddenLea, {}, { userAgent: null })).text
    expect(section(served, "## Context: you only")).toBe(`## Context: you only (private/lea/contexte)\n${personFacts(hiddenLea)}`)
    expect(section(served, "## Context: team Support")).toBe("## Context: team Support (support/contexte)\nTeam Support. Lead: Paul Girard.")

    // Plus de blocs publiés qu'une lecture n'en rend (`supabase-patterns.md § Error Handling`) : le premier
    // par position a l'id le plus grand, il n'arrive qu'en seconde page.
    const paged = oTables()
    addBlocks(paged, "contexte", "published", Array.from({ length: 1001 }, (_, index) => ({ id: blockUuid(0x30000 + 1000 - index), type: "paragraph" as const, text: `Bloc ${index}.` })))
    const many = await seedO(paged, orderedIds(paged.blocks.map((block) => String(block.id))))
    const everyone = section((await buildContext(await many.db("lea"), leaOf(many), {}, { userAgent: null })).text, "## Context: everyone")
    expect(everyone?.split("\n").slice(0, 5)).toEqual(["## Context: everyone (contexte)", orgFacts(leaOf(many).org), "Bloc 0.", "", "Bloc 1."])
  })
})

/** Nœuds de O que Léa lit, un par ligne des nouveautés après « annonces » et « ventes/devis » (E11-S16, AC-b1). */
const NEWS_NODES = ["guide", "contexte", "ventes", "ventes/contexte", "ventes/devis/modele", "ventes/x", "ventes/x/y"]

describe.skipIf(!sqlConfigured)(portable("what's new (E03-S08, AC2, AC3)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should list the last visible version of each node and the activations since the previous ctx in this organisation, most recent first, 10 lines counted after the filter (AC2 ; E11-S16, AC-b1)", async () => {
    const tables = oTables()
    tables.ctx.push(
      { code: "AAAA-0001", org_id: O.id, user_id: PEOPLE.lea.id, created_at: "2026-09-20T10:00:00.000Z" },
      { code: "AAAA-0002", org_id: OTHER_ORG.id, user_id: PEOPLE.lea.id, created_at: "2026-09-24T09:00:00.000Z" },
      { code: "AAAA-0003", org_id: O.id, user_id: PEOPLE.claire.id, created_at: "2026-09-24T09:00:00.000Z" },
    )
    tables.node_versions.push(
      // La plus récente, mais illisible de Léa : elle ne prend pas une des 10 lignes.
      version("support/faq", 3, "FAQ révisée", "2026-09-24T11:00:00.000Z"),
      // Huit versions d'un même nœud : une ligne, la dernière (E11-S16, AC-b1).
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((revision) => version("annonces", revision, `Annonce ${revision}`, `2026-09-23T0${revision - 1}:00:00.000Z`)),
      version("ventes/devis", 2, "Devis révisé", "2026-09-22T09:00:00.000Z"),
      // Sept autres nœuds lus de Léa : les lignes 4 à 10.
      ...NEWS_NODES.map((path, rank) => version(path, 2, `Révision ${rank}`, `2026-09-22T0${8 - rank}:00:00.000Z`)),
      version("annonces", 1, "Annonce 1", "2026-09-21T10:00:00.000Z"),
      // Onzième nœud : au-delà des 10 lignes.
      version("ventes/tarifs", 2, "Tarifs révisés", "2026-09-21T09:00:00.000Z"),
      version("ventes/tarifs", 1, "Tarifs", "2026-09-19T09:00:00.000Z"),
      // Sur la base réelle, la requête ne se lit plus : une page de versions de P, plus récentes que celles
      // de O et que Léa, membre de P, lit sous l'isolation, remplirait la lecture sans le filtre de l'organisation.
      ...Array.from({ length: READ_PAGE_ROWS }, (_, index) => ({ ...version("ventes", 5 + index, "Ailleurs", "2026-09-24T10:30:00.000Z"), node_id: OTHER_ORG.node.id })),
    )
    const activation = (orgId: string, connector: string, state: string, at: string) => ({ org_id: orgId, connector, state, created_at: "2026-09-01T00:00:00.000Z", updated_at: at })
    // Des connecteurs de `platform.connectors` (clés étrangères) : `notion`, activé avant la borne, est désactivé plus
    // bas, après elle.
    tables.connector_activations.push(
      activation(O.id, "mail", "active", "2026-09-24T12:00:00.000Z"),
      activation(O.id, "notion", "active", "2026-09-18T12:00:00.000Z"),
      activation(OTHER_ORG.id, "mail", "active", "2026-09-24T13:00:00.000Z"),
    )
    const ref = await seedO(tables)

    // La borne est lue avant l'émission du code : lue après, elle serait la date du code émis.
    const { text } = await buildContext(await ref.db("lea"), ref.identityOf("lea"), {}, { userAgent: null })
    expect(section(text, "## What's new")).toBe(
      [
        "## What's new since 2026-09-20",
        "- Connector mail activated (2026-09-24)",
        "- annonces v9 (2026-09-23): Annonce 9",
        "- ventes/devis v2 (2026-09-22): Devis révisé",
        ...NEWS_NODES.map((path, rank) => `- ${path} v2 (2026-09-22): Révision ${rank}`),
      ].join("\n"),
    )
    // Désactivé après la borne du code émis à l'instant : une activation inactive n'est pas une nouveauté.
    await theSeed().admin`update platform.connector_activations set state = 'inactive' where org_id = ${ref.org.id} and connector = 'notion'`
    const after = await buildContext(await ref.db("lea"), ref.identityOf("lea"), {}, { userAgent: null })
    expect(after.text).not.toContain("Connector notion")

    // Sans `ctx` antérieur : depuis 14 jours ; rien → « Nothing new. ». La session s'ouvre avant l'horloge figée.
    const empty = await seedO(oTables())
    const db = await empty.db("marc")
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-25T08:00:00.000Z"))
    const first = await buildContext(db, empty.identityOf("marc"), {}, { userAgent: null })
    expect(section(first.text, "## What's new")).toBe("## What's new since 2026-09-11\nNothing new.")
  })

  it("should serve a page published yesterday at the next conversation, then no more (AC3)", async () => {
    const yesterday = ago(24)
    const tables = oTables()
    tables.node_versions.push(version("ventes/devis", 2, "Devis révisé", yesterday))
    const ref = await seedO(tables)
    const db = await ref.db("claire")

    const first = await buildContext(db, ref.identityOf("claire"), {}, { userAgent: null })
    expect(section(first.text, "## What's new")?.split("\n")[1]).toBe(`- ventes/devis v2 (${day(yesterday)}): Devis révisé`)
    // La conversation suivante, le même jour : rien de nouveau depuis aujourd'hui, aucun bloc (fiche D99, M53).
    const next = await buildContext(db, ref.identityOf("claire"), {}, { userAgent: null })
    expect(section(next.text, "## What's new")).toBeUndefined()
    // Une nouveauté de la journée reste servie sous une borne du jour même.
    const today = new Date().toISOString()
    expect(newsBlock([{ at: today, line: "- ventes/devis v3" }], today)?.text).toBe(`## What's new since ${day(today)}\n- ventes/devis v3`)
  })
})

describe.skipIf(!sqlConfigured)(portable("procedures you can run (E03-S08, AC4)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  const PROCEDURES: ContentNode[] = [
    { path: "ventes/relance", kind: "procedure", summary: "Relance les devis en attente." },
    { path: "ventes/qualifier", kind: "procedure", summary: "Qualifie les prospects." },
    { path: "ventes/point", kind: "procedure", summary: "Fait le point sur le pipeline." },
    { path: "ventes/brouillon", kind: "procedure", summary: "Jamais publiée.", status: "draft", revision: 0 },
    { path: "support/ticket", kind: "procedure", summary: "Répond à un ticket." },
    { path: "annonces/lire", kind: "procedure", summary: "Lit les annonces." },
  ]
  const lines = (count: number, make: () => Row) => Array.from({ length: count }, make)

  it("should list the visible published procedures by their published summary, by the usage over 90 days the person may count, then by path (AC4)", async () => {
    const tables = oTables(PROCEDURES)
    openDraftRow(tables, "ventes/point", { summary: "Résumé en attente." })
    // Sur la base réelle, Claire membre de P : ses lignes de P lui reviennent sous l'isolation, le service les écarte.
    tables.members.push({ org_id: OTHER_ORG.id, user_id: PEOPLE.claire.id, role: "member", default_team_id: null, profile: { name: PEOPLE.claire.name, handle: "claire" } })
    const ventes = { team_id: TEAMS.ventes.id }
    // Aux bords de la fenêtre de 90 jours : une ligne de 89 jours compte, une de 91 jours non.
    const inside = ago(24 * 89)
    const outside = ago(24 * 91)
    tables.journal.push(
      ...lines(4, () => journalLine("claire", "ventes/point", ago(24), ventes)),
      ...lines(3, () => journalLine("lea", "ventes/relance", inside, ventes)),
      journalLine("lea", "ventes/qualifier", ago(48), ventes),
      ...lines(5, () => journalLine("paul", "annonces/lire", ago(24), { team_id: TEAMS.support.id })),
      // Comptées, elles mettraient qualifier (4) devant relance (3) dans l'ordre de Claire.
      ...lines(3, () => journalLine("claire", "ventes/qualifier", outside, ventes)),
      ...lines(6, () => journalLine("claire", "ventes/qualifier", ago(24), { org_id: OTHER_ORG.id })),
      ...lines(2, () => journalLine("ada", "ventes/relance", ago(24))),
    )
    const ref = await seedO(tables)
    const summaries = {
      point: "- ventes/point: Fait le point sur le pipeline.",
      relance: "- ventes/relance: Relance les devis en attente.",
      qualifier: "- ventes/qualifier: Qualifie les prospects.",
      lire: "- annonces/lire: Lit les annonces.",
      ticket: "- support/ticket: Répond à un ticket.",
    }

    // Claire mène Ventes : ses lignes et celles de Ventes comptent (H74, N3).
    expect((await proceduresBlock(await ref.db("claire"), ref.identityOf("claire"))).text).toBe(
      ["## Procedures you can run, most used first (4)", summaries.point, summaries.relance, summaries.qualifier, summaries.lire].join("\n"),
    )
    // Léa, simple membre : ses seules lignes.
    expect((await proceduresBlock(await ref.db("lea"), ref.identityOf("lea"))).text).toBe(
      ["## Procedures you can run, most used first (4)", summaries.relance, summaries.qualifier, summaries.lire, summaries.point].join("\n"),
    )
    // Ada, administratrice et simple membre de Ventes : ses lignes et toutes celles de ses équipes (isOrgAdmin).
    expect((await proceduresBlock(await ref.db("ada"), ref.identityOf("ada", { teams: [ref.teamOf("ventes", "ada")] }))).text).toBe(
      ["## Procedures you can run, most used first (5)", summaries.relance, summaries.point, summaries.qualifier, summaries.lire, summaries.ticket].join("\n"),
    )
    const empty = await seedO(oTables())
    expect((await proceduresBlock(await empty.db("marc"), empty.identityOf("marc"))).text).toBe("## Procedures you can run, most used first (0)\nNone published yet.")
  })
})

describe.skipIf(!sqlConfigured)(portable("recent content (E03-S08, AC5 ; E05-S12, AC-20)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should list the pages and tables the person read, wrote or published over 90 days, dated by their latest source, never a procedure, a Contexte, the root, a node she only created or an unreadable node (AC5)", async () => {
    const tables = oTables([
      { path: "ventes/suivi", kind: "table", title: "Suivi des prospects" },
      { path: "ventes/relance", kind: "procedure", title: "Relancer" },
      { path: "ventes/devis", title: "Devis" },
      { path: "ventes/devis/modele", title: "Modèle de devis" },
      { path: "ventes/tarifs", title: "Tarifs 2026" },
      { path: "ventes/x", title: "Notes de Léa" },
      // Des pages qu'elle lit, chacune n'ayant qu'une source, datée de 91 jours : jamais listées.
      { path: "annonces/lue", title: "Lue il y a 91 jours" },
      { path: "annonces/ecrite", title: "Écrite il y a 91 jours" },
      { path: "annonces/publiee", title: "Publiée il y a 91 jours" },
      // Son dossier personnel, posé par déclencheur à son nom, jamais publié : pas un document.
      { path: "private/lea", status: "draft", revision: 0 },
      // Une page qu'elle lit, lue, écrite et publiée par Claire seule (voir plus bas).
      { path: "annonces/de_claire", title: "Page de Claire" },
    ])
    const at = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 30].map((hours) => [hours, ago(hours)]))
    // Aux bords de la fenêtre de 90 jours : une source de 89 jours compte, une de 91 jours non.
    const inside = ago(24 * 89)
    const outside = ago(24 * 91)
    const write = { tool: "acme_write" }
    tables.journal.push(
      journalLine("lea", "ventes/devis", at[30]),
      journalLine("lea", "ventes/devis/modele", at[20], write),
      journalLine("lea", "support/faq", at[10]),
      journalLine("lea", "journal", at[9]),
      journalLine("lea", "ventes/relance", at[8]),
      journalLine("lea", "contexte", at[7]),
      journalLine("lea", "guide", at[6]),
      journalLine("lea", "ventes/tarifs", at[5], { is_error: true }),
      journalLine("lea", "table.rows", at[4], { tool: "acme_call" }),
      journalLine("claire", "ventes/zone", at[3]),
      journalLine("lea", "annonces/lue", outside),
    )
    authored(tables, addBlocks(tables, "ventes/suivi", "published", [{ type: "row", key: "P-1", data: { ville: "Valbrune" } }]), "lea", at[2])
    authored(tables, addBlocks(tables, "ventes/x", "draft", [{ type: "paragraph", text: "Brouillon de Léa." }]), "lea", at[12])
    authored(tables, addBlocks(tables, "ventes/relance", "published", [{ type: "paragraph", text: "Étape." }]), "lea", at[1])
    authored(tables, addBlocks(tables, "annonces/ecrite", "draft", [{ type: "paragraph", text: "Écrit il y a longtemps." }]), "lea", outside)
    // Un bloc `draft` ne se lit que sous le brouillon ouvert de son nœud (`blocks_select_level`) : ceux-ci ont le leur.
    for (const path of ["ventes/x", "annonces/ecrite"]) openDraftRow(tables, path)
    for (const [path, updated] of [["ventes/tarifs", inside], ["annonces/publiee", outside], ["guide", at[1]], ["private/lea", at[1]]]) {
      Object.assign(tables.nodes.find((row) => row.id === nodeId(path)) ?? {}, { updated_by: PEOPLE.lea.id, updated_at: updated })
    }
    // Sur la base réelle, la requête ne se lit plus : la page de Claire, que Léa lit, a les trois sources de
    // Claire, plus récentes que chaque document de la liste de Léa ; une source que le service ne filtrerait
    // pas par la personne la mettrait en tête.
    tables.journal.push(journalLine("claire", "annonces/de_claire", at[1]))
    authored(tables, addBlocks(tables, "annonces/de_claire", "published", [{ type: "paragraph", text: "Écrit par Claire." }]), "claire", at[1])
    Object.assign(tables.nodes.find((row) => row.id === nodeId("annonces/de_claire")) ?? {}, { updated_by: PEOPLE.claire.id, updated_at: at[1] })
    const ref = await seedO(tables)

    const block = await recentBlock(await ref.db("lea"), ref.identityOf("lea"))
    expect(block?.text).toBe(
      [
        "## Recent content",
        `- ventes/suivi (table, ${day(at[2])}): Suivi des prospects`,
        `- ventes/x (page, ${day(at[12])}): Notes de Léa`,
        `- ventes/devis/modele (page, ${day(at[20])}): Modèle de devis`,
        `- ventes/devis (page, ${day(at[30])}): Devis`,
        `- ventes/tarifs (page, ${day(inside)}): Tarifs 2026`,
      ].join("\n"),
    )
    const empty = await seedO(oTables())
    expect(await recentBlock(await empty.db("marc"), empty.identityOf("marc"))).toBeNull()
  })
})

// E11-S03 (AC-b1, HN-E11S03-15, fiche D134) : plus de taille par bloc ; les bornes en lignes restent, et un arrêt se dit.
describe.skipIf(!sqlConfigured)(portable("the dynamic blocks served whole (E03-S08, AC6 ; E11-S03, AC-b1)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should serve what's new and recent documents whole, and the procedures up to 60 lines, the first 15 by summary, then by title, with a last line counting the others", async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      at: `2026-09-23T0${9 - index}:00:00.000Z`,
      line: `- annonces v${10 - index} (2026-09-23): ${"Une annonce au titre long ".repeat(3)}${10 - index}`,
    }))
    const news = newsBlock(items, "2026-09-20T10:00:00.000Z")
    const newsLines = ["## What's new since 2026-09-20", ...items.map((item) => item.line)]
    // Plus longues que l'ancienne taille de 600 : entières.
    expect(news).toEqual({ name: "news", text: newsLines.join("\n") })
    expect(news?.text.length).toBeGreaterThan(600)

    const procedure = (index: number, summary: string): ContentNode => ({ path: `annonces/p${String(index).padStart(2, "0")}`, kind: "procedure", title: `Procédure ${index}`, summary })
    const long = Array.from({ length: 70 }, (_, index) => procedure(index, `Procédure ${index} : ${"étape détaillée ".repeat(9)}`.trim()))
    const longRef = await seedO(oTables(long))
    const procedures = await proceduresBlock(await longRef.db("marc"), longRef.identityOf("marc"))
    const lines = procedures.text.split("\n")
    expect(procedures.cut).toBe(true)
    // 60 lignes, puis celle qui compte les autres ; les 15 premières par leur résumé, les suivantes par leur titre (E11-S16).
    expect(lines[0]).toBe("## Procedures you can run, most used first (70)")
    expect(lines.slice(1, -1)).toEqual(long.slice(0, 60).map((node, rank) => `- ${node.path}: ${rank < 15 ? node.summary : node.title}`))
    expect(lines.at(-1)).toBe(`… and 10 more: find them with ${longRef.org.prefix}_find, type procedure.`)
    // Plus de procédures qu'une lecture n'en rend (`supabase-patterns.md § Error Handling`) : toutes comptées.
    const short = Array.from({ length: 1005 }, (_, index) => procedure(index, `Procédure ${index}.`))
    const shortRef = await seedO(oTables(short))
    const capped = (await proceduresBlock(await shortRef.db("marc"), shortRef.identityOf("marc"))).text.split("\n")
    expect(capped.length).toBe(62)
    expect([capped[0], capped.at(-1)]).toEqual(["## Procedures you can run, most used first (1005)", `… and 945 more: find them with ${shortRef.org.prefix}_find, type procedure.`])

    const documents = Array.from({ length: 20 }, (_, index): ContentNode => ({ path: `annonces/doc${String(index).padStart(2, "0")}`, title: `${"Un document au titre long ".repeat(4)}${index}` }))
    const updated = documents.map((_, index) => ago(index + 1))
    const tables = oTables(documents)
    documents.forEach((document, index) => {
      Object.assign(tables.nodes.find((row) => row.id === nodeId(document.path)) ?? {}, { updated_by: PEOPLE.marc.id, updated_at: updated[index] })
    })
    const documentsRef = await seedO(tables)
    const recent = await recentBlock(await documentsRef.db("marc"), documentsRef.identityOf("marc"))
    const recentLines = ["## Recent content", ...documents.map((document, index) => `- ${document.path} (page, ${day(updated[index])}): ${document.title}`)]
    // Plus longs que l'ancienne taille de 1 400 : entiers.
    expect(recent).toEqual({ name: "recent content", text: recentLines.join("\n") })
    expect(recent?.text.length).toBeGreaterThan(1_400)
  })
})

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(portable("previewContext (E03-S08, AC8)"), privatePending), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should render the text context would serve at the same instant, with the size, state and Contexte path of each block, writing nothing", async () => {
    const tables = oTables([
      { path: "private/lea/contexte" },
      { path: "ventes/relance", kind: "procedure", title: "Relancer les devis", summary: "Relance les devis en attente." },
    ])
    addBlocks(tables, "contexte", "published", [{ type: "paragraph", text: "Acme Test conçoit des opérations." }])
    addBlocks(tables, "ventes/contexte", "published", [{ type: "paragraph", text: `${"Une règle de Ventes. ".repeat(40)}\n${"Une autre règle. ".repeat(40)}` }])
    // Des étapes plus longues que le plafond (35 000, E11-S03) : la procédure servie cède la place à son pointeur.
    addBlocks(tables, "ventes/relance", "published", [{ type: "paragraph", text: "Étape. ".repeat(6000) }])
    tables.ctx.push({ code: "AAAA-0001", org_id: O.id, user_id: PEOPLE.lea.id, created_at: "2026-09-20T10:00:00.000Z" })
    // Le vrai routage (`route_candidates`) sert la procédure : son résumé porte la demande mot pour mot.
    const ref = await seedO(tables)
    const db = await ref.db("lea")
    const lea = leaOf(ref)
    const phrase = "relance les devis"
    /** Ce que `context` écrit : un code par conversation (`ctx`) et, par sa porte, le journal. */
    const written = async () =>
      (await theSeed().admin<{ ctx: number; journal: number }[]>`
        select (select count(*)::int from platform.ctx where org_id = ${ref.org.id}) as ctx,
               (select count(*)::int from platform.journal where org_id = ${ref.org.id}) as journal`)[0]
    const before = await written()

    const preview = await previewContext(db, lea, { phrase })
    expect(await written()).toEqual(before)
    const built = await buildContext(db, lea, { phrase }, { userAgent: null })
    expect(preview.text).toBe(built.text.replace(/^ctx: \S+/, "ctx: XXXX-XXXX"))
    expect({ budget: preview.budget, served: preview.served, candidates: preview.candidates }).toEqual({
      budget: CONTEXT_BUDGET,
      served: built.data?.served,
      candidates: built.data?.candidates,
    })
    // E05-S12 (AC-4) : une partie par Contexte, nommée par son chemin, `path` seulement quand son corps est servi.
    expect(preview.blocks.map(({ name, status, path }) => [name, status, path])).toEqual([
      ["code", "full", null],
      ["procedure", "replaced", null],
      ["related", "full", null],
      ["contexte", "full", "contexte"],
      ["private/lea/contexte", "full", null],
      // Plus de taille par partie (E11-S03, AC-b1) : le Contexte de Ventes, plus long que l'ancienne, entier.
      ["ventes/contexte", "full", "ventes/contexte"],
      ["support/contexte", "full", null],
      ["news", "full", null],
      ["procedures", "full", null],
    ])
    const included = preview.blocks.filter((block) => block.chars > 0)
    expect(included.reduce((sum, block) => sum + block.chars, 0) + 2 * (included.length - 1)).toBe(preview.text.length)
    const ventes = preview.blocks.find((block) => block.name === "ventes/contexte")
    const ventesText = section(preview.text, "## Context: team Ventes") ?? ""
    const ventesHead = "## Context: team Ventes (ventes/contexte)\nTeam Ventes. Lead: Claire Morel."
    expect([ventes?.chars, ventes?.head, ventesText]).toEqual([ventesText.length, ventesHead.length, `${ventesHead}\n${"Une règle de Ventes. ".repeat(40)}\n${"Une autre règle. ".repeat(40)}`])
  })
})

describe.skipIf(!sqlConfigured)(portable("filtering by the service (E03-S08, AC9)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should serve Paul no ventes/ path in any block, from nodes, versions, blocks, links and journal lines the database returns", async () => {
    const tables = oTables([
      { path: "contexte/offres", owner: { kind: "team", teamId: TEAMS.ventes.id, userId: null }, title: "Offres de Ventes" },
      { path: "ventes/relance", kind: "procedure", summary: "Relance les devis." },
      { path: "support/ticket", kind: "procedure", summary: "Répond à un ticket." },
    ])
    const [paragraph] = addBlocks(tables, "contexte", "published", [{ type: "paragraph", text: "Les pages utiles sont liées ci-dessous." }])
    addBlocks(tables, "ventes/contexte", "published", [{ type: "paragraph", text: "Règles de Ventes." }])
    let linkId = 0
    for (const path of ["ventes/devis", "support/faq"]) {
      linkId += 1
      tables.links.push({ id: linkId, org_id: O.id, source_node_id: nodeId("contexte"), source_block_id: paragraph, target_path: path, target_key: null, target_node_id: nodeId(path) })
    }
    const faqAt = ago(3)
    tables.ctx.push({ code: "AAAA-0001", org_id: O.id, user_id: PEOPLE.paul.id, created_at: ago(24 * 5) })
    tables.node_versions.push(version("ventes/devis", 2, "Devis révisé", ago(2)), version("support/faq", 2, "FAQ révisée", faqAt))
    tables.journal.push(
      ...Array.from({ length: 3 }, () => journalLine("paul", "ventes/relance", ago(5), { team_id: TEAMS.support.id })),
      journalLine("paul", "ventes/tarifs", ago(6)),
      journalLine("claire", "ventes/devis", ago(1), { team_id: TEAMS.ventes.id }),
    )
    authored(tables, addBlocks(tables, "ventes/devis", "published", [{ type: "paragraph", text: "Écrit par Paul." }]), "paul", ago(4))
    Object.assign(tables.nodes.find((row) => row.id === nodeId("ventes/tarifs")) ?? {}, { updated_by: PEOPLE.paul.id, updated_at: ago(7) })
    const ref = await seedO(tables)
    const db = await ref.db("paul")
    const paul = ref.identityOf("paul")

    // L'aperçu d'abord : il n'émet aucun code, et le code que `context` émet ferait la borne des nouveautés suivantes.
    const preview = (await previewContext(db, paul, {})).text
    const built = (await buildContext(db, paul, {}, { userAgent: null })).text
    for (const text of [built, preview]) {
      expect(text).not.toMatch(/ventes\//)
      expect(text).not.toContain("contexte/offres")
      expect(section(text, "## Context: everyone")).toBe(
        `## Context: everyone (contexte)\n${orgFacts(paul.org)}\nLes pages utiles sont liées ci-dessous.\n\nLinked pages:\n- support/faq — support/faq — Summary of support/faq.`,
      )
      expect(section(text, "## What's new")?.split("\n").slice(1)).toEqual([`- support/faq v2 (${day(faqAt)}): FAQ révisée`])
      expect(section(text, "## Procedures you can run, most used first")).toBe("## Procedures you can run, most used first (1)\n- support/ticket: Répond à un ticket.")
    }
  })
})

describe.skipIf(!sqlConfigured)(portable("acme_context through MCP (E03-S08, AC10)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  it("should serve the Contextes in the text, the same text in both channels, and only the fields of E03-S01 and E03-S02", async () => {
    const tables = oTables()
    addBlocks(tables, "contexte", "published", [{ type: "paragraph", text: "Acme Test conçoit des opérations." }])
    const ref = await seedO(tables)
    const lea = leaOf(ref)
    const deps = { db: await ref.db("lea"), org: lea.org, caller: { kind: "member" as const, identity: lea }, userAgent: "unit-test", journal: [], origin: "https://acme.test" }
    const session = await connectDeps({ ...deps, activeConnectors: () => Promise.resolve(new Set<string>()) })

    const { text, result, isError } = await session.call("context", { phrase: "bonjour" })
    expect(isError).toBe(false)
    expect(section(text, "## Context: everyone")).toBe(`## Context: everyone (contexte)\n${orgFacts(lea.org)}\nAcme Test conçoit des opérations.`)
    const code = /^ctx: (\S+)/.exec(text)?.[1]
    expect(result.structuredContent).toEqual({ ctx: code, text, next_actions: [], served: null, candidates: [], data_question: false })
    expect(session.journal).toEqual([
      expect.objectContaining({ method: "tools/call", tool: `${ref.org.prefix}_context`, target: "bonjour", ctx: code, result_chars: text.length }),
    ])
  })
})

describe.skipIf(!sqlConfigured)(portable("pages, tables and linked pages of a Contexte (E03-S08, AC12)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  function link(tables: Tables, block: string, path: string, target: string | null): void {
    tables.links.push({ id: tables.links.length + 1, org_id: O.id, source_node_id: nodeId("contexte"), source_block_id: block, target_path: path, target_key: null, target_node_id: target })
  }

  // E05-S12 (D110 b) : ses procédures aussi, sous « Pages, tables and procedures here: ».
  it("should list its readable published pages, tables and procedures, then the readable targets of its links by current path, once each, 20 lines at most then the pointer to read", async () => {
    const tables = oTables([
      { path: "contexte/tarifs", title: "Tarifs 2026", summary: "Les tarifs des études." },
      { path: "contexte/equipe", kind: "table", title: "Équipe", summary: "Qui fait quoi." },
      { path: "contexte/notes", status: "draft", revision: 0 },
      { path: "contexte/accueil", kind: "procedure" },
      { path: "contexte/offres", owner: { kind: "team", teamId: TEAMS.ventes.id, userId: null } },
      { path: "support/faq", title: "FAQ support", summary: "Réponses types." },
      { path: "ventes/modele_relance" },
      { path: "support/delais", title: "Délais", summary: "Délais de réponse." },
      { path: "support/faq_clients", title: "FAQ clients", summary: "Questions des clients." },
    ])
    tables.node_aliases.push({ org_id: O.id, old_path: "support/ancienne_faq", node_id: nodeId("support/faq_clients") })
    const [first, reference, second] = addBlocks(tables, "contexte", "published", [
      { type: "paragraph", text: "Voir [[support/faq]], [[ventes/modele_relance]] et [[contexte/tarifs]]." },
      { type: "reference", data: { path: "support/delais" } },
      { type: "paragraph", text: "Aussi [[support/absente]], [[support/ancienne_faq]] et [[support/faq]]." },
    ])
    // Plus de liens qu'une lecture n'en rend (`supabase-patterns.md § Error Handling`) : les suivants n'arrivent
    // qu'en seconde page (la base numérote les liens dans l'ordre où la graine les écrit).
    for (let rank = 0; rank < 1000; rank += 1) link(tables, first, "support/absente", null)
    // Un bloc ne cite un chemin qu'une fois par clé (`links_source_target_key`) : chacun de ces liens a la sienne.
    tables.links.forEach((row, rank) => Object.assign(row, { target_key: `k${rank}` }))
    link(tables, first, "support/faq", nodeId("support/faq"))
    link(tables, first, "ventes/modele_relance", null)
    link(tables, first, "contexte/tarifs", nodeId("contexte/tarifs"))
    link(tables, reference, "support/delais", null)
    link(tables, second, "support/absente", null)
    link(tables, second, "support/ancienne_faq", null)
    link(tables, second, "support/faq", nodeId("support/faq"))
    // Une page jamais publiée n'est pas une page liée (N9).
    link(tables, second, "contexte/notes", nodeId("contexte/notes"))
    const ref = await seedO(tables)

    const contexte = section((await buildContext(await ref.db("paul"), ref.identityOf("paul"), {}, { userAgent: null })).text, "## Context: everyone")
    expect(contexte?.slice(contexte.indexOf("\n\nPages, tables and procedures here:") + 2)).toBe(
      [
        "Pages, tables and procedures here:",
        "- contexte/accueil — contexte/accueil — Summary of contexte/accueil.",
        "- contexte/equipe — Équipe — Qui fait quoi.",
        "- contexte/tarifs — Tarifs 2026 — Les tarifs des études.",
        "Linked pages:",
        "- support/delais — Délais — Délais de réponse.",
        "- support/faq — FAQ support — Réponses types.",
        "- support/faq_clients — FAQ clients — Questions des clients.",
      ].join("\n"),
    )

    // 22 enfants lisibles et un lien vers une page qu'il lit : les 20 lignes sont des enfants, pas de titre
    // pour la liste vide, et le pointeur dit la coupe (N20) ; avant eux par id, 1 000 enfants de Ventes
    // qu'il ne lit pas : les lisibles n'arrivent qu'en seconde page.
    const hidden = Array.from({ length: 1000 }, (_, index): ContentNode => ({ path: `contexte/a${String(index).padStart(3, "0")}`, owner: { kind: "team", teamId: TEAMS.ventes.id, userId: null } }))
    const crowded = oTables([...hidden, ...Array.from({ length: 22 }, (_, index) => ({ path: `contexte/c${String(index).padStart(2, "0")}` }))])
    const [many] = addBlocks(crowded, "contexte", "published", [{ type: "paragraph", text: "Beaucoup de pages, et [[support/faq]]." }])
    link(crowded, many, "support/faq", nodeId("support/faq"))
    const crowdedRef = await seedO(crowded)
    // La base réelle tire les identifiants au hasard : les 22 lisibles en reçoivent un qui suit ceux de Ventes
    // (`ffffffff-ffff-…`) ; aucune ligne ne vise ces nœuds.
    await theSeed().admin`
      update platform.nodes set id = ('ffffffff-ffff-4fff-bfff-' || substr(md5(id::text || random()::text), 1, 12))::uuid
       where org_id = ${crowdedRef.org.id} and path like 'contexte/c%'`
    const listed = section((await buildContext(await crowdedRef.db("paul"), crowdedRef.identityOf("paul"), {}, { userAgent: null })).text, "## Context: everyone")?.split("\n") ?? []
    expect(listed.slice(4)).toEqual([
      "Pages, tables and procedures here:",
      ...Array.from({ length: 20 }, (_, index) => `- contexte/c${String(index).padStart(2, "0")} — contexte/c${String(index).padStart(2, "0")} — Summary of contexte/c${String(index).padStart(2, "0")}.`),
      // E11-S03 (AC-b2) : le pointeur dit l'arrêt des listes.
      `Only the first 20 entries are listed. Read the rest: ${crowdedRef.org.prefix}_read {"path": "contexte"}.`,
    ])
  })
})

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(portable("failures (E03-S08, AC13)"), privatePending), { timeout: REAL_BASE_TIMEOUT }, () => {
  /** Une lecture en panne, rendue comme le module la rend : `fromDatabaseError` n'en garde jamais le message. */
  const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout on platform.links" }
  const failure = (context: string) => () => Promise.reject(fromDatabaseError(TIMEOUT, context))

  it("should replace the Contextes by their header and a pointer, omit a dynamic block whose read fails, log it, and still serve the ctx", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const tables = oTables([{ path: "private/lea/contexte" }, { path: "annonces/lire", kind: "procedure", summary: "Lit les annonces." }])
    addBlocks(tables, "contexte", "published", [{ type: "paragraph", text: "Acme Test conçoit des opérations." }])
    tables.journal.push(journalLine("lea", "annonces", ago(1)))
    const ref = await seedO(tables)
    const db = await ref.db("lea")
    const lea = leaOf(ref)
    const prefix = ref.org.prefix

    // La lecture des liens des Contextes en panne (`contexts.ts`).
    vi.mocked(contextBodies).mockImplementationOnce(failure("context: context links"))
    const contexts = await buildContext(db, lea, {}, { userAgent: null })
    // E05-S12 (AC-3) : l'en-tête, la ligne de faits, puis le pointeur.
    const notLoaded = (header: string, path: string, facts: string) => `## Context: ${header} (${path})\n${facts}\nNot loaded: read it with ${prefix}_read {"path": "${path}"}.`
    const everyoneNotLoaded = notLoaded("everyone", "contexte", orgFacts(lea.org))
    expect(contexts.text.slice(contexts.text.indexOf("## Context: "), contexts.text.indexOf("\n\n## What's new"))).toBe(
      [
        everyoneNotLoaded,
        notLoaded("you only", "private/lea/contexte", personFacts(lea)),
        notLoaded("team Ventes", "ventes/contexte", "Team Ventes. Lead: Claire Morel."),
        notLoaded("team Support", "support/contexte", "Team Support. Lead: Paul Girard."),
      ].join("\n\n"),
    )
    expect(log).toHaveBeenCalledWith("[platform] context: contexts read failed", expect.anything())
    expect(contexts.text).not.toContain("statement timeout")

    // Les versions (`news.ts`), l'usage du journal (`procedures.ts`), les blocs écrits par la personne (`recent.ts`).
    const omitted: [string, () => void][] = [
      ["## What's new", () => vi.mocked(newsItems).mockImplementationOnce(failure("context: node_versions"))],
      ["## Procedures you can run, most used first", () => vi.mocked(proceduresBlock).mockImplementationOnce(failure("context: journal usage"))],
      ["## Recent content", () => vi.mocked(recentBlock).mockImplementationOnce(failure("context: recent blocks"))],
    ]
    for (const [heading, fail] of omitted) {
      fail()
      const { text, ctx } = await buildContext(db, lea, {}, { userAgent: null })
      expect(text.startsWith(`ctx: ${ctx}\n`), heading).toBe(true)
      expect(section(text, heading), heading).toBeUndefined()
      expect(section(text, "## Context: everyone"), heading).toBe(`## Context: everyone (contexte)\n${orgFacts(lea.org)}\nAcme Test conçoit des opérations.`)
    }
    // Sans panne, chacun de ces blocs est servi : aucune de ces omissions n'est vide de sens. Le lendemain des appels
    // précédents : rien de nouveau depuis le jour même omettrait « What's new » (M53).
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(Date.now() + 24 * 3600 * 1000))
    let served: string
    try {
      served = (await buildContext(db, lea, {}, { userAgent: null })).text
    } finally {
      vi.useRealTimers()
    }
    expect(omitted.map(([heading]) => section(served, heading) !== undefined)).toEqual([true, true, true])
    // La borne des nouveautés illisible (`ctx.ts`) : le bloc est omis, le code est émis ; l'aperçu fait de même.
    vi.mocked(lastCtxAt).mockImplementationOnce(failure("lastCtxAt: ctx"))
    expect(section((await buildContext(db, lea, {}, { userAgent: null })).text, "## What's new")).toBeUndefined()
    vi.mocked(contextBodies).mockImplementationOnce(failure("context: context links"))
    expect(section((await previewContext(db, lea, {})).text, "## Context: everyone")).toBe(everyoneNotLoaded)
    for (const message of log.mock.calls.flat()) expect(String(message)).not.toContain("statement timeout")
    for (const call of log.mock.calls) expect(call[0]).toMatch(/^\[platform\] /)
  })
})
