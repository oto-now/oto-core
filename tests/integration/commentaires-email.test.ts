// @vitest-environment node
// L'email groupé des commentaires sur une vraie base (`cli/comments-notify.mjs`, tables `comment_mails` et
// `comment_mail_items` de la migration `20261112090000`) : un passage de la commande, joué par son service
// (`notifyComments`) sur la connexion d'administration, avec un transport de capture. Aucun email ne part. L'organisation
// O : Claire mène Ventes, qui possède les pages commentées ; Léa en est membre ; Marc lit chaque page par une règle qui le
// nomme. La base est partagée : un passage sert toutes les organisations, donc chaque cas ne lit du transport que les
// emails des personnes de O, et repart de fils et d'heures remis à zéro. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { commentsNotifyCommand, notifyComments } from "../../packages/plateforme/cli/comments-notify.mjs"
import { deleteComment } from "../../packages/plateforme/server/comments/comments"
import { homeComments } from "../../packages/plateforme/server/comments/followed"
import { listComments, postComment, setThreadStatus } from "../../packages/plateforme/server/comments/threads"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261113180000"
const pending = (await pendingMigrations()).includes(VERSION)

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "grouped email of the comments on a real database"
const suite = !sqlConfigured ? `${SUITE} (${SQL_SKIP_REASON})` : pending ? `${SUITE} (${pendingReason([VERSION])})` : SUITE

const MINUTE = 60_000

