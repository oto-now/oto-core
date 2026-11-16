/**
 * Les noms d'objets SQL tels que les lit `migrations check` : identifiant nu (en minuscules) ou entre guillemets (tel
 * quel), qualifié ou non par son schéma. Partagés par le contrôle (`migrations-check.mjs`) et le retrait déclaré
 * (`migrations-retrait.mjs`).
 */
export const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`
export const QUALIFIED = new RegExp(String.raw`^(${IDENT})(?:\s*\.\s*(${IDENT}))?`, 'i')
export const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase())

/** Schéma et nom de l'objet qui commence à `pos` dans `body` (après les mots-clés). */
export function objectAt(body, pos) {
  const rest = body.slice(pos).replace(/^\s*(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?/i, '')
  const m = rest.match(QUALIFIED)
  if (!m) return { schema: null, name: null }
  return m[2] ? { schema: unquote(m[1]), name: unquote(m[2]) } : { schema: null, name: unquote(m[1]) }
}
