// E05-S13 (retour 8, AC-15, AC-16 ; HN-E05S13-12 à -14) : l'écran relit le texte servi par `context` pour le dire en
// français, par les formats de `schemas/context-index.ts`. Chaque bloc est rendu ici par le service même
// (`proceduresText`, `newsBlock`, `recentText`, `contextParts`, `renderContext`), puis relu par
// `ui/contexte/parties-du-contexte.ts` : un format changé d'un côté seulement fait échouer ce test. Les listes d'index
// d'un Contexte sont écrites en toutes lettres (le corps d'un Contexte se lit en base, `contextBody`) : ce sont celles
// du contrat, M71. Une ligne non reconnue reste telle que servie.
import { describe, expect, it } from "vitest"
import { contextParts, type PartFacts } from "../../packages/plateforme/server/context/blocks/contexts"
import { activationItem, newsBlock, versionItem } from "../../packages/plateforme/server/context/blocks/news"
import { proceduresText } from "../../packages/plateforme/server/context/blocks/procedures"
import { recentText } from "../../packages/plateforme/server/context/blocks/recent"
import { renderContext, type ContextBlock } from "../../packages/plateforme/server/context/engine"
import type { Identity } from "../../packages/plateforme/server/identity"
import {
  morceauxDeLaFin,
  morceauxDuBloc,
  morceauxDuContexte,
  partiesDuContexte,
} from "../../packages/plateforme/ui/contexte/parties-du-contexte"

/** Le bloc rendu par le service, relu par l'écran. */
const relu = (bloc: ContextBlock | null) => morceauxDuBloc(bloc?.name ?? "", bloc?.text ?? "")

