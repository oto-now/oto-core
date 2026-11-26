"use client"

// Les pièces du partage d'un connecteur communes au panneau « Partager » du détail et au panneau « Qui pourra s'en
// servir » de la fiche d'ajout : le niveau d'une ligne en pastille de sa couleur, la liste des niveaux avec leur glyphe
// et ce qu'ils ouvrent, et la ligne du propriétaire. Sans ce module, les deux panneaux recopieraient chacun leurs niveaux.
import type { ReactNode } from "react"
import { Eye } from "@phosphor-icons/react/dist/csr/Eye"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { ACCOUNT_LEVEL_NAMES, type AccountLevelName } from "../../../schemas"
import { AnimatedIcon } from "../../ds/react/icon"
import { Avatar } from "../../ds/react/primitives"
import { Select, type SelectOption } from "../../ds/react/select"
import type { SujetsDeRegle } from "../../equipes/types"
import type { Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { detailDuNiveau, NIVEAUX_DU_COMPTE, NIVEAUX_PARTAGES, TON_DU_NIVEAU, type ActionsParClasse } from "./libelles-des-partages"

/** Le glyphe de chaque niveau dans sa liste : celui de son groupe de fonctions, la clé pour la gestion. */
export const GLYPHES_DES_NIVEAUX: Record<AccountLevelName, ReactNode> = { none: <Prohibit />, read: <Eye />, write: <PencilSimple />, sensitive: <ShieldCheck />, manage: <Key /> }

export const niveauLu = (valeur: string) => ACCOUNT_LEVEL_NAMES.find((candidat) => candidat === valeur)

/** « Aucun accès » de la ligne de toute l'organisation : personne ne s'en sert par ce partage. */
export const AUCUN_ACCES: SelectOption = { value: "none", label: NIVEAUX_DU_COMPTE.none, description: "Personne ne s'en sert par ce partage.", icon: GLYPHES_DES_NIVEAUX.none }

/**
 * Les niveaux qu'une ligne propose : ceux qu'on partage, la gestion pour un administrateur, et toujours celui de la ligne
 * (la gestion, posée par un administrateur, reste lisible pour qui ne l'accorde pas).
 */
export function optionsDeNiveau(courant: AccountLevelName, actions: ActionsParClasse | null, administre: boolean): SelectOption[] {
  const niveaux = administre ? [...NIVEAUX_PARTAGES, "manage" as const] : NIVEAUX_PARTAGES
  const partages: SelectOption[] = niveaux.map((niveau) => ({ value: niveau, label: NIVEAUX_DU_COMPTE[niveau], description: detailDuNiveau(niveau, actions), icon: GLYPHES_DES_NIVEAUX[niveau] }))
  const horsEchelle = partages.some((option) => option.value === courant) || courant === "none" ? [] : [{ value: courant, label: NIVEAUX_DU_COMPTE[courant], icon: GLYPHES_DES_NIVEAUX[courant] }]
  return [...horsEchelle, ...partages]
}

type PastilleProps = { valeur: string; servi: AccountLevelName; options: SelectOption[]; nom: string; disabled: boolean; onChange: (valeur: string) => void }

/** Le niveau d'une ligne, en pastille de sa couleur, qui ouvre la liste des niveaux. */
export function PastilleDeNiveau({ valeur, servi, options, nom, disabled, onChange }: PastilleProps) {
  return (
    <span className="oto-share-level" data-niveau={TON_DU_NIVEAU[niveauLu(valeur) ?? servi]}>
      <Select size="sm" value={valeur} options={options} aria-label={nom} disabled={disabled} onChange={(evenement) => onChange(evenement.target.value)} />
    </span>
  )
}

/** La ligne du propriétaire, en tête du panneau : son nom, « vous », et ce qu'il est, ou le choix du propriétaire. */
export function LigneDuProprietaire({ nom, vous, choix }: { nom: string; vous: boolean; choix?: ReactNode }) {
  return (
    <div className="oto-pop-row">
      <Avatar name={nom} size="sm" aria-hidden="true" />
      <span className="oto-share-name">
        {choix ?? nom}
        {vous && <EtiquetteDeLigne accent>vous</EtiquetteDeLigne>}
      </span>
      <span className="oto-pop-meta">Propriétaire</span>
    </div>
  )
}

/**
 * Les équipes puis les personnes qu'on peut encore ajouter : ni un sujet déjà ajouté, ni un exclu (le propriétaire d'un
 * connecteur personnel, l'équipe qui le porte), les uns et les autres par leur clé « genre:id ».
 */
export function candidatsDe(sujets: SujetsDeRegle, dejaAjoutes: readonly { kind: "team" | "user"; id: string }[], exclus: readonly string[]): Candidat[] {
  const ecartes = new Set([...dejaAjoutes.map(({ kind, id }) => `${kind}:${id}`), ...exclus])
  const tous: Candidat[] = [...sujets.equipes.map((equipe) => ({ kind: "team" as const, ...equipe })), ...sujets.personnes.map((personne) => ({ kind: "user" as const, ...personne }))]
  return tous.filter((candidat) => !ecartes.has(`${candidat.kind}:${candidat.id}`))
}

type LigneDeToutLOrganisationProps = { valeur: string; servi: AccountLevelName; actions: ActionsParClasse | null; administre: boolean; disabled: boolean; onChange: (valeur: string) => void }

/** « Toute l'organisation » et son niveau, « Aucun accès » compris : commune au partage du détail et à celui de l'ajout. */
export function LigneDeToutLOrganisation({ valeur, servi, actions, administre, disabled, onChange }: LigneDeToutLOrganisationProps) {
  return (
    <div className="oto-pop-row">
      <span className="oto-avatar" data-size="sm" aria-hidden="true">
        <AnimatedIcon as={UsersThree} size="xs" />
      </span>
      <span className="oto-share-name">Toute l&apos;organisation</span>
      <PastilleDeNiveau valeur={valeur} servi={servi} nom="Accès de toute l'organisation" options={[...optionsDeNiveau(servi, actions, administre), AUCUN_ACCES]} disabled={disabled} onChange={onChange} />
    </div>
  )
}
