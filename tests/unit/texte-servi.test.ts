// @vitest-environment node
// Le texte servi par `context` et sa relecture par l'écran.
// - Le texte servi après E05-S12, lot A (D109, retours 1, 2 et 4) : une partie par Contexte ouverte par sa ligne de
//   faits (AC-1 à AC-5), la section des règles de l'espace (AC-10) et la tête rapportée par le moteur (AC-4).
//   Fonctions pures : `contextParts` reçoit les faits et les corps lus, `renderContext` les blocs ; l'ordre sur une
//   base réelle, les faits relus (responsables, connecteurs) et le filtrage sont prouvés par `context-blocks.test.ts`,
//   `context-engine.test.ts`, `mcp-core.test.ts` et `mcp-connectors.test.ts`.
// - La découpe du texte servi en ses parties (E05-S11, AC-11, AC-13 ; HN-E05S11-8, HN-E05S11-9), confrontée au
//   moteur même de `context` (`renderContext`, `server/context/engine.ts`) : `ui/` réécrit sa règle de séparation
//   sans l'importer, ces tests tiennent les deux ensemble sur un texte entier, coupé, remplacé, omis, et reculé (une
//   ligne finale plus longue que sa réserve). Les ancres des parties sont celles de l'encart d'un Contexte.
//   E05-S12 (lot C, AC-4, AC-7, AC-8) : la tête d'une partie de Contexte, lue par `head`, est celle que rendent les
//   parties du serveur (`contextParts`), entière, puis ramenée par le recul du texte.
// - E05-S13 (retour 8, AC-15, AC-16 ; HN-E05S13-12 à -14) : l'écran relit le texte servi par `context` pour le dire
//   en français, par les formats de `schemas/context-index.ts`. Chaque bloc est rendu ici par le service même
//   (`recentText`, nouveautés comprises depuis le 2026-10-27, `contextParts`, `renderContext`), puis relu par
//   `ui/contexte/parties-du-contexte.ts` : un format changé d'un côté seulement fait échouer ces tests. Les listes
//   d'index d'un Contexte sont écrites en toutes lettres (le corps d'un Contexte se lit en base, `contextBody`) : ce
//   sont celles du contrat, M71. Une ligne non reconnue reste telle que servie.
import { describe, expect, it } from "vitest"
import { workspaceRules } from "../../packages/plateforme/server/context/blocks/code"
import { contextParts, type ContextBody, type PartFacts } from "../../packages/plateforme/server/context/blocks/contexts"
import { orgAddress } from "../../packages/plateforme/server/context/blocks/org"
import { recentText } from "../../packages/plateforme/server/context/blocks/recent"
import { CONTEXT_BUDGET, renderContext, type ContextBlock } from "../../packages/plateforme/server/context/engine"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"
import {
  ancreDeLaPartie,
  cheminDuContexte,
  morceauxDeLaFin,
  morceauxDuBloc,
  morceauxDuContexte,
  partiesDuContexte,
} from "../../packages/plateforme/ui/contexte/parties-du-contexte"

// Léa, de Démo : la relecture par l'écran.

const lignes = (prefixe: string, nombre: number) => Array.from({ length: nombre }, (_, rang) => `${prefixe} ligne ${rang}`).join("\n")

/** Chaque partie incluse, lue dans le texte, est ce que le moteur a inclus du bloc ; le reste est l'avis. */
function confronter(blocs: ContextBlock[], budget: number) {
  const { text, report } = renderContext(blocs, budget, "demo")
  const { parties, reste } = partiesDuContexte({ text, blocks: report })
  const inclus = parties.filter((partie) => partie.chars > 0)
  // Recomposé, le texte est celui du moteur, à l'octet.
  expect(inclus.map((partie) => partie.texte).join("\n\n") + (reste ? `\n\n${reste}` : "")).toBe(text)
  return { parties, reste, report }
}

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
  teamConnectors: [["Connectors (the team that runs each call unless the procedure's place says otherwise):", "mail: team Ventes (write)"]],
  connectors: [],
}

