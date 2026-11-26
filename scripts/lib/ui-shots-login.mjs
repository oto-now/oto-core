/**
 * La garde de `pnpm ui:shots` (`scripts/ui-shots.mjs`) : une route protégée renvoyée sur la connexion n'est jamais
 * capturée à la place de l'écran demandé. Module à part pour qu'un test la lise sans lancer le script.
 */

/**
 * Vrai quand la page a fini sur `/login` alors qu'une autre route était demandée : l'écran est protégé et la
 * session manque, ou a été refusée.
 * @param {string} route
 * @param {string} finalUrl
 * @returns {boolean}
 */
export function landedOnLogin(route, finalUrl) {
  const asked = new URL(route, "http://x").pathname.replace(/\/+$/, "")
  const landed = new URL(finalUrl).pathname.replace(/\/+$/, "")
  return landed === "/login" && asked !== "/login"
}
