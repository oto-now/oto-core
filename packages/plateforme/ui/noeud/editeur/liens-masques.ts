// Les liens d'un champ réduits à leur titre pendant la frappe (décision de JB du 14/10/2026, story `liens-en-edition`) :
// le champ montre `[[Titre]]` pour `[[chemin|Titre]]` et `[Titre]` pour `[Titre](https://…)`, la source gardée de côté.
// Sans ce module, le champ montrait la source entière au focus : le texte grandissait et le bloc sautait.
//
// Fonctions pures sur un découpage du texte en morceaux (texte, ou lien montré par son titre) : les positions se
// convertissent entre le texte montré et la source ; une frappe du texte montré devient une frappe de la source
// (`appliquer`). Les liens se lisent par `liensDuTexte` (`en-ligne.ts`), le seul lecteur des liens de l'écran.
import { liensDuTexte } from "../en-ligne"

/** Un morceau du champ : du texte, montré tel quel, ou un lien montré par son titre entre ses crochets. */
export type Morceau =
  | { genre: "texte"; texte: string }
  | {
      genre: "lien"
      /** La source entière du lien, telle qu'elle est enregistrée. */
      source: string
      ouvrant: "[[" | "["
      libelle: string
      fermant: "]]" | "]"
      /** Les caractères de la source avant le libellé : `[[chemin|` ou `[`. */
      avantLibelle: number
    }

/** Le texte montré par le champ, et ses morceaux, dans l'ordre. */
export type Masque = { visible: string; morceaux: readonly Morceau[] }

/** Les caractères qu'un titre de lien ne porte pas : tapés dedans, ils rendent le lien à son titre (AC-4). */
const HORS_LIBELLE = /[[\]|\r\n]/u

const montre = (morceau: Morceau) => (morceau.genre === "texte" ? morceau.texte : `${morceau.ouvrant}${morceau.libelle}${morceau.fermant}`)
const sourceDuMorceau = (morceau: Morceau) => (morceau.genre === "texte" ? morceau.texte : morceau.source)

/** Ajoute un texte à la suite des morceaux, fondu avec le texte qui précède. */
function pousserDuTexte(morceaux: Morceau[], texte: string) {
  if (texte === "") return
  const dernier = morceaux.at(-1)
  if (dernier?.genre === "texte") morceaux[morceaux.length - 1] = { genre: "texte", texte: dernier.texte + texte }
  else morceaux.push({ genre: "texte", texte })
}

/** Les morceaux d'une ligne (ou d'un texte entier) : un lien de page à libellé, ou un lien web à libellé, se montre par son titre. */
function morceauxDe(texte: string, morceaux: Morceau[]) {
  let place = 0
  for (const lu of liensDuTexte(texte)) {
    const source = texte.slice(lu.debut, lu.fin)
    const separateur = lu.forme === "page" ? source.indexOf("|") : lu.forme === "web-libelle" ? source.indexOf("](") : -1
    if (separateur === -1) continue
    const avantLibelle = lu.forme === "page" ? separateur + 1 : 1
    const libelle = lu.forme === "page" ? source.slice(avantLibelle, -2) : source.slice(1, separateur)
    if (libelle.trim() === "" || HORS_LIBELLE.test(libelle)) continue
    pousserDuTexte(morceaux, texte.slice(place, lu.debut))
    morceaux.push(lu.forme === "page" ? { genre: "lien", source, ouvrant: "[[", libelle, fermant: "]]", avantLibelle } : { genre: "lien", source, ouvrant: "[", libelle, fermant: "]", avantLibelle })
    place = lu.fin
  }
  pousserDuTexte(morceaux, texte.slice(place))
}

function masqueDe(morceaux: readonly Morceau[]): Masque {
  return { visible: morceaux.map(montre).join(""), morceaux }
}

/**
 * Le texte montré d'une source. `parLigne` : une liste, dont chaque ligne se lit seule (un span de code ouvert sur une
 * ligne ne masque pas un lien de la suivante), comme le panneau « Lien » et la copie des éléments la lisent.
 */
export function masquer(source: string, parLigne: boolean): Masque {
  const morceaux: Morceau[] = []
  const lignes = parLigne ? source.split("\n") : [source]
  lignes.forEach((ligne, rang) => {
    if (rang > 0) pousserDuTexte(morceaux, "\n")
    morceauxDe(ligne, morceaux)
  })
  return masqueDe(morceaux)
}

/** La source d'un masque. */
export const sourceDe = (masque: Masque) => masque.morceaux.map(sourceDuMorceau).join("")

/** Un masque sans lien réduit : son texte montré est sa source. */
export const sansLienReduit = (masque: Masque) => masque.morceaux.every((morceau) => morceau.genre === "texte")

/**
 * La position de la source qui répond à une position du texte montré : dans un titre, la même lettre ; dans un crochet
 * ouvrant, le début du titre ; dans un crochet fermant, sa fin ; avant et après un lien, ses bords.
 */
