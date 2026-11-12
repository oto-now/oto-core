// @vitest-environment node
// Le suivi des commentaires, en fonctions pures : à qui un fil est destiné (`concerns`, sur la règle de l'email groupé,
// `recipientsOf`), l'ordre et la borne du bloc de l'accueil (`homeCommentsOf`), la ligne de `context` (« 2 new
// comments », `recentText`) et sa relecture par l'écran du Contexte, avec la marque « for the assistant ». La lecture
// sur une base est dans `tests/integration/commentaires-suivis.test.ts`.
import { describe, expect, it } from "vitest"
import { recipientsOf } from "../../packages/plateforme/cli/comments-mail.mjs"
import { HOME_COMMENT_EXCERPT_CHARS, HOME_COMMENTS_SHOWN } from "../../packages/plateforme/schemas/accueil"
import { SERVED_RECENT } from "../../packages/plateforme/schemas/context-index"
import { concerns, homeCommentsOf, type FollowedThread, type OtherComment, type RuledThread } from "../../packages/plateforme/server/comments/followed"
import { markedPages, recentText } from "../../packages/plateforme/server/context/blocks/recent"
import { LIGNES_SERVIES } from "../../packages/plateforme/ui/contexte/libelles"
import { morceauxDuBloc } from "../../packages/plateforme/ui/contexte/parties-du-contexte"

const comment = (author: string | null, mentions: string[] = []) => ({ author, mentions })

describe("threads meant for a person", () => {
  // Chaque fil ne diffère du précédent que par ce qui change le verdict pour Léa.
  const THREADS: Record<string, RuledThread> = {
    mentioned: { author: "marc", teamLeads: [], comments: [comment("marc", ["lea"])] },
    mentionedByHerself: { author: "lea", teamLeads: [], comments: [comment("lea", ["lea"])] },
    ownThreadAlone: { author: "lea", teamLeads: [], comments: [comment("lea"), comment("lea")] },
    ownThreadAnswered: { author: "lea", teamLeads: [], comments: [comment("lea"), comment("marc")] },
    repliedThenAnswered: { author: "marc", teamLeads: [], comments: [comment("marc"), comment("lea"), comment("ada")] },
    repliedLast: { author: "marc", teamLeads: [], comments: [comment("marc"), comment("ada"), comment("lea")] },
    // Son commentaire d'ouverture supprimé : le fil reste le sien, la réponse d'un autre la prévient.
    openedThenDeleted: { author: "lea", teamLeads: [], comments: [comment("marc"), comment("ada")] },
    newThreadOfHerTeam: { author: "marc", teamLeads: ["lea"], comments: [comment("marc")] },
    newThreadOfHerTeamByHerself: { author: "lea", teamLeads: ["lea"], comments: [comment("lea")] },
    newThreadOfAnotherTeam: { author: "marc", teamLeads: ["claire"], comments: [comment("marc"), comment("ada")] },
    forgottenAuthor: { author: null, teamLeads: [], comments: [comment(null, ["lea"])] },
  }

  it("should follow a thread for a mention, for a reply of another where the person wrote, and for a new thread of a team she leads, never for her own comments alone (AC1 to AC3)", () => {
    expect(Object.fromEntries(Object.entries(THREADS).map(([name, thread]) => [name, concerns("lea", thread)]))).toEqual({
      mentioned: true,
      mentionedByHerself: false,
      ownThreadAlone: false,
      ownThreadAnswered: true,
      repliedThenAnswered: true,
      repliedLast: false,
      openedThenDeleted: true,
      newThreadOfHerTeam: true,
      newThreadOfHerTeamByHerself: false,
      newThreadOfAnotherTeam: false,
      forgottenAuthor: true,
    })
  })

  it("should follow a thread for exactly the people one of its comments notifies by email (AC7)", () => {
    const people = ["lea", "marc", "ada", "claire"]
    const notified = (thread: RuledThread) =>
      new Set(
        thread.comments.flatMap((one, rank) =>
          recipientsOf({
            author: one.author,
            mentions: one.mentions,
            first: rank === 0,
            threadAuthor: thread.author,
            earlierAuthors: thread.comments.slice(0, rank).flatMap((earlier) => earlier.author ?? []),
            teamLeads: thread.teamLeads,
          }),
        ),
      )

    expect(Object.values(THREADS).map((thread) => people.filter((person) => concerns(person, thread)))).toEqual(
      Object.values(THREADS).map((thread) => people.filter((person) => notified(thread).has(person))),
    )
  })
})

