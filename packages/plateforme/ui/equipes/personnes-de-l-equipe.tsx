"use client"

// « Les personnes de … » (E05-S03, AC13 ; porté par E05-S09 partie d1) : qui est dans une équipe, et comment
// elle se compose. Porté d'oto-frontend (`team-people-dialog.tsx`, `team-people-rows.tsx`) : un dialogue plutôt
// qu'une ligne dépliable (le `Table` n'a pas de rangée de détail), deux sections, « dedans » et « Ajouter
// quelqu'un », et un bouton nommé par ligne (« Retirer … de cette équipe ») plutôt qu'une case qui changerait
// de liste sous le pointeur ; le compte en titre ; un seul créneau d'échec ; le focus au dialogue quand le
// bouton activé change de liste. Changé : la composition se lit dans l'équipe servie (`TeamView.members`),
// les responsables dits ; composer est réservé à l'administrateur et aux responsables de CETTE équipe (H72),
// les autres voient la liste. Retiré : l'équipe « Tout le monde » (architecture § 4), la file d'invitations
// d'équipe (les invitations sont dans l'onglet Membres), les deux sources de la composition. Ajouté (M36,
// fiche D94 B) : retirer quelqu'un demande confirmation, par un second dialogue qui se ferme au clic, avant la
// réponse. Ajouté (E05-S13, AC-24) : une équipe a zéro, un ou plusieurs responsables ; l'administrateur nomme
// chaque membre responsable ou le retire des responsables, sur sa ligne (`PATCH teams/<id>/members/<userId>`) ;
// retirer de l'équipe un responsable lui est aussi réservé (HN-E05S13-20).
import { useState } from "react"
import { Crown } from "@phosphor-icons/react/dist/csr/Crown"
import { CrownCross } from "@phosphor-icons/react/dist/csr/CrownCross"
import { UserMinus } from "@phosphor-icons/react/dist/csr/UserMinus"
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { teamMemberSchema, teamRoleSchema, type TeamView } from "../../schemas"
import { ConfirmDialog } from "../ds/react/confirm-dialog"
import { Dialog } from "../ds/react/dialog"
import { EmptyState } from "../ds/react/empty-state"
import { AnimatedIcon, type Glyphe } from "../ds/react/icon"
import { Alert, Avatar, Button } from "../ds/react/primitives"
import { Row, RowList } from "../ds/react/row-list"
import { useGeste } from "./gestes"
import { pluriel, RESPONSABLES, ROLES_D_EQUIPE } from "./libelles"
import { useRepliDuFocus } from "./repli-du-focus"

/** Une personne de l'organisation, telle que la composition la propose. */
export type PersonneDeLOrganisation = { id: string; nom: string; email: string }

/** Le repli du focus : le bouton activé change de section, et disparaît de sous le doigt. */
const ANCRE = "equipe-composition"

/** Un geste d'une ligne ; `cle` le garde d'un rendu à l'autre (nommer puis retirer : le même bouton garde le focus). */
type Action = { cle: "role" | "retrait" | "ajout"; libelle: string; court: string; glyphe: Glyphe; enCours: boolean; faire: () => void }

function BoutonDAction({ action }: { action: Action }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={action.libelle}
      disabled={action.enCours}
      aria-busy={action.enCours}
      iconStart={<AnimatedIcon as={action.glyphe} size="xs" aria-hidden="true" />}
      onClick={action.faire}
    >
      {action.court}
    </Button>
  )
}

/** Une personne : son visage, son nom, son adresse et, au bout, les gestes qui la concernent. */
function LigneDePersonne({ nom, email, precision, actions = [] }: { nom: string; email: string; precision?: string; actions?: Action[] }) {
  return (
    <Row
      lead={<Avatar name={nom} size="sm" aria-hidden="true" />}
      end={
        actions.length > 0 && (
          <span className="flex items-center gap-2">
            {actions.map((action) => (
              <BoutonDAction key={action.cle} action={action} />
            ))}
          </span>
        )
      }
    >
      <span className="ms-2 flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{nom}</span>
        {precision && <span className="oto-caption">{precision}</span>}
        <span className="oto-caption truncate">{email}</span>
      </span>
    </Row>
  )
}

