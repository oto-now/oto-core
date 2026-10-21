/**
 * L'adresse de la base des commandes à connexion d'administration (`db prepare`, `accounts secret`, `journal purge`,
 * `org delete`), une règle pour toutes. Ce que ça empêche : un mot de passe passé en argument, que `ps` montre à tout
 * compte de la machine et que l'historique du shell garde. L'adresse se lit dans `PLATFORM_ADMIN_DATABASE_URL`, mot
 * de passe compris ; `--db-url` reste admis sans mot de passe, celui-ci lu par postgres.js dans `PGPASSWORD` (pas
 * dans `.pgpass`, que postgres.js ne lit pas). Ni l'un ni l'autre, ou les deux : refusé, sans choix silencieux. Aucun
 * refus ne réécrit l'adresse.
 */

export const ADMIN_URL_VARIABLE = 'PLATFORM_ADMIN_DATABASE_URL'

/**
 * L'adresse porte-t-elle un mot de passe ? Un « : » avant le dernier « @ » (`admin:…@`, vide compris, et un mot de
 * passe aux caractères non encodés que ni l'URL du WHATWG ni postgres.js ne lisent), ou un paramètre `password`.
 * Au plus large : une adresse au « @ » non encodé dans un paramètre, après un port, est refusée aussi (`%40`).
 * @param {string} url
 */
function carriesPassword(url) {
  const scheme = url.indexOf('://')
  const rest = scheme === -1 ? url : url.slice(scheme + 3)
  const at = rest.lastIndexOf('@')
  if (at !== -1 && rest.slice(0, at).includes(':')) return true
  const query = url.split('#')[0].split('?').slice(1).join('?')
  return [...new URLSearchParams(query).keys()].some((name) => name.toLowerCase() === 'password')
}

/**
 * L'adresse de la base, de `--db-url` (`flag`) ou de `PLATFORM_ADMIN_DATABASE_URL` ; une variable vide vaut absente.
 * @param {{ flag: string | undefined, env: Record<string, string | undefined> }} options
 * @returns {{ url: string } | { problem: string }}
 */
export function adminDbUrl({ flag, env }) {
  const fromEnv = env[ADMIN_URL_VARIABLE]?.trim() ? env[ADMIN_URL_VARIABLE] : undefined
  if (flag !== undefined && carriesPassword(flag)) {
    return {
      problem: `--db-url porte un mot de passe, que ps et l'historique du shell montrent : refusé. Posez l'adresse dans ${ADMIN_URL_VARIABLE}, ou passez --db-url sans mot de passe et celui-ci dans PGPASSWORD`,
    }
  }
  if (flag !== undefined && fromEnv !== undefined) return { problem: `deux adresses de base : ${ADMIN_URL_VARIABLE} et --db-url, gardez-en une` }
  if (flag !== undefined) return { url: flag }
  if (fromEnv !== undefined) return { url: fromEnv }
  return { problem: `adresse de la base absente : ${ADMIN_URL_VARIABLE} dans l'environnement, ou --db-url <url> sans mot de passe` }
}
