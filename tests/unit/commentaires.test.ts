// @vitest-environment node
// Les commentaires d'une page, sans base : la lecture des mentions d'un texte (`readMentions`, `addressesAssistant`), l'état
// calculé du passage commenté (`anchorOf`), l'attente d'un assistant (`waitingAssistant`) et l'ordre des fils
// (`orderThreads`), fonctions pures de `server/comments/`. Le service et ses
// droits sont sur une vraie base (`tests/integration/commentaires.test.ts`).
import { describe, expect, it } from "vitest"
import { COMMENT_MAX_CHARS, COMMENT_MENTIONS_MAX } from "../../packages/plateforme/schemas"
import { addressesAssistant, readMentions } from "../../packages/plateforme/server/comments/mentions"
import { anchorOf, orderThreads, waitingAssistant } from "../../packages/plateforme/server/comments/threads"
import { lecteursNommes, morceauxDuTexte } from "../../packages/plateforme/ui/noeud/commentaires/mentions"
import { readingRatio } from "../helpers/temps-lineaire"

const READERS = [
  { id: "lea", name: "Léa Roux" },
  { id: "lea-martin", name: "Léa Roux Martin" },
  { id: "paul", name: "Paul Girard" },
  { id: "paul-bis", name: "Paul Girard" },
]

describe("readMentions", () => {
  it("should read the full name of a reader after an @, the longest first, and leave any other text alone", () => {
    const cases: Record<string, string> = {
      reader: "Merci @Léa Roux, c'est corrigé.",
      unknown: "Voir avec @Marc Petit demain.",
      two: "@Paul Girard et @Léa Roux : à relire.",
      twice: "@Léa Roux ? @Léa Roux !",
      alone: "Rendez-vous @ 14 h, ou @",
      caseless: "merci @léa ROUX",
      longest: "Pour @Léa Roux Martin.",
      prolonged: "Pour @Léa Rouxel.",
      address: "Écrire à contact@Léa Roux",
      firstNameOnly: "Merci @Léa",
    }
    const read = Object.fromEntries(Object.entries(cases).map(([name, text]) => [name, readMentions(text, READERS)]))
    expect(read).toEqual({
      reader: ["lea"],
      unknown: [],
      // Des homonymes sont tous mentionnés : le texte ne les distingue pas.
      two: ["paul", "paul-bis", "lea"],
      twice: ["lea"],
      alone: [],
      caseless: ["lea"],
      longest: ["lea-martin"],
      prolonged: [],
      address: [],
      firstNameOnly: [],
    })
  })

  it("should keep no more mentions than the base accepts", () => {
    const readers = Array.from({ length: COMMENT_MENTIONS_MAX + 5 }, (_, rank) => ({ id: `p${rank}`, name: `Personne ${rank}x` }))
    const text = readers.map((reader) => `@${reader.name}`).join(" ")
    expect(readMentions(text, readers)).toEqual(readers.slice(0, COMMENT_MENTIONS_MAX).map((reader) => reader.id))
  })

  it("should read a hostile text of the largest size in linear time", () => {
    // Le pire texte : des `@` suivis du début du nom de chaque lecteur, jamais du nom entier.
    const readers = Array.from({ length: 200 }, (_, rank) => ({ id: `p${rank}`, name: `Aaaaaaaaaaaaaaaaaaaa ${rank}` }))
    const hostile = (chars: number) => "@Aaaaaaaaaaaaaaaaaaaa ".repeat(Math.ceil(chars / 22)).slice(0, chars)
    const whole = COMMENT_MAX_CHARS * 25
    expect(readingRatio((text) => readMentions(text, readers), hostile(whole / 4), hostile(whole)).linear).toBe(true)
  })
})

