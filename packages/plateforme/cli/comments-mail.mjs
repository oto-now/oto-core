/**
 * L'email groupé des commentaires d'une page (parcours 5.4), en fonctions pures : qui un commentaire prévient, quand
 * une personne peut recevoir son email suivant, l'adresse d'où s'ouvrent ses liens, et le modèle en français (objet,
 * texte, HTML) à la marque de l'organisation. La partie base et l'envoi sont dans `comments-notify.mjs`. En `.mjs`
 * sous `cli/` : la commande de l'hôte les charge sans compilation, ce qu'elle ne peut pas d'un module de `server/`.
 * Sans ce module, la règle « un email par personne et par heure » et le choix des destinataires ne se testeraient que
 * sur une base.
 */
import { escapeHtml, MAIL_STYLES } from './mail.mjs'

/** Un email par personne et par heure au plus. */
export const MAIL_WINDOW_MS = 60 * 60 * 1000

/**
 * Ce que la fenêtre tolère : la tâche horaire de l'hôte ne part jamais deux fois au même instant de l'heure, et sans
 * tolérance un passage lancé une seconde plus tôt que le précédent repousserait l'email d'une heure entière.
 */
export const WINDOW_SLACK_MS = 5 * 60 * 1000

/** Longueur de l'extrait d'un commentaire dans l'email. */
export const EXCERPT_CHARS = 200

/**
 * @typedef {object} NotifiedComment
 * @property {string | null} author  son auteur, nul quand la personne est oubliée
 * @property {readonly string[]} mentions  les personnes qu'il mentionne
 * @property {boolean} first  le premier commentaire de son fil : un nouveau fil
 * @property {string | null} threadAuthor  l'auteur du fil
 * @property {readonly string[]} earlierAuthors  les auteurs des commentaires qui le précèdent dans le fil
 * @property {readonly string[]} teamLeads  les responsables de l'équipe propriétaire de la page ; vide sans équipe
 */

/**
 * Les personnes qu'un commentaire prévient, chacune une fois : celles qu'il mentionne ; pour une réponse, l'auteur du
 * fil et ceux qui y ont déjà écrit ; pour un nouveau fil, les responsables de l'équipe propriétaire de la page. Jamais
 * son auteur. Un commentaire écrit par un assistant prévient comme un autre. Qui lit encore la page se décide à
 * l'envoi, sur la base (`comments-notify.mjs`).
 * @param {NotifiedComment} comment
 * @returns {string[]}
 */
export function recipientsOf(comment) {
  const concerned = comment.first ? comment.teamLeads : [comment.threadAuthor, ...comment.earlierAuthors]
  return [...new Set([...comment.mentions, ...concerned])].filter((person) => person !== null && person !== comment.author)
}

/**
 * Une personne peut-elle recevoir un email à `now` ? Oui sans email précédent, ou quand le précédent a une heure
 * (`MAIL_WINDOW_MS`, à `WINDOW_SLACK_MS` près).
 * @param {Date | null} lastSentAt
 * @param {Date} now
 */
export function isDue(lastSentAt, now) {
  return lastSentAt === null || lastSentAt.getTime() <= dueBefore(now).getTime()
}

/**
 * L'instant avant lequel un email précédent laisse partir le suivant à `now`.
 * @param {Date} now
 * @returns {Date}
 */
export function dueBefore(now) {
  return new Date(now.getTime() - MAIL_WINDOW_MS + WINDOW_SLACK_MS)
}

/** Une adresse du poste de développement (`localhost`, `*.localhost`), la seule servie en `http:`. */
const isLocal = (/** @type {string} */ host) => host === 'localhost' || host.endsWith('.localhost')

/**
 * L'origine des liens d'un email, parmi les adresses de l'organisation (`org_domains`) : une adresse de confiance,
 * jamais un en-tête de requête (`security-patterns.md § XSS Prevention`) ; une adresse qui n'est pas du poste de
 * développement d'abord, puis l'ordre alphabétique (les deux derniers critères de `reachableHost`,
 * `server/organisations.ts`), en `https:` hors du poste. `null` sans adresse : aucun lien ne se bâtit.
 * @param {readonly string[]} hosts
 * @returns {string | null}
 */
export function linkOrigin(hosts) {
  const [host] = [...hosts].sort((a, b) => Number(isLocal(a)) - Number(isLocal(b)) || a.localeCompare(b))
  return host === undefined ? null : `${isLocal(host) ? 'http' : 'https'}://${host}`
}

/**
 * L'extrait d'un commentaire : son texte brut, blancs réduits, `EXCERPT_CHARS` caractères au plus, « … » compris quand
 * il est coupé, jamais au milieu d'une paire de substitution (la règle de `clip`, `server/journal.ts`, que la commande
 * ne charge pas).
 * @param {string} text
 * @returns {string}
 */
