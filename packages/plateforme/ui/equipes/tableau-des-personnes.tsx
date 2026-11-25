"use client"

// Le tableau des personnes (E05-S03, AC4 à AC9 ; porté par E05-S09 partie d1). Porté d'oto-frontend
// (`members-table.tsx`, `members-columns.tsx`) : le `Table` du design system, nommé par sa légende, qui défile
// sous 768 px au lieu de se replier en cartes ; la personne (visage, nom, « · vous », adresse), son statut en
// mot et en teinte, ses équipes, ses gestes au bout de la ligne ; le tri sur la colonne Personne ; deux vides
// qui n'appellent pas la même action ; quand une ligne part avec son déclencheur, le focus va au tableau,
// jamais à `<body>`. Changé : les colonnes Rôle et Dernière connexion, que l'écran d'aujourd'hui montre
// (AC-x2 ; plus d'Équipe par défaut, E05-S13 AC-26) ; une invitation en attente est une ligne « Invitée » nommée par son adresse,
// avec qui l'a envoyée et son échéance ; le tri et le filtre vivent dans l'adresse de l'hôte (`useHote`).
// Retiré : TanStack Query, les pages enchaînées, « Connexions à son nom » et « Depuis » (sans source).
import { Users } from "@phosphor-icons/react/dist/csr/Users"
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { AnimatedIcon } from "../ds/react/icon"
import { EmptyState } from "../ds/react/empty-state"
import { Avatar, Badge } from "../ds/react/primitives"
import { Table, type Column } from "../ds/react/table"
import { Tag } from "../ds/react/tag"
import { dateLisible } from "../format/dates"
import { useHote } from "../hote/navigation"
import { EquipesDUnePersonne, type EquipeProposee } from "./equipes-d-une-personne"
import { COLONNES_DES_PERSONNES, PERSONNES, ROLES } from "./libelles"
import { nomDeLaLigne, type LigneDePersonne } from "./lignes-des-personnes"
import { MenuDUneInvitation, MenuDUnMembre } from "./menu-d-une-personne"
import { useRepliDuFocus } from "./repli-du-focus"
import type { Moi } from "./types"

export type TableauDesPersonnesProps = {
  lignes: LigneDePersonne[]
  moi: Moi
  nomOrganisation: string
  /** Les équipes de l'organisation, que « Ses équipes » propose ; `null` quand leur lecture a échoué. */
  toutes: EquipeProposee[] | null
  sens: "asc" | "desc"
  /** Les adresses du tableau trié dans chaque sens, et celle de la liste sans recherche ni filtre. */
  adresses: { asc: string; desc: string; sansFiltre: string }
  filtrePose: boolean
  /** Le conteneur de l'onglet (`tabIndex={-1}`), qui reçoit le focus quand un geste emporte son déclencheur. */
  ancre: string
}

type Contexte = { moi: Moi; nomOrganisation: string; toutes: EquipeProposee[] | null; apresUnDepart: () => void }

/** La personne : son visage (décoratif, le nom est écrit à côté), son nom, « · vous », son adresse ou qui l'a invitée. */
function Personne({ ligne }: { ligne: LigneDePersonne }) {
  const nom = nomDeLaLigne(ligne)
  const soi = ligne.genre === "membre" && ligne.soi
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={nom} size="sm" self={soi} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {nom}
          {soi && PERSONNES.vous}
        </span>
        <span className="oto-caption truncate">{ligne.genre === "membre" ? ligne.email : PERSONNES.invitePar(ligne.invitePar)}</span>
      </span>
    </span>
  )
}

/** L'échéance d'une invitation ; une inscription sans email n'en a pas. */
function echeance(expiration: string | null): string {
  return expiration === null ? PERSONNES.sansEcheance : PERSONNES.expire(dateLisible(expiration) ?? "?")
}

