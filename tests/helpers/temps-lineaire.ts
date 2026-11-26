/**
 * La borne d'une lecture linéaire d'un texte hostile de la plus grande taille qu'un client envoie (100 000
 * caractères et plus ; `security-patterns.md § Validation des inputs`). Une lecture quadratique y met plus de
 * 3 s (mesuré sur `segmentsEnLigne`, revue 1 d'E05-S10) ; la lecture linéaire, jusqu'à 318 ms sur la machine
 * partagée par les agents, qui faisait échouer une borne de 250 ms. 1 000 ms attrape le temps quadratique
 * sans dépendre de la charge. Un texte plus court (40 000 caractères et moins) garde sa borne de 250 ms : un
 * temps quadratique y a été mesuré dès 0,4 s.
 */
export const TEMPS_LINEAIRE_MS = 1_000

/**
 * Le temps de processeur d'une lecture, en millisecondes : `process.cpuUsage` ne compte que ce que le processus calcule
 * (utilisateur et système), jamais le temps où le poste partagé le met en attente. Une lecture ralentie par la charge
 * d'autres sessions garde donc le même temps ; le temps d'horloge (`performance.now`) y gagnait un rapport de 10,1 à 10,7
 * sur un texte lu en linéaire, pour une borne de 10.
 */
function readingTime(read: (text: string) => unknown, text: string): number {
  const start = process.cpuUsage()
  read(text)
  const { user, system } = process.cpuUsage(start)
  return (user + system) / 1000
}

/** Sous ce temps, trop court pour un rapport (le ramasse-miettes y pèse) : une lecture quadratique de 1 000 000 caractères prend des secondes. */
const QUICK_MS = 50

/** Les manches mesurées : la médiane de leurs rapports, qu'une manche gênée par le ramasse-miettes ne fait pas basculer. */
const ROUNDS = 7

/**
 * Le temps de lecture de `whole` par `read` et son rapport à celui de `quarter`, quatre fois plus court : après une
 * lecture de chauffe de chacun, ROUNDS manches alternées, chacune son rapport ; le rapport retenu est leur médiane, le
 * temps retenu la médiane des temps du texte entier. Le temps est celui du processeur (`readingTime`) : la charge de la
 * machine ne l'allonge pas. Linéaire : quatre fois le texte, quatre fois le temps ; quadratique, seize. `linear` : le
 * rapport sous 10, ou le texte entier lu en moins de `QUICK_MS`.
 */
function measureOnce(read: (text: string) => unknown, quarter: string, whole: string): { whole: number; ratio: number; linear: boolean } {
  readingTime(read, quarter)
  readingTime(read, whole)
  const wholes: number[] = []
  const ratios: number[] = []
  for (let round = 0; round < ROUNDS; round++) {
    const q = readingTime(read, quarter)
    const w = readingTime(read, whole)
    wholes.push(w)
    ratios.push(w / Math.max(q, 0.01))
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const [medianWhole, ratio] = [median(wholes), median(ratios)]
  return { whole: medianWhole, ratio, linear: medianWhole < QUICK_MS || ratio < 10 }
}

/** Les mesures tentées au plus : une lecture linéaire gênée par la charge (160 ms pour 6 en temps normal, rapport 10,3) se reprend ; une lecture quadratique donne plus de 10 à chaque tentative. */
const ATTEMPTS = 4

/**
 * `measureOnce`, reprise tant que le rapport n'est pas sous la borne, ATTEMPTS fois au plus : la meilleure mesure est
 * rendue. Une régression quadratique échoue à toutes les tentatives (seize fois le temps, la charge ne le réduit pas) ;
 * une lecture linéaire que la charge du poste partagé a gênée une fois passe à la suivante.
 */
export function readingRatio(read: (text: string) => unknown, quarter: string, whole: string): { whole: number; ratio: number; linear: boolean } {
  let best = measureOnce(read, quarter, whole)
  for (let attempt = 1; attempt < ATTEMPTS && !best.linear; attempt++) {
    const next = measureOnce(read, quarter, whole)
    if (next.linear || next.ratio < best.ratio) best = next
  }
  return best
}