const LEA: Identity = {
  org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
  user: { id: "user-lea", email: "lea@example.test", name: "Léa Martin" },
  member: { role: "member", profile: { name: "Léa Martin", handle: "lea" } },
  teams: [{ id: "team-ventes", slug: "ventes", name: "Ventes", role: "member" }],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const FAITS: PartFacts = {
  everyone: "Organisation: Démo.",
  private: "You: Léa Martin (lea), member of Démo.",
  teams: ["Team Ventes."],
  teamConnectors: [["Connectors (the team that runs each call unless the procedure's place says otherwise):", "- mail: team Ventes (write)"]],
  connectors: [],
}

describe("the procedures block read back (AC-16)", () => {
  it("should read its count, each procedure by its path and summary, the none line and the more line", () => {
    // Un résumé qui porte lui-même « : » reste entier : le chemin s'arrête au premier séparateur.
    expect(relu(proceduresText([{ path: "ventes/qualifier", title: "Qualifier un prospect", summary: "Qualifie un prospect : score et suite." }], "demo"))).toEqual([
      { genre: "liste", legende: { genre: "procedures", nombre: 1 }, lignes: [{ genre: "procedure", chemin: "ventes/qualifier", resume: "Qualifie un prospect : score et suite." }] },
    ])
    expect(relu(proceduresText([], "demo"))).toEqual([
      { genre: "liste", legende: { genre: "procedures", nombre: 0 }, lignes: [] },
      { genre: "phrase", phrase: "aucune-procedure" },
    ])
    // 61 procédures : 60 listées, la dernière ligne compte l'autre.
    const nombreuses = Array.from({ length: 61 }, (_, rang) => ({ path: `ventes/p${String(rang).padStart(2, "0")}`, title: "Une procédure", summary: "Une procédure." }))
    const morceaux = relu(proceduresText(nombreuses, "demo"))
    expect(morceaux.map((morceau) => (morceau.genre === "liste" ? [morceau.genre, morceau.lignes.length] : morceau))).toEqual([
      ["liste", 60],
      { genre: "autres-procedures", nombre: 1 },
    ])
  })
})

describe("the news block read back (AC-16)", () => {
  it("should read its date, a version, a connector, and « Nothing new. »", () => {
    const depuis = "2026-09-20T10:00:00.000Z"
    const items = [versionItem({ path: "ventes/devis", revision: 3, title: "Devis (modèle): 2026" }, "2026-09-27T08:00:00.000Z"), activationItem("mail", "2026-09-26T08:00:00.000Z")]
    expect(relu(newsBlock(items, depuis))).toEqual([
      {
        genre: "liste",
        legende: { genre: "nouveautes", depuis: "2026-09-20" },
        lignes: [
          { genre: "version", chemin: "ventes/devis", revision: 3, date: "2026-09-27", titre: "Devis (modèle): 2026" },
          { genre: "connecteur", nom: "mail", date: "2026-09-26" },
        ],
      },
    ])
    expect(relu(newsBlock([], depuis))).toEqual([
      { genre: "liste", legende: { genre: "nouveautes", depuis: "2026-09-20" }, lignes: [] },
      { genre: "phrase", phrase: "rien-de-nouveau" },
    ])
  })
})

describe("the recent content block read back (AC-16)", () => {
  it("should read each content by its path, kind, date and title", () => {
    const bloc = recentText([
      { path: "ventes/tarifs", kind: "table", title: "Tarifs (2026): grille", at: "2026-09-27T08:00:00.000Z" },
      { path: "ventes/faq", kind: "page", title: "FAQ", at: "2026-09-26T08:00:00.000Z" },
    ])
    expect(relu(bloc)).toEqual([
      {
        genre: "liste",
        legende: null,
        lignes: [
          { genre: "recent", chemin: "ventes/tarifs", nature: "table", date: "2026-09-27", titre: "Tarifs (2026): grille" },
          { genre: "recent", chemin: "ventes/faq", nature: "page", date: "2026-09-26", titre: "FAQ" },
        ],
      },
    ])
  })
})

describe("a Contexte part read back (AC-15)", () => {
  const LISTES = ["Pages, tables and procedures here:", "- contexte/tarifs — Tarifs — Les tarifs.", "Linked pages:", "- support/faq — FAQ — Réponses — types."]

  it("should read its body as served, its lists, then the cut pointer", () => {
    // Des listes arrêtées à 20 lignes (`listsCut`) : la partie finit par le pointeur vers `read`.
    const corps = new Map([["contexte", { text: ["Corps du Contexte.", "", ...LISTES].join("\n"), listsCut: true }]])
    const { text, report } = renderContext(contextParts(LEA, FAITS, corps), 20_000, "demo")
    const partie = partiesDuContexte({ text, blocks: report }).parties[0]
    expect(morceauxDuContexte(partie.suite)).toEqual([
      { genre: "brut", texte: "Corps du Contexte." },
      { genre: "liste", legende: { genre: "children" }, lignes: [{ genre: "index", chemin: "contexte/tarifs", titre: "Tarifs", resume: "Les tarifs." }] },
      // Un titre suivi de plus d'un séparateur : la suite, résumé compris, reste lue.
      { genre: "liste", legende: { genre: "linked" }, lignes: [{ genre: "index", chemin: "support/faq", titre: "FAQ", resume: "Réponses — types." }] },
      { genre: "phrase", phrase: "suite" },
    ])
    // Sous l'éditeur (ou les blocs d'Organisation), le corps n'est pas répété.
    expect(morceauxDuContexte(partie.suite, { sansCorps: true }).map((morceau) => morceau.genre)).toEqual(["liste", "liste", "phrase"])
  })

  it("should say a Contexte that could not be read, and keep as served lines that only look like a list", () => {
    const { text, report } = renderContext(contextParts(LEA, FAITS, null), 20_000, "demo")
    const parties = partiesDuContexte({ text, blocks: report }).parties
    expect(parties.map((partie) => morceauxDuContexte(partie.suite))).toEqual([[{ genre: "phrase", phrase: "non-charge" }], [{ genre: "phrase", phrase: "non-charge" }], [{ genre: "phrase", phrase: "non-charge" }]])
    // Sans ligne vide avant eux, un titre et ses lignes sont du corps (M71).
    const suite = ["Corps.", ...LISTES.slice(2)].join("\n")
    expect(morceauxDuContexte(suite)).toEqual([{ genre: "brut", texte: suite }])
  })
})

describe("the end of the text read back (AC-14)", () => {
  it("should read the budget notice: omitted parts, the cut one, and those only counted", () => {
    const lignes = (nombre: number) => Array.from({ length: nombre }, (_, rang) => `ligne ${rang}`).join("\n")
    const blocs: ContextBlock[] = [
      { name: "code", text: "ctx: XXXX-XXXX" },
      { name: "contexte", text: lignes(400), path: "contexte" },
      { name: "news", text: lignes(5) },
      { name: "procedures", text: lignes(5) },
    ]
    const court = renderContext(blocs, 2_000, "demo")
    expect(morceauxDeLaFin(partiesDuContexte({ text: court.text, blocks: court.report }).reste)).toEqual([
      {
        genre: "budget",
        noms: [
          { nom: "contexte", coupe: true },
          { nom: "news", coupe: false },
          { nom: "procedures", coupe: false },
        ],
        autres: 0,
      },
    ])
    // Des noms trop longs pour la réserve de l'avis : les derniers sont comptés (« and <k> more »).
    const longs: ContextBlock[] = [{ name: "code", text: lignes(300) }, ...Array.from({ length: 12 }, (_, rang) => ({ name: `equipe_${rang}_${"x".repeat(20)}/contexte`, text: lignes(5) }))]
    const coupe = renderContext(longs, 2_000, "demo")
    const [avis] = morceauxDeLaFin(partiesDuContexte({ text: coupe.text, blocks: coupe.report }).reste)
    expect(avis).toMatchObject({ genre: "budget", noms: expect.arrayContaining([{ nom: "code", coupe: true }]) })
    expect(avis.genre === "budget" && avis.autres).toBeGreaterThan(0)
  })

  it("should keep as served a block or an end it does not recognize", () => {
    expect(morceauxDuBloc("calendar", "## Calendar\n- demain")).toEqual([{ genre: "brut", texte: "## Calendar\n- demain" }])
    expect(morceauxDuBloc("procedures", "## Other header\n- a/b: c")).toEqual([{ genre: "brut", texte: "## Other header\n- a/b: c" }])
    expect(morceauxDuBloc("news", "## What's new since 2026-09-20\n- une ligne libre\n- ventes/devis v3 (2026-09-27): Devis")).toEqual([
      { genre: "liste", legende: { genre: "nouveautes", depuis: "2026-09-20" }, lignes: [] },
      { genre: "brut", texte: "- une ligne libre" },
      { genre: "liste", legende: null, lignes: [{ genre: "version", chemin: "ventes/devis", revision: 3, date: "2026-09-27", titre: "Devis" }] },
    ])
    expect(morceauxDeLaFin("Une fin libre.")).toEqual([{ genre: "brut", texte: "Une fin libre." }])
    // Une ligne presque servie : un chemin hors du format des nœuds, une date qui n'en est pas une.
    expect(morceauxDuBloc("procedures", "## Procedures you can run, most used first (1)\n- Hors Format: x")).toEqual([
      { genre: "liste", legende: { genre: "procedures", nombre: 1 }, lignes: [] },
      { genre: "brut", texte: "- Hors Format: x" },
    ])
    expect(morceauxDuBloc("recent content", "## Recent content\n- ventes/faq (page, hier): FAQ")).toEqual([{ genre: "brut", texte: "- ventes/faq (page, hier): FAQ" }])
  })

  // Les titres et résumés servis viennent des clients (`security-patterns.md § Validation des inputs`).
  it("should read a hostile served text of the budget size in linear time", () => {
    const hostiles = [
      `## Recent content\n${`- a (b, ${"(".repeat(200)}): `.repeat(100)}`,
      `## What's new since 2026-09-20\n${`- a/a v1 (${" (".repeat(9_990)}`}`,
      `## Procedures you can run, most used first (1)\n- ${"a/".repeat(9_990)}!: x`,
      `[Context budget reached. Omitted: ${"a, ".repeat(6_600)}. Use demo_find or demo_read for more.]`,
    ]
    for (const texte of hostiles) {
      const debut = performance.now()
      if (texte.startsWith("[")) morceauxDeLaFin(texte)
      else morceauxDuBloc(texte.startsWith("## Recent") ? "recent content" : texte.startsWith("## What") ? "news" : "procedures", texte)
      morceauxDuContexte(texte)
      expect(performance.now() - debut).toBeLessThan(1_000)
    }
  })
})