function colonnes({ moi, nomOrganisation, toutes, apresUnDepart }: Contexte, avecActions: boolean): Column<LigneDePersonne>[] {
  const c = COLONNES_DES_PERSONNES
  const communes: Column<LigneDePersonne>[] = [
    { key: "personne", header: c.personne, primary: true, sortable: true, render: (ligne) => <Personne ligne={ligne} /> },
    {
      key: "statut",
      header: c.statut,
      // Le mot et la teinte, jamais la teinte seule.
      render: (ligne) => (ligne.genre === "membre" ? <Badge tone="ok">{PERSONNES.membre}</Badge> : <Badge tone="review">{PERSONNES.invitee}</Badge>),
    },
    { key: "role", header: c.role, render: (ligne) => ROLES[ligne.role] },
    {
      key: "equipes",
      header: c.equipes,
      render: (ligne) =>
        ligne.genre === "membre" ? <EquipesDUnePersonne membre={ligne} toutes={toutes} moi={moi} apresUnDepart={apresUnDepart} /> : ligne.equipe ? <Tag>{ligne.equipe}</Tag> : <span className="oto-caption">{PERSONNES.aucune}</span>,
    },
    {
      key: "connexion",
      header: c.connexion,
      render: (ligne) => (ligne.genre === "membre" ? (dateLisible(ligne.derniereConnexion) ?? PERSONNES.jamais) : echeance(ligne.expiration)),
    },
  ]
  if (!avecActions) return communes
  return [
    ...communes,
    {
      key: "actions",
      header: c.actions,
      align: "end",
      render: (ligne) =>
        ligne.genre === "membre" ? (
          <MenuDUnMembre ligne={ligne} moi={moi} nomOrganisation={nomOrganisation} toutes={toutes} apresUnDepart={apresUnDepart} />
        ) : (
          <MenuDUneInvitation ligne={ligne} nomOrganisation={nomOrganisation} apresUnDepart={apresUnDepart} />
        ),
    },
  ]
}

/** Deux vides, qui n'appellent pas la même action : un filtre qui ne trouve personne, une organisation où l'on est seul. */
function TableauVide({ filtrePose, sansFiltre }: { filtrePose: boolean; sansFiltre: string }) {
  const { Lien } = useHote()
  if (filtrePose) {
    return (
      <EmptyState
        icon={<AnimatedIcon as={WarningCircle} anim="bounce" size="lg" />}
        title={PERSONNES.aucunResultat}
        action={
          <Lien href={sansFiltre} className="oto-btn anim-host" data-variant="secondary" data-size="md">
            <span>{PERSONNES.voirTout}</span>
          </Lien>
        }
      >
        {PERSONNES.aucunResultatTexte}
      </EmptyState>
    )
  }
  return (
    <EmptyState icon={<AnimatedIcon as={Users} anim="pulse" size="lg" />} title={PERSONNES.seul}>
      {PERSONNES.seulTexte}
    </EmptyState>
  )
}

export function TableauDesPersonnes({ lignes, moi, nomOrganisation, toutes, sens, adresses, filtrePose, ancre }: TableauDesPersonnesProps) {
  const { naviguer } = useHote()
  const apresUnDepart = useRepliDuFocus(ancre, lignes)
  const avecActions = moi.estAdmin || moi.equipesDirigees.length > 0 || lignes.some((ligne) => ligne.genre === "invitation" && ligne.annulable)
  return (
    <Table<LigneDePersonne>
      caption={PERSONNES.legende(nomOrganisation)}
      responsive="scroll"
      columns={colonnes({ moi, nomOrganisation, toutes, apresUnDepart }, avecActions)}
      rows={lignes}
      getRowId={(ligne) => `${ligne.genre}-${ligne.id}`}
      sort={{ key: "personne", dir: sens }}
      onSortChange={(tri) => naviguer(adresses[tri.dir])}
      empty={<TableauVide filtrePose={filtrePose} sansFiltre={adresses.sansFiltre} />}
    />
  )
}
