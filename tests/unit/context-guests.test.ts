// La vue invité servie par `context`, fonctions pures : les points d'entrée tirés des contenus lisibles
// (`guestTeamsOf`) et le texte du bloc (`guestsText`) : la première phrase des résumés, 25 points d'entrée au plus, puis
// la ligne qui compte les autres (contexte plus court). La lecture sur une vraie base, les droits et l'assemblage sont
// dans `tests/integration/vue-invite.test.ts` ; la relecture par l'écran dans `tests/unit/texte-servi.test.ts`.
import { describe, expect, it } from "vitest"
import { SERVED_GUESTS } from "../../packages/plateforme/schemas"
import { GUESTS_MAX, guestsText, type GuestView } from "../../packages/plateforme/server/context/blocks/guests"
import { guestTeamsOf } from "../../packages/plateforme/server/nodes/guest-entries"

const node = (path: string, title = path) => ({ path, title, summary: `Résumé de ${path}.`, kind: "page" })

const HEAD = [
  SERVED_GUESTS.title,
  "You are not a member of these teams: you read only what they shared with you, whether listed here or not. Read one with acme_read; search them with acme_find.",
]

/** Une équipe de `count` entrées, chacune avec un résumé de `summary` caractères faits de mots de neuf lettres. */
function team(name: string, count: number, summary: number): GuestView {
  const words = "abcdefghi ".repeat(Math.ceil(summary / 10)).slice(0, summary)
  const slug = name.toLowerCase()
  return { id: slug, slug, name, leads: ["Paul Girard"], entries: Array.from({ length: count }, (_, rank) => ({ path: `${slug}/page_${rank}`, title: `Page ${rank}`, summary: words, kind: "page", under: 0 })) }
}

describe("guestTeamsOf", () => {
  it("should keep the readable contents without a readable ancestor, count what is under them at any depth, never list the folder of the team, and order teams by name and entries by path", () => {
    const teams = [
      { id: "t-s", slug: "support", name: "Support" },
      { id: "t-e", slug: "etudes", name: "Études" },
      { id: "t-v", slug: "ventes", name: "Ventes" },
    ]
    const readable = [
      node("support/faq", "FAQ"),
      // Le dossier de l'équipe, lisible : jamais une ligne, ses contenus le sont.
      node("etudes"),
      node("etudes/b"),
      node("etudes/a"),
      node("etudes/a/x"),
      // Sous un parent illisible : compté sous son ancêtre lisible le plus haut.
      node("etudes/a/cache/y"),
      // Sans ancêtre lisible : un point d'entrée, même profond.
      node("support/interne/note"),
    ]

    expect(guestTeamsOf(teams, readable).map((one) => [one.name, one.entries.map((entry) => [entry.path, entry.under])])).toEqual([
      ["Études", [["etudes/a", 2], ["etudes/b", 0]]],
      ["Support", [["support/faq", 0], ["support/interne/note", 0]]],
    ])
  })
})

describe("guestsText", () => {
  it("should serve the first sentence of each summary, with the count of a folder, and the same text whatever the request", () => {
    const support: GuestView = {
      ...team("Support", 0, 0),
      entries: [
        { path: "support/dossier", title: "Dossier", summary: "Les fiches. Mises à jour chaque lundi.", kind: "page", under: 4 },
        { path: "support/faq", title: "FAQ", summary: "Les questions.", kind: "page", under: 0 },
      ],
    }
    const finance: GuestView = { ...team("Finance", 1, 20), leads: [] }

    const served = guestsText([finance, support], "acme")

    expect(served).toEqual({
      more: 0,
      text: [...HEAD, "### Team Finance.", "- finance/page_0 — Page 0 — abcdefghi abcdefghi", "### Team Support. Lead: Paul Girard.", "- support/dossier (+4 under it) — Dossier — Les fiches.", "- support/faq — FAQ — Les questions."].join("\n"),
    })
    expect(guestsText([finance, support], "acme")).toEqual(served)
  })

  // Contexte plus court : 25 points d'entrée au plus, toutes équipes comprises, puis une ligne qui compte les autres et
  // dit de les chercher par `find` ; une équipe dont aucun n'est listé n'a pas d'intertitre. Remplace les paliers de taille.
  it("should list 25 entry points at most, in team then path order, then say how many more and how to find them", () => {
    const at = (count: number) => guestsText([team("Finance", count, 20), team("Support", 10, 20)], "acme")
    const exact = guestsText([team("Finance", GUESTS_MAX, 20)], "acme")
    const over = guestsText([team("Finance", GUESTS_MAX + 1, 20)], "acme")
    const lines = at(20).text.split("\n")

    expect({
      max: GUESTS_MAX,
      shown: lines.filter((line) => line.startsWith("- ")).length,
      supportShown: lines.filter((line) => line.startsWith("- support/")).length,
      last: lines.at(-1),
      more: at(20).more,
      // Finance prend les 25 : Support n'a plus d'intertitre.
      supportHeading: at(25).text.includes("### Team Support"),
      exact: [exact.more, exact.text.split("\n").at(-1)],
      over: [over.more, over.text.split("\n").at(-1)],
    }).toEqual({
      max: 25,
      shown: 25,
      supportShown: 5,
      last: "and 5 more shared with you: search them with acme_find and the words of what you need.",
      more: 5,
      supportHeading: false,
      exact: [0, "- finance/page_24 — Page 24 — abcdefghi abcdefghi"],
      over: [1, "and 1 more shared with you: search them with acme_find and the words of what you need."],
    })
  })
})
