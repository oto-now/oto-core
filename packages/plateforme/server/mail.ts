// Email d'invitation envoyé par la plateforme elle-même, hors Supabase (E01-S11 a2, fiche D54,
// HN-E01S11-3) : en mode OIDC, personne d'autre ne l'envoie. Un modèle en français à la marque de
// l'organisation (nom affiché et logo lus par `readBrand`), puis l'envoi par le relais SMTP de l'hôte
// (`PLATFORM_SMTP_URL` : Brevo par son relais, comme tout autre fournisseur) au nom de
// `PLATFORM_MAIL_FROM`. `invitations.ts` s'y branche ensuite (partie a2-wire) ; sur Supabase, Supabase
// envoie toujours son propre email.
//
// Le relais lui-même (variables, TLS, délais, code d'un échec) et l'habillage du HTML vivent dans
// `cli/mail.mjs` : la commande `oto-platform comments notify` envoie l'email groupé des commentaires
// par le même relais, dans les deux modes, et ne charge pas ce module.
//
// Textes repris des modèles Supabase d'E02-S01 (`pnpm auth:settings`) : « Vous êtes invité·e à
// rejoindre… », « Si vous n'attendiez pas cette invitation, ignorez ce message. » Retiré : « Ce lien
// ne sert qu'une fois » : le lien mène ici à la page de connexion, pas à un jeton.
import { escapeHtml, failureCode, MAIL_STYLES, relaySettings as readRelaySettings, smtpTransport } from "../cli/mail.mjs"
import { webUrl } from "../schemas/oauth"
import type { Brand } from "./brand"
import { PlatformError } from "./errors"

/** Ce que le branchement passe au modèle : l'adresse invitée, la marque lue par `readBrand`, qui invite, l'origine. */
export type InvitationMailInput = {
  /** L'adresse invitée : le destinataire, et celle avec laquelle se connecter pour que l'invitation soit acceptée. */
  to: string
  brand: Pick<Brand, "displayName" | "logoUrl">
  /** Nom de qui invite ; `null` quand il n'est pas connu. */
  inviterName: string | null
  /** Origine `http:` ou `https:` de l'adresse d'où l'on invite (`identityLinkOrigin` de la porte, l'adresse du MCP admin) : le lien mène à `<origine>/login`. */
  origin: string
}

/** Un email prêt à partir ; l'expéditeur vient de l'hôte (`PLATFORM_MAIL_FROM`), jamais du message. */
export type MailContent = { to: string; subject: string; text: string; html: string }

/** Ce qu'il faut d'un transport : le `sendMail` de nodemailer, ou un transport de capture dans les tests. */
export type MailTransport = { sendMail(message: MailContent & { from: string }): Promise<unknown> }

/** La phrase d'invitation, sans point final ; pour le HTML, ses deux noms arrivent échappés. */
function invitedBy(inviterName: string | null, orgName: string): string {
  return inviterName ? `${inviterName} vous invite à rejoindre ${orgName}` : `Vous êtes invité·e à rejoindre ${orgName}`
}

const { body: BODY_STYLE, card: CARD_STYLE, button: BUTTON_STYLE, note: NOTE_STYLE } = MAIL_STYLES

function invitationHtml(input: InvitationMailInput, loginUrl: string): string {
  const org = escapeHtml(input.brand.displayName)
  const link = escapeHtml(loginUrl)
  const inviter = input.inviterName === null ? null : escapeHtml(input.inviterName)
  // Le logo est décoratif : le nom affiché le suit en titre, et le texte reste lisible images bloquées.
  const logo = input.brand.logoUrl
    ? `<img src="${escapeHtml(input.brand.logoUrl)}" alt="" height="40" style="display:block;height:40px;width:auto;max-width:200px;margin:0 0 24px">`
    : null
  return [
    "<!doctype html>",
    '<html lang="fr">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="${BODY_STYLE}">`,
    `<div style="${CARD_STYLE}">`,
    logo,
    `<h1 style="margin:0 0 24px;font-size:22px;line-height:1.3">${org}</h1>`,
    '<p style="margin:0 0 16px">Bonjour,</p>',
    `<p style="margin:0 0 16px">${invitedBy(inviter, org)}.</p>`,
    `<p style="margin:0 0 24px">Pour accepter l'invitation, connectez-vous avec l'adresse <strong>${escapeHtml(input.to)}</strong>, ou créez votre compte avec elle si vous n'en avez pas encore.</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="${BUTTON_STYLE}">Accepter l'invitation</a></p>`,
    `<p style="${NOTE_STYLE}">Le bouton ne s'ouvre pas ? Copiez cette adresse dans votre navigateur : ${link}</p>`,
    `<p style="${NOTE_STYLE}">Si vous n'attendiez pas cette invitation, ignorez ce message.</p>`,
    "</div>",
    "</body>",
    "</html>",
  ]
    .filter((line) => line !== null)
    .join("\n")
}

