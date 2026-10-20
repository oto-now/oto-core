"use client"

// Le tableau des équipes (E05-S03, AC10 à AC14 ; porté par E05-S09 partie d1). Porté d'oto-frontend
// (`teams-table.tsx`, `teams-columns.tsx`) : le `Table` du design system, nommé par sa légende, qui défile sous
// 768 px ; l'équipe, ses personnes (visages et compte, un bouton qui ouvre « Les personnes de … »), son menu
// « ⋯ » (ajouter quelqu'un, renommer, supprimer) ; le tri sur le nom et le nombre de personnes ; un seul vide,
// sans action (elle est dans l'en-tête) ; le focus au tableau quand une ligne part. Changé : la colonne
// Responsables (E05-S13, AC-24 : tous les noms, « — » sans responsable ; ils se nomment dans « Les personnes
// de … ») ; le menu selon les droits (composer : l'administrateur et les responsables de l'équipe ;
// renommer, supprimer : l'administrateur) ; le tri dans l'adresse de l'hôte. Retiré : TanStack Query,
// `TitleField` en place (un dialogue à un champ), l'équipe « Tout le monde » (architecture § 4), « Changer de
// responsable… » (E05-S13).
import { useState } from "react"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import type { TeamView } from "../../schemas"
import { AvatarGroup } from "../ds/react/avatar-group"
import { EmptyState } from "../ds/react/empty-state"
import { AnimatedIcon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { IconButton } from "../ds/react/primitives"
import { Table, type Column } from "../ds/react/table"
import { useHote } from "../hote/navigation"
import { pluriel, RESPONSABLES } from "./libelles"
import { PersonnesDeLEquipe, type PersonneDeLOrganisation } from "./personnes-de-l-equipe"
import { ReglagesDEquipe } from "./reglages-d-equipe"
import { useRepliDuFocus } from "./repli-du-focus"
import { SuppressionDEquipe } from "./suppression-d-equipe"
import type { Moi } from "./types"

type Geste = "personnes" | "nom" | "supprimer"
type Tri = "team" | "people"

export type TableauDesEquipesProps = {
  /** Les équipes, déjà triées par la page selon l'adresse. */
  equipes: TeamView[]
  personnes: PersonneDeLOrganisation[]
  moi: Moi
  nomOrganisation: string
  tri: { cle: Tri; sens: "asc" | "desc" }
  adresses: Record<Tri, Record<"asc" | "desc", string>>
  /** Le conteneur de l'onglet (`tabIndex={-1}`), qui reçoit le focus quand une ligne part avec son déclencheur. */
  ancre: string
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`), en chaîne : une page qui bloque la suppression d'une équipe y mène. */
  prefixeDesPages: string
}

const compose = (equipe: TeamView, moi: Moi) => moi.estAdmin || moi.equipesDirigees.includes(equipe.id)

/** Le « ⋯ » d'une équipe : composer, pour l'administrateur ou son responsable ; le reste, pour l'administrateur. */
function itemsDeLEquipe(equipe: TeamView, moi: Moi, ouvrir: (geste: Geste) => void): MenuItem[] {
  const composer: MenuItem[] = compose(equipe, moi) ? [{ label: "Ajouter quelqu'un…", icon: <AnimatedIcon as={UserPlus} size="xs" />, onSelect: () => ouvrir("personnes") }] : []
  if (!moi.estAdmin) return composer
  return [
    ...composer,
    { label: "Renommer…", icon: <AnimatedIcon as={PencilSimple} size="xs" />, onSelect: () => ouvrir("nom") },
    { separator: true },
    { label: "Supprimer l'équipe", icon: <AnimatedIcon as={Trash} size="xs" />, destructive: true, onSelect: () => ouvrir("supprimer") },
  ]
}

function colonnes(moi: Moi, ouvrir: (equipe: TeamView, geste: Geste) => void): Column<TeamView>[] {
  const communes: Column<TeamView>[] = [
    { key: "team", header: "Équipe", primary: true, sortable: true, render: (equipe) => equipe.name },
    { key: "responsables", header: RESPONSABLES.colonne, render: (equipe) => equipe.leadName ?? RESPONSABLES.aucun },
    {
      key: "people",
      header: "Personnes",
      sortable: true,
      // Un bouton, jamais une cellule cliquable : le clic sur le « ⋯ » ne doit pas l'armer aussi.
      render: (equipe) => (
        <button type="button" className="flex items-center gap-2" aria-label={`Voir les personnes de ${equipe.name}`} onClick={() => ouvrir(equipe, "personnes")}>
          <AvatarGroup people={equipe.members.map((personne) => ({ id: personne.userId, name: personne.name }))} max={5} size="sm" on="island" aria-hidden="true" />
          <span>{pluriel(equipe.members.length, "personne", "personnes")}</span>
        </button>
      ),
    },
  ]
  if (!moi.estAdmin && moi.equipesDirigees.length === 0) return communes
  const actions: Column<TeamView> = {
    key: "actions",
    header: "Actions",
    align: "end",
    render: (equipe) => {
      const items = itemsDeLEquipe(equipe, moi, (geste) => ouvrir(equipe, geste))
      if (items.length === 0) return null
      return (
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={`Gérer ${equipe.name}`} variant="ghost" size="sm">
              <AnimatedIcon as={DotsThree} size="xs" />
            </IconButton>
          }
          items={items}
        />
      )
    },
  }
  return [...communes, actions]
}

type DialoguesProps = Omit<TableauDesEquipesProps, "equipes" | "tri" | "adresses" | "ancre"> & {
  ouvert: { geste: Geste; equipe: TeamView }
  onFermer: () => void
  apresUnDepart: () => void
}

/** Le dialogue du geste ouvert, sur l'équipe relue : la composition suit la relecture. */
function DialogueDuGeste({ ouvert, personnes, moi, nomOrganisation, onFermer, apresUnDepart, prefixeDesPages }: DialoguesProps) {
  const { geste, equipe } = ouvert
  if (geste === "personnes") return <PersonnesDeLEquipe equipe={equipe} personnes={personnes} compose={compose(equipe, moi)} nommeLesResponsables={moi.estAdmin} onFermer={onFermer} />
  if (geste === "supprimer") return <SuppressionDEquipe equipe={equipe} onFermer={onFermer} apresUnDepart={apresUnDepart} prefixeDesPages={prefixeDesPages} />
  return <ReglagesDEquipe equipe={equipe} nomOrganisation={nomOrganisation} onFermer={onFermer} />
}

export function TableauDesEquipes({ equipes, personnes, moi, nomOrganisation, tri, adresses, ancre, prefixeDesPages }: TableauDesEquipesProps) {
  const { naviguer } = useHote()
  const apresUnDepart = useRepliDuFocus(ancre, equipes)
  const [ouvert, setOuvert] = useState<{ geste: Geste; id: string } | null>(null)
  const equipe = ouvert ? equipes.find((candidate) => candidate.id === ouvert.id) : undefined
  return (
    <>
      <Table<TeamView>
        caption={`Les équipes de ${nomOrganisation}`}
        responsive="scroll"
        columns={colonnes(moi, (cible, geste) => setOuvert({ geste, id: cible.id }))}
        rows={equipes}
        getRowId={(ligne) => ligne.id}
        sort={{ key: tri.cle, dir: tri.sens }}
        onSortChange={({ key, dir }) => {
          if (key === "team" || key === "people") naviguer(adresses[key][dir])
        }}
        empty={
          <EmptyState icon={<AnimatedIcon as={UsersThree} size="lg" />} title="Aucune équipe pour l'instant">
            Une équipe range les pages, les tableaux et les procédures de celles et ceux qui en font partie.
          </EmptyState>
        }
      />
      {ouvert && equipe && (
        <DialogueDuGeste ouvert={{ geste: ouvert.geste, equipe }} personnes={personnes} moi={moi} nomOrganisation={nomOrganisation} onFermer={() => setOuvert(null)} apresUnDepart={apresUnDepart} prefixeDesPages={prefixeDesPages} />
      )}
    </>
  )
}
