// Les gestes de groupe du modèle d'édition (E11-S17, lot a) : retirer, rétablir, déplacer et remettre plusieurs rangées
// d'un coup, et les corps d'écriture à plusieurs opérations qui les envoient en une seule écriture. Fonctions pures, hors
// de `modele.ts`, qui est à sa borne de lignes (`max-lines`). Sans lui, chaque geste d'une sélection de blocs recoderait
// sa transformation, sans test pur.
import type { BlockInput, WriteOpBody } from "../../../schemas"
import { headingOf, sectionEnd } from "../../../schemas/blocks-render"
import { insererEnTete, retablir, type Focus, type Rangee, type Retiree } from "./modele"
import { idPrecedent, operationDeplacer, operationInserer } from "./operations"

/**
 * Ce qu'« Annuler » défait après un geste de groupe (AC-a6, AC-a8) : les blocs supprimés, tels qu'ils étaient
 * enregistrés, dans l'ordre de la page ; ou l'ordre des rangées d'avant un déplacement, et les rangées déplacées.
 */
export type GesteDeGroupe = { genre: "suppression"; retirees: readonly Retiree[] } | { genre: "deplacement"; avant: readonly string[]; cles: readonly string[] }

/** Les clés reçues, dans l'ordre de la page ; une clé absente du modèle part. */
export function dansLOrdre(modele: readonly Rangee[], cles: Iterable<string>): string[] {
  const voulues = new Set(cles)
  return modele.filter((rangee) => voulues.has(rangee.cle)).map((rangee) => rangee.cle)
}

/**
 * Retirer plusieurs rangées (AC-a6) : chacune garde son voisin d'avant, retiré ou non, pour revenir à sa place ; le focus
 * va à la poignée de la rangée qui précédait la première retirée, de la première restante sinon. Toutes retirées, un Texte
 * vide reste, le focus dedans (E11-S05, AC-g1).
 */
export function retirerLeGroupe(modele: readonly Rangee[], cles: Iterable<string>): { modele: Rangee[]; retirees: Retiree[]; focus?: Focus } {
  const retires = new Set(cles)
  const retirees = modele.flatMap((rangee, rang) => (retires.has(rangee.cle) ? [{ rangee, voisin: modele[rang - 1]?.cle ?? null, rang }] : []))
  if (retirees.length === 0) return { modele: [...modele], retirees }
  const reste = modele.filter((rangee) => !retires.has(rangee.cle))
  if (reste.length === 0) {
    const vide = insererEnTete([])
    return { modele: vide.modele, retirees, focus: vide.focus }
  }
  // Rien ne précède la première retirée qui soit retiré : sa voisine d'avant reste, sinon la première restante la suit.
  const voisine = modele[retirees[0].rang - 1] ?? reste[0]
  return { modele: reste, retirees, focus: { cle: voisine.cle, curseur: null, cible: "rangee" } }
}

/**
 * Rétablir un groupe retiré (AC-a6, « Annuler ») : chaque bloc, dans l'ordre de la page, après son ancien voisin, qui est
 * lui-même un bloc rétabli juste avant lui quand ils se suivaient ; sans `id` (HN-E05S02-13). `cles` : les rangées neuves,
 * dans l'ordre de la page.
 */
export function retablirLeGroupe(modele: readonly Rangee[], retirees: readonly Retiree[]): { modele: Rangee[]; cles: string[] } {
  const neuves = new Map<string, string>()
  let courant: Rangee[] = [...modele]
  for (const retiree of retirees) {
    const voisin = retiree.voisin === null ? null : (neuves.get(retiree.voisin) ?? retiree.voisin)
    const suite = retablir(courant, { ...retiree, voisin })
    courant = suite.modele
    if (suite.focus) neuves.set(retiree.rangee.cle, suite.focus.cle)
  }
  return { modele: courant, cles: retirees.flatMap((retiree) => neuves.get(retiree.rangee.cle) ?? []) }
}

/**
 * Déplacer un groupe d'un pas (AC-a8, HN-E11S16-6) : ses rangées se suivent, dans l'ordre de la page, avant la rangée qui
 * précédait la première (vers le haut) ou après celle qui suivait la dernière (vers le bas). En tête ou en fin, un groupe
 * épars se regroupe là ; un groupe qui s'y suit déjà ne bouge pas.
 */
export function deplacerLeGroupe(modele: readonly Rangee[], cles: Iterable<string>, pas: -1 | 1): Rangee[] {
  const dans = new Set(cles)
  const groupe = modele.filter((rangee) => dans.has(rangee.cle))
  if (groupe.length === 0) return [...modele]
  const reste = modele.filter((rangee) => !dans.has(rangee.cle))
  const premier = modele.findIndex((rangee) => dans.has(rangee.cle))
  const dernier = modele.findLastIndex((rangee) => dans.has(rangee.cle))
  // Le rang, parmi les rangées restantes, où le groupe se pose : avant la dernière de celles qui précèdent le premier, ou
  // après la première de celles qui suivent le dernier.
  const position = pas < 0 ? Math.max(premier - 1, 0) : Math.min(dernier + 2 - groupe.length, reste.length)
  return [...reste.slice(0, position), ...groupe, ...reste.slice(position)]
}

