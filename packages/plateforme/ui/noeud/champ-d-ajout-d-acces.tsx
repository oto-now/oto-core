"use client"

// « Ajouter une personne ou une équipe », le champ commun au partage d'une page (`partage-du-noeud.tsx`) et au partage
// d'un connecteur (`admin/connecteurs/partage-du-connecteur.tsx`) : il cherche, sans casse ni accent, parmi les équipes et
// les personnes qu'on lui donne, et propose jusqu'à huit réponses ; les flèches les parcourent, Entrée ou un clic choisit,
// Échap efface la saisie avant de laisser le panneau se fermer. Ce que fait le choix (la règle posée, sur un nœud ou sur
// un compte) appartient au panneau, qui passe `ajouter`. Sans lui, chaque panneau de partage recopiait le champ.
// Deux ajouts facultatifs, que seule la fiche d'ajout d'un connecteur passe : « Toute l'organisation » parmi les
// réponses (`organisation`), et un candidat que la personne ne peut pas donner, grisé (`refus`) : il se parcourt au
// clavier (`aria-disabled`), ne se choisit pas, et dit sa raison sous son nom, lue par le lecteur d'écran
// (`aria-describedby`). Le partage d'une page ne passe ni l'un ni l'autre.
//
// Sorti de `partage-du-noeud.tsx` (`AjoutDAcces`, `Suggestions`), sans changement de geste ni de mot (`PARTAGE`) ; la ref
// est celle du champ de saisie, pour le panneau qui replie le focus quand la relecture l'emporte.
import { forwardRef, useId, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { normalizeTitle } from "../../schemas"
import { AnimatedIcon } from "../ds/react/icon"
import { InputAffix } from "../ds/react/input-affix"
import { Avatar } from "../ds/react/primitives"
import { PARTAGE } from "./libelles"

/** Ce qu'on ajoute : une équipe ou une personne de l'organisation. */
export type Candidat = { kind: "team" | "user"; id: string; nom: string }

/** Une réponse du champ : un candidat, ou toute l'organisation ; `refus` : grisée, avec la raison qui la refuse. */
type Reponse = (Candidat | { kind: "org"; id: "org"; nom: string }) & { refus?: string }

const TOUTE_L_ORGANISATION = "Toute l'organisation"

/** Le nom d'un candidat tel qu'une ligne le dit : « Équipe Ventes », ou le nom de la personne. */
export const nomDuCandidat = (candidat: Pick<Candidat, "kind" | "nom">) => (candidat.kind === "team" ? PARTAGE.equipe(candidat.nom) : candidat.nom)

const nomDeLaReponse = (reponse: Reponse) => (reponse.kind === "org" ? reponse.nom : nomDuCandidat(reponse))

type SuggestionsProps = { id: string; trouves: Reponse[]; rang: number; choisir: (reponse: Reponse) => void }

/** Les suggestions du champ : l'équipe, la personne ou l'organisation, et ce qu'elle est ; une réponse refusée, grisée. */
function Suggestions({ id, trouves, rang, choisir }: SuggestionsProps) {
  return (
    <div id={id} role="listbox" aria-label={PARTAGE.suggestions} className="oto-share-suggestions">
      {trouves.map((reponse, index) => (
        <button
          key={`${reponse.kind}:${reponse.id}`}
          id={`${id}-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={index === rang}
          aria-disabled={reponse.refus ? true : undefined}
          // Grisée, son nom reste le sien : la raison la décrit, sans entrer dans le nom.
          aria-labelledby={reponse.refus ? `${id}-${index}-nom` : undefined}
          aria-describedby={reponse.refus ? `${id}-${index}-refus` : undefined}
          data-highlighted={index === rang ? "" : undefined}
          className="oto-menu-item aria-disabled:text-mute"
          // Le focus reste dans le champ : le choix se fait au clic, sans le lui retirer.
          onMouseDown={(evenement) => evenement.preventDefault()}
          onClick={() => choisir(reponse)}
        >
          {reponse.kind === "user" ? <Avatar name={reponse.nom} size="sm" aria-hidden="true" /> : <AnimatedIcon as={UsersThree} size="xs" />}
          {reponse.refus ? (
            <span className="flex min-w-0 flex-col items-start text-start">
              <span id={`${id}-${index}-nom`}>{nomDeLaReponse(reponse)}</span>
              <span id={`${id}-${index}-refus`} className="oto-caption whitespace-normal text-mute">
                {reponse.refus}
              </span>
            </span>
          ) : (
            <span>{nomDeLaReponse(reponse)}</span>
          )}
        </button>
      ))}
    </div>
  )
}

type ChampDAjoutDAccesProps = {
  /** Les équipes et les personnes qu'on peut encore ajouter ; `refus` : proposée grisée, avec sa raison. */
  candidats: (Candidat & { refus?: string })[]
  /** Ajoute le candidat choisi ; `true` s'il a abouti : la saisie se vide alors. */
  ajouter: (candidat: Candidat) => Promise<boolean>
  enCours: boolean
  /** « Toute l'organisation » parmi les réponses (fiche d'ajout d'un connecteur) : son ajout, et sa raison si elle est refusée. */
  organisation?: { ajouter: () => void; refus?: string }
}

/** Les réponses à la saisie : toute l'organisation d'abord, si le panneau la propose, puis les candidats ; huit au plus. */
function reponsesA(cherche: string, candidats: ChampDAjoutDAccesProps["candidats"], organisation: ChampDAjoutDAccesProps["organisation"]): Reponse[] {
  if (!cherche) return []
  const toutes: Reponse[] = [...(organisation ? [{ kind: "org" as const, id: "org" as const, nom: TOUTE_L_ORGANISATION, refus: organisation.refus }] : []), ...candidats]
  return toutes.filter((reponse) => normalizeTitle(reponse.nom).includes(cherche)).slice(0, 8)
}

export const ChampDAjoutDAcces = forwardRef<HTMLInputElement, ChampDAjoutDAccesProps>(function ChampDAjoutDAcces({ candidats, ajouter, enCours, organisation }, ref) {
  const id = useId()
  const [saisie, setSaisie] = useState("")
  const [rang, setRang] = useState(-1)
  const cherche = normalizeTitle(saisie)
  const trouves = reponsesA(cherche, candidats, organisation)

  async function choisir(reponse: Reponse) {
    if (enCours || reponse.refus) return
    if (reponse.kind === "org") organisation?.ajouter()
    else if (!(await ajouter(reponse))) return
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
      // Une saisie en cours s'efface d'abord ; le panneau ne se referme qu'au second Échap.
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
        ref={ref}
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
      {ouverte && (trouves.length > 0 ? <Suggestions id={`${id}-liste`} trouves={trouves} rang={rang} choisir={(reponse) => void choisir(reponse)} /> : <p className="oto-caption">{PARTAGE.rienTrouve}</p>)}
    </div>
  )
})
