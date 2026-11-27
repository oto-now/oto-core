// Les annexes d'un Contexte (E05-S04, AC10, AC12 ; P39, HN-E05S04-6, HN-E05S04-7 ; E05-S09, partie c1 ; refonte #217) :
// deux places sur l'écran du nœud. Sous la méta (`place="tete"`, l'emplacement `annexes`) : la phrase de portée
// (`aQuoiSert`), qui dit qui le reçoit, en corps et en encre, toujours visible ; pour « Mes instructions », dessous,
// l'explication, la phrase de reprise et « Copier » (`ValeurCopiable`), sans intertitre. Au pied (`place="pied"`,
// l'emplacement `piedDeColonne`) : la section « Ce que reçoit votre assistant », la jauge du budget puis l'ordre de
// lecture (`ApercuDuContexte`). La portée se lit dans le chemin du Contexte, que la base garde figé (`is_context_path`,
// P39). Server Component, passé par l'hôte. Sans lui, rien ne dit qui reçoit un Contexte ni ce que le modèle en recevra.
//
// Porté d'oto-frontend (`routes/context.$sectionId.lazy.tsx`, `contexte/annexes-du-contexte.tsx`, DS `context.jsx`) :
// la phrase de cloisonnement par grain, jamais le nom d'un collègue ; ce qui est servi, dans l'ordre. Retiré : le
// périmètre lu dans la coquille, la ligne « Comment », l'aide servie ; depuis la refonte, le repli « À quoi sert cette
// page » et sa seconde phrase (« Vous l'écrivez comme n'importe quelle page. »), le titre « Reprendre vos préférences »
// et celui de l'aperçu (« Voici ce que votre agent va lire »).
import type { Resultat } from "../api/resultat"
import { PERSO } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ValeurCopiable } from "../connexion/valeur-copiable"
import { ApercuDuContexte, type DonneesDeLApercu } from "./apercu-du-contexte"
import { JaugeDuBudget } from "./jauge-du-budget"
import { aQuoiSert, PIED_DU_CONTEXTE, porteeDe, REPRISE_DES_PREFERENCES, type EquipesNommees, type Portee } from "./libelles"

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
  /** `tete` (par défaut) : sous la méta ; `pied` : la section « Ce que reçoit votre assistant » du pied. */
  place?: "tete" | "pied"
}

/** La portée du Contexte ouvert : son Contexte Perso est servi à la personne, celui d'une autre, à elle seule. */
function porteeOuverte(chemin: string, equipes: EquipesNommees, handle: string | null): Portee {
  const portee = porteeDe(chemin, equipes)
  return portee.genre === "private" && chemin !== `${PERSO}/${handle}/contexte` ? { genre: "private-d-autrui" } : portee
}

/** La section du pied : la jauge (rien sans le poids entier), puis l'ordre de lecture ou son échec, dit avec « Réessayer ». */
function CeQueRecoitLAssistant({ apercu, ...props }: Omit<AnnexesDuContexteProps, "handle" | "place">) {
  return (
    <section className="oto-context-foot" aria-label={PIED_DU_CONTEXTE.titre}>
      <h2 className="oto-group-title">{PIED_DU_CONTEXTE.titre}</h2>
      {apercu.error === undefined && <JaugeDuBudget apercu={apercu.data} cheminCourant={props.cheminCourant} />}
      <ApercuDuContexte apercu={apercu} {...props} />
    </section>
  )
}

export function AnnexesDuContexte({ place = "tete", handle, ...props }: AnnexesDuContexteProps) {
  if (place === "pied") return <CeQueRecoitLAssistant {...props} />
  const portee = porteeOuverte(props.cheminCourant, props.equipes, handle)
  return (
    <>
      <p className="oto-body">{aQuoiSert(portee)}</p>
      {/* « Mes instructions » seulement : la phrase qui y range les préférences que l'assistant garde dans sa mémoire. */}
      {portee.genre === "private" && (
        <div className="oto-context-reprise">
          <p className="oto-caption">{REPRISE_DES_PREFERENCES.explication}</p>
          <ValeurCopiable valeur={REPRISE_DES_PREFERENCES.phrase} cible={REPRISE_DES_PREFERENCES.cible} />
        </div>
      )}
    </>
  )
}