export function versSource(masque: Masque, position: number): number {
  let visible = 0
  let source = 0
  for (const morceau of masque.morceaux) {
    const longueur = montre(morceau).length
    if (position <= visible + longueur) {
      const decalage = position - visible
      if (morceau.genre === "texte") return source + decalage
      if (decalage === 0) return source
      if (decalage === longueur) return source + morceau.source.length
      return source + morceau.avantLibelle + Math.min(Math.max(decalage - morceau.ouvrant.length, 0), morceau.libelle.length)
    }
    visible += longueur
    source += sourceDuMorceau(morceau).length
  }
  return source
}

/** La position du texte montré qui répond à une position de la source : une place cachée d'un lien va au bord de son titre. */
export function versVisible(masque: Masque, position: number): number {
  let visible = 0
  let source = 0
  for (const morceau of masque.morceaux) {
    const longueur = sourceDuMorceau(morceau).length
    if (position <= source + longueur) {
      const decalage = position - source
      if (morceau.genre === "texte") return visible + decalage
      if (decalage === 0) return visible
      if (decalage === longueur) return visible + montre(morceau).length
      return visible + morceau.ouvrant.length + Math.min(Math.max(decalage - morceau.avantLibelle, 0), morceau.libelle.length)
    }
    visible += montre(morceau).length
    source += longueur
  }
  return visible
}

/** Les bornes d'un lien dans le texte montré : le lien entier, et son titre. */
type Bornes = { rang: number; debut: number; titre: number; finDuTitre: number; fin: number }

function bornesDesLiens(masque: Masque): Bornes[] {
  const bornes: Bornes[] = []
  let visible = 0
  masque.morceaux.forEach((morceau, rang) => {
    if (morceau.genre === "lien") {
      const titre = visible + morceau.ouvrant.length
      bornes.push({ rang, debut: visible, titre, finDuTitre: titre + morceau.libelle.length, fin: titre + morceau.libelle.length + morceau.fermant.length })
    }
    visible += montre(morceau).length
  })
  return bornes
}

/** La frappe d'un champ : ce qui a été remplacé (`[debut, fin)` du texte d'avant) et ce qui l'a remplacé. */
type Frappe = { debut: number; fin: number; insere: string }

/**
 * La frappe qui mène d'un texte à l'autre, ancrée au curseur d'arrivée : sans lui, un `]` tapé juste avant `]]` se
 * lirait après le lien, les deux textes ne différant que d'un `]`.
 */
function frappeEntre(avant: string, apres: string, curseur: number): Frappe {
  const borne = Math.min(avant.length, apres.length)
  let fin = 0
  while (fin < borne && fin < apres.length - curseur && avant[avant.length - 1 - fin] === apres[apres.length - 1 - fin]) fin += 1
  let debut = 0
  while (debut < borne - fin && avant[debut] === apres[debut]) debut += 1
  return { debut, fin: avant.length - fin, insere: apres.slice(debut, apres.length - fin) }
}

/** Le texte montré d'un lien, ses crochets compris : la clé d'un lien rendu à son titre, que l'annulation peut remettre. */
const jetonDu = (morceau: Extract<Morceau, { genre: "lien" }>) => `${morceau.ouvrant}${morceau.libelle}${morceau.fermant}`

/** Ce qu'une frappe fait à un lien qu'elle touche. */
type Effet = "intact" | "titre" | "emporte" | "rendu"

function effetSur(bornes: Bornes, frappe: Frappe): Effet {
  const { debut, fin } = frappe
  if (debut === fin) return debut > bornes.debut && debut < bornes.fin ? "titre" : "intact"
  if (fin <= bornes.debut || debut >= bornes.fin) return "intact"
  if (debut <= bornes.debut && fin >= bornes.fin) return "emporte"
  return debut >= bornes.titre && fin <= bornes.finDuTitre ? "titre" : "rendu"
}

/** Un lien rendu à son titre (AC-4) : son titre seul, en texte ; la position d'une frappe y glisse au bord du titre. */
function rendreASonTitre(masque: Masque, bornes: Bornes, frappe: Frappe): { masque: Masque; frappe: Frappe } {
  const ouvrant = bornes.titre - bornes.debut
  const retires = bornes.fin - bornes.finDuTitre + ouvrant
  const deplacer = (position: number) => {
    if (position <= bornes.debut) return position
    if (position >= bornes.fin) return position - retires
    return bornes.debut + Math.min(Math.max(position - bornes.titre, 0), bornes.finDuTitre - bornes.titre)
  }
  const morceaux: Morceau[] = []
  masque.morceaux.forEach((morceau, rang) => {
    if (rang === bornes.rang && morceau.genre === "lien") pousserDuTexte(morceaux, morceau.libelle)
    else if (morceau.genre === "texte") pousserDuTexte(morceaux, morceau.texte)
    else morceaux.push(morceau)
  })
  return { masque: masqueDe(morceaux), frappe: { debut: deplacer(frappe.debut), fin: deplacer(frappe.fin), insere: frappe.insere } }
}

/** Une frappe dans la source : la source d'arrivée, et le curseur juste après ce qui a été tapé. */
export type Ecriture = { source: string; curseur: number }