describe("comments block of the home", () => {
  const other = (at: string, surcharge: Partial<OtherComment> = {}): OtherComment => ({ author: "marc", viaAssistant: false, text: "Vu.", at, unseen: false, fresh: false, ...surcharge })
  const thread = (id: string, others: OtherComment[]): FollowedThread => ({ id, node: { id: `n-${id}`, path: `ventes/${id}`, kind: "page", title: `Page ${id}` }, others })
  const names = new Map([["marc", "Marc Petit"]])
  const nameOf = (userId: string) => names.get(userId)

  it("should show the unread threads first, then the most recent comment of another first, ties by id, with the author and the excerpt of that comment", () => {
    const long = `Un  texte\nsur deux lignes ${"a".repeat(HOME_COMMENT_EXCERPT_CHARS)}`
    // Écrits hors de l'ordre attendu : le plus ancien non lu passe avant le plus récent lu.
    const block = homeCommentsOf(
      [
        thread("read-recent", [other("2026-11-12T10:00:00+00:00")]),
        thread("b-tie", [other("2026-11-11T10:00:00+00:00")]),
        thread("unread-old", [other("2026-11-01T10:00:00+00:00", { unseen: true }), other("2026-11-02T10:00:00+00:00", { author: "gone", viaAssistant: true, text: long })]),
        thread("a-tie", [other("2026-11-11T10:00:00+00:00", { author: null })]),
        thread("unread-recent", [other("2026-11-10T10:00:00+00:00", { unseen: true })]),
        thread("own-only", []),
      ],
      nameOf,
    )

    expect(block.threads.map((line) => [line.id, line.unread, line.author])).toEqual([
      ["unread-recent", true, "Marc Petit"],
      ["unread-old", true, null],
      ["read-recent", false, "Marc Petit"],
      ["a-tie", false, null],
      ["b-tie", false, "Marc Petit"],
    ])
    const [, cut] = block.threads
    expect([cut.path, cut.title, cut.viaAssistant, cut.at, cut.excerpt.length, cut.excerpt.startsWith("Un texte sur deux lignes aaa"), cut.excerpt.endsWith("a…")]).toEqual([
      "ventes/unread-old",
      "Page unread-old",
      true,
      "2026-11-02T10:00:00+00:00",
      HOME_COMMENT_EXCERPT_CHARS,
      true,
      true,
    ])
    expect(block.more).toBe(0)
  })

  it("should show ten threads at most, the unread ones kept, and count the others (AC5)", () => {
    const read = Array.from({ length: HOME_COMMENTS_SHOWN }, (_, rank) => thread(`read-${rank}`, [other(`2026-11-${String(rank + 10)}T10:00:00+00:00`)]))
    const unread = [thread("unread-0", [other("2026-10-01T10:00:00+00:00", { unseen: true })]), thread("unread-1", [other("2026-10-02T10:00:00+00:00", { unseen: true })])]

    const exact = homeCommentsOf(read, nameOf)
    const beyond = homeCommentsOf([...read, ...unread], nameOf)

    expect([exact.threads.length, exact.more]).toEqual([HOME_COMMENTS_SHOWN, 0])
    expect([beyond.threads.length, beyond.more, beyond.threads.slice(0, 3).map((line) => line.id), beyond.threads.at(-1)?.id]).toEqual([
      HOME_COMMENTS_SHOWN,
      2,
      ["unread-1", "unread-0", "read-9"],
      "read-2",
    ])
  })
})