type Who = "claire" | "lea" | "marc"
type Mail = { to: string; subject: string; text: string; html: string }

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Who, { db: PlatformDb; identity: Identity }>()

  /** Une page publiée de Ventes, que Marc lit par une règle qui le nomme. */
  async function page(title: string): Promise<{ id: string; path: string; url: string }> {
    const path = `ventes/email_${hex(3)}`
    const id = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title })
    await fx.publishBlocks(id, [{ type: "paragraph", text: "Le corps de la page, jamais dans un email." }])
    await fx.addRule({ orgId: o.org.id, nodeId: id, userId: o.people.marc.id, level: "read" })
    return { id, path, url: `https://${o.host}/n/${path}` }
  }

  /** Un commentaire écrit par `who` ; rend son fil et son identifiant. */
  async function post(who: Who, input: Record<string, unknown>): Promise<{ thread: string; comment: string }> {
    const session = sessions.get(who)
    if (!session) throw new Error(`${who} has no session`)
    const { data } = await postComment(session.db, session.identity, input)
    return { thread: data.thread.id, comment: data.comment }
  }

  const session = (who: Who) => {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  /** Un passage à `now` ; rend les emails des personnes de O, et ce que le passage a écrit sur sa sortie d'erreur. */
  async function pass(now: Date, failing: string[] = []): Promise<{ mails: Mail[]; errors: string[]; failures: number }> {
    const sent: Mail[] = []
    const errors: string[] = []
    const ours = new Set(Object.values(o.people).map((person) => person.email))
    const report = await notifyComments({
      sql: fx.admin,
      now,
      printError: (line) => errors.push(line),
      send: async (mail) => {
        // Le refus d'un relais, tel que nodemailer le lève : un code, et un message qui porte l'adresse.
        if (failing.includes(mail.to)) throw Object.assign(new Error(`relay refused ${mail.to}`), { code: "EENVELOPE", responseCode: 550 })
        if (ours.has(mail.to)) sent.push(mail)
      },
    })
    return { mails: sent, errors: errors.filter((line) => line.includes(o.org.slug)), failures: report.failures }
  }

  const to = (mails: Mail[], who: Who) => mails.filter((mail) => mail.to === o.people[who].email)

  /** Les commentaires déjà marqués pour `who`, et l'heure de son dernier email. */
  async function stateOf(who: Who): Promise<{ items: string[]; mailed: boolean }> {
    const items = await fx.admin<{ comment_id: string }[]>`select comment_id from platform.comment_mail_items where org_id = ${o.org.id} and user_id = ${o.people[who].id}`
    const mailed = await fx.admin`select 1 from platform.comment_mails where org_id = ${o.org.id} and user_id = ${o.people[who].id}`
    return { items: items.map((item) => item.comment_id).sort(), mailed: mailed.length > 0 }
  }

  /** La précondition de chaque cas : O sans fil ni email passé. */
  async function fresh(): Promise<void> {
    await fx.admin`delete from platform.comment_threads where org_id = ${o.org.id}`
    await fx.admin`delete from platform.comment_mails where org_id = ${o.org.id}`
  }

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const who of ["claire", "lea", "marc"] as const) {
      const person = o.people[who]
      const db = fx.as(person)
      sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
    }
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should send one email for three comments, nothing twice, and keep a fourth comment until an hour after that email (AC1)", async () => {
    await fresh()
    const [first, second] = [await page("Offre tarifaire"), await page("Grille de remises")]
    const opened = await post("marc", { path: first.path, text: "Le tarif de base est-il à jour ?" })
    await post("lea", { path: second.path, text: "Remise à revoir." })
    await post("lea", { path: first.path, thread: opened.thread, text: `@${o.people.claire.name} peux-tu confirmer ?` })
    const now = new Date()

    const once = await pass(now)
    const again = await pass(now)
    await post("marc", { path: first.path, text: `@${o.people.claire.name} et la TVA ?` })
    const tenMinutesLater = await pass(new Date(now.getTime() + 10 * MINUTE))
    const anHourLater = await pass(new Date(now.getTime() + 60 * MINUTE))

    // Claire : responsable de l'équipe propriétaire pour les deux nouveaux fils, mentionnée par la réponse. Marc : auteur
    // du fil auquel Léa répond. Léa, qui n'est concernée que par ses propres commentaires : rien.
    expect(to(once.mails, "claire").map((mail) => [mail.subject, mail.text])).toEqual([
      [
        "3 nouveaux commentaires sur vos pages",
        [
          "Bonjour,",
          "",
          "3 nouveaux commentaires vous concernent sur les pages de l'organisation Acme Test :",
          "",
          "- Offre tarifaire, par Marc Petit : « Le tarif de base est-il à jour ? »",
          `  ${first.url}`,
          "",
          "- Grille de remises, par Léa Roux : « Remise à revoir. »",
          `  ${second.url}`,
          "",
          "- Offre tarifaire, par Léa Roux : « @Claire Morel peux-tu confirmer ? »",
          `  ${first.url}`,
          "",
          "Vous recevez au plus un email par heure : il réunit les commentaires arrivés depuis le précédent.",
        ].join("\n"),
      ],
    ])
    expect(to(once.mails, "marc").map((mail) => mail.subject)).toEqual(["1 nouveau commentaire sur vos pages"])
    expect(to(once.mails, "lea")).toEqual([])
    expect([again.mails, tenMinutesLater.mails]).toEqual([[], []])
    expect(anHourLater.mails.map((mail) => [mail.to, mail.subject, mail.text.includes("et la TVA ?")])).toEqual([[o.people.claire.email, "1 nouveau commentaire sur vos pages", true]])
  })

  it("should leave out a deleted comment and a resolved thread, and send no email without a line (AC2)", async () => {
    await fresh()
    const p = await page("Conditions de vente")
    const resolved = await post("marc", { path: p.path, text: "Fil résolu avant l'envoi." })
    await post("lea", { path: p.path, text: "Fil resté ouvert." })
    const kept = await post("marc", { path: p.path, text: "Autre fil ouvert." })
    const reply = await post("lea", { path: p.path, thread: kept.thread, text: "Réponse supprimée avant l'envoi." })
    await setThreadStatus(session("marc").db, session("marc").identity, resolved.thread, { status: "resolved" })
    await deleteComment(session("lea").db, session("lea").identity, reply.comment)

    const { mails } = await pass(new Date())

    // Marc n'était concerné que par la réponse supprimée : aucun email, plutôt qu'un email sans ligne.
    expect(mails.map((mail) => [mail.to, mail.subject])).toEqual([[o.people.claire.email, "2 nouveaux commentaires sur vos pages"]])
    expect(mails[0].text).not.toMatch(/résolu avant|supprimée avant/)
    expect(await stateOf("marc")).toEqual({ items: [], mailed: false })
  })

  it("should send nothing of a page to a person who no longer reads it (AC3)", async () => {
    await fresh()
    const [lost, read] = [await page("Page retirée à Marc"), await page("Page que Marc lit")]
    const hidden = await post("lea", { path: lost.path, text: `@${o.people.marc.name} à relire.` })
    const shown = await post("lea", { path: read.path, text: `@${o.people.marc.name} à relire aussi.` })
    await fx.admin`delete from platform.access_rules where node_id = ${lost.id} and subject_user_id = ${o.people.marc.id}`

    const { mails } = await pass(new Date())

    expect(to(mails, "marc").map((mail) => [mail.subject, mail.text.includes(read.url), mail.text.includes(lost.path)])).toEqual([["1 nouveau commentaire sur vos pages", true, false]])
    expect((await stateOf("marc")).items).toEqual([shown.comment])
    expect(hidden.comment).not.toBe(shown.comment)
  })

  it("should put on the home of each person the pages of the threads her email names, and no other (suivi, AC7)", async () => {
    await fresh()
    const [first, second, lost] = [await page("Offre suivie"), await page("Grille suivie"), await page("Page suivie retirée à Marc")]
    const opened = await post("marc", { path: first.path, text: "Un nouveau fil, sans mention." })
    await post("lea", { path: first.path, thread: opened.thread, text: "Une réponse à Marc." })
    const asked = await post("lea", { path: second.path, text: `@${o.people.marc.name} à relire.` })
    await post("claire", { path: second.path, thread: asked.thread, text: "Une réponse de la responsable." })
    await post("lea", { path: lost.path, text: `@${o.people.marc.name} sur une page qu'il ne lira plus.` })
    await fx.admin`delete from platform.access_rules where node_id = ${lost.id} and subject_user_id = ${o.people.marc.id}`
    const pages = [first, second, lost]
    const people = ["claire", "lea", "marc"] as const

    const { mails } = await pass(new Date())
    const mailed = Object.fromEntries(people.map((who) => [who, pages.filter((one) => to(mails, who).some((mail) => mail.text.includes(one.url))).map((one) => one.path)]))
    const followed = Object.fromEntries(
      await Promise.all(
        people.map(async (who) => {
          const { threads } = await homeComments(session(who).db, session(who).identity)
          return [who, pages.filter((one) => threads.some((thread) => thread.path === one.path)).map((one) => one.path)]
        }),
      ),
    )

    expect(followed).toEqual(mailed)
    // Le jeu distingue les trois personnes : sans cela, l'égalité ne prouverait rien.
    expect(mailed).toEqual({ claire: [first.path, second.path, lost.path], lea: [second.path], marc: [first.path, second.path] })
  })

  it("should keep the comments of a failed sending for the next pass, and name the failure in the staff journal without the address (AC5)", async () => {
    await fresh()
    const p = await page("Devis type")
    const { comment } = await post("lea", { path: p.path, text: "À valider." })
    const claire = o.people.claire
    const now = new Date()

    const failed = await pass(now, [claire.email])
    const afterFailure = await stateOf("claire")
    const lines = await fx.admin<{ id: string; method: string; tool: string; op: string; target: string; is_error: boolean; error: string; user_id: string | null }[]>`
      select id, method, tool, op, target, is_error, error, user_id from platform.admin_journal where org_id = ${o.org.id} and tool = 'comments'`
    const replayed = await pass(now)
    await fx.admin`delete from platform.admin_journal where id = any(${lines.map((line) => line.id)}::bigint[])`

    expect({ mails: failed.mails, failures: failed.failures, errors: failed.errors, state: afterFailure }).toEqual({
      mails: [],
      failures: 1,
      errors: [`comments notify : envoi en échec pour une personne de ${o.org.slug} (EENVELOPE 550) ; ses commentaires partiront au passage suivant.`],
      state: { items: [], mailed: false },
    })
    expect(lines.map((line) => ({ ...line, id: null }))).toEqual([{ id: null, method: "cli", tool: "comments", op: "notify", target: `user:${claire.id}`, is_error: true, error: "EENVELOPE 550", user_id: null }])
    expect(JSON.stringify([lines, failed.errors])).not.toContain(claire.email)
    expect(to(replayed.mails, "claire").map((mail) => mail.subject)).toEqual(["1 nouveau commentaire sur vos pages"])
    expect(await stateOf("claire")).toEqual({ items: [comment], mailed: true })
  })

  it("should tell the screen that an email will leave only when the host has a relay (AC4)", async () => {
    const p = await page("Page sans fil")
    const { db, identity } = session("lea")
    vi.stubEnv("PLATFORM_SMTP_URL", "")
    vi.stubEnv("PLATFORM_MAIL_FROM", "")
    const without = await listComments(db, identity, p.path)
    vi.stubEnv("PLATFORM_SMTP_URL", "smtps://relay.example.invalid")
    const half = await listComments(db, identity, p.path)
    vi.stubEnv("PLATFORM_MAIL_FROM", "Acme <no-reply@example.invalid>")
    const configured = await listComments(db, identity, p.path)

    expect([without.mailEnabled, half.mailEnabled, configured.mailEnabled]).toEqual([false, false, true])
  })

  it("should run as the command of the host, on its administration connection, and report what it sent", async () => {
    await fresh()
    const p = await page("Commande de l'hôte")
    await post("lea", { path: p.path, text: "Un passage de la commande." })
    const sent: { to: string; from: string }[] = []
    const printed: string[] = []

    const code = await commentsNotifyCommand({
      dbUrl: process.env.PLATFORM_ADMIN_DATABASE_URL ?? "",
      env: { PLATFORM_SMTP_URL: "smtps://relay.example.invalid", PLATFORM_MAIL_FROM: "Acme <no-reply@example.invalid>" },
      print: (line) => printed.push(line),
      printError: (line) => printed.push(line),
      transport: { sendMail: async (message: { to: string; from: string }) => void sent.push({ to: message.to, from: message.from }) },
    })

    expect(code).toBe(0)
    expect(printed.at(-1)).toMatch(/^comments notify : \d+ email\(s\) envoyé\(s\), \d+ commentaire\(s\), 0 échec\(s\)\.$/)
    expect(sent.filter((mail) => mail.to === o.people.claire.email)).toEqual([{ to: o.people.claire.email, from: "Acme <no-reply@example.invalid>" }])
  })
})