describe("mentions on the screen", () => {
  // L'écran annonce avant l'envoi, et met en valeur après, ce que le service enregistre (`portage-ecrans.md § 6`).
  it("should name and highlight the readers the service records: the longest of two nested names, whatever the composition of the accents", () => {
    const nameOf = (id: string) => READERS.find((reader) => reader.id === id)?.name
    const nested = "Pour @Léa Roux Martin."
    const both = `Pour @Léa Roux Martin, puis ${"@Léa Roux".normalize("NFD")} seule.`
    const highlighted = (text: string) => morceauxDuTexte(text, readMentions(text, READERS).flatMap((id) => nameOf(id) ?? [])).filter((piece) => piece.mention).map((piece) => piece.texte)

    expect({ service: readMentions(nested, READERS).map(nameOf), screen: lecteursNommes(nested, READERS), highlighted: highlighted(nested) }).toEqual({
      service: ["Léa Roux Martin"],
      screen: ["Léa Roux Martin"],
      highlighted: ["@Léa Roux Martin"],
    })
    expect({ service: readMentions(both, READERS).map(nameOf), screen: lecteursNommes(both, READERS), highlighted: highlighted(both) }).toEqual({
      service: ["Léa Roux Martin", "Léa Roux"],
      screen: ["Léa Roux Martin", "Léa Roux"],
      highlighted: ["@Léa Roux Martin", "@Léa Roux"],
    })
  })
})

describe("addressesAssistant", () => {
  it("should read @assistant as a whole word, whatever its case, and nothing else", () => {
    const cases: Record<string, string> = {
      plain: "@assistant corrige le délai partout",
      inside: "Merci, et @Assistant: revois aussi le titre.",
      upper: "@ASSISTANT ?",
      prolonged: "Pour mon @assistante.",
      address: "Écrire à moi@assistant",
      word: "L'assistant a répondu.",
      alone: "Rendez-vous @ 14 h",
    }
    expect(Object.fromEntries(Object.entries(cases).map(([name, text]) => [name, addressesAssistant(text)]))).toEqual({
      plain: true,
      inside: true,
      upper: true,
      prolonged: false,
      address: false,
      word: false,
      alone: false,
    })
  })

  it("should read a hostile text of the largest size in linear time", () => {
    const hostile = (chars: number) => "@assistan ".repeat(Math.ceil(chars / 10)).slice(0, chars)
    const whole = COMMENT_MAX_CHARS * 25
    expect(readingRatio(addressesAssistant, hostile(whole / 4), hostile(whole)).linear).toBe(true)
  })
})

describe("waitingAssistant", () => {
  it("should wait while open, asked, and not answered by an assistant since the last request", () => {
    const human = { toAssistant: false, viaAssistant: false }
    const asked = { toAssistant: true, viaAssistant: false }
    const answered = { toAssistant: false, viaAssistant: true }
    expect({
      neverAsked: waitingAssistant("open", [human, answered]),
      asked: waitingAssistant("open", [human, asked]),
      humanReply: waitingAssistant("open", [asked, human]),
      answered: waitingAssistant("open", [asked, answered]),
      askedAgain: waitingAssistant("open", [asked, answered, human, asked]),
      // Un assistant qui demande à son tour : sa demande attend le prochain.
      askedByAnAssistant: waitingAssistant("open", [asked, { toAssistant: true, viaAssistant: true }]),
      resolved: waitingAssistant("resolved", [asked]),
      empty: waitingAssistant("open", []),
    }).toEqual({ neverAsked: false, asked: true, humanReply: true, answered: false, askedAgain: true, askedByAnAssistant: true, resolved: false, empty: false })
  })
})

describe("anchorOf", () => {
  it("should tell the page, an intact block, a block published again since, and a block no longer published", () => {
    const published = new Map([
      ["kept", 3],
      ["rewritten", 5],
    ])
    expect({
      page: anchorOf({ block_id: null, block_revision: null }, published),
      intact: anchorOf({ block_id: "kept", block_revision: 3 }, published),
      changed: anchorOf({ block_id: "rewritten", block_revision: 4 }, published),
      deleted: anchorOf({ block_id: "gone", block_revision: 2 }, published),
    }).toEqual({ page: "page", intact: "intact", changed: "changed", deleted: "deleted" })
  })
})

describe("orderThreads", () => {
  it("should put the open threads first, then the most recent first", () => {
    const threads = [
      { id: "resolved-recent", status: "resolved" as const, createdAt: "2026-11-12T10:00:00.5+00:00" },
      { id: "open-old", status: "open" as const, createdAt: "2026-11-01T08:00:00+00:00" },
      { id: "resolved-old", status: "resolved" as const, createdAt: "2026-11-02T08:00:00+00:00" },
      { id: "open-recent", status: "open" as const, createdAt: "2026-11-12T09:00:00.123456+00:00" },
    ]
    expect(orderThreads(threads).map((thread) => thread.id)).toEqual(["open-recent", "open-old", "resolved-recent", "resolved-old"])
  })
})
