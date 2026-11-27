"use client"

// Les pièces du partage d'un connecteur communes à « Qui peut s'en servir » du détail et à « Qui pourra s'en servir » de
// la fiche d'ajout : le niveau d'une ligne en pastille de sa couleur, la liste des niveaux avec leur glyphe et ce qu'ils
// ouvrent, la ligne du propriétaire, celle de toute l'organisation et le lien qui l'ouvre. Sans ce module, les deux
// panneaux recopieraient chacun leurs niveaux et leurs lignes.
import type { ReactNode } from "react"
import { Eye } from "@phosphor-icons/react/dist/csr/Eye"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { ACCOUNT_LEVEL_NAMES, type AccountLevelName } from "../../../schemas"
import { LIEN } from "../../components/classes"
import { AnimatedIcon, Icon } from "../../ds/react/icon"
import { Avatar } from "../../ds/react/primitives"
import { Select, type SelectOption } from "../../ds/react/select"
import { Tooltip } from "../../ds/react/tooltip"
import type { SujetsDeRegle } from "../../equipes/types"
import type { Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { detailDuNiveau, NIVEAUX_DU_COMPTE, NIVEAUX_PARTAGES, TON_DU_NIVEAU, type ActionsParClasse } from "./libelles-des-partages"

/** Le glyphe de chaque niveau dans sa liste : celui de son groupe de fonctions, la clé pour la gestion. */
export const GLYPHES_DES_NIVEAUX: Record<AccountLevelName, ReactNode> = { none: <Prohibit />, read: <Eye />, write: <PencilSimple />, sensitive: <ShieldCheck />, manage: <Key /> }

export const niveauLu = (valeur: string) => ACCOUNT_LEVEL_NAMES.find((candidat) => candidat === valeur)

/** « Retirer l'accès » au bas du menu d'une ligne : sa valeur, `none`, ne nomme aucun niveau qu'on partage. */
export const RETIRER_L_ACCES: SelectOption = { value: "none", label: "Retirer l'accès", icon: GLYPHES_DES_NIVEAUX.none }

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

/**
 * La ligne du propriétaire, en tête du panneau : son nom, « vous » sur la même ligne, et ce qu'il est ; `groupe` : une
 * équipe ou l'organisation, sous l'icône des groupes plutôt que des initiales.
 */
export function LigneDuProprietaire({ nom, vous, groupe = false }: { nom: string; vous: boolean; groupe?: boolean }) {
  return (
    <div className="oto-pop-row">
      {groupe ? (
        <span className="oto-avatar" data-size="sm" aria-hidden="true">
          <AnimatedIcon as={UsersThree} size="xs" />
        </span>
      ) : (
        <Avatar name={nom} size="sm" aria-hidden="true" />
      )}
      <span className="oto-share-name">
        {nom}
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

/**
 * « Toute l'organisation » et son niveau, montée seulement quand elle est ouverte ; « Retirer l'accès » la ferme. Commune
 * au partage du détail et à celui de l'ajout.
 */
export function LigneDeToutLOrganisation({ valeur, servi, actions, administre, disabled, onChange }: LigneDeToutLOrganisationProps) {
  return (
    <div className="oto-pop-row">
      <span className="oto-avatar" data-size="sm" aria-hidden="true">
        <AnimatedIcon as={UsersThree} size="xs" />
      </span>
      <span className="oto-share-name">Toute l&apos;organisation</span>
      <PastilleDeNiveau valeur={valeur} servi={servi} nom="Accès de toute l'organisation" options={[...optionsDeNiveau(servi, actions, administre), RETIRER_L_ACCES]} disabled={disabled} onChange={onChange} />
    </div>
  )
}

/** Le style des liens discrets du partage : « Ouvrir à toute l'organisation », « Journal des partages ». */
export const LIEN_DISCRET = "inline-flex items-center gap-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ink"

/**
 * « Ouvrir à toute l'organisation », sous les lignes tant qu'elle n'a pas d'accès : un lien qui l'ajoute en « Lire ».
 * `refus` : la raison pour qui ne peut pas le faire ; le lien reste lisible, grisé, et l'infobulle la dit au survol et au
 * focus (un bouton `disabled` ne recevrait ni l'un ni l'autre).
 */
export function OuvrirAToutLOrganisation({ ouvrir, refus, disabled = false }: { ouvrir: () => void; refus?: string; disabled?: boolean }) {
  const lien = (
    <button
      type="button"
      aria-disabled={refus !== undefined || disabled || undefined}
      onClick={refus === undefined && !disabled ? ouvrir : undefined}
      className={`${LIEN_DISCRET} self-start ${refus === undefined ? LIEN : "cursor-default rounded-sm text-mute"}`}
    >
      <Icon as={UsersThree} size="xs" />
      Ouvrir à toute l&apos;organisation
    </button>
  )
  return refus === undefined ? lien : <Tooltip content={refus}>{lien}</Tooltip>
}
