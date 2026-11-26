// Les classes des gestes des écrans du paquet, sur le jeu Oto (E05-S03, AC21). Focus : anneau `ink`
// (≥ 10:1 sur l'îlot), jamais `ring-ring` (1,17:1). Contour d'un champ : anneau `mute` (> 3:1 sur
// l'îlot, jour et nuit), jamais une bordure — la règle `* { border-color }` de l'hôte l'emporterait
// (`portage-ecrans.md § 3`). Sans ce module, huit fichiers redisaient ces chaînes.
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
export const LIBELLE = "block text-sm font-medium text-ink"
/** Un lien de texte : souligné, jamais distingué par la couleur seule. */
export const LIEN = `rounded-sm text-ink underline underline-offset-2 ${FOCUS}`
export const TITRE_DE_SECTION = "text-lg font-semibold text-ink"
/**
 * Le titre d'une liste qui reçoit le focus quand un geste emporte sa ligne (`tabIndex={-1}` : hors de
 * l'ordre de tabulation, atteint par script ; `ancre` d'`ActionPlateforme`).
 */
export const ANCRE = `rounded-sm ${FOCUS}`
// Les tableaux sont ceux du design system (`TableServeur`, `components/table-serveur.tsx`, M31).
