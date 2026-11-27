// Les annexes d'un Contexte (E05-S04, AC10, AC12 ; P39, HN-E05S04-6, HN-E05S04-7 ; E05-S09, partie c1) : la
// note « À quoi sert cette page » (ce que c'est, qui le reçoit, la recharge des conversations, le
// cloisonnement), puis l'encart de ce que l'agent va lire. La portée se lit dans le chemin du Contexte, que
// la base garde figé (`is_context_path`, P39). Server Component, passé par l'hôte dans l'emplacement
// `annexes` de l'écran de nœud, rendu dans la colonne de droite (`TwoColumns`). Sans lui, rien ne dit qui
// reçoit un Contexte ni ce que le modèle en recevra. E05-S11 (AC-8) : « Ma fiche » quitte la colonne, ses
// champs vont à la page Profil. E05-S13 (retour 9, AC-17 ; D128) : la note dit deux phrases dans un seul style, qui
// le reçoit par sa portée puis comment il s'écrit ; « Reçu par », la recharge et le cloisonnement en pied partent.
//
// Porté d'oto-frontend (`routes/context.$sectionId.lazy.tsx`, `contexte/annexes-du-contexte.tsx`, DS
// `context.jsx`) : le Contexte comme un nœud en deux colonnes, des notes et non des îlots (`NotePanel` : une
// explication ne se met pas au rang du texte), l'introduction du produit, les couples terme-définition
// (`NoteDefs`), la phrase de cloisonnement par grain en pied (entreprise, équipe, privé → Tout le monde,
// équipe, Perso), jamais le nom d'un collègue ; la seconde note, ce qui est servi, dont oto-frontend avait
// retiré la jauge. Retiré : le périmètre lu dans la coquille, la ligne « Comment » (« déposé dans les
// instructions du serveur MCP », architecture § 10), l'aide servie (`help`).
//
// E11-S05 (AC-e2) : « À quoi sert cette page » devient un repli fermé à l'arrivée, du même dessin que les encarts
// « Cité dans », « Cite » et « Sous-pages » (`LinkedContent`), nommé par son titre ; le texte ne change pas.
// « Mes instructions » (le Contexte privé de la personne) : une note ouverte porte la phrase de reprise, à copier dans
// l'assistant (`ValeurCopiable`).
import { Info } from "@phosphor-icons/react/dist/ssr/Info"
import type { Resultat } from "../api/resultat"
import { PERSO } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { AnimatedIcon } from "../ds/react/icon"
import { LinkedContent } from "../ds/react/linked-content"
import { NotePanel } from "../ds/react/note-panel"
import { ValeurCopiable } from "../connexion/valeur-copiable"
import { ApercuDuContexte, type DonneesDeLApercu } from "./apercu-du-contexte"
import { ANNEXES, aQuoiSert, porteeDe, REPRISE_DES_PREFERENCES, type EquipesNommees, type Portee } from "./libelles"

type AnnexesDuContexteProps = {
  /** Le chemin du Contexte ouvert : sa portée, et sa couche marquée dans l'aperçu. */
  cheminCourant: string
  /**
   * Le `handle` de la personne qui regarde (son profil) : son propre Contexte Perso lui est servi, celui d'une
   * autre personne ne l'est qu'à elle (HN-E05S04-22) ; `null` sans `handle`.
   */
  handle: string | null
  /** `previewContext` sans phrase (E03-S08). */
  apercu: Resultat<DonneesDeLApercu>
  /** Les équipes de l'organisation (`listTeams`) : le nom d'un Contexte d'équipe. */
  equipes: EquipesNommees
  /** L'adresse de la vue « Contexte » (`/context`, E11-S10), où mène chaque ligne de l'encart (AC-11). */
  hrefDuContexteServi: string
  /** L'adresse de la page, pour « Réessayer ». */
  ici: string
  Lien: LienDeLHote
}

/** La portée du Contexte ouvert : son Contexte Perso est servi à la personne, celui d'une autre, à elle seule. */
function porteeOuverte(chemin: string, equipes: EquipesNommees, handle: string | null): Portee {
  const portee = porteeDe(chemin, equipes)
  return portee.genre === "private" && chemin !== `${PERSO}/${handle}/contexte` ? { genre: "private-d-autrui" } : portee
}

export function AnnexesDuContexte({ cheminCourant, handle, apercu, equipes, hrefDuContexteServi, ici, Lien }: AnnexesDuContexteProps) {
  const portee = porteeOuverte(cheminCourant, equipes, handle)
  return (
    <>
      {/* Un `<details>` a le rôle `group` sans nom propre : il prend celui de son titre. */}
      <LinkedContent aria-label={ANNEXES.titre} title={ANNEXES.titre} icon={<AnimatedIcon as={Info} size="xs" />}>
        <p>{aQuoiSert(portee)}</p>
        <p>{ANNEXES.ecriture}</p>
      </LinkedContent>
      {/* « Mes instructions » seulement : la phrase qui y range les préférences que l'assistant garde dans sa mémoire. */}
      {portee.genre === "private" && (
        <NotePanel title={REPRISE_DES_PREFERENCES.titre}>
          <p>{REPRISE_DES_PREFERENCES.explication}</p>
          <ValeurCopiable valeur={REPRISE_DES_PREFERENCES.phrase} cible={REPRISE_DES_PREFERENCES.cible} />
        </NotePanel>
      )}
      <ApercuDuContexte apercu={apercu} cheminCourant={cheminCourant} equipes={equipes} hrefDuContexteServi={hrefDuContexteServi} ici={ici} Lien={Lien} />
    </>
  )
}