/**
 * Une frappe du texte montré, en frappe de la source (AC-3, AC-4) : `nouveau` est le texte du champ après la frappe,
 * `curseur` sa position d'arrivée. `retenus` garde, le temps du champ, les liens rendus à leur titre par une frappe :
 * remis entiers par l'annulation (`[[Titre]]` retapé d'un coup), ils retrouvent leur source (AC-5).
 */
export function appliquer(masque: Masque, nouveau: string, curseur: number, retenus: Map<string, string>): Ecriture {
  let frappe = frappeEntre(masque.visible, nouveau, curseur)
  for (const [jeton, source] of retenus) if (frappe.insere.includes(jeton)) frappe = { ...frappe, insere: frappe.insere.split(jeton).join(source) }
  let courant = masque
  for (;;) {
    const touches = bornesDesLiens(courant).map((bornes) => ({ bornes, effet: effetSur(bornes, frappe) }))
    const titre = touches.find((touche) => touche.effet === "titre")
    const aRendre = touches.find((touche) => touche.effet === "rendu") ?? (titre && HORS_LIBELLE.test(frappe.insere) ? titre : undefined)
    if (aRendre) {
      const lien = courant.morceaux[aRendre.bornes.rang]
      if (lien.genre === "lien") retenus.set(jetonDu(lien), lien.source)
      const rendu = rendreASonTitre(courant, aRendre.bornes, frappe)
      courant = rendu.masque
      frappe = rendu.frappe
      continue
    }
    if (titre) {
      const { bornes } = titre
      // Un `|` ou un crochet tapé près d'un crochet glisse au bord du titre ; un titre vidé emporte son lien.
      frappe = { ...frappe, debut: Math.min(Math.max(frappe.debut, bornes.titre), bornes.finDuTitre), fin: Math.min(Math.max(frappe.fin, bornes.titre), bornes.finDuTitre) }
      const reste = bornes.finDuTitre - bornes.titre - (frappe.fin - frappe.debut) + frappe.insere.length
      if (reste === 0) frappe = { ...frappe, debut: bornes.debut, fin: bornes.fin }
    }
    break
  }
  const source = sourceDe(courant)
  const debut = versSource(courant, frappe.debut)
  const fin = versSource(courant, frappe.fin)
  return { source: `${source.slice(0, debut)}${frappe.insere}${source.slice(fin)}`, curseur: debut + frappe.insere.length }
}

/** La source d'une sélection du texte montré (AC-8) : un lien entier avec sa source, un morceau de titre en texte. */
export function sourceDeLaSelection(masque: Masque, debut: number, fin: number): string {
  let visible = 0
  let source = ""
  for (const morceau of masque.morceaux) {
    const texte = montre(morceau)
    const de = Math.max(debut, visible)
    const a = Math.min(fin, visible + texte.length)
    if (de < a) {
      if (morceau.genre === "texte") source += texte.slice(de - visible, a - visible)
      else if (de === visible && a === visible + texte.length) source += morceau.source
      else {
        const titre = visible + morceau.ouvrant.length
        source += morceau.libelle.slice(Math.max(de - titre, 0), Math.max(a - titre, 0))
      }
    }
    visible += texte.length
  }
  return source
}

/** Les morceaux de chaque ligne du texte montré : la copie d'une liste dessine ses éléments ligne par ligne. */
export function morceauxParLigne(masque: Masque): Morceau[][] {
  const lignes: Morceau[][] = [[]]
  for (const morceau of masque.morceaux) {
    if (morceau.genre === "lien") {
      lignes[lignes.length - 1].push(morceau)
      continue
    }
    morceau.texte.split("\n").forEach((morceauDeLigne, rang) => {
      if (rang > 0) lignes.push([])
      pousserDuTexte(lignes[lignes.length - 1], morceauDeLigne)
    })
  }
  return lignes
}

/**
 * Le masque du champ monté de chaque bloc : le clavier (Entrée, `Tab`) et le focus posé par un geste de l'éditeur
 * lisent le champ, dont la valeur est le texte montré, et convertissent leurs positions par lui.
 */
const MASQUES = new WeakMap<HTMLElement, Masque>()

export function retenirLeMasque(champ: HTMLElement, masque: Masque) {
  MASQUES.set(champ, masque)
}

/** Une position de la source, posée dans un champ : sa place dans le texte montré. */
export function placeDansLeChamp(champ: HTMLElement, position: number): number {
  const masque = MASQUES.get(champ)
  return masque ? versVisible(masque, position) : position
}

/** Une position du champ, en position de la source. */
export function placeDansLaSource(champ: HTMLElement, position: number): number {
  const masque = MASQUES.get(champ)
  return masque ? versSource(masque, position) : position
}

/** La source du champ : sa valeur quand aucun lien n'y est réduit. */
export function sourceDuChamp(champ: HTMLTextAreaElement | HTMLInputElement): string {
  const masque = MASQUES.get(champ)
  return masque ? sourceDe(masque) : champ.value
}
