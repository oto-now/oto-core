// Email d'invitation envoyé par la plateforme elle-même, hors Supabase (E01-S11 a2, fiche D54,
// HN-E01S11-3) : en mode OIDC, personne d'autre ne l'envoie. Un modèle en français à la marque de
// l'organisation (nom affiché et logo lus par `readBrand`), puis l'envoi par le relais SMTP de l'hôte
// (`PLATFORM_SMTP_URL` : Brevo par son relais, comme tout autre fournisseur) au nom de
// `PLATFORM_MAIL_FROM`. `invitations.ts` s'y branche ensuite (partie a2-wire) ; sur Supabase, Supabase
// envoie toujours son propre email.
//
// Textes repris des modèles Supabase d'E02-S01 (`pnpm auth:settings`) : « Vous êtes invité·e à
// rejoindre… », « Si vous n'attendiez pas cette invitation, ignorez ce message. » Retiré : « Ce lien
// ne sert qu'une fois » : le lien mène ici à la page de connexion, pas à un jeton.
import { createTransport } from "nodemailer"
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

/**
 * Délais du relais. Ceux de nodemailer (2 minutes pour la connexion, 30 s pour l'accueil, 10 minutes
 * d'inactivité) visent l'envoi en lot ; ici, l'admin attend la réponse de sa requête, et un relais
 * qui ne répond pas doit la faire échouer sous la minute, celle d'une fonction de l'hôte ou d'un
 * proxy devant lui, pour que l'invitation soit retirée et le refus servi (AC-a8b). Passés à côté de
 * `url`, ils ne s'appliquent que depuis nodemailer 10.0.0 : avant, ils seraient perdus sans bruit.
 */
const RELAY_LIMITS = { dnsTimeout: 5_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 }

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

/** Un texte de l'organisation, de la personne ou de l'hôte posé dans le HTML : ni balise, ni sortie d'attribut. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character])
}

/** La phrase d'invitation, sans point final ; pour le HTML, ses deux noms arrivent échappés. */
function invitedBy(inviterName: string | null, orgName: string): string {
  return inviterName ? `${inviterName} vous invite à rejoindre ${orgName}` : `Vous êtes invité·e à rejoindre ${orgName}`
}

const BODY_STYLE =
  "margin:0;padding:24px 12px;background-color:#f4f4f5;color:#18181b;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5"
const CARD_STYLE = "max-width:560px;margin:0 auto;padding:32px;background-color:#ffffff;border-radius:8px"
const BUTTON_STYLE =
  "display:inline-block;padding:12px 24px;background-color:#18181b;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:bold"
const NOTE_STYLE = "margin:0 0 16px;font-size:14px;color:#52525b"

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

/**
 * Une adresse de relais `smtp:` ou `smtps:` que l'analyseur d'URL lit. Contrôlée avant nodemailer, qui
 * la relit par l'analyseur ancien de Node : un port illisible y fait écrire à Node un avertissement
 * qui recopie l'adresse entière, mot de passe compris (DEP0170) ; une autre adresse que `smtp:` ou
 * `smtps:` partirait sans bruit vers un autre relais (localhost pour une adresse sans protocole).
 */
function isRelayAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === "smtp:" || protocol === "smtps:"
  } catch {
    return false
  }
}

function relaySettings(): { url: string; from: string } {
  const url = process.env.PLATFORM_SMTP_URL?.trim()
  const from = process.env.PLATFORM_MAIL_FROM?.trim()
  if (!url || !from) {
    const missing = [url ? null : "PLATFORM_SMTP_URL", from ? null : "PLATFORM_MAIL_FROM"].filter((name) => name !== null)
    throw configurationError(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set in the host environment`)
  }
  if (!isRelayAddress(url)) throw configurationError(UNREADABLE_RELAY)
  return { url, from }
}

/**
 * Le transport SMTP de nodemailer, créé sans se connecter : la connexion s'ouvre à l'envoi. TLS exigé :
 * en `smtp://`, nodemailer ne passe en STARTTLS que si le relais l'annonce, et qui retire l'annonce sur
 * le chemin lirait en clair le mot de passe du relais, puis le message ; exigé, STARTTLS est demandé
 * même sans annonce et l'envoi refusé sans lui, avant AUTH. Un relais de développement sans TLS
 * l'annule par `?requireTLS=false` dans l'adresse, dont nodemailer fait passer les options devant
 * celles d'ici (depuis sa version 10.0.0, comme les délais).
 */
function smtpRelay(url: string): MailTransport {
  try {
    return createTransport({ url, requireTLS: true, ...RELAY_LIMITS })
  } catch {
    // L'analyseur ancien refuse des hôtes que `new URL` accepte (`smtp://ho%20st`), et son erreur
    // porte l'adresse entière (`ERR_INVALID_URL`, champ `input`) : elle ne remonte ni ne part au log.
    throw configurationError(UNREADABLE_RELAY)
  }
}

/** Ce que le log garde d'un échec du relais : le code de nodemailer et la réponse SMTP, jamais le message. */
function failureCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown"
  const code = "code" in error && typeof error.code === "string" ? error.code : "unknown"
  return "responseCode" in error && typeof error.responseCode === "number" ? `${code} ${error.responseCode}` : code
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
