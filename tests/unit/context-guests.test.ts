// La vue invité servie par `context`, fonctions pures : les points d'entrée tirés des contenus lisibles
// (`guestTeamsOf`) et le texte du bloc à chacun de ses quatre paliers (`guestsText`), choisis par la taille seule. La
// lecture sur une vraie base, les droits et l'assemblage sont dans `tests/integration/vue-invite.test.ts` ; la relecture
// par l'écran dans `tests/unit/texte-servi.test.ts`.
import { describe, expect, it } from "vitest"
import { SERVED_GUESTS } from "../../packages/plateforme/schemas"
import { GUEST_SUMMARY_MAX, GUESTS_FULL_MAX, GUESTS_PLAIN_MAX, guestsText, type GuestView } from "../../packages/plateforme/server/context/blocks/guests"
import { guestTeamsOf } from "../../packages/plateforme/server/nodes/guest-entries"

const node = (path: string, title = path) => ({ path, title, summary: `Résumé de ${path}.`, kind: "page" })

const HEAD = [
  SERVED_GUESTS.title,
  "You are not a member of these teams: you read only what is listed here and what sits under a listed folder. Read one with acme_read; search them with acme_find.",
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
  it("should serve whole summaries while the block fits, with the count of a folder, and the same text whatever the request", () => {
    const support: GuestView = { ...team("Support", 0, 0), entries: [{ path: "support/dossier", title: "Dossier", summary: "Les fiches.", kind: "page", under: 4 }, { path: "support/faq", title: "FAQ", summary: "Les questions.", kind: "page", under: 0 }] }
    const finance: GuestView = { ...team("Finance", 1, 20), leads: [] }

    const served = guestsText([finance, support], "acme")

    expect(served).toEqual({
      tier: 1,
      text: [...HEAD, "### Team Finance.", "- finance/page_0 — Page 0 — abcdefghi abcdefghi ", "### Team Support. Lead: Paul Girard.", "- support/dossier (+4 under it) — Dossier — Les fiches.", "- support/faq — FAQ — Les questions."].join("\n"),
    })
    expect(guestsText([finance, support], "acme")).toEqual(served)
  })

  it("should fall back by size alone, one tier for the whole block: summaries cut at a word, then none, then one line per team", () => {
    // 30 entrées à 190 caractères de résumé dépassent 5 000 ; coupées à 100, elles tiennent.
    const short = guestsText([team("Support", 30, 190)], "acme")
    // 60 entrées dépassent 5 000 même coupées, et tiennent sans résumé.
    const plain = guestsText([team("Support", 60, 190)], "acme")
    // 400 entrées dépassent 10 000 sans résumé : une ligne par équipe.
    const counted = guestsText([team("Support", 400, 190), { ...team("Ventes", 1, 10), entries: [{ path: "ventes/seul", title: "Seul", summary: "s", kind: "page", under: 0 }] }], "acme")
    const line = (text: string, rank: number) => text.split("\n")[rank]

    expect({
      tiers: [short.tier, plain.tier, counted.tier],
      shortLine: line(short.text, 3),
      shortFits: short.text.length <= GUESTS_FULL_MAX,
      plainLine: line(plain.text, 3),
      plainFits: plain.text.length <= GUESTS_PLAIN_MAX,
      counted: counted.text.split("\n"),
    }).toEqual({
      tiers: [2, 3, 4],
      // Le dernier mot entier dans la borne, puis « … » : jamais un mot coupé.
      shortLine: `- support/page_0 — Page 0 — ${"abcdefghi ".repeat(GUEST_SUMMARY_MAX / 10).trimEnd()}…`,
      shortFits: true,
      plainLine: "- support/page_0 — Page 0",
      plainFits: true,
      counted: [...HEAD, "### Team Support. Lead: Paul Girard. 400 contents shared with you: search them with acme_find.", "### Team Ventes. Lead: Paul Girard. 1 content shared with you: search it with acme_find."],
    })
  })
})