type Membre = TeamView["members"][number]

type SectionsProps = {
  equipe: TeamView
  dehors: PersonneDeLOrganisation[]
  compose: boolean
  nommeLesResponsables: boolean
  enCours: boolean
  retirer: (personne: Membre) => void
  changerLeRole: (personne: Membre, role: Membre["role"]) => void
  ajouter: (personne: PersonneDeLOrganisation) => void
}

/**
 * Les gestes d'une personne de l'équipe (AC-24) : la nommer responsable ou la retirer des responsables
 * (administrateur), la retirer de l'équipe (qui compose ; un responsable, par l'administrateur seul).
 */
function gestesDe(personne: Membre, props: Omit<SectionsProps, "equipe" | "dehors" | "ajouter">): Action[] {
  const { compose, nommeLesResponsables, enCours } = props
  const responsable = personne.role === "lead"
  const court = responsable ? RESPONSABLES.retirer : RESPONSABLES.nommer
  const role: Action[] = nommeLesResponsables
    ? [{ cle: "role", libelle: `${court} : ${personne.name}`, court, glyphe: responsable ? CrownCross : Crown, enCours, faire: () => props.changerLeRole(personne, responsable ? "member" : "lead") }]
    : []
  const retrait: Action[] =
    compose && (!responsable || nommeLesResponsables)
      ? [{ cle: "retrait", libelle: `Retirer ${personne.name} de cette équipe`, court: "Retirer", glyphe: UserMinus, enCours, faire: () => props.retirer(personne) }]
      : []
  return [...role, ...retrait]
}

function Dedans({ equipe, ...props }: Omit<SectionsProps, "dehors" | "ajouter">) {
  return (
    <section aria-labelledby={`${ANCRE}-dedans`} className="flex flex-col gap-2">
      <h3 id={`${ANCRE}-dedans`} className="oto-caption">
        {pluriel(equipe.members.length, "personne", "personnes")}
      </h3>
      <RowList
        className="flex flex-col gap-1"
        aria-label={`Les personnes de ${equipe.name}`}
        empty={
          <EmptyState icon={<AnimatedIcon as={UsersThree} size="lg" />} title="Personne pour l'instant">
            Cette équipe ne range rien tant que personne n&apos;en fait partie.
          </EmptyState>
        }
      >
        {equipe.members.map((personne) => (
          <LigneDePersonne
            key={personne.userId}
            nom={personne.name}
            email={personne.email}
            precision={personne.role === "lead" ? ROLES_D_EQUIPE.lead : undefined}
            actions={gestesDe(personne, props)}
          />
        ))}
      </RowList>
    </section>
  )
}

function Dehors({ equipe, dehors, enCours, ajouter }: Pick<SectionsProps, "equipe" | "dehors" | "enCours" | "ajouter">) {
  return (
    <section aria-labelledby={`${ANCRE}-dehors`} className="flex flex-col gap-2">
      <h3 id={`${ANCRE}-dehors`} className="oto-caption">
        Ajouter quelqu&apos;un
      </h3>
      <RowList
        className="flex flex-col gap-1"
        aria-label={`À ajouter à ${equipe.name}`}
        empty={
          <EmptyState icon={<AnimatedIcon as={UsersThree} size="lg" />} title="Tout le monde y est déjà">
            Chaque personne de l&apos;organisation fait déjà partie de cette équipe.
          </EmptyState>
        }
      >
        {dehors.map((personne) => (
          <LigneDePersonne
            key={personne.id}
            nom={personne.nom}
            email={personne.email}
            actions={[{ cle: "ajout", libelle: `Ajouter ${personne.nom} à cette équipe`, court: "Ajouter", glyphe: UserPlus, enCours, faire: () => ajouter(personne) }]}
          />
        ))}
      </RowList>
    </section>
  )
}

