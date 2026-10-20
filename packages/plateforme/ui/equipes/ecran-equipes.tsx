// « Équipes & accès » (E05-S03, AC1 à AC3 ; titre d'E05-S11, AC-33) : une route, deux onglets portés par
// l'adresse de l'hôte (`?tab=`), un Server Component qui aiguille ; seuls les gestes sont des îlots client.
// Chaque donnée arrive en `resultat` (`{ data }` ou `{ error }`, portage § 4) ; la navigation vient de
// l'hôte (`Lien`, `hrefDOnglet`), `ui/` n'importe aucun routeur.
//
// Porté d'oto-frontend par E05-S09 (partie d1 ; `routes/settings.members.lazy.tsx`, capture
// `membres-final.png`) : l'en-tête d'écran (titre et glyphe, la méta qui suit l'onglet et compte ce que la page
// a lu, l'action qui suit l'onglet : « Inviter quelqu'un », « Créer une équipe »), puis UN îlot dont la tête
// est la barre d'onglets, les comptes en badges, le corps le contenu de l'onglet ; la recherche, le filtre et
// le tri des tableaux dans l'adresse (`reglages`). Retiré : TanStack Router, `SettingsShell` et son fil
// « Réglages / … » (la plateforme n'a pas d'écran de réglages qui les regroupe : le menu de l'entreprise du
// rail en tient lieu) ; les onglets « Règles d'accès » et « Accès plateforme » (E05-S13, AC-5, fiche D127 b,
// c : les droits se règlent dans « Partager » de chaque contenu, les accès plateforme depuis la console Oto).
import { Users } from "@phosphor-icons/react/dist/ssr/Users"
import { limitReached, type EquipesTab, type MemberView, type OpenEntry, type OrgLimitsView, type ReglagesDesListes, type TeamView } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Icon } from "../ds/react/icon"
import { Island } from "../ds/react/island"
import { Badge } from "../ds/react/primitives"
import { ScreenHeader } from "../ds/react/screen-header"
import { Skeleton } from "../ds/react/skeleton"
import { BoutonDInvitation } from "../invitations/bouton-d-invitation"
import { LimiteAtteinte } from "../limites/limite-atteinte"
import { CreationDEquipe } from "./creation-d-equipe"
import { OngletEquipes } from "./equipes"
import { ECRAN, ONGLETS, pluriel } from "./libelles"
import { OngletMembres } from "./membres"
import { Onglets } from "./onglets"
import type { InvitationEnAttente, Moi, Navigation, OptionsDInvitation } from "./types"

