// La vue « Contexte » de l'accueil (E05-S11, retours 4 et 6 de JB, AC-13 à AC-15 ; HN-E05S11-8) : toutes les
// parties du texte que `context` servirait à la personne, empilées dans l'ordre servi, chacune avec son nom et son
// ancre. Même moteur que l'encart d'un Contexte (`previewContext` sans phrase), découpé par son rapport
// (`partiesDuContexte`). Une partie venue d'un Contexte que la personne peut écrire (niveau 2 ou 3, décidé par le
// service à la lecture du nœud) s'y écrit en place, avec l'éditeur d'une page et sa file (publication seule dès
// le niveau écriture depuis E11-S02, qui fait relire la page) ; les autres se lisent. Server Component : l'éditeur et sa file sont les
// îlots client de l'écran de nœud, montés tels quels. Sans elle, personne ne lit d'un coup ce que son assistant
// reçoit, ni n'écrit ses Contextes depuis là.
//
// E05-S12 (lot C, D109, AC-6, AC-7, AC-11) : « Règles Oto » (le bloc `code`) repliée et jamais écrivable ; dans
// la partie d'un Contexte, la tête servie (faits, connecteurs) se lit toujours, l'éditeur dessous,
// même quand le Contexte n'est pas servi (brouillon, vide) ; la partie Privé renvoie à Profil sous sa tête.
//
// E05-S13 (retours 7 et 8, AC-13 à AC-15) : ni taille, ni état, ni note des versions, ni total ; chaque partie est une
// carte (`Island`) sous son titre, ses lignes dites en français (`ListesServies`), les listes d'index d'un Contexte
// écrivable dans la carte de son éditeur ; l'en-tête `## Context: …` d'une partie retiré (HN-E05S13-13).
//
// E11-S10 (lot f, HN-E11S10-14, -15, -22) : la vue quitte l'accueil pour son écran (`EcranDuContexte`) ; la tête
// servie d'une partie de Contexte (faits, connecteurs) n'est plus montrée, l'assistant la reçoit toujours ; ni lien
// vers Profil, ni « Règles Oto » (le bloc `code`, sauté, les autres parties gardant leur ancre) ; une partie sans
// corps le dit ; l'ancre de l'adresse est suivie au montage et à chaque changement (`VersLaPartie`). Le 2026-10-27, la
// section « Nouveautés » toujours présente part : les nouveautés sont servies dans les contenus récents.
import type { ReactNode } from "react"
import type { NodeView } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { Island, IslandBody } from "../ds/react/island"
import { blocsAffiches, niveauDEcritureDe } from "../noeud/corps-du-noeud"
import { EditeurDeBlocs } from "../noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../noeud/editeur/file-d-operations"
import type { DonneesDeLApercu } from "./apercu-du-contexte"
import { APERCU_DU_CONTEXTE, CONTEXTE_SERVI, nomDuBloc, type EquipesNommees } from "./libelles"
import { ListesServies } from "./listes-servies"
import {
  cheminDuContexte,
  estUnContexte,
  morceauxDeLaFin,
  morceauxDuBloc,
  morceauxDuContexte,
  partiesDuContexte,
  type PartieServie,
} from "./parties-du-contexte"
import { VersLaPartie } from "./vers-la-partie"

/** Ce que la page de l'hôte lit pour la vue « Contexte ». */
export type DonneesDuContexteServi = {
  /** `previewContext` sans phrase (E03-S08). */
  apercu: Resultat<DonneesDeLApercu>
  /** Les Contextes servis, lus par leur chemin (`loadNode`) : le niveau de la personne décide de l'éditeur. */
  contextes: Readonly<Record<string, Resultat<NodeView>>>
  /** Les équipes de la personne : le nom d'un Contexte d'équipe. */
  equipes: EquipesNommees
}

export type ContexteServiProps = {
  donnees: DonneesDuContexteServi
  Lien: LienDeLHote
  /** Le préfixe des pages de l'arbre (« /n/ ») : les liens de l'éditeur et des listes servies. */
  prefixeDesPages: string
  /** L'adresse de la vue, pour « Réessayer ». */
  ici: string
}

type CorpsProps = Omit<ContexteServiProps, "donnees"> & Pick<DonneesDuContexteServi, "contextes" | "equipes"> & { partie: PartieServie }

/** La carte d'une partie lue (AC-14) : sa carte, comme celle de l'éditeur d'un Contexte, sans éditeur. */
function Carte({ children }: { children: ReactNode }) {
  return (
    <Island as="div">
      <IslandBody>{children}</IslandBody>
    </Island>
  )
}

/**
 * L'éditeur d'un Contexte que la personne peut écrire, sous sa propre file d'écriture (`FileDOperations`), dans
 * la carte d'un document comme sur sa page (`CorpsDuNoeud`) : l'îlot (`.oto-island`, positionné) tient
 * l'indication d'enregistrement de l'éditeur, posée en absolu en haut à droite de la carte (E05-S11, AC-1). Sous
 * l'éditeur, dans la même carte, les listes que le texte servi porte en plus de ses blocs (M71 ; E05-S13, AC-15).
 */
function EditeurDuContexte({ vue, prefixeDesPages, children }: { vue: NodeView; children: ReactNode } & Pick<CorpsProps, "prefixeDesPages">) {
  return (
    <FileDOperations key={vue.id} chemin={vue.path} revisionPubliee={vue.revision} tampon={vue.draft?.draftStamp ?? null}>
      <Island as="div">
        <EditeurDeBlocs blocs={blocsAffiches(vue, false)} revisionServie={vue.revision} prefixeDesPages={prefixeDesPages} genre="context" />
        {children && <IslandBody>{children}</IslandBody>}
      </Island>
    </FileDOperations>
  )
}

