import { describe, expect, it } from "vitest"
import { NODE_HEAD_MAX } from "@otomata_tech/oto_platform/schemas"
import { CREATION } from "../../packages/plateforme/ui/coque/libelles"
import { resumeMontre } from "../../packages/plateforme/ui/noeud/libelles"
import { nomDeLAssistant } from "../../packages/plateforme/ui/tableau/libelles"

// Les libellés d'E11-S05 : le nom de l'assistant dans le vide d'un tableau (AC-h1, HN-E11S05-17, HN-E11S05-18), le
// résumé montré pour une procédure seule (AC-f1, AC-f2), le résumé par défaut d'une procédure (AC-f3).

describe("nomDeLAssistant (E11-S05, AC-h1)", () => {
  it.each([
    ["claude.ai", "Claude"],
    ["Claude Code", "Claude"],
    ["ChatGPT", "ChatGPT"],
    ["mistral-le-chat", "votre assistant"],
    [undefined, "votre assistant"],
  ])("should name the family %s « %s »", (famille, nom) => {
    expect(nomDeLAssistant(famille)).toBe(nom)
  })
})

describe("resumeMontre (E11-S05, AC-f1)", () => {
  it("should show the summary of a procedure only", () => {
    expect(["page", "procedure", "context", "table"].map(resumeMontre)).toEqual([false, true, false, false])
  })
})

describe("the default summary of a procedure (E11-S05, AC-f3)", () => {
  it("should say how to write it, word for word, within the bound of a summary; those of a page and a table unchanged", () => {
    const resume = CREATION.resumeParDefaut.procedure
    expect(resume).toBe("Résumé à compléter : dites ce que fait la procédure et comment on la demande, avec les mots de l'équipe. L'assistant la choisit sur ce résumé et sur le titre.")
    expect([...resume]).toHaveLength(158)
    expect(resume.length).toBeLessThanOrEqual(NODE_HEAD_MAX)
    expect([CREATION.resumeParDefaut.page, CREATION.resumeParDefaut.table]).toEqual(["Résumé de la page à compléter.", "Résumé du tableau à compléter."])
  })
})
