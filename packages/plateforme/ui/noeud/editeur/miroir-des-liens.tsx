// Le dessin du texte montré d'un champ dont les liens sont réduits à leur titre (story `liens-en-edition`, AC-1) : posé
// sur le champ, aux classes du champ, il replie son texte comme lui ; les crochets en gris pâle, le titre souligné en
// couleur de lien. Le champ, dessous, garde le curseur et la sélection, son texte transparent (`editeur.css`). Sans lui,
// un `<textarea>` ne colore aucune partie de son texte.
import type { Morceau } from "./liens-masques"

function UnMorceau({ morceau }: { morceau: Morceau }) {
  if (morceau.genre === "texte") return morceau.texte
  return (
    <span className="oto-lien-reduit">
      <span className="oto-lien-reduit-crochet">{morceau.ouvrant}</span>
      <span className="oto-lien-reduit-titre">{morceau.libelle}</span>
      <span className="oto-lien-reduit-crochet">{morceau.fermant}</span>
    </span>
  )
}

/** Les morceaux d'un texte montré, dans l'ordre (le rang d'un morceau est sa place : aucun état ne s'y attache). */
export function MorceauxMontres({ morceaux }: { morceaux: readonly Morceau[] }) {
  return morceaux.map((morceau, rang) => <UnMorceau key={rang} morceau={morceau} />)
}

/** Le dessin d'un champ qui n'est pas une liste (la copie d'une liste dessine ses éléments). */
export function MiroirDuChamp({ morceaux, genre }: { morceaux: readonly Morceau[]; genre: string }) {
  return (
    <span className="oto-block-field oto-block-miroir" data-kind={genre} aria-hidden="true">
      <MorceauxMontres morceaux={morceaux} />
    </span>
  )
}