export function excerpt(text) {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= EXCERPT_CHARS) return plain
  const end = EXCERPT_CHARS - 1
  const last = plain.charCodeAt(end - 1)
  return `${plain.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)}…`
}

/**
 * L'objet de l'email : « 1 nouveau commentaire sur vos pages », « 3 nouveaux commentaires sur vos pages ».
 * @param {number} count
 */
export function digestSubject(count) {
  return count === 1 ? '1 nouveau commentaire sur vos pages' : `${count} nouveaux commentaires sur vos pages`
}

/**
 * @typedef {object} DigestLine
 * @property {string} title  le titre de la page
 * @property {string} path  son chemin
 * @property {string | null} author  le nom de l'auteur du commentaire, nul quand il n'est plus membre
 * @property {boolean} viaAssistant  écrit par l'assistant de son auteur
 * @property {string} text  le texte du commentaire
 */

/** L'auteur tel que l'écran le nomme : « Ancien membre » sans nom, « Assistant de <nom> » pour un assistant. */
function authorLabel(/** @type {DigestLine} */ line) {
  const name = line.author ?? 'Ancien membre'
  return line.viaAssistant ? `Assistant de ${name}` : name
}

/**
 * L'adresse qui ouvre une page : `<origine>/n/<chemin>`.
 * @param {string} origin
 * @param {string} path
 */
function pageUrl(origin, path) {
  return new URL(`/n/${path.split('/').map(encodeURIComponent).join('/')}`, origin).href
}

/**
 * Un logo se montre s'il est une adresse `https:` (la règle de `readBrand`, `server/brand.ts`) ; sinon aucun.
 * @param {unknown} logoUrl
 * @returns {string | null}
 */
function safeLogo(logoUrl) {
  if (typeof logoUrl !== 'string' || logoUrl.length > 2048) return null
  try {
    return new URL(logoUrl).protocol === 'https:' ? logoUrl : null
  } catch {
    return null
  }
}

/**
 * L'email groupé d'une personne, en français : l'objet, puis une ligne par commentaire (titre de la page, auteur,
 * extrait du texte, lien qui ouvre la page), au nom et au logo de l'organisation. Aucun contenu de la page n'y entre,
 * et du commentaire son seul extrait. Fonction pure : le HTML échappe tout ce qu'il reçoit.
 * @param {{ to: string, orgName: string, logoUrl: unknown, origin: string, lines: readonly DigestLine[] }} input
 * @returns {{ to: string, subject: string, text: string, html: string }}
 */
export function commentsDigestMail({ to, orgName, logoUrl, origin, lines }) {
  const count = lines.length
  const intro = `${count === 1 ? '1 nouveau commentaire vous concerne' : `${count} nouveaux commentaires vous concernent`} sur les pages de l'organisation ${orgName} :`
  const note = "Vous recevez au plus un email par heure : il réunit les commentaires arrivés depuis le précédent."
  const shown = lines.map((line) => ({ title: line.title, author: authorLabel(line), quote: excerpt(line.text), url: pageUrl(origin, line.path) }))
  const text = ['Bonjour,', '', intro, '', ...shown.flatMap((line) => [`- ${line.title}, par ${line.author} : « ${line.quote} »`, `  ${line.url}`, '']), note].join('\n')
  const logo = safeLogo(logoUrl)
  const html = [
    '<!doctype html>',
    '<html lang="fr">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="${MAIL_STYLES.body}">`,
    `<div style="${MAIL_STYLES.card}">`,
    // Le logo est décoratif : le nom de l'organisation le suit en titre, et le texte reste lisible images bloquées.
    logo ? `<img src="${escapeHtml(logo)}" alt="" height="40" style="display:block;height:40px;width:auto;max-width:200px;margin:0 0 24px">` : null,
    `<h1 style="margin:0 0 24px;font-size:22px;line-height:1.3">${escapeHtml(orgName)}</h1>`,
    '<p style="margin:0 0 16px">Bonjour,</p>',
    `<p style="margin:0 0 24px">${escapeHtml(intro)}</p>`,
    ...shown.map(
      (line) =>
        `<p style="margin:0 0 24px"><strong>${escapeHtml(line.title)}</strong>, par ${escapeHtml(line.author)}<br>« ${escapeHtml(line.quote)} »<br><a href="${escapeHtml(line.url)}">Ouvrir la page</a></p>`,
    ),
    `<p style="${MAIL_STYLES.note}">${escapeHtml(note)}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== null)
    .join('\n')
  return { to, subject: digestSubject(count), text, html }
}
