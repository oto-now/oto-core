// Le dialogue de suppression du rail dit qui perd l'accès (`phraseDuPartage`, `ui/coque/gestes-du-rail.tsx`) : sujet
// d'abord, liste à la française, verbe accordé. Fonction pure ; le dialogue lui-même est dans
// `tests/integration/components/rail-application.test.tsx`.
import { describe, expect, it } from "vitest"
import { phraseDuPartage } from "../../packages/plateforme/ui/coque/gestes-du-rail"

const equipe = (name: string) => ({ name, level: "read" as const })

describe("phraseDuPartage", () => {
  it("should name the teams, the whole organisation then the counted people, the verb agreed, and say nothing without a share", () => {
    expect([
      phraseDuPartage({ teams: [], people: 0, org: false }),
      phraseDuPartage({ teams: [equipe("Support")], people: 0, org: false }),
      phraseDuPartage({ teams: [], people: 0, org: true }),
      phraseDuPartage({ teams: [], people: 1, org: false }),
      phraseDuPartage({ teams: [], people: 2, org: false }),
      phraseDuPartage({ teams: [equipe("Support"), equipe("Ventes")], people: 2, org: false }),
      phraseDuPartage({ teams: [equipe("Support")], people: 1, org: true }),
    ]).toEqual([
      null,
      "Support n'y aura plus accès.",
      "Toute l'organisation n'y aura plus accès.",
      "1 personne n'y aura plus accès.",
      "2 personnes n'y auront plus accès.",
      "Support, Ventes et 2 personnes n'y auront plus accès.",
      "Support, toute l'organisation et 1 personne n'y auront plus accès.",
    ])
  })
})