/**
 * L'email d'invitation, en français : sujet, texte et HTML, au nom affiché et au logo de
 * l'organisation, avec le nom de qui invite s'il est connu et le lien `<origine>/login`, qui mène à la
 * connexion chez l'émetteur de l'hôte (AC-a8). Fonction pure : le HTML échappe tout ce qu'il reçoit,
 * et une origine que `webUrl` refuse (ni `http:` ni `https:`, illisible, ou à identifiants) lève
 * `internal` avant qu'un lien n'existe : l'origine du MCP admin prend le protocole dans `x-forwarded-proto`,
 * qu'un proxy peut transmettre du client, et un lien n'interpole jamais un autre protocole
 * (`security-patterns.md § XSS Prevention`).
 */
export function invitationMail(input: InvitationMailInput): MailContent {
  const { to, brand, inviterName } = input
  const origin = webUrl(input.origin)
  if (!origin) throw new PlatformError("internal", "The email cannot be sent: the request origin is not a readable http:// or https:// address.")
  const loginUrl = new URL("/login", origin).href
  const text = [
    "Bonjour,",
    "",
    `${invitedBy(inviterName, brand.displayName)}.`,
    "",
    `Pour accepter l'invitation, connectez-vous avec l'adresse ${to}, ou créez votre compte avec elle si vous n'en avez pas encore :`,
    loginUrl,
    "",
    "Si vous n'attendiez pas cette invitation, ignorez ce message.",
  ].join("\n")
  return {
    to,
    subject: inviterName ? invitedBy(inviterName, brand.displayName) : `Invitation à rejoindre ${brand.displayName}`,
    text,
    html: invitationHtml(input, loginUrl),
  }
}

/** Refus de configuration : la variable nommée au log serveur et dans le message, jamais sa valeur. */
function configurationError(problem: string): PlatformError {
  console.error(`[platform] mail: ${problem}`)
  return new PlatformError("internal", `The email cannot be sent: ${problem}.`)
}

const UNREADABLE_RELAY = "PLATFORM_SMTP_URL is not a readable smtp:// or smtps:// address"

function relaySettings(): { url: string; from: string } {
  const settings = readRelaySettings(process.env)
  if ("missing" in settings) {
    const { missing } = settings
    throw configurationError(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set in the host environment`)
  }
  if ("unreadable" in settings) throw configurationError(UNREADABLE_RELAY)
  return settings
}

/** Le transport du relais (`smtpTransport`, TLS exigé) ; une adresse que nodemailer refuse : la même réponse qu'une adresse illisible. */
function smtpRelay(url: string): MailTransport {
  const relay = smtpTransport(url)
  if (!relay) throw configurationError(UNREADABLE_RELAY)
  return relay
}

/**
 * L'hôte a un relais d'envoi : les deux variables posées, l'adresse du relais lisible. Ce que l'écran des commentaires
 * lit pour annoncer l'email groupé (`NodeCommentsView.mailEnabled`) ; sans relais, aucun email ne part et rien ne l'annonce.
 */
export function mailRelayConfigured(): boolean {
  return "url" in readRelaySettings(process.env)
}

/**
 * L'envoi par le relais SMTP de l'hôte, au nom de `PLATFORM_MAIL_FROM` ; `transport` remplace le
 * relais (transport de capture des tests). Les deux variables se lisent ici, avant tout envoi :
 * l'appelant obtient l'envoi avant de créer ce qu'il annonce (AC-a8b : l'invitation n'est pas créée
 * quand une variable manque), et aucun message ne part sans elles. Une variable absente, ou une
 * adresse de relais illisible, lève `internal` en la nommant, jamais sa valeur. Un relais qui refuse,
 * ne répond pas ou ne passe pas en TLS lève `internal` ; son code part au log serveur, jamais son
 * message, où peuvent figurer l'adresse du relais et le destinataire.
 */
export function mailSender(transport?: MailTransport): (content: MailContent) => Promise<void> {
  const { url, from } = relaySettings()
  const relay = transport ?? smtpRelay(url)
  return async (content) => {
    try {
      await relay.sendMail({ ...content, from })
    } catch (error) {
      console.error("[platform] mail: the SMTP relay did not take the message", failureCode(error))
      throw new PlatformError("internal", "The email could not be sent.")
    }
  }
}
