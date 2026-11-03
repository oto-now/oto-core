// @vitest-environment node
// Email d'invitation envoyé par la plateforme hors Supabase (E01-S11 partie a2-core ; AC-a8, AC-a8b) :
// le modèle en français à la marque de l'organisation, l'échappement de ce qu'il reçoit dans le HTML,
// la configuration refusée par une erreur nommée avant tout envoi, l'envoi par un transport de
// capture (jamais un vrai relais), et l'échec du relais tenu hors du message et du log. Le branchement
// dans `inviteMember` (invitation non créée ou retirée, réponse de l'API) est la partie a2-wire.
// Revue 1 : origine `http:` ou `https:` seulement, et TLS exigé, prouvé face à un relais factice
// local qui n'offre pas STARTTLS (le transport de capture ne traverse pas le SMTP de nodemailer).
import { randomBytes } from "crypto"
import { createServer, type Socket } from "net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { invitationMail, mailSender, type InvitationMailInput, type MailContent } from "../../packages/plateforme/server/mail"
import { loggedText } from "../helpers/logs"

const FROM = "Invitations <invitations@example.test>"
const INPUT: InvitationMailInput = {
  to: "camille@example.test",
  brand: { displayName: "Atelier Nord", logoUrl: "https://cdn.example.test/logo.png" },
  inviterName: "Léa Durand",
  origin: "https://atelier.example.test",
}

// Le mot de passe du relais est tiré à chaque passage : un faux secret écrit en littéral serait refusé
// par le contrôle pré-public (`testing-strategy.md § Anti-patterns`).
const PASSWORD = randomBytes(8).toString("hex")

/** Adresse de relais qui porte un utilisateur et le mot de passe tiré plus haut. */
function relayUrl(address = "smtp://relay.example.invalid:587"): string {
  const url = new URL(address)
  url.username = "relay-user"
  url.password = PASSWORD
  return url.href
}

/** Ce que ni un refus ni le log ne doivent porter : la configuration de l'hôte et le destinataire. */
const NEVER_WRITTEN = [PASSWORD, "relay-user", "relay.example.invalid", "relay%20host", "invitations@example.test", INPUT.to]

