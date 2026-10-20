// Ce que le modèle recevra (E05-S04, AC12 ; P39 ; E05-S09, partie c1) : les blocs servis dans leur ordre (nom,
// taille, état), le Contexte ouvert marqué, puis le total du texte que `context` servirait à la personne, sur
// le budget. Calculé par `previewContext` sans phrase (E03-S08) : même moteur et même rendu que `context`,
// aucun `ctx` émis ni journal ; l'écran ne recompose rien. Server Component. Sans lui, personne ne sait ce
// que son assistant lit de ce Contexte.
//
// 2026-10-20 (décidé par JB) : `whole` porte le poids sans plafond que lit la jauge du budget (`JaugeDuBudget`), montée tout
// en bas de la colonne par l'hôte ; elle reprend les chiffres qu'E05-S13 avait retirés.
//
// E05-S11 (retour 4 de JB, AC-9 à AC-11) : « Voici ce que votre agent va lire », « Ordre de lecture », le
// total en dernière ligne ; le texte servi replié part (il se lit dans la vue « Contexte » de l'accueil), et
// chaque ligne y mène, ouverte sur la même partie (`/context#<ancre>`, E11-S10). E05-S13 (retour 7, AC-13) : plus
// aucun chiffre (taille, état, total), ni note des versions, ni légende visible. E11-S10 (AC-g1, AC-g2) : ni titre
// visible, le nom accessible gardé, ni « Règles Oto » (le bloc `code`).
//
// Porté d'oto-frontend (`contexte/annexes-du-contexte.tsx`, DS `context.jsx` `NotePanel`, `LayerStack`,
// `LayerLink`) : les couches empilées et leur poids, la couche regardée marquée (`data-here`,
// `aria-current`), chaque couche un lien. Changé : le poids se compte en caractères, la mesure du budget,
// chaque couche dit son état. Repris d'Oto (`capabilities/agent_context.py` l. 1-17, 44-52) : « exactement ce
// que son Claude reçoit », mesuré par couche, dans l'ordre d'injection ; retiré : la notice, la toolbox, les
// déroulés.
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { FOCUS } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { LayerLink, LayerStack } from "../ds/react/layer-stack"
import { NotePanel } from "../ds/react/note-panel"
import { APERCU_DU_CONTEXTE, nomDuBloc, type EquipesNommees } from "./libelles"
import { ancreDeLaPartie } from "./parties-du-contexte"

/**
 * Ce que `previewContext` rend et que l'aperçu lit (E03-S08, AC8). La forme servie (`ContextPreview`)
 * vit dans `server/`, que `ui/` n'importe pas ; tsc la confronte à celle-ci sur la page de l'hôte.
 */
export type DonneesDeLApercu = {
  text: string
  /**
   * `head` (E05-S12, AC-4) : les caractères de la tête d'une partie de Contexte (en-tête, faits, connecteurs),
   * 0 ailleurs ; facultatif comme au moteur (HN-E05S12-A1), lu `head ?? 0`.
   */
  blocks: readonly { name: string; chars: number; status: string; path: string | null; head?: number }[]
  budget: number
  /** Le poids sans plafond de chaque bloc et leur total (`WholeWeights`, 2026-10-20) : la jauge du budget ; absent d'un hôte qui ne le sert pas. */
  whole?: { total: number; blocks: readonly { name: string; chars: number }[] }
}

type ApercuDuContexteProps = {
  apercu: Resultat<DonneesDeLApercu>
  cheminCourant: string
  equipes: EquipesNommees
  /** L'adresse de la vue « Contexte » (`/context`) : chaque ligne y mène, à son ancre. */
  hrefDuContexteServi: string
  /** L'adresse de la page, pour « Réessayer ». */
  ici: string
  Lien: LienDeLHote
}

type CouchesProps = Pick<ApercuDuContexteProps, "cheminCourant" | "equipes" | "hrefDuContexteServi" | "Lien"> & { apercu: DonneesDeLApercu }

/**
 * Les couches servies, dans l'ordre, chacune un lien vers sa partie ; le Contexte ouvert marqué. Sans taille ni état
 * (E05-S13, AC-13) ; « Ordre de lecture » reste le nom accessible de la liste. Sans « Règles Oto » (E11-S10, AC-g2) :
 * chaque autre ligne garde l'ancre de son rang d'origine.
 */
function Couches({ apercu, cheminCourant, equipes, hrefDuContexteServi, Lien }: CouchesProps) {
  return (
    <LayerStack role="list" aria-label={APERCU_DU_CONTEXTE.legende}>
      {apercu.blocks.map((bloc, rang) => {
        if (bloc.name === "code") return null
        // Par le nom, le chemin du Contexte même quand il n'est pas servi (brouillon, vide : E05-S12, AC-8).
        const ici = bloc.name === cheminCourant
        const nom = `${nomDuBloc(bloc, equipes)}${ici ? ` ${APERCU_DU_CONTEXTE.ceContexte}` : ""}`
        // Un bloc servi n'a pas d'identité propre : son rang dans l'ordre servi, que rien ne réordonne.
        return (
          <div key={rang} role="listitem">
            <LayerLink as={Lien} href={`${hrefDuContexteServi}#${ancreDeLaPartie(bloc, rang)}`} className={FOCUS} name={nom} here={ici} />
          </div>
        )
      })}
    </LayerStack>
  )
}

export function ApercuDuContexte({ apercu, cheminCourant, equipes, hrefDuContexteServi, ici, Lien }: ApercuDuContexteProps) {
  if (apercu.error !== undefined) {
    return (
      <NotePanel aria-label={APERCU_DU_CONTEXTE.titre}>
        <ErreurDeLecture titre={APERCU_DU_CONTEXTE.echec} message={apercu.error} href={ici} Lien={Lien} />
      </NotePanel>
    )
  }
  return (
    <NotePanel aria-label={APERCU_DU_CONTEXTE.titre}>
      <Couches apercu={apercu.data} cheminCourant={cheminCourant} equipes={equipes} hrefDuContexteServi={hrefDuContexteServi} Lien={Lien} />
    </NotePanel>
  )
}
