// L'onglet « Équipes » (E05-S03, AC10 à AC14 ; porté sur oto-frontend par E05-S09 partie d1) : ce qu'aucune
// autre surface ne dit (les personnes qui ne sont dans aucune équipe), puis le tableau des équipes. Server
// Component : il trie les équipes selon l'adresse de l'hôte et ne passe à l'îlot que des données et des
// adresses. Porté d'oto-frontend (`teams-table.tsx`, `TeamsTable`, `personnesSansEquipe`) : un seul
// conteneur, cible du repli du focus ; « n personnes dans aucune équipe » au-dessus du tableau, rien à zéro ;
// le tri en `localeCompare` français. Changé : la création est l'action de l'en-tête de l'écran ; aucune équipe
// automatique à exclure du compte (architecture § 4). Retiré : TanStack Query.
import type { MemberView, ReglagesDesListes, TeamView } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { pluriel } from "./libelles"
import { TableauDesEquipes } from "./tableau-des-equipes"
import type { Moi, Navigation } from "./types"

/** Le conteneur de l'onglet, qui reçoit le focus quand une ligne part avec son déclencheur. */
export const ANCRE_DES_EQUIPES = "equipes-liste"

type OngletEquipesProps = {
  nomOrganisation: string
  moi: Moi
  equipes: Resultat<TeamView[]>
  membres: Resultat<MemberView[]>
  reglages: ReglagesDesListes
  navigation: Navigation
  /** L'adresse de l'onglet sous d'autres réglages ; un réglage absent y prend son défaut. */
  adresseAvec: (reglages: Partial<ReglagesDesListes>) => string
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`), en chaîne : une page qui bloque la suppression d'une équipe y mène. */
  prefixeDesPages: string
}

/** Le tri sur les équipes reçues : par nom, ou par nombre de personnes (puis par nom). */
function trierLesEquipes(equipes: TeamView[], cle: "team" | "people", sens: "asc" | "desc"): TeamView[] {
  const signe = sens === "asc" ? 1 : -1
  const parNom = (a: TeamView, b: TeamView) => a.name.localeCompare(b.name, "fr")
  return [...equipes].sort((a, b) => signe * (cle === "people" ? a.members.length - b.members.length || parNom(a, b) : parNom(a, b)))
}

/** « 1 personne dans aucune équipe », ou rien : une ligne qui annonce une absence prend la place de ce qu'on vient lire. */
function personnesSansEquipe(membres: MemberView[]): string | undefined {
  const seules = membres.filter((membre) => membre.teams.length === 0).length
  return seules === 0 ? undefined : pluriel(seules, "personne dans aucune équipe", "personnes dans aucune équipe")
}

export function OngletEquipes({ nomOrganisation, moi, equipes, membres, reglages, navigation, adresseAvec, prefixeDesPages }: OngletEquipesProps) {
  if (equipes.error !== undefined) return <ErreurDeLecture message={equipes.error} href={navigation.ici} Lien={navigation.Lien} />
  if (membres.error !== undefined) return <ErreurDeLecture message={membres.error} href={navigation.ici} Lien={navigation.Lien} />
  const cle = reglages.sort ?? "team"
  const seules = personnesSansEquipe(membres.data)
  const adresse = (tri: "team" | "people", sens: "asc" | "desc") => adresseAvec({ sort: tri === "team" ? undefined : tri, order: sens })
  return (
    <div id={ANCRE_DES_EQUIPES} tabIndex={-1} className="flex flex-col gap-3">
      {seules && <p className="oto-caption">{seules}</p>}
      <TableauDesEquipes
        equipes={trierLesEquipes(equipes.data, cle, reglages.order)}
        personnes={membres.data.map((membre) => ({ id: membre.userId, nom: membre.name, email: membre.email }))}
        moi={moi}
        nomOrganisation={nomOrganisation}
        tri={{ cle, sens: reglages.order }}
        adresses={{ team: { asc: adresse("team", "asc"), desc: adresse("team", "desc") }, people: { asc: adresse("people", "asc"), desc: adresse("people", "desc") } }}
        ancre={ANCRE_DES_EQUIPES}
        prefixeDesPages={prefixeDesPages}
      />
    </div>
  )
}
