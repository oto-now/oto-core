"use client"

// Le niveau de chaque membre sur le dossier de son équipe (1.4.12, droits par personne), dans « Les personnes de … » :
// lu par `useNiveauxDesMembres` sur le dossier (le panneau du nœud, `GET rules?path=<slug>`), relu quand la composition
// change et après chaque niveau changé ; réglé par le menu de `NiveauDUnMembre`, qui pose ou retire la règle qui nomme le
// membre sur le dossier. Toutes les pages de l'équipe en héritent, et une page la surcharge (« Partager »). Sans lui,
// chaque membre d'une équipe pouvait modifier tout ce qu'elle range, sans réglage par personne.
import { NIVEAUX_D_ACCES } from "../noeud/libelles"
import { NiveauDUnMembre, type NiveauxDesMembres } from "../noeud/niveau-d-un-membre"

/** Le niveau d'un membre sur le dossier : un menu pour qui gère le dossier, son nom sinon ; rien tant qu'il n'est pas lu. */
export function NiveauDansLEquipe({ niveaux, userId, gestionAccordable }: { niveaux: NiveauxDesMembres; userId: string; gestionAccordable: boolean }) {
  if (niveaux.lecture.etat !== "pret") return null
  const { vue } = niveaux.lecture
  const membre = vue.people?.find((un) => un.userId === userId)
  if (!membre) return null
  if (vue.viewerLevel < 3) return <span className="oto-caption">{NIVEAUX_D_ACCES[membre.level]}</span>
  return <NiveauDUnMembre chemin={vue.path} membre={membre} gestionAccordable={gestionAccordable} envoyer={niveaux.envoyer} enCours={niveaux.enCours} />
}
