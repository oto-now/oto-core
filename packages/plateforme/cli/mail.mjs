/**
 * Le relais SMTP de l'hôte et l'habillage commun des emails du paquet, dans un module que la commande charge sans
 * compilation : `oto-platform comments notify` (`comments-notify.mjs`) envoie l'email groupé des commentaires par le
 * même relais que l'invitation (`server/mail.ts`), sous la même règle TLS et les mêmes délais. Sans ce module partagé,
 * la commande recopierait la règle TLS du serveur, et l'une des deux copies finirait par envoyer en clair.
 */
import { createTransport } from 'nodemailer'

/** Les deux variables du relais : son adresse, et l'expéditeur. */
export const RELAY_VARIABLES = /** @type {const} */ (['PLATFORM_SMTP_URL', 'PLATFORM_MAIL_FROM'])

/**
 * Délais du relais. Ceux de nodemailer (2 minutes pour la connexion, 30 s pour l'accueil, 10 minutes d'inactivité)
 * visent l'envoi en lot ; ici, l'admin qui invite attend la réponse de sa requête, et un relais qui ne répond pas doit
 * la faire échouer sous la minute, celle d'une fonction de l'hôte ou d'un proxy devant lui (AC-a8b). Passés à côté de
 * `url`, ils ne s'appliquent que depuis nodemailer 10.0.0 : avant, ils seraient perdus sans bruit.
 */
const RELAY_LIMITS = { dnsTimeout: 5_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 }

/**
 * Une adresse de relais `smtp:` ou `smtps:` que l'analyseur d'URL lit. Contrôlée avant nodemailer, qui la relit par
 * l'analyseur ancien de Node : un port illisible y fait écrire à Node un avertissement qui recopie l'adresse entière,
 * mot de passe compris (DEP0170) ; une autre adresse que `smtp:` ou `smtps:` partirait sans bruit vers un autre relais
 * (localhost pour une adresse sans protocole).
 * @param {string} value
 */
function isRelayAddress(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'smtp:' || protocol === 'smtps:'
  } catch {
    return false
  }
}

/**
 * Le relais lu dans l'environnement de l'hôte : son adresse et l'expéditeur ; sinon les variables absentes (`missing`),
 * ou une adresse de relais illisible (`unreadable`). Jamais une valeur dans un refus.
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, from: string } | { missing: string[] } | { unreadable: true }}
 */
export function relaySettings(env) {
  const url = env.PLATFORM_SMTP_URL?.trim()
  const from = env.PLATFORM_MAIL_FROM?.trim()
  if (!url || !from) return { missing: [url ? null : RELAY_VARIABLES[0], from ? null : RELAY_VARIABLES[1]].filter((name) => name !== null) }
  if (!isRelayAddress(url)) return { unreadable: true }
  return { url, from }
}

/**
 * Le transport SMTP de nodemailer, créé sans se connecter : la connexion s'ouvre à l'envoi. TLS exigé : en `smtp://`,
 * nodemailer ne passe en STARTTLS que si le relais l'annonce, et qui retire l'annonce sur le chemin lirait en clair le
 * mot de passe du relais, puis le message ; exigé, STARTTLS est demandé même sans annonce et l'envoi refusé sans lui,
 * avant AUTH. Un relais de développement sans TLS l'annule par `?requireTLS=false` dans l'adresse, dont nodemailer fait
 * passer les options devant celles d'ici (depuis sa version 10.0.0, comme les délais). `null` quand nodemailer refuse
 * l'adresse : son analyseur ancien refuse des hôtes que `new URL` accepte (`smtp://ho%20st`), et son erreur porte
 * l'adresse entière (`ERR_INVALID_URL`, champ `input`), qui ne sort donc jamais d'ici.
 * @param {string} url
 * @returns {{ sendMail(message: { from: string, to: string, subject: string, text: string, html: string }): Promise<unknown> } | null}
 */
export function smtpTransport(url) {
  try {
    return createTransport({ url, requireTLS: true, ...RELAY_LIMITS })
  } catch {
    return null
  }
}

/**
 * Ce qu'un log ou un journal garde d'un échec du relais : le code de nodemailer et la réponse SMTP, jamais le message,
 * où peuvent figurer l'adresse du relais et le destinataire.
 * @param {unknown} error
 * @returns {string}
 */
export function failureCode(error) {
  if (typeof error !== 'object' || error === null) return 'unknown'
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'unknown'
  return 'responseCode' in error && typeof error.responseCode === 'number' ? `${code} ${error.responseCode}` : code
}

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Un texte de l'organisation, de la personne ou de l'hôte posé dans le HTML : ni balise, ni sortie d'attribut.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character])
}

/** L'habillage commun des emails : le fond, la carte, le bouton, la note de fin. */
export const MAIL_STYLES = {
  body: 'margin:0;padding:24px 12px;background-color:#f4f4f5;color:#18181b;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5',
  card: 'max-width:560px;margin:0 auto;padding:32px;background-color:#ffffff;border-radius:8px',
  button: 'display:inline-block;padding:12px 24px;background-color:#18181b;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:bold',
  note: 'margin:0 0 16px;font-size:14px;color:#52525b',
}
