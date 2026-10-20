// @vitest-environment node
// Décidé par JB le 20/10/2026 : une personne de plus de trois équipes reçoit en entier Tout le monde,
// Privé et les trois Contextes d'équipe les plus proches de sa demande ; les autres gardent leur tête et une ligne (résumé,
// comment les lire). Fonctions pures : `contextParts` reçoit les faits et les corps lus.
import { describe, expect, it } from "vitest"
import { contextParts, fullTeamContexts, type ContextBody, type PartFacts } from "../../packages/plateforme/server/context/blocks/contexts"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"

const team = (slug: string, name: string, role: IdentityTeam["role"] = "member"): IdentityTeam => ({ id: `team-${slug}`, slug, name, role })

const EQUIPES = [team("achats", "Achats"), team("compta", "Comptabilité"), team("juridique", "Juridique"), team("rh", "Ressources humaines"), team("ventes", "Ventes", "lead")]

function identity(teams: IdentityTeam[]): Identity {
  return {
    org: { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acme", brand: {}, domains: null },
    user: { id: "user-claire", email: "claire@example.test", name: "Claire Morel" },
    member: { role: "member", profile: { name: "Claire Morel", handle: "claire" } },
    teams,
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
  }
}

function faits(teams: IdentityTeam[]): PartFacts {
  return { everyone: "Organisation: Acme Énergies.", private: "You: Claire Morel.", teams: teams.map((one) => `Team ${one.name}.`), teamConnectors: teams.map(() => []), connectors: [] }
}

const body = (text: string, summary?: string): ContextBody => ({ text, listsCut: false, summary })

/** Un corps par Contexte : Tout le monde, Privé et chaque équipe, chacun avec un texte à lui. */
const CORPS = new Map<string, ContextBody>([
  ["contexte", body("Nous vendons de l'énergie solaire.")],
  ["private/claire/contexte", body("Je tutoie mes collègues.")],
  ["achats/contexte", body("Les commandes fournisseurs passent par le bon de commande.", "Commandes fournisseurs.")],
  ["compta/contexte", body("Les factures fournisseurs se rapprochent chaque mois.", "Rapprochement des factures.")],
  ["juridique/contexte", body("Tout contrat se relit avant signature.", "Relecture des contrats.")],
  ["rh/contexte", body("Les congés se posent deux semaines avant.", "Congés et absences.")],
  ["ventes/contexte", body("Une relance de devis part sous huit jours.", "Relances de devis.")],
])

const textes = (teams: IdentityTeam[], phrase?: string) => contextParts(identity(teams), faits(teams), CORPS, phrase).map((part) => part.text)

describe("team Contextes served by closeness to the request", () => {
  it("should serve three team Contextes in full beyond three teams, and every other one by its head and one line", () => {
    const parts = textes(EQUIPES, "relancer un devis client")
    const pleins = parts.filter((texte) => !texte.includes("Summarised here"))
    expect(pleins).toHaveLength(5)
    const resume = parts.find((texte) => texte.startsWith("## Context: team Ressources humaines"))
    expect(resume).toBe(
      '## Context: team Ressources humaines (rh/contexte)\nTeam Ressources humaines.\nCongés et absences. Summarised here: other team contexts are closer to this request. Read it in full with acme_read {"path": "rh/contexte"}.',
    )
  })

  it("should always serve Tout le monde and Privé in full", () => {
    const [toutLeMonde, prive] = textes(EQUIPES, "congés")
    expect(toutLeMonde).toContain("Nous vendons de l'énergie solaire.")
    expect(prive).toContain("Je tutoie mes collègues.")
  })

  it("should pick the team whose Contexte shares words with the request, then the teams with a body, the teams led, and the order of names", () => {
    expect([...fullTeamContexts(identity(EQUIPES), CORPS, "Quelles factures rapprocher ce mois ?")]).toEqual(["compta/contexte", "ventes/contexte", "achats/contexte"])
    expect([...fullTeamContexts(identity(EQUIPES), CORPS, "contrat à relire avant signature")]).toContain("juridique/contexte")
    // Une demande sans mot commun : les départages seuls, l'équipe menée, puis l'ordre des noms.
    expect([...fullTeamContexts(identity(EQUIPES), CORPS, "bonjour")]).toEqual(["ventes/contexte", "achats/contexte", "compta/contexte"])
    // Une équipe sans Contexte publié ne prend pas une place servie en entier.
    const sansCorps = new Map([...CORPS].filter(([chemin]) => chemin !== "achats/contexte"))
    expect([...fullTeamContexts(identity(EQUIPES), sansCorps, "bonjour")]).toEqual(["ventes/contexte", "compta/contexte", "juridique/contexte"])
  })

  // Sans demande, rien n'est résumé : seul le plafond de 35 000 caractères coupe, comme avant (décidé par JB le 20/10/2026).
  it("should serve every team Contexte in full without a request", () => {
    expect(textes(EQUIPES).some((texte) => texte.includes("Summarised here"))).toBe(false)
    expect(fullTeamContexts(identity(EQUIPES), CORPS).size).toBe(EQUIPES.length)
  })

  it("should change nothing for three teams or fewer", () => {
    const trois = EQUIPES.slice(0, 3)
    expect(textes(trois, "congés").some((texte) => texte.includes("Summarised here"))).toBe(false)
  })
})
