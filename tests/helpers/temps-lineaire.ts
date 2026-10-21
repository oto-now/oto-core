/**
 * La borne d'une lecture linéaire d'un texte hostile de la plus grande taille qu'un client envoie (100 000
 * caractères et plus ; `security-patterns.md § Validation des inputs`). Une lecture quadratique y met plus de
 * 3 s (mesuré sur `segmentsEnLigne`, revue 1 d'E05-S10) ; la lecture linéaire, jusqu'à 318 ms sur la machine
 * partagée par les agents, qui faisait échouer une borne de 250 ms. 1 000 ms attrape le temps quadratique
 * sans dépendre de la charge. Un texte plus court (40 000 caractères et moins) garde sa borne de 250 ms : un
 * temps quadratique y a été mesuré dès 0,4 s.
 */
export const TEMPS_LINEAIRE_MS = 1_000

/** Le temps d'une lecture, en millisecondes. */
function readingTime(read: (text: string) => unknown, text: string): number {
  const start = performance.now()
  read(text)
  return performance.now() - start
}

/** Sous ce temps, trop court pour un rapport (le ramasse-miettes y pèse) : une lecture quadratique de 1 000 000 caractères prend des secondes. */
const QUICK_MS = 50

/**
 * Le temps de lecture de `whole` par `read` et son rapport à celui de `quarter`, quatre fois plus court : chacun le
 * plus court de trois lectures alternées, après une lecture de chauffe. La charge de la machine ne fait que les
 * allonger, et touche les deux de la même façon. Linéaire : quatre fois le texte, quatre fois le temps (jusqu'à 8
 * mesuré, ramasse-miettes compris) ; quadratique, seize. `linear` : le rapport sous 10, ou le texte entier lu en
 * moins de `QUICK_MS`. Le rapport ne dépend pas de la charge, qu'une borne en millisecondes subit (2,9 s pour 1 s
 * dans un `pnpm verify` complet).
 */
export function readingRatio(read: (text: string) => unknown, quarter: string, whole: string): { whole: number; ratio: number; linear: boolean } {
  readingTime(read, quarter)
  let [fastQuarter, fastWhole] = [Infinity, Infinity]
  for (let round = 0; round < 3; round++) {
    fastQuarter = Math.min(fastQuarter, readingTime(read, quarter))
    fastWhole = Math.min(fastWhole, readingTime(read, whole))
  }
  const ratio = fastWhole / fastQuarter
  return { whole: fastWhole, ratio, linear: fastWhole < QUICK_MS || ratio < 10 }
}