/** Les personnes de l'organisation qui ne sont pas dans l'équipe : la section « Ajouter quelqu'un ». */
function horsDeLEquipe(equipe: TeamView, personnes: readonly PersonneDeLOrganisation[]): PersonneDeLOrganisation[] {
  const dedans = new Set(equipe.members.map((personne) => personne.userId))
  return personnes.filter((personne) => !dedans.has(personne.id))
}

type ConfirmationDuRetraitProps = { nom: string; nomEquipe: string; onRenoncer: () => void; onConfirmer: () => void }

/**
 * Monté le temps de la question : démonté par « Annuler », Échap ou la confirmation, le dialogue rend le focus
 * au « Retirer » qui l'a ouvert (`useNativeDialog`). Le geste destructeur n'est ni le bouton par défaut ni
 * celui qui a le focus (`ConfirmDialog`).
 */
function ConfirmationDuRetrait({ nom, nomEquipe, onRenoncer, onConfirmer }: ConfirmationDuRetraitProps) {
  return (
    <ConfirmDialog open onCancel={onRenoncer} title={`Retirer ${nom} de l'équipe ${nomEquipe} ?`} confirmLabel="Retirer de l'équipe" onConfirm={onConfirmer}>
      <p>{`Les accès que ${nomEquipe} lui donne tombent ; « Ajouter » l'y remet.`}</p>
    </ConfirmDialog>
  )
}

type PersonnesDeLEquipeProps = {
  equipe: TeamView
  personnes: PersonneDeLOrganisation[]
  compose: boolean
  /** Nommer ou retirer les responsables : l'administrateur seul (HN-E05S13-20). */
  nommeLesResponsables: boolean
  onFermer: () => void
}

export function PersonnesDeLEquipe({ equipe, personnes, compose, nommeLesResponsables, onFermer }: PersonnesDeLEquipeProps) {
  const geste = useGeste()
  const apresUnDepart = useRepliDuFocus(ANCRE, equipe.members)
  const [aRetirer, setARetirer] = useState<Membre | null>(null)
  const retirer = (personne: Membre) => {
    setARetirer(null)
    geste.envoyer({ methode: "DELETE", ressource: `teams/${equipe.id}/members/${personne.userId}` }, undefined, { succes: apresUnDepart })
  }
  const ajouter = (personne: PersonneDeLOrganisation) => {
    const saisie = teamMemberSchema.safeParse({ userId: personne.id })
    if (saisie.success) geste.envoyer({ methode: "POST", ressource: `teams/${equipe.id}/members`, corps: saisie.data }, undefined, { succes: apresUnDepart })
  }
  // La ligne remonte ou descend avec son rôle (les responsables d'abord) : le focus se replie s'il la perd.
  const changerLeRole = (personne: Membre, role: Membre["role"]) => {
    const saisie = teamRoleSchema.safeParse({ role })
    if (saisie.success) {
      geste.envoyer({ methode: "PATCH", ressource: `teams/${equipe.id}/members/${personne.userId}`, corps: saisie.data }, undefined, { succes: apresUnDepart })
    }
  }
  return (
    <Dialog
      open
      onClose={onFermer}
      title={`Les personnes de ${equipe.name}`}
      size="xl"
      footer={
        <Button variant="secondary" onClick={onFermer}>
          Fermer
        </Button>
      }
    >
      <div id={ANCRE} tabIndex={-1} className="flex flex-col gap-4">
        <Dedans
          equipe={equipe}
          compose={compose}
          nommeLesResponsables={nommeLesResponsables}
          enCours={geste.enCours}
          retirer={setARetirer}
          changerLeRole={changerLeRole}
        />
        {compose && <Dehors equipe={equipe} dehors={horsDeLEquipe(equipe, personnes)} enCours={geste.enCours} ajouter={ajouter} />}
        {geste.erreur && (
          <Alert tone="fail" title="Changement impossible">
            {geste.erreur}
          </Alert>
        )}
      </div>
      {aRetirer && <ConfirmationDuRetrait nom={aRetirer.name} nomEquipe={equipe.name} onRenoncer={() => setARetirer(null)} onConfirmer={() => retirer(aRetirer)} />}
    </Dialog>
  )
}