/**
 * Le corps d'une partie de Contexte (AC-7), sans sa tête servie (E11-S10, AC-f1) : l'éditeur de son Contexte quand
 * la personne peut l'écrire, servi ou non, ses listes servies dans sa carte ; sinon la suite servie dans une carte
 * (corps tel que servi, listes et fin en français), ou, rien n'étant servi après la tête, la phrase qui le dit (AC-f2).
 */
function CorpsDuContexte({ partie, contextes, prefixeDesPages, ici, Lien }: CorpsProps) {
  const chemin = cheminDuContexte(partie)
  const lu = chemin === null ? undefined : contextes[chemin]
  const vue = lu?.data ?? null
  const niveau = vue ? niveauDEcritureDe(vue, false) : null
  const navigation = { ancre: partie.ancre, prefixeDesPages, Lien }
  // Sous l'éditeur, le corps servi n'est pas répété : l'éditeur le porte.
  const listes = morceauxDuContexte(partie.suite, { sansCorps: true })
  return (
    <>
      {vue && niveau !== null ? (
        <EditeurDuContexte vue={vue} prefixeDesPages={prefixeDesPages}>
          {listes.length > 0 && <ListesServies morceaux={listes} {...navigation} />}
        </EditeurDuContexte>
      ) : partie.suite !== "" ? (
        <Carte>
          <ListesServies morceaux={morceauxDuContexte(partie.suite)} {...navigation} />
        </Carte>
      ) : (
        <p className="oto-caption">{CONTEXTE_SERVI.vide}</p>
      )}
      {/* Un Contexte illisible à l'instant : son texte servi reste lu, l'échec se dit (portage-ecrans.md § 4). Un
          Contexte absent ou hors de portée (`not_found`) n'est pas un échec : la page ne le lit pas en erreur. */}
      {lu?.error !== undefined && <ErreurDeLecture message={lu.error} href={ici} Lien={Lien} />}
    </>
  )
}

/** Le corps d'une partie : omise, elle dit pourquoi ; un Contexte, sa tête puis son Contexte ; un autre bloc, sa carte. */
function CorpsDeLaPartie(props: CorpsProps) {
  const { partie, prefixeDesPages, Lien } = props
  if (partie.texte === "") return <p className="oto-caption">{CONTEXTE_SERVI.omise}</p>
  if (estUnContexte(partie.name)) return <CorpsDuContexte {...props} />
  return (
    <Carte>
      <ListesServies morceaux={morceauxDuBloc(partie.name, partie.texte)} ancre={partie.ancre} prefixeDesPages={prefixeDesPages} Lien={Lien} />
    </Carte>
  )
}

type PartieProps = Omit<CorpsProps, "partie"> & { partie: PartieServie; nom: string }

function Partie({ nom, ...corps }: PartieProps) {
  const { partie } = corps
  return (
    <section id={partie.ancre} aria-labelledby={`${partie.ancre}-titre`} className="flex flex-col gap-2">
      <h2 id={`${partie.ancre}-titre`} className="text-base font-semibold text-ink">
        {nom}
      </h2>
      <CorpsDeLaPartie {...corps} />
    </section>
  )
}

type PartiesProps = Omit<CorpsProps, "partie"> & { apercu: DonneesDeLApercu }

/**
 * Les parties, dans l'ordre servi, sans « Règles Oto » (le bloc `code`, AC-f4 : chacune garde l'ancre de son rang
 * d'origine) ; puis la fin du texte (l'avis qui nomme les blocs omis) s'il y en a une. Les nouveautés sont dans les
 * contenus récents depuis le 2026-10-27 : plus de section « Nouveautés » à part, ni de phrase quand rien n'en est servi.
 */
function Parties({ apercu, ...corps }: PartiesProps) {
  const { parties, reste } = partiesDuContexte(apercu)
  const montrees = parties.filter((partie) => partie.name !== "code")
  return (
    <>
      {montrees.map((partie) => (
        // Une partie n'a pas d'identité propre : son ancre, tirée de son rang dans l'ordre servi, que rien ne réordonne.
        <Partie key={partie.ancre} partie={partie} nom={nomDuBloc(partie, corps.equipes)} {...corps} />
      ))}
      {reste !== "" && (
        <section aria-label={CONTEXTE_SERVI.fin} className="flex flex-col gap-2">
          <ListesServies morceaux={morceauxDeLaFin(reste)} ancre="fin" equipes={corps.equipes} prefixeDesPages={corps.prefixeDesPages} Lien={corps.Lien} />
        </section>
      )}
    </>
  )
}

/** Le conteneur de la vue : le haut où mène une ancre sans partie (AC-f6). */
const HAUT_DE_LA_VUE = "haut-de-la-vue"

export function ContexteServi({ donnees, ...props }: ContexteServiProps) {
  const { apercu, contextes, equipes } = donnees
  if (apercu.error !== undefined) return <ErreurDeLecture titre={APERCU_DU_CONTEXTE.echec} message={apercu.error} href={props.ici} Lien={props.Lien} />
  return (
    <div id={HAUT_DE_LA_VUE} className="flex flex-col gap-5">
      <Parties apercu={apercu.data} equipes={equipes} contextes={contextes} {...props} />
      <VersLaPartie haut={HAUT_DE_LA_VUE} />
    </div>
  )
}