/**
 * Ce qui se déplace avec les rangées reçues : chaque titre emmène sa section (`sectionEnd`, celle que son chevron replie),
 * sous-titres compris, au glisser comme à ⌥↑ / ⌥↓ et au menu. Dans l'ordre de la page ; sans titre, les rangées seules.
 */
export function avecLeursSections(modele: readonly Rangee[], cles: Iterable<string>): string[] {
  const niveaux = modele.map((rangee) => headingOf(rangee.bloc)?.level ?? null)
  const prises = new Set(cles)
  modele.forEach((rangee, rang) => {
    if (!prises.has(rangee.cle) || niveaux[rang] === null) return
    for (let suite = rang + 1; suite < sectionEnd(niveaux, rang); suite++) prises.add(modele[suite].cle)
  })
  return dansLOrdre(modele, prises)
}

/**
 * Poser un groupe juste avant la rangée `suivante` (en fin de page pour `null`), ses rangées dans l'ordre de la page : la
 * cible d'un glissé, lue sous le pointeur (`glisser.ts`). Une `suivante` du groupe ou disparue le pose en fin de page.
 */
export function poserAvant(modele: readonly Rangee[], cles: Iterable<string>, suivante: string | null): Rangee[] {
  const dans = new Set(cles)
  const groupe = modele.filter((rangee) => dans.has(rangee.cle))
  const reste = modele.filter((rangee) => !dans.has(rangee.cle))
  const rang = suivante === null ? -1 : reste.findIndex((rangee) => rangee.cle === suivante)
  const position = rang < 0 ? reste.length : rang
  return [...reste.slice(0, position), ...groupe, ...reste.slice(position)]
}

/**
 * Remettre les rangées d'un groupe dans l'ordre d'avant (AC-a8 : « Annuler », un glissé interrompu) : chacune après la
 * rangée qui la précédait, si elle est encore là, en tête sinon ; les autres rangées gardent leur ordre.
 */
export function remettre(modele: readonly Rangee[], avant: readonly string[], cles: Iterable<string>): Rangee[] {
  const bouges = new Set(cles)
  const parCle = new Map(modele.map((rangee) => [rangee.cle, rangee]))
  let courant = modele.filter((rangee) => !bouges.has(rangee.cle))
  avant.forEach((cle, rang) => {
    const rangee = parCle.get(cle)
    if (!rangee || !bouges.has(cle)) return
    const precedente = avant.slice(0, rang).findLast((une) => courant.some((rangeeCourante) => rangeeCourante.cle === une))
    const position = precedente === undefined ? 0 : courant.findIndex((rangeeCourante) => rangeeCourante.cle === precedente) + 1
    courant = [...courant.slice(0, position), rangee, ...courant.slice(position)]
  })
  return courant
}

/** Un corps d'écriture à plusieurs opérations : `cles[i]` est la rangée de `ops[i]`, dont la réponse rend l'identité. */
export type CorpsDuGroupe = { ops: WriteOpBody[]; cles: string[] }

/**
 * Les `insert_after` des blocs rétablis (AC-a6, « Annuler ») en une écriture : un bloc rétabli n'a pas encore d'`id`,
 * chacun s'ancre au bloc écrit qui le précède ; ceux d'une même ancre partent du dernier au premier, chacun posé juste
 * après elle, pour retrouver l'ordre de la page. `entrees` : dans l'ordre de la page.
 */
export function insertionsDuGroupe(modele: readonly Rangee[], entrees: readonly { cle: string; entree: BlockInput }[]): CorpsDuGroupe {
  const parAncre = new Map<string | null, { cle: string; entree: BlockInput }[]>()
  for (const une of entrees) {
    const ancre = idPrecedent(modele, une.cle)
    parAncre.set(ancre, [...(parAncre.get(ancre) ?? []), une])
  }
  const ordre = [...parAncre].flatMap(([ancre, unes]) => [...unes].reverse().map((une) => ({ ...une, ancre })))
  return { ops: ordre.map((une) => operationInserer(une.ancre, une.entree)), cles: ordre.map((une) => une.cle) }
}

/**
 * Les `move_block` d'un groupe (AC-a8) en une écriture : dans l'ordre de la page, chacun après le bloc écrit qui le
 * précède désormais, que le serveur a déjà posé à sa place ; un bloc neuf, sans `id`, part plus tard avec son texte.
 */
export function deplacementsDuGroupe(modele: readonly Rangee[], cles: Iterable<string>, idDe: (cle: string) => string | undefined): CorpsDuGroupe {
  const envoyees = dansLOrdre(modele, cles).flatMap((cle) => {
    const id = idDe(cle)
    return id === undefined ? [] : [{ cle, id }]
  })
  return { ops: envoyees.map(({ cle, id }) => operationDeplacer(id, idPrecedent(modele, cle))), cles: envoyees.map(({ cle }) => cle) }
}