/** L'erreur levée, qui doit être une `PlatformError` : le test échoue sinon. */
function platformError(error: unknown): PlatformError {
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

/** Ce que lève `run`, `null` s'il ne lève rien. */
function thrownBy(run: () => unknown): unknown {
  try {
    run()
    return null
  } catch (error) {
    return error
  }
}

// Échange local de quelques millisecondes ; un relais factice muet serait coupé par les délais du
// relais de `server/mail.ts` (15 s au plus), sous ce délai.
const RELAY_EXCHANGE_TIMEOUT = 30_000

/**
 * Relais factice sur 127.0.0.1, sans STARTTLS : il accueille, répond à EHLO en n'annonçant qu'AUTH,
 * refuse toute autre commande (502) et garde le verbe de chaque commande reçue. Rien n'y part : il
 * n'accepte ni AUTH, ni message.
 */
async function relayWithoutStartTls(): Promise<{ port: number; commands: string[]; close: () => Promise<void> }> {
  const commands: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    // nodemailer coupe la connexion après son refus (ECONNRESET sous Windows) : rien d'autre à faire.
    socket.on("error", () => socket.destroy())
    socket.write("220 relay.test ESMTP\r\n")
    let pending = ""
    socket.on("data", (chunk: Buffer) => {
      const lines = (pending + chunk.toString("utf8")).split("\r\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        commands.push(line.split(" ")[0])
        socket.write(line.startsWith("EHLO ") ? "250-relay.test\r\n250 AUTH PLAIN LOGIN\r\n" : "502 5.5.1 Unsupported\r\n")
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("the fake relay has no port")
  return {
    port: address.port,
    commands,
    close: () => {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

describe("invitationMail (AC-a8)", () => {
  it("should build a French invitation with the organisation brand, the inviter when known and the <origin>/login link to account creation for the invited address", () => {
    const mail = invitationMail(INPUT)
    expect(mail.to).toBe("camille@example.test")
    expect(mail.subject).toBe("Léa Durand vous invite à rejoindre Atelier Nord")
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Bonjour,")
      expect(body).toContain("Léa Durand vous invite à rejoindre Atelier Nord.")
      expect(body).toContain("créez votre compte avec l'adresse")
      expect(body).toContain("camille@example.test")
      expect(body).toContain("https://atelier.example.test/login?login_hint=camille%40example.test")
      expect(body).toContain("Si vous n'attendiez pas cette invitation, ignorez ce message.")
    }
    expect(mail.html).toContain('<html lang="fr">')
    expect(mail.html).toMatch(/<h1[^>]*>Atelier Nord<\/h1>/)
    expect(mail.html).toContain('<img src="https://cdn.example.test/logo.png" alt=""')
    expect(mail.text).toContain("https://atelier.example.test/login?login_hint=camille%40example.test&first_screen=register")
    expect(mail.html).toContain('<a href="https://atelier.example.test/login?login_hint=camille%40example.test&amp;first_screen=register"')

    // Ni nom de qui invite, ni logo : la phrase et le sujet se passent d'eux, sans rien d'autre à la place.
    const bare = invitationMail({ ...INPUT, inviterName: null, brand: { displayName: "Atelier Nord", logoUrl: null } })
    expect(bare.subject).toBe("Invitation à rejoindre Atelier Nord")
    expect(bare.text).toContain("Vous êtes invité·e à rejoindre Atelier Nord.")
    expect(bare.html).toContain("Vous êtes invité·e à rejoindre Atelier Nord.")
    expect(bare.html).not.toContain("<img")
    expect(`${bare.subject}\n${bare.text}\n${bare.html}`).not.toContain("null")
  })

  it("should escape in the HTML, and only there, the display name, the inviter, the address and the logo", () => {
    const mail = invitationMail({
      to: "o'neil@example.test",
      brand: {
        displayName: "Dupont & Fils <script>alert(1)</script>",
        // `readBrand` garde cette adresse : `new URL` la lit, en `https:`, sans la réécrire.
        logoUrl: 'https://cdn.example.test/logo.png" onerror="alert(1)',
      },
      inviterName: 'Léa "Lé" <b>Durand</b>',
      origin: "https://atelier.example.test",
    })
    expect(mail.html).not.toMatch(/<script|<b>|onerror="/)
    expect(mail.html).toContain("Dupont &amp; Fils &lt;script&gt;alert(1)&lt;/script&gt;")
    expect(mail.html).toContain("Léa &quot;Lé&quot; &lt;b&gt;Durand&lt;/b&gt; vous invite à rejoindre Dupont &amp; Fils")
    expect(mail.html).toContain('<img src="https://cdn.example.test/logo.png&quot; onerror=&quot;alert(1)" alt=""')
    expect(mail.html).toContain("<strong>o&#39;neil@example.test</strong>")
    expect(mail.text).toContain('Léa "Lé" <b>Durand</b> vous invite à rejoindre Dupont & Fils <script>alert(1)</script>.')
  })

  it("should build the link on an http: or https: origin only, refusing any other before a mail exists", () => {
    expect(invitationMail({ ...INPUT, origin: "http://localhost:3000" }).text).toContain("http://localhost:3000/login?login_hint=")

    // Un protocole pris dans `x-forwarded-proto` passé du client, puis une origine illisible.
    for (const origin of ["javascript://atelier.example.test", "atelier.example.test"]) {
      const refusal = platformError(thrownBy(() => invitationMail({ ...INPUT, origin })))
      expect(refusal.code).toBe("internal")
      expect(refusal.message).toContain("the request origin is not a readable http:// or https:// address")
    }
  })
})

describe("mailSender (AC-a8, AC-a8b)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    { refused: "a missing PLATFORM_SMTP_URL", smtp: undefined, from: FROM, named: "PLATFORM_SMTP_URL is not set" },
    { refused: "a missing PLATFORM_MAIL_FROM", smtp: relayUrl(), from: undefined, named: "PLATFORM_MAIL_FROM is not set" },
    { refused: "both missing", smtp: undefined, from: undefined, named: "PLATFORM_SMTP_URL and PLATFORM_MAIL_FROM are not set" },
    {
      refused: "a relay address that is neither smtp:// nor smtps://",
      smtp: relayUrl("https://relay.example.invalid"),
      from: FROM,
      named: "PLATFORM_SMTP_URL is not a readable smtp:// or smtps:// address",
    },
    {
      // `new URL` lit cet hôte, nodemailer non : son erreur porte l'adresse entière.
      refused: "a relay address nodemailer cannot read",
      smtp: relayUrl("smtp://relay%20host.example.invalid:587"),
      from: FROM,
      named: "PLATFORM_SMTP_URL is not a readable smtp:// or smtps:// address",
    },
  ])("should refuse $refused before any send, naming the variable and never a value", ({ smtp, from, named }) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("PLATFORM_SMTP_URL", smtp)
    vi.stubEnv("PLATFORM_MAIL_FROM", from)

    // Aucun transport injecté : sans refus, l'envoi par le relais de l'hôte serait prêt à partir.
    const refusal = platformError(thrownBy(() => mailSender()))
    expect(refusal.code).toBe("internal")
    expect(refusal.message).toContain(named)
    expect(loggedText(errors)).toContain(named)
    const written = `${refusal.message}\n${loggedText(errors)}`
    expect(NEVER_WRITTEN.filter((value) => written.includes(value))).toEqual([])
  })

  it("should send the content through the injected transport, from PLATFORM_MAIL_FROM", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("PLATFORM_SMTP_URL", relayUrl())
    vi.stubEnv("PLATFORM_MAIL_FROM", FROM)
    const sent: unknown[] = []
    const send = mailSender({
      sendMail: async (message) => {
        sent.push(message)
      },
    })

    const content: MailContent = invitationMail(INPUT)
    await send(content)
    expect(sent).toEqual([{ ...content, from: FROM }])
    expect(errors).not.toHaveBeenCalled()
  })

  it("should refuse with internal when the relay fails, logging its code and neither its address nor the recipient", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("PLATFORM_SMTP_URL", relayUrl())
    vi.stubEnv("PLATFORM_MAIL_FROM", FROM)
    // Une erreur de nodemailer peut nommer le relais et le destinataire dans son message.
    const failure = Object.assign(new Error(`Invalid login at ${relayUrl()} for ${INPUT.to}`), { code: "EAUTH", responseCode: 535 })
    const send = mailSender({ sendMail: () => Promise.reject(failure) })

    const refusal = platformError(await send(invitationMail(INPUT)).then(() => null, (error: unknown) => error))
    expect(refusal.code).toBe("internal")
    expect(loggedText(errors)).toContain("EAUTH 535")
    const written = `${refusal.message}\n${loggedText(errors)}`
    expect(NEVER_WRITTEN.filter((value) => written.includes(value))).toEqual([])
  })

  it(
    "should refuse the send before any AUTH when the relay does not take the link to TLS",
    async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const relay = await relayWithoutStartTls()
      try {
        vi.stubEnv("PLATFORM_SMTP_URL", relayUrl(`smtp://127.0.0.1:${relay.port}`))
        vi.stubEnv("PLATFORM_MAIL_FROM", FROM)
        const send = mailSender()

        const refusal = platformError(await send(invitationMail(INPUT)).then(() => null, (error: unknown) => error))
        expect(refusal.code).toBe("internal")
        // STARTTLS demandé même sans annonce, puis rien : sans TLS exigé, nodemailer enverrait
        // `AUTH PLAIN`, identifiant et mot de passe du relais lisibles sur le chemin.
        expect(relay.commands).toEqual(["EHLO", "STARTTLS"])
      } finally {
        await relay.close()
      }
    },
    RELAY_EXCHANGE_TIMEOUT,
  )
})
