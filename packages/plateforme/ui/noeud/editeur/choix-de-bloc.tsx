"use client"

// Le choix d'un bloc (E10-S06, AC-a1, AC-a2 ; fiche D116) : les mêmes entrées, en deux groupes, « Texte » (les formes
// du menu « Style ») et « Insérer » (Tableau simple, Séparateur), servies au « + » d'une rangée, un `DropdownMenu`, et
// à « / » tapé dans un Texte vide, une liste sous le champ filtrée par ce qui suit. HTML n'y figure jamais : un
// artefact est une page créée depuis le rail (D116). Sans lui, le « + » n'insère qu'un Texte, et un bloc d'une autre
// forme demande de le convertir ensuite.
//
// Écrit dans le style d'oto-frontend, qui n'a ni `/` ni choix au « + » : le menu est celui du design system
// (`overlays.tsx`, ses groupes) ; la liste reprend celle de « @ » (`citer.tsx` : `oto-pop`, `oto-menu-item`, option
// désignée par le champ, région montée vide) ; le filtre, `fuzzyScore` de la palette ⌘K, sans casse ni accent.
//
// E10-S02 (lot b) : le groupe « Insérer » propose aussi « Image » et « Fichier » quand le stockage est activé (AC-b1, AC-b2,
// AC-b7), au « + » comme à « / » : les deux listes montrent les mêmes entrées. Choisis par « / », le Texte se vide de sa
// barre et le fichier se joint après lui. 1.4.3 : « Intégration » les suit, partout : elle ouvre le dialogue de son adresse.
//
// Chaque entrée porte son glyphe devant son libellé, comme Notion, au « + » comme à « / » (`GLYPHES_DES_CHOIX`).
import { useEffect, useState, type KeyboardEvent } from "react"
import { Browser } from "@phosphor-icons/react/dist/csr/Browser"
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight"
import { Code } from "@phosphor-icons/react/dist/csr/Code"
import { FlowArrow } from "@phosphor-icons/react/dist/csr/FlowArrow"
import { Image } from "@phosphor-icons/react/dist/csr/Image"
import { ListBullets } from "@phosphor-icons/react/dist/csr/ListBullets"
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks"
import { ListNumbers } from "@phosphor-icons/react/dist/csr/ListNumbers"
import { Minus } from "@phosphor-icons/react/dist/csr/Minus"
import { Paperclip } from "@phosphor-icons/react/dist/csr/Paperclip"
import { Quotes } from "@phosphor-icons/react/dist/csr/Quotes"
import { Table } from "@phosphor-icons/react/dist/csr/Table"
import { TextHOne } from "@phosphor-icons/react/dist/csr/TextHOne"
import { TextHThree } from "@phosphor-icons/react/dist/csr/TextHThree"
import { TextHTwo } from "@phosphor-icons/react/dist/csr/TextHTwo"
import { TextT } from "@phosphor-icons/react/dist/csr/TextT"
import { normalizeTitle } from "../../../schemas/nodes"
import { fuzzyScore } from "../../ds/react/command-palette"
import { Icon, type Glyphe } from "../../ds/react/icon"
import type { MenuItem } from "../../ds/react/overlays"
import { CHOIX_DE_BLOC, FORMES, INTEGRATION } from "../libelles"
import { FICHIERS } from "../libelles-des-fichiers"
import { idDOption } from "./citer"
import type { Genre } from "./envoi-de-fichier"
import { FORMES_ECRITES, type Choix } from "./modele"

/** Les deux groupes du choix, dans l'ordre du menu. */
const GROUPES: readonly { titre: string; choix: readonly Choix[] }[] = [
  { titre: CHOIX_DE_BLOC.texte, choix: FORMES_ECRITES },
  { titre: CHOIX_DE_BLOC.inserer, choix: ["tableau", "separateur"] },
]

/** Une entrée de « / » : un bloc, un fichier à joindre (« Image », « Fichier »), ou un cadre à intégrer. */
export type ChoixDeBarre = Choix | Genre | "integration"

const FICHIERS_JOINTS: readonly Genre[] = ["image", "fichier"]

const estUnFichier = (choix: ChoixDeBarre): choix is Genre => choix === "image" || choix === "fichier"

/** Le glyphe de chaque entrée : un titre dit son niveau (H1, H2, H3), comme dans Notion. */
const GLYPHES_DES_CHOIX: Record<ChoixDeBarre, Glyphe> = {
  texte: TextT,
  grandTitre: TextHOne,
  moyenTitre: TextHTwo,
  petitTitre: TextHThree,
  puces: ListBullets,
  numerotee: ListNumbers,
  cases: ListChecks,
  citation: Quotes,
  code: Code,
  diagramme: FlowArrow,
  repli: CaretRight,
  tableau: Table,
  separateur: Minus,
  image: Image,
  fichier: Paperclip,
  integration: Browser,
}

const glypheDe = (choix: ChoixDeBarre) => <Icon as={GLYPHES_DES_CHOIX[choix]} size="xs" />

const libelleDe = (choix: ChoixDeBarre) =>
  choix === "integration" ? INTEGRATION.entree : estUnFichier(choix) ? FICHIERS[choix] : choix === "separateur" ? CHOIX_DE_BLOC.separateur : FORMES[choix].libelle

/**
 * Le menu du « + » (AC-a1) : les deux groupes ; choisir insère le bloc après la rangée. `joindre` : le stockage est
 * activé, « Image » et « Fichier » terminent « Insérer » (E10-S02, AC-b7).
 */
