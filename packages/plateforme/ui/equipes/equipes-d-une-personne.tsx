"use client"

// La cellule « Équipes » d'une personne, et le groupe « Ses équipes » que partagent ses menus (E05-S03, AC13 ;
// porté par E05-S09 partie d1). Porté d'oto-frontend (`member-actions.tsx`, `MemberTeamsCell`,
// `itemsDeSesEquipes`, `useBascule`, `EchecDeLaBascule`) : deux puces au plus sur une ligne, un « +n » qui
// ouvre le menu, un « + » nommé « Régler les équipes de … » ; une seule liste d'items pour les deux
// déclencheurs et le « ⋯ » ; cocher garde le menu ouvert (`keepOpen`) ; l'échec d'une bascule se dit sous
// son déclencheur, jamais dans le menu, qui n'a pas de fente pour un message. Changé : une case par équipe
// que qui regarde compose (toutes pour l'administrateur, les siennes pour un responsable, H72), les autres
// équipes de la personne cochées et inertes ; l'envoi par l'API du paquet (`POST` et `DELETE
// teams/<id>/members`, `invitations/<id>/teams/<teamId>` pour une personne en attente), puis la relecture. Retiré : « Tout le monde » automatique (architecture § 4),
// `ZoneNonServie`. E05-S11 (retour 8, AC-21) : les deux déclencheurs du menu à cases prennent le bord arrondi
// des listes de choix (`oto-scope`), le menu reste le même.
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { teamMemberSchema } from "../../schemas"
import { AnimatedIcon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { Tag } from "../ds/react/tag"
import { useGeste, type Requete } from "./gestes"
import { PERSONNES, pluriel } from "./libelles"
import { nomDeLaLigne, type LigneDePersonne } from "./lignes-des-personnes"
import type { Moi } from "./types"

/** Une équipe de l'organisation, telle que les menus la proposent. */
export type EquipeProposee = { id: string; nom: string }

/** Deux puces : les noms d'équipes sont longs, la troisième poussait le « + » hors de la colonne (mesure d'oto-frontend). */
const PUCES_VISIBLES = 2

/** Les équipes que qui regarde compose : toutes pour l'administrateur, celles qu'il dirige pour un responsable (H72). */
export function equipesComposables(toutes: readonly EquipeProposee[] | null, moi: Moi): EquipeProposee[] {
  return (toutes ?? []).filter((equipe) => moi.estAdmin || moi.equipesDirigees.includes(equipe.id))
}

/** Le groupe « Ses équipes » : une case par équipe composée, cochée si la personne en est ; ses autres équipes, cochées et inertes. */
export function itemsDeSesEquipes(personne: LigneDePersonne, composables: readonly EquipeProposee[], basculer: (equipe: EquipeProposee) => void, enCours: boolean): MenuItem[] {
  const siennes = new Set(personne.equipes.map((equipe) => equipe.id))
  const composees = new Set(composables.map((equipe) => equipe.id))
  const cases: MenuItem[] = composables.map((equipe) => ({
    label: equipe.nom,
    checked: siennes.has(equipe.id),
    keepOpen: true,
    disabled: enCours,
    onSelect: () => basculer(equipe),
  }))
  const inertes: MenuItem[] = personne.equipes.filter((equipe) => !composees.has(equipe.id)).map((equipe) => ({ label: equipe.nom, checked: true, disabled: true }))
  return [{ group: "Ses équipes" }, ...cases, ...inertes]
}

/**
 * La requête qui ajoute la personne à l'équipe, ou l'en retire : un membre par `teams/<id>/members`, une personne
 * en attente par les équipes de son invitation, qui ne changent qu'à sa première connexion.
 */
function requeteDeLaBascule(personne: LigneDePersonne, equipe: EquipeProposee, retirer: boolean): Requete | null {
  if (personne.genre === "invitation") {
    const ressource = `invitations/${personne.id}/teams/${equipe.id}`
    return retirer ? { methode: "DELETE", ressource } : { methode: "POST", ressource, corps: {} }
  }
  if (retirer) return { methode: "DELETE", ressource: `teams/${equipe.id}/members/${personne.id}` }
  const saisie = teamMemberSchema.safeParse({ userId: personne.id })
  return saisie.success ? { methode: "POST", ressource: `teams/${equipe.id}/members`, corps: saisie.data } : null
}

/**
 * Ajouter la personne à une équipe, ou l'en retirer, selon qu'elle en est. `apresUnDepart`, s'il est donné,
 * suit chaque succès : retirer la troisième équipe emporte le « +n » et son menu ouvert à la relecture, et le
 * focus qui y était va à l'ancre du tableau ; un déclencheur resté en place garde le sien (`replierLeFocusSur`).
 */
export function useBascule(personne: LigneDePersonne, apresUnDepart?: () => void) {
  const geste = useGeste()
  const suites = { succes: apresUnDepart }
  const basculer = (equipe: EquipeProposee) => {
    const requete = requeteDeLaBascule(personne, equipe, personne.equipes.some((sienne) => sienne.id === equipe.id))
    if (requete) geste.envoyer(requete, undefined, suites)
  }
  return { ...geste, basculer }
}

/** L'échec d'une bascule, sous son déclencheur : `role="alert"` l'annonce sans déplacer le focus. */
export function EchecDuGeste({ erreur }: { erreur: string }) {
  if (!erreur) return null
  return (
    <span role="alert" className="oto-field-error">
      {erreur}
    </span>
  )
}

/** Les puces des premières équipes, ou « Aucune », un mot plutôt qu'une cellule blanche. */
function PucesDesEquipes({ equipes }: { equipes: LigneDePersonne["equipes"] }) {
  if (equipes.length === 0) return <span className="oto-caption">{PERSONNES.aucune}</span>
  return equipes.slice(0, PUCES_VISIBLES).map((equipe) => <Tag key={equipe.id}>{equipe.nom}</Tag>)
}

type EquipesDUnePersonneProps = {
  /** Un membre, ou une personne en attente, dont les équipes sont celles de son invitation. */
  ligne: LigneDePersonne
  toutes: readonly EquipeProposee[] | null
  moi: Moi
  /** Le repli du focus du tableau, quand la relecture emporte le « +n » où il était. */
  apresUnDepart: () => void
}

export function EquipesDUnePersonne({ ligne, toutes, moi, apresUnDepart }: EquipesDUnePersonneProps) {
  const { basculer, erreur, enCours } = useBascule(ligne, apresUnDepart)
  const composables = equipesComposables(toutes, moi)
  const cachees = Math.max(0, ligne.equipes.length - PUCES_VISIBLES)
  const items = itemsDeSesEquipes(ligne, composables, basculer, enCours)
  const nom = nomDeLaLigne(ligne)
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <PucesDesEquipes equipes={ligne.equipes} />
        {cachees > 0 && (
          <DropdownMenu
            align="start"
            trigger={
              <button type="button" className="oto-scope" aria-label={`Et ${pluriel(cachees, "autre équipe", "autres équipes")} de ${nom}`}>
                +{cachees}
              </button>
            }
            items={items}
          />
        )}
        {composables.length > 0 && (
          <DropdownMenu
            align="start"
            trigger={
              <button type="button" className="oto-scope" data-icon-only="" aria-label={`Régler les équipes de ${nom}`}>
                <AnimatedIcon as={Plus} size="xs" />
              </button>
            }
            items={items}
          />
        )}
      </span>
      <EchecDuGeste erreur={erreur} />
    </span>
  )
}
