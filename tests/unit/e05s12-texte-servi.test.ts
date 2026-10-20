// @vitest-environment node
// Le texte servi par `context` après E05-S12, lot A (D109, retours 1, 2 et 4) : une partie par Contexte ouverte
// par sa ligne de faits (AC-1 à AC-5), la section des règles de l'espace (AC-10) et la tête rapportée par le
// moteur (AC-4). Fonctions pures : `contextParts` reçoit les faits et les corps lus, `renderContext` les blocs ;
// l'ordre sur une base réelle, les faits relus (responsables, connecteurs) et le filtrage sont prouvés par
// `context-blocks.test.ts`, `context-engine.test.ts`, `mcp-core.test.ts` et `mcp-connectors.test.ts`.
import { describe, expect, it } from "vitest"
import { workspaceRules } from "../../packages/plateforme/server/context/blocks/code"
import { contextParts, type ContextBody, type PartFacts } from "../../packages/plateforme/server/context/blocks/contexts"
import { newsBlock } from "../../packages/plateforme/server/context/blocks/news"
import { proceduresText } from "../../packages/plateforme/server/context/blocks/procedures"
import { CONTEXT_BUDGET, renderContext } from "../../packages/plateforme/server/context/engine"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"

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
describe("procedures named by their titles at the budget", () => {
  it("should give the useful procedures a fallback that names each one by its title, under the same header", () => {
    const procedures = proceduresText(
      [
        { path: "ventes/relance", title: "Relancer les devis", summary: "Relance les devis restés sans réponse depuis dix jours, un par client." },
        { path: "support/ticket", title: "Répondre à un ticket", summary: "Répond à un ticket du support avec la FAQ et le contrat du client." },
      ],
      "acme",
    )
    expect(procedures.fallback).toBe("## Procedures you can run, most used first (2)\n- ventes/relance: Relancer les devis\n- support/ticket: Répondre à un ticket")
  })
})

describe("whole blocks under the cap (E11-S03, AC-b1, AC-b2)", () => {
  it("should serve a 10,000-character Contexte, 60 useful procedures and 10 news whole, without pointer nor notice, every report line full", () => {
    const long = Array.from({ length: 200 }, (_, index) => `Règle ${index} de l'organisation, relue chaque trimestre.`).join("\n").slice(0, 10_000)
    expect(long.length).toBe(10_000)
    const parts = contextParts(identity(), FACTS, new Map([["contexte", body(long)]]))
    const procedures = proceduresText(
      Array.from({ length: 60 }, (_, index) => ({ path: `ventes/p${String(index).padStart(2, "0")}`, title: `Procédure ${index} : ${"étape ".repeat(21)}`.trim(), summary: `Procédure ${index} : ${"étape ".repeat(21)}`.trim() })),
      "acme",
    )
    const news = newsBlock(
      Array.from({ length: 10 }, (_, index) => ({ at: `2026-09-2${index % 9}T08:00:00.000Z`, line: `- annonces v${index + 1} (2026-09-23): ${"Une annonce ".repeat(6)}${index}` })),
      "2026-09-20T10:00:00.000Z",
    )
    const blocks = [{ name: "code", text: "ctx: XXXX-XXXX" }, ...parts, ...(news ? [news] : []), procedures]
    // Des tailles qui dépassaient chacune l'ancienne taille nominale (2 400, 8 000, 600), un total sous le plafond.
    expect([procedures.text.length > 8_000 && procedures.text.length < 10_000, (news?.text.length ?? 0) > 800]).toEqual([true, true])
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

  it("should cut the head down to what is included, when the budget cuts a part and when the notice makes the text recede", () => {
    const [, , ventes] = contextParts(identity(), { ...FACTS, teamConnectors: [MANY_CONNECTORS, []] }, new Map())
    // Coupée par le budget dans sa tête : la part incluse.
    const cut = renderContext([{ name: "code", text: "c".repeat(300) }, ventes], 1000, "acme").report[1]
    expect(cut.status).toBe("cut")
    expect(cut.head).toBe(cut.chars)
    expect(cut.chars).toBeLessThan(ventes.head ?? 0)
    // Puis un avis plus long que sa réserve (le nom de la seule partie coupée) : le texte recule encore, la tête
    // rapportée avec lui (`recededReport`).
    const receded = renderContext([{ name: "code", text: "c".repeat(300) }, { ...ventes, name: "x".repeat(300) }], 1000, "acme").report[1]
    expect(receded.chars).toBeLessThan(cut.chars)
    expect(receded.head).toBe(receded.chars)
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
  })
})