export type EcranEquipesProps = {
  onglet: EquipesTab
  /** La recherche, le filtre et le tri des tableaux, lus dans l'adresse (`equipesListesSchema`) ; absents, ceux par défaut. */
  reglages?: ReglagesDesListes
  nomOrganisation: string
  moi: Moi
  membres: Resultat<MemberView[]>
  invitations: Resultat<InvitationEnAttente[]>
  optionsDInvitation: Resultat<OptionsDInvitation | null>
  equipes: Resultat<TeamView[]>
  /** Les capacités de l'organisation (`orgLimitsView`, E12-S02) ; absentes : aucun geste grisé. */
  limites?: OrgLimitsView
  /** L'entrée sans invitation (`readOpenEntry`), montrée à qui administre sous les membres ; absente : rien. */
  entreeSansInvitation?: OpenEntry
  Lien: LienDeLHote
  /** L'adresse d'un onglet ; `reglages` : ceux de ses tableaux (un réglage absent y prend son défaut). */
  hrefDOnglet: (onglet: EquipesTab, reglages?: Partial<ReglagesDesListes>) => string
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`), en chaîne : une page qui bloque la suppression d'une équipe y mène. */
  prefixeDesPages: string
}

const PAR_DEFAUT: ReglagesDesListes = { q: "", order: "asc" }

/** Le compte d'un onglet, en badge, quand sa lecture l'a servi : rien pendant une panne. */
function compte(resultat: Resultat<unknown[]> | undefined) {
  return resultat?.data ? <Badge>{resultat.data.length}</Badge> : undefined
}

/** La méta de l'en-tête suit l'onglet, et ses nombres viennent de ce que la page a lu. */
function meta(props: EcranEquipesProps): string | undefined {
  const { onglet, membres, invitations, equipes } = props
  if (onglet === "teams") return equipes.data && pluriel(equipes.data.length, "équipe", "équipes")
  if (!membres.data) return undefined
  const gens = pluriel(membres.data.length, "personne", "personnes")
  return invitations.data && invitations.data.length > 0 ? `${gens} · ${pluriel(invitations.data.length, "invitation", "invitations")}` : gens
}

/**
 * L'action de l'en-tête suit l'onglet : on invite depuis les personnes, on crée une équipe depuis les équipes ; une
 * capacité atteinte grise le geste et le dit (E12-S02), avec le lien de l'hôte pour un administrateur.
 */
function action({ onglet, moi, nomOrganisation, optionsDInvitation, limites }: EcranEquipesProps) {
  const lien = moi.estAdmin ? (limites?.raiseUrl ?? null) : null
  if (onglet === "members" && optionsDInvitation.data) {
    if (limites?.members && limitReached(limites.members)) return <LimiteAtteinte libelle="Inviter quelqu'un" nom="members_max" etat={limites.members} lien={lien} />
    const options = optionsDInvitation.data
    return <BoutonDInvitation equipes={options.teams.map((equipe) => ({ id: equipe.id, nom: equipe.name }))} rolesPermis={options.roles} equipeObligatoire={options.teamRequired} />
  }
  if (onglet === "teams" && moi.estAdmin) {
    if (limites?.teams && limitReached(limites.teams)) return <LimiteAtteinte libelle="Créer une équipe" nom="teams_max" etat={limites.teams} lien={lien} />
    return <CreationDEquipe nomOrganisation={nomOrganisation} />
  }
  return undefined
}

function Contenu(props: EcranEquipesProps & { reglages: ReglagesDesListes }) {
  const { onglet, moi, nomOrganisation, Lien, reglages } = props
  const adresseAvec = (autres: Partial<ReglagesDesListes>) => props.hrefDOnglet(onglet, autres)
  const navigation: Navigation = { Lien, ici: props.hrefDOnglet(onglet, reglages) }
  if (onglet === "teams") {
    return <OngletEquipes nomOrganisation={nomOrganisation} moi={moi} equipes={props.equipes} membres={props.membres} reglages={reglages} navigation={navigation} adresseAvec={adresseAvec} prefixeDesPages={props.prefixeDesPages} />
  }
  return (
    <OngletMembres
      nomOrganisation={nomOrganisation}
      moi={moi}
      membres={props.membres}
      invitations={props.invitations}
      optionsDInvitation={props.optionsDInvitation}
      equipes={props.equipes}
      reglages={reglages}
      navigation={navigation}
      adresseAvec={adresseAvec}
      entreeSansInvitation={moi.estAdmin ? props.entreeSansInvitation : undefined}
    />
  )
}

export function EcranEquipes(props: EcranEquipesProps) {
  const reglages = props.reglages ?? PAR_DEFAUT
  const badges: Partial<Record<EquipesTab, ReturnType<typeof compte>>> = { members: compte(props.membres), teams: compte(props.equipes) }
  const onglets = ONGLETS.map((onglet) => ({ ...onglet, href: props.hrefDOnglet(onglet.cle), badge: badges[onglet.cle] }))
  return (
    <>
      <ScreenHeader title={ECRAN} icon={<Icon as={Users} size="sm" />} meta={meta(props)} actions={action(props)} />
      {/* Les menus « ⋯ » des lignes s'ancrent dans l'îlot : il ne découpe pas son contenu. */}
      <Island aria-label={ECRAN} overflow="visible">
        <Onglets label="Onglets de l'écran" titre={ECRAN} onglets={onglets} courant={props.onglet}>
          <Contenu {...props} reglages={reglages} />
        </Onglets>
      </Island>
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC2). */
export function EcranEquipesChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="oto-sr-only">Chargement des équipes et des accès…</span>
      <Skeleton shape="text" width="30%" />
      <Skeleton shape="card" />
      {["un", "deux", "trois", "quatre", "cinq"].map((rang) => (
        <Skeleton key={rang} shape="row" />
      ))}
    </div>
  )
}