describe("new comments in the recent content of context", () => {
  const documents = [
    { path: "ventes/devis", kind: "page", title: "Devis 2026", at: "2026-10-26T08:00:00.000Z" },
    { path: "ventes/faq", kind: "page", title: "FAQ", at: "2026-10-25T08:00:00.000Z" },
  ]
  const news = { versions: [{ path: "ventes/devis", kind: "page", revision: 3, title: "Devis 2026", at: "2026-10-26T08:00:00.000Z" }], activations: [] }
  const waiting = [{ id: "n1", path: "ventes/devis", kind: "page", title: "Devis 2026", threads: 1, at: "2026-10-24T08:00:00.000Z" }]
  const commented = [
    { path: "ventes/devis", kind: "page", title: "Devis 2026", comments: 2, at: "2026-10-27T08:00:00.000Z" },
    { path: "ventes/faq", kind: "page", title: "FAQ", comments: 1, at: "2026-10-22T08:00:00.000Z" },
    { path: "ventes/suivi", kind: "table", title: "Suivi", comments: 3, at: "2026-10-23T08:00:00.000Z" },
  ]
  const since = "2026-10-20T09:00:00.000Z"

  it("should say the new comments on the line that names the page, before the comments for the assistant, else on a line of its own dated by the last one, and change nothing without one (AC6)", () => {
    const text = recentText(documents, news, since, markedPages(waiting, commented))?.text ?? ""

    expect(text.split("\n")).toEqual([
      "## Recent content (new: published since 2026-10-20)",
      "- ventes/devis (page, new v3, 2 new comments, 1 comment for the assistant, 2026-10-26): Devis 2026",
      "- ventes/faq (page, 1 new comment, 2026-10-25): FAQ",
      "- ventes/suivi (table, 3 new comments, 2026-10-23): Suivi",
      SERVED_RECENT.commentsHint,
    ])
    expect(recentText(documents, news, since, markedPages(waiting, []))).toEqual(recentText(documents, news, since, waiting))
    expect(recentText(documents, news, since, markedPages([], []))).toEqual(recentText(documents, news, since))
    // Sans marque, ni compte ni consigne.
    expect(recentText(documents, news, since, markedPages([], []))?.text.split("\n")).toEqual([
      "## Recent content (new: published since 2026-10-20)",
      "- ventes/devis (page, new v3, 2026-10-26): Devis 2026",
      "- ventes/faq (page, 2026-10-25): FAQ",
    ])
  })

  it("should keep the block within its twenty lines, a page with new comments taking its place by its date", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ path: `ventes/p${String(index).padStart(2, "0")}`, kind: "page", title: `P${index}`, at: `2026-10-${String(26 - index).padStart(2, "0")}T08:00:00.000Z` }))
    const lines = recentText(many, null, since, markedPages([], [commented[2]]))?.text.split("\n") ?? []

    // Le titre, les 20 lignes, puis la consigne, qui ne prend la place d'aucune.
    expect([lines.length, lines.indexOf("- ventes/suivi (table, 3 new comments, 2026-10-23): Suivi"), lines.at(-2), lines.at(-1)]).toEqual([
      22,
      5,
      "- ventes/p18 (page, 2026-10-08): P18",
      SERVED_RECENT.commentsHint,
    ])
  })

  it("should be read back by the Contexte screen, with the comments for the assistant, said in French, without the hint meant for the assistant", () => {
    const text = recentText(documents, news, since, markedPages(waiting, commented))?.text ?? ""

    // La consigne est servie, et l'écran ne la rend ni en ligne de contenu ni en texte brut.
    expect(text.split("\n").at(-1)).toBe(SERVED_RECENT.commentsHint)
    expect(morceauxDuBloc("recent content", text)).toEqual([
      {
        genre: "liste",
        legende: { genre: "nouveautes", depuis: "2026-10-20" },
        lignes: [
          { genre: "version", chemin: "ventes/devis", nature: "page", revision: 3, commentaires: 2, pourLAssistant: 1, date: "2026-10-26", titre: "Devis 2026" },
          { genre: "recent", chemin: "ventes/faq", nature: "page", commentaires: 1, date: "2026-10-25", titre: "FAQ" },
          { genre: "recent", chemin: "ventes/suivi", nature: "table", commentaires: 3, date: "2026-10-23", titre: "Suivi" },
        ],
      },
    ])
    // Une marque qui n'est aucune des trois laisse la ligne telle que servie, jamais perdue.
    expect(morceauxDuBloc("recent content", "## Recent content\n- ventes/faq (page, 2 old comments, 2026-10-25): FAQ")).toEqual([
      { genre: "brut", texte: "- ventes/faq (page, 2 old comments, 2026-10-25): FAQ" },
    ])
    expect([LIGNES_SERVIES.nouveauxCommentaires(1), LIGNES_SERVIES.nouveauxCommentaires(2), LIGNES_SERVIES.pourLAssistant(1), LIGNES_SERVIES.pourLAssistant(2)]).toEqual([
      "1 nouveau commentaire",
      "2 nouveaux commentaires",
      "1 fil en attente d'un assistant",
      "2 fils en attente d'un assistant",
    ])
  })
})