const TETES = {
  toutLeMonde: `## Context: everyone (contexte)\n${FAITS.everyone}`,
  prive: `## Context: you only (private/lea/contexte)\n${FAITS.private}`,
  ventes: ["## Context: team Ventes (ventes/contexte)", FAITS.teams[0], ...FAITS.teamConnectors[0]].join("\n"),
}

// Claire, d'Acme Énergies : le texte servi.

const VENTES: IdentityTeam = { id: "team-ventes", slug: "ventes", name: "Ventes", role: "lead" }
const CONSEIL: IdentityTeam = { id: "team-conseil", slug: "conseil", name: "Conseil", role: "member" }

function identity(fields: Partial<Identity> = {}): Identity {
  return {
    org: { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acme", brand: {}, domains: null },
    user: { id: "user-claire", email: "claire@example.test", name: "Claire Morel" },
    member: { role: "member", profile: { name: "Claire Morel", handle: "claire" } },
    teams: [VENTES, CONSEIL],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
    ...fields,
  }
}

const CONNECTORS = [
  "Connectors (this team runs a call when the procedure or the call names it, or when it is your only team with an account; if several are, ask the user which one):",
  "mail: team Ventes (write), account « Mail Ventes » (simulated)",
]

/** Les connecteurs dont aucune équipe de la personne n'a de compte : dans la partie de Tout le monde (E05-S13, D128). */
const ORG_CONNECTORS = ["Connectors (when no team of yours runs the call):", "sms: no team (write), account « SMS Acme » (simulated)"]

/** Des faits reconnaissables : le texte de chaque ligne est prouvé par `personFacts`, `orgFacts` et `teamFacts`. */
const FACTS: PartFacts = {
  everyone: "Organisation: Acme Énergies.",
  private: "You: Claire Morel (claire), member of Acme Énergies.",
  teams: ["Team Ventes. Lead: Claire Morel.", "Team Conseil."],
  teamConnectors: [CONNECTORS, []],
  connectors: [],
}

/** Les têtes attendues de Claire : en-tête, faits, connecteurs. */
const HEADS = {
  everyone: `## Context: everyone (contexte)\n${FACTS.everyone}`,
  private: `## Context: you only (private/claire/contexte)\n${FACTS.private}`,
  ventes: ["## Context: team Ventes (ventes/contexte)", FACTS.teams[0], ...CONNECTORS].join("\n"),
  conseil: `## Context: team Conseil (conseil/contexte)\n${FACTS.teams[1]}`,
}

/** Trente lignes de connecteurs : une tête longue, que le plafond d'un essai coupe. */
const MANY_CONNECTORS = [CONNECTORS[0], ...Array.from({ length: 30 }, (_, index) => `c${index}: team Ventes (write), account « Compte ${index} » (simulated)`)]

const body = (text: string, listsCut = false): ContextBody => ({ text, listsCut })

describe("contextParts (E05-S12, AC-1 to AC-4)", () => {
  it("should serve everyone, private, then each team, each opened by its header and its facts, each team's connectors after its facts", () => {
    const bodies = new Map([
      ["contexte", body("Nous vendons.")],
      ["ventes/contexte", body("Tutoie.")],
    ])
    expect(contextParts(identity(), FACTS, bodies)).toEqual([
      { name: "contexte", path: "contexte", head: HEADS.everyone.length, text: `${HEADS.everyone}\nNous vendons.` },
      // Le Contexte Privé manque (absent, brouillon ou illisible : `contextBodies` n'en rend pas) : sa tête seule, sans `path`.
      { name: "private/claire/contexte", head: HEADS.private.length, text: HEADS.private },
      { name: "ventes/contexte", path: "ventes/contexte", head: HEADS.ventes.length, text: `${HEADS.ventes}\nTutoie.` },
      { name: "conseil/contexte", head: HEADS.conseil.length, text: HEADS.conseil },
    ])
  })

  it("should give a person without team the connectors after the organisation's facts, and no team part", () => {
    const parts = contextParts(identity({ teams: [] }), { ...FACTS, teams: [], teamConnectors: [], connectors: ORG_CONNECTORS }, new Map())
    expect(parts.map((part) => part.text)).toEqual([[HEADS.everyone, ...ORG_CONNECTORS].join("\n"), HEADS.private])
  })

  // E05-S13 (D128) : plus d'équipe par défaut ; chaque équipe qui a un compte porte ses lignes, un connecteur dont
  // aucune équipe de la personne n'a de compte suit les faits de l'organisation.
  it("should put the connectors of each team with an account in its part, and the others after the organisation's facts", () => {
    const facts = { ...FACTS, teamConnectors: [CONNECTORS, [CONNECTORS[0], "x: team Conseil (read), account « X Conseil » (simulated)"]], connectors: ORG_CONNECTORS }
    expect(contextParts(identity(), facts, new Map()).map((part) => part.text)).toEqual([
      [HEADS.everyone, ...ORG_CONNECTORS].join("\n"),
      HEADS.private,
      HEADS.ventes,
      [HEADS.conseil, CONNECTORS[0], "x: team Conseil (read), account « X Conseil » (simulated)"].join("\n"),
    ])
  })

  it("should serve the private part of a profile without handle with no path, named private, never read", () => {
    const withoutHandle = identity({ member: { role: "member", profile: {} } })
    const head = `## Context: you only\n${FACTS.private}`
    const served = contextParts(withoutHandle, FACTS, new Map([["private/claire/contexte", body("Ailleurs.")]]))[1]
    const notLoaded = contextParts(withoutHandle, FACTS, null)[1]
    for (const part of [served, notLoaded]) expect(part).toEqual({ name: "private", head: head.length, text: head })
  })

  it("should keep the header, the facts and the connectors of each part when the Contextes could not be read, then the pointer (AC13)", () => {
    const pointer = (path: string) => `Not loaded: read it with acme_read {"path": "${path}"}.`
    expect(contextParts(identity(), FACTS, null)).toEqual([
      { name: "contexte", head: HEADS.everyone.length, text: `${HEADS.everyone}\n${pointer("contexte")}` },
      { name: "private/claire/contexte", head: HEADS.private.length, text: `${HEADS.private}\n${pointer("private/claire/contexte")}` },
      { name: "ventes/contexte", head: HEADS.ventes.length, text: `${HEADS.ventes}\n${pointer("ventes/contexte")}` },
      { name: "conseil/contexte", head: HEADS.conseil.length, text: `${HEADS.conseil}\n${pointer("conseil/contexte")}` },
    ])
  })

  it("should serve an empty Contexte as its head alone, without path", () => {
    expect(contextParts(identity(), FACTS, new Map([["contexte", body("")]]))[0]).toEqual({ name: "contexte", head: HEADS.everyone.length, text: HEADS.everyone })
  })
})

// E11-S03 (lot b, fiche D134) : plus de taille par bloc ; seul le plafond de `renderContext` coupe, et toute coupe
// est dite (le plafond : `context-engine.test.ts`).
describe("whole blocks under the cap (E11-S03, AC-b1, AC-b2)", () => {
  it("should serve a 10,000-character Contexte and 20 recent or new contents whole, without pointer nor notice, every report line full", () => {
    const long = Array.from({ length: 200 }, (_, index) => `Règle ${index} de l'organisation, relue chaque trimestre.`).join("\n").slice(0, 10_000)
    expect(long.length).toBe(10_000)
    const parts = contextParts(identity(), FACTS, new Map([["contexte", body(long)]]))
    const versions = Array.from({ length: 20 }, (_, index) => ({ path: `annonces/a${index}`, kind: "page", revision: index + 1, title: `${"Une annonce ".repeat(6)}${index}`, at: `2026-09-2${index % 9}T08:00:00.000Z` }))
    const recent = recentText([], { versions, activations: [] }, "2026-09-20T10:00:00.000Z")
    const blocks = [{ name: "code", text: "ctx: XXXX-XXXX" }, ...parts, ...(recent ? [recent] : [])]
    // Plus long que les anciennes tailles nominales des nouveautés et des contenus récents (600, 1 400), un total sous le plafond.
    expect((recent?.text.length ?? 0) > 1_400).toBe(true)
    const { text, report } = renderContext(blocks, CONTEXT_BUDGET, "acme")
    expect(text).toBe(blocks.map((block) => block.text).join("\n\n"))
    expect(text).toContain(`${HEADS.everyone}\n${long}\n\n`)
    expect(text).not.toContain("Read the rest:")
    expect(text).not.toContain("budget reached")
    expect(report.map((entry) => entry.status)).toEqual(blocks.map(() => "full"))
  })

  it("should end a Contexte whose lists were stopped at 20 lines with the pointer that says so, counted cut", () => {
    const [everyone, , ventes] = contextParts(identity(), FACTS, new Map([["contexte", body("Court.", true)], ["ventes/contexte", body("Tutoie.", true)]]))
    expect(everyone).toEqual({
      name: "contexte",
      path: "contexte",
      cut: true,
      head: HEADS.everyone.length,
      text: `${HEADS.everyone}\nCourt.\nOnly the first 20 entries are listed. Read the rest: acme_read {"path": "contexte"}.`,
    })
    expect(ventes.text.split("\n").at(-1)).toBe('Only the first 20 entries are listed. Read the rest: acme_read {"path": "ventes/contexte"}.')
    expect(renderContext([everyone], CONTEXT_BUDGET, "acme").report).toEqual([{ name: "contexte", chars: everyone.text.length, status: "cut", path: "contexte", head: HEADS.everyone.length }])
  })
})

describe("the head in the report of renderContext (E05-S12, AC-4)", () => {
  it("should report the head of each included part and 0 for the other blocks", () => {
    const parts = contextParts(identity(), FACTS, new Map([["contexte", body("Nous vendons.")]]))
    const { report } = renderContext([{ name: "code", text: "ctx: XXXX-XXXX" }, ...parts], 20_000, "acme")
    expect(report.map((entry) => entry.head)).toEqual([0, HEADS.everyone.length, HEADS.private.length, HEADS.ventes.length, HEADS.conseil.length])
  })

  // Quand l'avis fait reculer le texte, la tête rapportée recule avec lui (`recededReport`) : « should keep only the
  // part of the head the receded text still includes », plus bas.
  it("should cut the head down to what is included when the budget cuts a part", () => {
    const [, , ventes] = contextParts(identity(), { ...FACTS, teamConnectors: [MANY_CONNECTORS, []] }, new Map())
    const cut = renderContext([{ name: "code", text: "c".repeat(300) }, ventes], 1000, "acme").report[1]
    expect(cut.status).toBe("cut")
    expect(cut.head).toBe(cut.chars)
    expect(cut.chars).toBeLessThan(ventes.head ?? 0)
  })
})

describe("How this workspace works (E05-S12, AC-10)", () => {
  // 1.4.3 : les références et les pièges ajoutent moins de 1 200 caractères aux 1 900 d'avant (cahier des charges de JB) ;
  // 1.4.12 : la notice d'une procédure, en deux lignes, moins de 600 de plus.
  it("should hold 18 lines and 3,400 characters at most with a 10-character prefix, the same for everyone", () => {
    const rules = workspaceRules("abcdefghij")
    // La section et la ligne « ## This request » qui la suit dans le bloc code.
    expect(`${rules}\n## This request`.split("\n").length).toBeLessThanOrEqual(18)
    expect(rules.length).toBeLessThanOrEqual(3_400)
    expect(rules).toContain("A procedure is a page of numbered steps")
    expect(rules).toContain("A good procedure has a part « When to use it »")
    for (const pointer of ["abcdefghij_read path functions", "path help", "write.procedure or write.table", "abcdefghij_call table.schema", "abcdefghij_call node.move"]) expect(rules).toContain(pointer)
    expect(rules.split("\n")[0]).toBe("## How this workspace works")
    expect(rules).toContain("abcdefghij_context (first, then again with since_ctx for each new request), abcdefghij_find, abcdefghij_read, abcdefghij_call, abcdefghij_write, abcdefghij_feedback.")
    // Aucune donnée d'une identité, aucun nom de produit ni de client : seul le préfixe varie.
    expect(workspaceRules("acme").replaceAll("acme_", "abcdefghij_")).toBe(rules)
    for (const word of ["<p>", "Oto", "Claude", "ChatGPT", "Acme", "ventes"]) expect(rules).not.toContain(word)
    // 2026-10-27 : l'adresse d'Oto, première règle quand l'origine se lit ; une ligne de plus.
    const address = orgAddress("https://demo.example.test/api/mcp")
    const withAddress = workspaceRules("abcdefghij", address)
    expect(withAddress.split("\n")).toEqual([rules.split("\n")[0], `- ${address}`, ...rules.split("\n").slice(1)])
    expect(`${withAddress}\n## This request`.split("\n").length).toBeLessThanOrEqual(19)
  })
})

describe("partiesDuContexte (AC-13, parity with renderContext)", () => {
  it("should cut the served text by the report: full, replaced, cut and omitted parts, then the budget notice", () => {
    const blocs: ContextBlock[] = [
      { name: "code", text: "ctx: XXXX-XXXX" },
      { name: "procedure", text: lignes("procédure", 400), fallback: "Read it with demo_read." },
      { name: "contexte", text: lignes("tout le monde", 200), path: "contexte" },
      { name: "news", text: lignes("nouveau", 5) },
      // Deux blocs omis : un bloc vide n'avance pas la découpe (garde `bloc.chars > 0`) ; sans elle, le second
      // décalerait l'avis de deux caractères.
      { name: "procedures", text: lignes("procédures", 5) },
    ]
    const { parties, reste } = confronter(blocs, 4_000)
    expect(parties.map((partie) => [partie.name, partie.status])).toEqual([
      ["code", "full"],
      ["procedure", "replaced"],
      ["contexte", "cut"],
      ["news", "omitted"],
      ["procedures", "omitted"],
    ])
    expect(parties[1].texte).toBe("Read it with demo_read.")
    // Une partie de Contexte coupée par le plafond finit par son pointeur (E11-S03, AC-b4).
    const pointeur = '\nThis context is cut: everything served together exceeds 4,000 characters. Read the rest: demo_read {"path": "contexte"}.'
    expect(parties[2].texte.endsWith(pointeur)).toBe(true)
    expect(blocs[2].text.startsWith(parties[2].texte.slice(0, -pointeur.length))).toBe(true)
    expect(parties[3].texte).toBe("")
    expect(parties[4].texte).toBe("")
    expect(reste).toBe("[Context budget reached. Omitted: contexte (cut), news, procedures. Use demo_find or demo_read for more.]")
  })

  it("should follow the engine when the notice is longer than its reserve and the text recedes", () => {
    // Le seul bloc coupé porte un nom plus long que la réserve de la ligne finale : l'avis la dépasse, le texte
    // recule d'autant (`recededReport`), sous les 1 260 caractères qu'il occupait.
    const blocs: ContextBlock[] = [
      { name: "code", text: "ctx: XXXX-XXXX" },
      { name: "x".repeat(400), text: lignes("organisation", 60) },
    ]
    const { report, parties, reste } = confronter(blocs, 1_500)
    expect(report[1].status).toBe("cut")
    expect("ctx: XXXX-XXXX\n\n".length + report[1].chars).toBeLessThanOrEqual(1_500 - `\n\n${reste}`.length)
    expect(parties[1].texte.length).toBe(report[1].chars)
  })

  it("should give a text without notice no remainder, and every part in order", () => {
    const { parties, reste } = confronter([{ name: "code", text: "ctx: XXXX-XXXX" }, { name: "news", text: "## What's new\nTarifs" }], 20_000)
    expect(parties.map((partie) => partie.texte)).toEqual(["ctx: XXXX-XXXX", "## What's new\nTarifs"])
    expect(reste).toBe("")
  })
})

describe("partiesDuContexte, the head of a part (E05-S12, AC-4, AC-7)", () => {
  it("should read as head the header, facts and connectors the server's parts give, and the Contexte below as the rest", () => {
    const corps = new Map([
      ["contexte", { text: "Nous vendons des logiciels.", listsCut: false }],
      ["ventes/contexte", { text: "Tutoie les clients.", listsCut: false }],
    ])
    const { parties } = confronter([{ name: "code", text: "ctx: XXXX-XXXX" }, ...contextParts(LEA, FAITS, corps), { name: "news", text: "## What's new\nTarifs" }], 20_000)
    expect(parties.map((partie) => [partie.name, partie.tete, partie.suite])).toEqual([
      ["code", "", "ctx: XXXX-XXXX"],
      ["contexte", TETES.toutLeMonde, "Nous vendons des logiciels."],
      // Le Privé n'est pas servi (absent, brouillon, illisible) : sa tête seule.
      ["private/lea/contexte", TETES.prive, ""],
      ["ventes/contexte", TETES.ventes, "Tutoie les clients."],
      ["news", "", "## What's new\nTarifs"],
    ])
  })

  it("should keep only the part of the head the receded text still includes", () => {
    // Un nom plus long que la réserve de l'avis fait reculer le texte : la tête du Contexte coupé tient en partie.
    const blocs: ContextBlock[] = [
      { name: "code", text: "ctx: XXXX-XXXX" },
      { name: `${"x".repeat(400)}/contexte`, text: `${lignes("tête", 150)}\nCorps.`, head: lignes("tête", 150).length },
    ]
    const { report, parties } = confronter(blocs, 1_500)
    expect(report[1].head).toBe(report[1].chars)
    expect(parties[1].tete).toBe(parties[1].texte)
    expect(parties[1].suite).toBe("")
  })

  // E11-S03 (AC-b2, AC-b4, AC-b5) : les deux pointeurs du service, reconnus par leurs constantes, jamais montrés bruts.
  it("should read the pointer of stopped lists and the pointer of the cap as the end of the part", () => {
    const listes = contextParts(LEA, FAITS, new Map([["ventes/contexte", { text: "Tutoie les clients.", listsCut: true }]]))
    const arretees = confronter([{ name: "code", text: "ctx: XXXX-XXXX" }, ...listes], 35_000).parties.find((partie) => partie.name === "ventes/contexte")
    const longues = contextParts(LEA, FAITS, new Map([["contexte", { text: lignes("Règle", 400), listsCut: false }]]))
    const coupee = confronter([{ name: "code", text: "ctx: XXXX-XXXX" }, ...longues], 3_000).parties.find((partie) => partie.name === "contexte")
    expect(coupee?.status).toBe("cut")
    expect(coupee?.suite.split("\n").at(-1)).toBe('This context is cut: everything served together exceeds 3,000 characters. Read the rest: demo_read {"path": "contexte"}.')
    for (const partie of [arretees, coupee]) {
      const morceaux = morceauxDuContexte(partie?.suite ?? "")
      expect(morceaux.at(-1)).toEqual({ genre: "phrase", phrase: "suite" })
      expect(JSON.stringify(morceaux)).not.toContain("Read the rest")
    }
  })

  it("should read a report without head (before E05-S12) as a part without head", () => {
    const { parties } = partiesDuContexte({ text: "## Context: everyone (contexte)\nNous vendons.", blocks: [{ name: "contexte", chars: 45, status: "full", path: "contexte" }] })
    expect([parties[0].tete, parties[0].suite]).toEqual(["", "## Context: everyone (contexte)\nNous vendons."])
  })
})

describe("ancreDeLaPartie (AC-11, HN-E05S11-9 ; E05-S12, AC-8, HN-E05S12-10 ; E11-S07, AC-c1)", () => {
  it("should anchor each part by its name, at its rank when it has no anchor of its own", () => {
    const ancres: [{ name: string }, string][] = [
      [{ name: "recent content" }, "recent-content"],
      // Une partie de Contexte par son nom, servie ou non.
      [{ name: "contexte" }, "everyone-context"],
      [{ name: "private/lea/contexte" }, "private-context"],
      [{ name: "private" }, "private-context"],
      [{ name: "ventes/contexte" }, "context-ventes"],
      // Une équipe au slug `everyone` ne prend pas l'ancre de Tout le monde.
      [{ name: "everyone/contexte" }, "context-everyone"],
      // Le bloc `code`, que rien n'affiche plus (HN-E11S07-11), et les anciens blocs n'ont plus d'ancre propre ; un nom
      // inconnu, son rang.
      [{ name: "code" }, "part-5"],
      [{ name: "person" }, "part-5"],
      // Les nouveautés et les procédures utiles, servies à part jusqu'au 2026-10-27.
      [{ name: "news" }, "part-5"],
      [{ name: "procedures" }, "part-5"],
      [{ name: "calendar" }, "part-5"],
    ]
    expect(Object.fromEntries(ancres.map(([bloc]) => [bloc.name, ancreDeLaPartie(bloc, 4)]))).toEqual(Object.fromEntries(ancres.map(([bloc, ancre]) => [bloc.name, ancre])))
  })
})

describe("cheminDuContexte (E05-S12, AC-7)", () => {
  it("should give the path of each Contexte part, and none to the other blocks", () => {
    const chemins: [{ name: string }, string | null][] = [
      [{ name: "contexte" }, "contexte"],
      [{ name: "private/lea/contexte" }, "private/lea/contexte"],
      [{ name: "ventes/contexte" }, "ventes/contexte"],
      // Le Privé sans `handle` n'a pas de nœud ; les autres blocs ne sont pas des Contextes.
      [{ name: "private" }, null],
      [{ name: "code" }, null],
      [{ name: "recent content" }, null],
      [{ name: "ventes/contexte-bis" }, null],
    ]
    expect(Object.fromEntries(chemins.map(([bloc]) => [bloc.name, cheminDuContexte(bloc)]))).toEqual(Object.fromEntries(chemins.map(([bloc, chemin]) => [bloc.name, chemin])))
  })
})

// 2026-10-27 : nouveautés et contenus récents en un bloc ; l'écran relit la borne, chaque nouveauté et chaque contenu.
describe("the recent content block read back (AC-16)", () => {
  it("should read the bound of the news, a new version, a connector and each content by its path, kind, date and title", () => {
    const news = {
      versions: [{ path: "ventes/devis", kind: "page", revision: 3, title: "Devis (modèle): 2026", at: "2026-09-28T08:00:00.000Z" }],
      activations: [{ connector: "mail", at: "2026-09-26T08:00:00.000Z" }],
    }
    const bloc = recentText(
      [
        { path: "ventes/tarifs", kind: "table", title: "Tarifs (2026): grille", at: "2026-09-27T08:00:00.000Z" },
        { path: "ventes/faq", kind: "page", title: "FAQ", at: "2026-09-25T08:00:00.000Z" },
      ],
      news,
      "2026-09-20T10:00:00.000Z",
    )
    expect(relu(bloc)).toEqual([
      {
        genre: "liste",
        legende: { genre: "nouveautes", depuis: "2026-09-20" },
        lignes: [
          { genre: "version", chemin: "ventes/devis", nature: "page", revision: 3, date: "2026-09-28", titre: "Devis (modèle): 2026" },
          { genre: "recent", chemin: "ventes/tarifs", nature: "table", date: "2026-09-27", titre: "Tarifs (2026): grille" },
          { genre: "connecteur", nom: "mail", date: "2026-09-26" },
          { genre: "recent", chemin: "ventes/faq", nature: "page", date: "2026-09-25", titre: "FAQ" },
        ],
      },
    ])
    // Sans borne (illisible) : les contenus seuls, sans légende.
    expect(relu(recentText([{ path: "ventes/faq", kind: "page", title: "FAQ", at: "2026-09-25T08:00:00.000Z" }], null, null))).toEqual([
      { genre: "liste", legende: null, lignes: [{ genre: "recent", chemin: "ventes/faq", nature: "page", date: "2026-09-25", titre: "FAQ" }] },
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
    const numerotees = (nombre: number) => Array.from({ length: nombre }, (_, rang) => `ligne ${rang}`).join("\n")
    const blocs: ContextBlock[] = [
      { name: "code", text: "ctx: XXXX-XXXX" },
      { name: "contexte", text: numerotees(400), path: "contexte" },
      { name: "news", text: numerotees(5) },
      { name: "procedures", text: numerotees(5) },
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
    const longs: ContextBlock[] = [{ name: "code", text: numerotees(300) }, ...Array.from({ length: 12 }, (_, rang) => ({ name: `equipe_${rang}_${"x".repeat(20)}/contexte`, text: numerotees(5) }))]
    const coupe = renderContext(longs, 2_000, "demo")
    const [avis] = morceauxDeLaFin(partiesDuContexte({ text: coupe.text, blocks: coupe.report }).reste)
    expect(avis).toMatchObject({ genre: "budget", noms: expect.arrayContaining([{ nom: "code", coupe: true }]) })
    expect(avis.genre === "budget" && avis.autres).toBeGreaterThan(0)
  })

  it("should keep as served a block or an end it does not recognize", () => {
    expect(morceauxDuBloc("calendar", "## Calendar\n- demain")).toEqual([{ genre: "brut", texte: "## Calendar\n- demain" }])
    expect(morceauxDuBloc("recent content", "## Other header\n- a/b (page, 2026-09-27): c")).toEqual([{ genre: "brut", texte: "## Other header\n- a/b (page, 2026-09-27): c" }])
    expect(morceauxDuBloc("recent content", "## Recent content (new: published since 2026-09-20)\n- une ligne libre\n- ventes/devis (page, new v3, 2026-09-27): Devis")).toEqual([
      { genre: "liste", legende: { genre: "nouveautes", depuis: "2026-09-20" }, lignes: [] },
      { genre: "brut", texte: "- une ligne libre" },
      { genre: "liste", legende: null, lignes: [{ genre: "version", chemin: "ventes/devis", nature: "page", revision: 3, date: "2026-09-27", titre: "Devis" }] },
    ])
    expect(morceauxDeLaFin("Une fin libre.")).toEqual([{ genre: "brut", texte: "Une fin libre." }])
    // Une ligne presque servie : un chemin hors du format des nœuds, une date qui n'en est pas une, une marque de version
    // sans numéro, une précision de trop.
    const presque = ["- Hors Format (page, 2026-09-27): x", "- ventes/faq (page, hier): FAQ", "- ventes/faq (page, new vX, 2026-09-27): FAQ", "- ventes/faq (page, a, b, 2026-09-27): FAQ"]
    expect(morceauxDuBloc("recent content", ["## Recent content", ...presque].join("\n"))).toEqual([{ genre: "brut", texte: presque.join("\n") }])
  })

  // Les titres et résumés servis viennent des clients (`security-patterns.md § Validation des inputs`).
  it("should read a hostile served text of the budget size in linear time", () => {
    const hostiles = [
      `## Recent content\n${`- a (b, ${"(".repeat(200)}): `.repeat(100)}`,
      `## Recent content (new: published since 2026-09-20)\n${`- a/a (page, new v1, ${", ".repeat(9_990)}`}`,
      `## Recent content\n- ${"a/".repeat(9_990)}! (page, 2026-09-27): x`,
      `[Context budget reached. Omitted: ${"a, ".repeat(6_600)}. Use demo_find or demo_read for more.]`,
    ]
    for (const texte of hostiles) {
      const debut = performance.now()
      if (texte.startsWith("[")) morceauxDeLaFin(texte)
      else morceauxDuBloc("recent content", texte)
      morceauxDuContexte(texte)
      expect(performance.now() - debut).toBeLessThan(1_000)
    }
  })
})