export function itemsDuChoix(choisir: (choix: Choix) => void, joindre?: (quoi: Genre) => void, integrer?: () => void): MenuItem[] {
  const fichiers: MenuItem[] = [
    ...(joindre
      ? [
          { label: FICHIERS.image, icon: glypheDe("image"), onSelect: () => joindre("image") },
          { label: FICHIERS.fichier, icon: glypheDe("fichier"), onSelect: () => joindre("fichier") },
        ]
      : []),
    ...(integrer ? [{ label: INTEGRATION.entree, icon: glypheDe("integration"), onSelect: integrer }] : []),
  ]
  return GROUPES.flatMap(({ titre, choix }, rang) => [
    { group: titre },
    ...choix.map((un) => ({ label: libelleDe(un), icon: glypheDe(un), onSelect: () => choisir(un) })),
    ...(rang === GROUPES.length - 1 ? fichiers : []),
  ])
}

/**
 * Les entrées que retient ce qui est tapé après « / » (AC-a2) : toutes sans rien, sinon les meilleures d'abord, sans casse
 * ni accent. `fichiers` : le stockage est activé, « Image » et « Fichier » terminent la liste, comme au « + ».
 */
export function choixRetenus(requete: string, fichiers = false, integrer = false): ChoixDeBarre[] {
  const tous: ChoixDeBarre[] = [...GROUPES.flatMap(({ choix }) => choix), ...(fichiers ? FICHIERS_JOINTS : []), ...(integrer ? (["integration"] as const) : [])]
  if (requete === "") return tous
  const cherche = normalizeTitle(requete)
  return tous
    .map((choix) => ({ choix, score: fuzzyScore(cherche, normalizeTitle(libelleDe(choix))) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ choix }) => choix)
}

/**
 * « / » dans un Texte (AC-a2) : tapé seul dans un Texte vide, il ouvre la liste, filtrée par ce qui suit ; les flèches la
 * parcourent, Entrée ou Tab choisit et remplace le Texte par le bloc choisi ; Échap la ferme, le texte reste. Un « / »
 * tapé ailleurs reste du texte.
 */
export function useChoixParBarre(texte: string, choisir: (choix: Choix) => void, joindre?: (quoi: Genre) => void, integrer?: () => void) {
  const [ouverte, setOuverte] = useState(false)
  const [actif, setActif] = useState(0)
  const retenus = ouverte ? choixRetenus(texte.slice(1), joindre !== undefined, integrer !== undefined) : []
  const fermer = () => setOuverte(false)
  /** La frappe d'un Texte : `avant`, son texte d'avant ; rend `true` si la liste reste ouverte après elle. */
  const suivre = (avant: string, apres: string, unTexte: boolean): boolean => {
    setActif(0)
    const reste = ouverte ? apres.startsWith("/") : unTexte && avant === "" && apres === "/"
    setOuverte(reste)
    return reste
  }
  const prendre = (choix: ChoixDeBarre) => {
    fermer()
    if (choix === "integration") return integrer?.()
    if (!estUnFichier(choix)) return choisir(choix)
    joindre?.(choix)
  }
  /** Le clavier de la liste ouverte : `true` si la touche est prise. */
  const toucher = (evenement: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!ouverte) return false
    if (evenement.key === "Escape") {
      evenement.preventDefault()
      fermer()
      return true
    }
    // Rien ne correspond : la liste le dit, et la touche reste au champ (le texte reste du texte).
    if (retenus.length === 0) return false
    if (evenement.key === "ArrowDown" || evenement.key === "ArrowUp") {
      evenement.preventDefault()
      setActif((rang) => (rang + (evenement.key === "ArrowDown" ? 1 : retenus.length - 1)) % retenus.length)
      return true
    }
    if (evenement.key !== "Enter" && evenement.key !== "Tab") return false
    evenement.preventDefault()
    prendre(retenus[Math.min(actif, retenus.length - 1)])
    return true
  }
  return { ouverte, retenus, actif: Math.min(actif, Math.max(retenus.length - 1, 0)), suivre, fermer, prendre, toucher }
}

type ListeDesChoixProps = { id: string; retenus: readonly ChoixDeBarre[]; actif: number; prendre: (choix: ChoixDeBarre) => void }

function Options({ id, retenus, actif, prendre }: ListeDesChoixProps) {
  return retenus.map((choix, rang) => (
    <li
      key={choix}
      id={idDOption(id, rang)}
      role="option"
      aria-selected={rang === actif}
      className="oto-menu-item"
      data-highlighted={rang === actif ? "" : undefined}
      // Le focus reste dans le champ : l'appui ne le lui prend pas, le clic choisit.
      onMouseDown={(evenement) => evenement.preventDefault()}
      onClick={() => prendre(choix)}
    >
      {glypheDe(choix)}
      <span className="oto-menu-label">{libelleDe(choix)}</span>
    </li>
  ))
}

/** La liste de « / », sous le champ, que le champ désigne (`aria-activedescendant`) ; « Aucun bloc » quand rien ne correspond. */
export function ListeDesChoix(props: ListeDesChoixProps) {
  // Une région n'annonce que ce qui change après son montage : elle se monte vide (`accessibility-patterns.md § Régions dynamiques`).
  const [montee, setMontee] = useState(false)
  useEffect(() => setMontee(true), [])
  return (
    <div className="oto-pop oto-citer oto-choix-de-bloc">
      <p role="status" className="oto-caption px-2 py-1 empty:hidden">
        {montee && props.retenus.length === 0 ? CHOIX_DE_BLOC.aucun : ""}
      </p>
      <ul id={props.id} role="listbox" aria-label={CHOIX_DE_BLOC.liste} className="oto-menu">
        <Options {...props} />
      </ul>
    </div>
  )
}
