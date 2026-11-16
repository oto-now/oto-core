// @vitest-environment node
// L'email groupé des commentaires, en fonctions pures (`cli/comments-mail.mjs`) : qui un commentaire prévient, la
// fenêtre d'une heure, l'adresse des liens, l'extrait et le modèle. Le passage sur une base est dans
// `tests/integration/commentaires-email.test.ts`.
import { describe, expect, it } from "vitest"
import { commentsDigestMail, digestSubject, excerpt, EXCERPT_CHARS, isDue, linkOrigin, recipientsOf } from "../../packages/plateforme/cli/comments-mail.mjs"

const MINUTE = 60_000

describe("recipients of a comment", () => {
  it("should notify the mentioned people, the thread author and the earlier participants of a reply, the team leads of a new thread, and never the author", () => {
    const reply = { author: "lea", mentions: [], first: false, threadAuthor: "marc", earlierAuthors: ["marc", "ada", "lea"], teamLeads: ["claire"] }
    const opening = { author: "marc", mentions: [], first: true, threadAuthor: "marc", earlierAuthors: [], teamLeads: ["claire", "marc"] }

    expect({
      reply: recipientsOf(reply),
      replyWithMention: recipientsOf({ ...reply, mentions: ["paul", "marc", "lea"] }),
      // L'auteur du fil a été oublié, comme l'auteur du commentaire d'un assistant resté sans personne.
      replyToForgotten: recipientsOf({ ...reply, threadAuthor: null, earlierAuthors: [] }),
      opening: recipientsOf(opening),
      openingWithoutTeam: recipientsOf({ ...opening, teamLeads: [], mentions: ["paul"] }),
    }).toEqual({
      reply: ["marc", "ada"],
      replyWithMention: ["paul", "marc", "ada"],
      replyToForgotten: [],
      opening: ["claire"],
      openingWithoutTeam: ["paul"],
    })
  })
})

describe("hour of a person", () => {
  it("should let an email leave without a previous one, or an hour after it, within the slack of the hourly task", () => {
    const now = new Date("2026-11-12T10:00:00Z")
    const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE)

    expect([isDue(null, now), isDue(ago(10), now), isDue(ago(54), now), isDue(ago(55), now), isDue(ago(60), now), isDue(ago(180), now)]).toEqual([true, false, false, true, true, true])
  })
})

describe("origin of the links", () => {
  it("should take an address of the organisation, out of the development machine first, in https, and none without an address", () => {
    expect([linkOrigin(["demo.localhost", "b.example.invalid", "a.example.invalid"]), linkOrigin(["demo.localhost"]), linkOrigin([])]).toEqual([
      "https://a.example.invalid",
      "http://demo.localhost",
      null,
    ])
  })
})

describe("excerpt of a comment", () => {
  it("should keep a short text, cut a long one at 200 characters with an ellipsis, and never split a surrogate pair", () => {
    const long = "a".repeat(EXCERPT_CHARS + 50)
    // Une paire de substitution à cheval sur la coupe : l'emoji entier part, jamais sa première moitié.
    const astride = `${"a".repeat(EXCERPT_CHARS - 2)}${String.fromCodePoint(0x1f600)}suite`

    expect({
      short: excerpt("  Un texte\nsur deux lignes.  "),
      atLimit: excerpt("a".repeat(EXCERPT_CHARS)).length,
      long: [excerpt(long).length, excerpt(long).endsWith("a…")],
      astride: [excerpt(astride), excerpt(astride).isWellFormed()],
    }).toEqual({
      short: "Un texte sur deux lignes.",
      atLimit: EXCERPT_CHARS,
      long: [EXCERPT_CHARS, true],
      astride: [`${"a".repeat(EXCERPT_CHARS - 2)}…`, true],
    })
  })
})

describe("grouped email of the comments", () => {
  const line = { title: "Offre <tarifaire>", path: "ventes/offre", author: "Léa Roux", viaAssistant: false, text: "Le tarif est-il à jour ?" }
  const input = { to: "claire@example.invalid", orgName: "Acme & Fils", logoUrl: "https://cdn.example.invalid/logo.png", origin: "https://acme.example.invalid" }

  it("should write the subject in the singular and in the plural", () => {
    expect([digestSubject(1), digestSubject(2), digestSubject(12)]).toEqual([
      "1 nouveau commentaire sur vos pages",
      "2 nouveaux commentaires sur vos pages",
      "12 nouveaux commentaires sur vos pages",
    ])
  })

  it("should carry one line per comment (page, author, excerpt, link to the page) and nothing else of the comment (AC6)", () => {
    const long = `${"Un très long commentaire. ".repeat(20)}FIN-DU-TEXTE`
    const mail = commentsDigestMail({
      ...input,
      lines: [line, { ...line, title: "Devis", path: "ventes/devis/modele", author: "Marc Petit", viaAssistant: true, text: long }, { ...line, author: null }],
    })

    expect({ to: mail.to, subject: mail.subject }).toEqual({ to: "claire@example.invalid", subject: "3 nouveaux commentaires sur vos pages" })
    expect(mail.text.split("\n")).toEqual([
      "Bonjour,",
      "",
      "3 nouveaux commentaires vous concernent sur les pages de l'organisation Acme & Fils :",
      "",
      "- Offre <tarifaire>, par Léa Roux : « Le tarif est-il à jour ? »",
      "  https://acme.example.invalid/n/ventes/offre",
      "",
      `- Devis, par Assistant de Marc Petit : « ${excerpt(long)} »`,
      "  https://acme.example.invalid/n/ventes/devis/modele",
      "",
      "- Offre <tarifaire>, par Ancien membre : « Le tarif est-il à jour ? »",
      "  https://acme.example.invalid/n/ventes/offre",
      "",
      "Vous recevez au plus un email par heure : il réunit les commentaires arrivés depuis le précédent.",
    ])
    expect([mail.text.includes("FIN-DU-TEXTE"), mail.html.includes("FIN-DU-TEXTE")]).toEqual([false, false])
  })

  it("should escape what it puts in the HTML, and show a logo only from an https address", () => {
    const html = (logoUrl: unknown) => commentsDigestMail({ ...input, logoUrl, lines: [{ ...line, text: `<script>alert("x")</script>` }] }).html

    expect(html(input.logoUrl)).toContain("<strong>Offre &lt;tarifaire&gt;</strong>, par Léa Roux<br>« &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; »")
    expect(html(input.logoUrl)).toContain('<h1 style="margin:0 0 24px;font-size:22px;line-height:1.3">Acme &amp; Fils</h1>')
    expect(html(input.logoUrl)).toContain('<a href="https://acme.example.invalid/n/ventes/offre">Ouvrir la page</a>')
    expect([input.logoUrl, "http://cdn.example.invalid/logo.png", "javascript:alert(1)", null].map((logo) => html(logo).includes("<img"))).toEqual([true, false, false, false])
  })
})
