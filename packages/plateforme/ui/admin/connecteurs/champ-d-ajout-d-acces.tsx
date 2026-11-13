"use client"

// « Ajouter une personne ou une équipe » du panneau de partage d'un connecteur : un champ qui cherche, sans casse ni
// accent, parmi les équipes et les personnes qu'on lui donne, et propose jusqu'à huit réponses ; les flèches les
// parcourent, Entrée ou un clic choisit, Échap efface la saisie avant de laisser le dialogue se fermer. Ce que fait le
// choix (la règle posée) appartient au panneau, qui passe `ajouter`.
//
// Repris du champ du partage d'une page (`noeud/partage-du-noeud.tsx`, `AjoutDAcces`), qui reste câblé sur la règle d'un
// nœud : mêmes gestes, mêmes mots (`PARTAGE`).
import { useId, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { AnimatedIcon } from "../../ds/react/icon"
import { InputAffix } from "../../ds/react/input-affix"
import { Avatar } from "../../ds/react/primitives"
import { PARTAGE } from "../../noeud/libelles"
import { normaliser } from "./lignes-des-connecteurs"

/** Ce qu'on ajoute : une équipe ou une personne de l'organisation. */
export type Candidat = { kind: "team" | "user"; id: string; nom: string }

/** Le nom d'un candidat tel qu'une ligne le dit : « Équipe Ventes », ou le nom de la personne. */
export const nomDuCandidat = (candidat: Pick<Candidat, "kind" | "nom">) => (candidat.kind === "team" ? PARTAGE.equipe(candidat.nom) : candidat.nom)

/** Les suggestions du champ : l'équipe ou la personne, et ce qu'elle est. */
function Suggestions({ id, trouves, rang, choisir }: { id: string; trouves: Candidat[]; rang: number; choisir: (candidat: Candidat) => void }) {
  return (
    <div id={id} role="listbox" aria-label={PARTAGE.suggestions} className="oto-share-suggestions">
      {trouves.map((candidat, index) => (
        <button
          key={`${candidat.kind}:${candidat.id}`}
          id={`${id}-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={index === rang}
          data-highlighted={index === rang ? "" : undefined}
          className="oto-menu-item"
          // Le focus reste dans le champ : le choix se fait au clic, sans le lui retirer.
          onMouseDown={(evenement) => evenement.preventDefault()}
          onClick={() => choisir(candidat)}
        >
          {candidat.kind === "team" ? <AnimatedIcon as={UsersThree} size="xs" /> : <Avatar name={candidat.nom} size="sm" aria-hidden="true" />}
          <span>{nomDuCandidat(candidat)}</span>
        </button>
      ))}
    </div>
  )
}

type ChampDAjoutDAccesProps = {
  /** Les équipes et les personnes qu'on peut encore ajouter. */
  candidats: Candidat[]
  /** Ajoute le candidat choisi ; `true` s'il a abouti : la saisie se vide alors. */
  ajouter: (candidat: Candidat) => Promise<boolean>
  enCours: boolean
}

export function ChampDAjoutDAcces({ candidats, ajouter, enCours }: ChampDAjoutDAccesProps) {
  const id = useId()
  const [saisie, setSaisie] = useState("")
  const [rang, setRang] = useState(-1)
  const cherche = normaliser(saisie.trim())
  const trouves = cherche ? candidats.filter((candidat) => normaliser(candidat.nom).includes(cherche)).slice(0, 8) : []

  async function choisir(candidat: Candidat) {
    if (enCours || !(await ajouter(candidat))) return
    setSaisie("")
    setRang(-1)
  }

  function clavier(evenement: KeyboardEvent<HTMLInputElement>) {
    const gestes: Record<string, () => void> = {
      ArrowDown: () => setRang((courant) => (trouves.length === 0 ? -1 : (courant + 1) % trouves.length)),
      ArrowUp: () => setRang((courant) => (trouves.length === 0 ? -1 : (courant - 1 + trouves.length) % trouves.length)),
      Enter: () => {
        const choisi = trouves[rang] ?? (trouves.length === 1 ? trouves[0] : undefined)
        if (choisi) void choisir(choisi)
      },
      // Une saisie en cours s'efface d'abord ; le dialogue ne se referme qu'au second Échap.
      Escape: () => {
        setSaisie("")
        setRang(-1)
      },
    }
    const touche = gestes[evenement.key]
    if (!touche || (evenement.key === "Escape" && saisie === "")) return
    evenement.preventDefault()
    touche()
  }

  const ouverte = cherche !== ""
  return (
    <div className="flex flex-col gap-1">
      <InputAffix
        type="text"
        role="combobox"
        aria-label={PARTAGE.ajouter}
        placeholder={PARTAGE.ajouter}
        aria-autocomplete="list"
        aria-expanded={ouverte}
        aria-controls={ouverte ? `${id}-liste` : undefined}
        aria-activedescendant={rang >= 0 && trouves[rang] ? `${id}-liste-${rang}` : undefined}
        aria-busy={enCours}
        value={saisie}
        onChange={(evenement: ChangeEvent<HTMLInputElement>) => {
          setSaisie(evenement.target.value)
          setRang(-1)
        }}
        onKeyDown={clavier}
        start={<AnimatedIcon as={MagnifyingGlass} anim="magnify" size="xs" />}
      />
      {ouverte && (trouves.length > 0 ? <Suggestions id={`${id}-liste`} trouves={trouves} rang={rang} choisir={(candidat) => void choisir(candidat)} /> : <p className="oto-caption">{PARTAGE.rienTrouve}</p>)}
    </div>
  )
}
