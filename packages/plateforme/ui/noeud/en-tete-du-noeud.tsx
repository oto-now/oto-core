// L'en-tête d'un nœud (E05-S02, AC2, AC8, AC19, AC20 ; E05-S09, partie c1 ; E05-S10, partie b ; refonte #217, #218) :
// l'en-tête d'écran du design system, à plat : à gauche le fil qui finit par le titre (D2), à droite Commentaires,
// Liens, Historique des versions, « Partager » et « ⋯ » (`ActionsDuNoeud`) ; puis le grand titre en `<h1>`, une seule
// fois, sans glyphe ; sous lui, la méta à gauche, « Procédure · Modifiée il y a … par … · Ventes » (la nature en tête
// sauf pour une page), et son infobulle ; puis le chapô de la plateforme (le résumé d'une procédure). Au niveau
// écriture, le titre et le résumé s'écrivent en place (AC-a1). Server Component : la navigation vient de l'hôte, les
// îlots reçoivent des données et du `ReactNode` déjà rendu.
//
// Porté d'oto-frontend (l'en-tête de `routes/n.$nodeId.lazy.tsx`, `components/noeud/meta-modifiee.tsx`,
// `acces-du-noeud.tsx`) : `ScreenHeader` et ses créneaux, « Modifiée … par … » calculé au rendu (une moitié inconnue
// se tait), le détail du partage dans un popover. Changé : le panneau est celui du partage d'un nœud (E05-S10, AC-b5) ;
// le type, l'état, la révision et le propriétaire passent dans une infobulle (AC-a7) ; le champ du titre est celui de la
// plateforme (`TitreModifiable`). Retiré : la pile d'avatars ; « Déplacer » (AC-b4), que le rail porte (E05-S13, AC-20) ;
// le glyphe du titre, « Télécharger », « Importer », « Réglages » et « Page ⇄ Procédure » en boutons visibles, passés
// dans « ⋯ » (refonte #218).
import type { ReactNode } from "react"
import { tableHeaderSchema, type NodeView, type TreeNode } from "../../schemas"
import { NoeudOuvert } from "../coque/noeud-ouvert"
import { AccessPanel } from "../ds/react/access-panel"
import { ScreenHeader } from "../ds/react/screen-header"
import { Tooltip } from "../ds/react/tooltip"
import { proprietaire } from "../equipes/libelles"
import { ilYA } from "../format/dates"
import { ActionsDuNoeud, type GenreModifiable, type TableauModifiable } from "./actions-du-noeud"
import { ResumeModifiable, TitreModifiable } from "./en-tete-modifiable"
import { filDuChemin, sectionDuChemin } from "./fil"
import { FilDuNoeud } from "./fil-du-noeud"
import { detailsDuNoeud, ECRAN, genreDuNoeud, INFOBULLE, metaDuNoeud, modifieeDuNoeud, resumeMontre } from "./libelles"

type Equipes = readonly { slug: string; name: string }[]

type EnTeteDuNoeudProps = {
  vue: NodeView
  /** Le titre montré : celui du brouillon en attente pour un rédacteur, sinon celui publié. */
  titre: string
  /** `null` : la lecture a échoué (la page le dit) ; le fil n'en devine ni titre ni frère. */
  arbre: readonly TreeNode[] | null
  /** `null` : la lecture des équipes a échoué ; le fil ne nomme alors aucune section d'équipe. */
  equipes: Equipes | null
  /** Le `handle` de la personne : son espace personnel n'est pas un maillon du fil. */
  handle: string | null
  prefixeDesPages: string
  /** Monté sous la file d'écriture seulement (niveau écriture, hors de la version publiée) : le titre s'écrit en place (AC-a1). */
  modifiable: boolean
  /** Le panneau « Partager » (AC-b5) ; absent, l'en-tête n'a pas d'accès. */
  partage?: ReactNode
  /** Le bouton « Liens » et son popover (D1), rendus par l'écran. */
  liens?: ReactNode
}

/**
 * La ligne sous le titre (AC-a7, brief § 5.6) : la nature (sauf d'une page), « Modifiée <quand> par <qui> », puis
 * l'espace, focalisable ; son survol et son focus ouvrent l'infobulle du type, de l'état, de la révision et du
 * propriétaire.
 */
function MetaDuNoeud({ vue, espace }: { vue: NodeView; espace: string | null }) {
  const modifiee = modifieeDuNoeud(vue, { quand: ilYA(vue.updatedAt), qui: vue.updatedByName })
  const faits = [...detailsDuNoeud(vue), { intitule: INFOBULLE.proprietaire, valeur: proprietaire(vue.owner) }]
  const infobulle = (
    <dl className="oto-node-facts">
      {faits.map((fait) => (
        <div key={fait.intitule}>
          <dt>{fait.intitule}</dt>
          <dd>{fait.valeur}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <Tooltip content={infobulle} side="bottom">
      {/* Une ligne de texte qui prend le focus pour ouvrir son infobulle au clavier : rien à activer, pas un bouton. */}
      <span tabIndex={0} className="oto-node-modified">
        {metaDuNoeud(vue, modifiee, espace)}
      </span>
    </Tooltip>
  )
}

/** Un ancêtre du chemin, dans l'arbre visible, est une procédure : ses sous-étapes restent des pages (1.4.11). */
function sousUneProcedure(arbre: readonly TreeNode[], chemin: string): boolean {
  return arbre.some((noeud) => (noeud.kind === "procedure" && chemin.startsWith(`${noeud.path}/`)) || sousUneProcedure(noeud.children, chemin))
}

/**
 * « Transformer en procédure » ou « en page », pour qui écrit une page ou une procédure (`modifiable`, sous la file
 * d'écriture) ; un arbre en échec ne bloque rien, le service tranche.
 */
function genreModifiable(vue: NodeView, titre: string, arbre: readonly TreeNode[] | null, modifiable: boolean): GenreModifiable | null {
  const genre = genreDuNoeud(vue)
  if (!modifiable || (genre !== "page" && genre !== "procedure")) return null
  const blocs = (vue.draft?.blocks ?? vue.blocks).map((bloc) => ({ id: bloc.id, ref: bloc.ref }))
  return { genre, titre, sousUneProcedure: sousUneProcedure(arbre ?? [], vue.path), blocs }
}

/** « Importer un fichier… » et « Réglages du tableau… », pour qui écrit un tableau à l'en-tête lisible (E11-S15, AC-a7 ; E11-S01, AC-g1). */
function tableauModifiable(vue: NodeView, ecrit: boolean): TableauModifiable | null {
  if (vue.kind !== "table" || !ecrit) return null
  const entete = tableHeaderSchema.safeParse(vue.meta)
  return entete.success ? { chemin: vue.path, titre: vue.title, entete: entete.data, enAttente: (vue.draft?.meta ?? null) !== null } : null
}

export function EnTeteDuNoeud({ vue, titre, arbre, equipes, handle, prefixeDesPages, modifiable, partage, liens }: EnTeteDuNoeudProps) {
  const section = sectionDuChemin(vue.path, equipes, handle)
  // Un nœud jamais publié n'a rien à télécharger ni d'historique (HN-E11S05-9).
  const telechargement = vue.status !== "published" ? null : vue.kind === "table" ? "csv" : "md"
  // « Partager » seul, la seule action pleine de l'écran ; l'espace est passé dans la méta.
  const accesDuPartage = partage && <AccessPanel className="oto-node-share" scope={ECRAN.partagerSeul} panel={partage} panelLabel={ECRAN.panneauDePartage(titre)} />
  return (
    <>
      {/* Le chemin actuel, que le rail reconnaît sous un ancien chemin resté dans l'adresse (AC-b12). */}
      <NoeudOuvert chemin={vue.path} />
      <ScreenHeader
        className="oto-node-header"
        breadcrumb={<FilDuNoeud maillons={filDuChemin({ chemin: vue.path, titre, arbre, equipes, handle, prefixe: prefixeDesPages })} />}
        title={modifiable ? <TitreModifiable titre={titre} revisionServie={vue.revision} tamponServi={vue.draft?.draftStamp ?? null} /> : titre}
        meta={<MetaDuNoeud vue={vue} espace={section.titre} />}
        access={
          <ActionsDuNoeud
            chemin={vue.path}
            telechargement={telechargement}
            genre={genreModifiable(vue, titre, arbre, modifiable)}
            tableau={tableauModifiable(vue, modifiable)}
            liens={liens}
            partage={accesDuPartage}
          />
        }
      />
    </>
  )
}

type ChapoDuNoeudProps = {
  vue: NodeView
  resume: string
  /** Monté sous la file d'écriture seulement (niveau écriture, hors de la version publiée). */
  modifiable: boolean
}

/**
 * Ce que la plateforme dit d'un nœud sous son en-tête, et qu'oto-frontend n'avait pas : le résumé (lu par
 * le routage avec le titre), écrit en place au niveau écriture (AC-a1) ; celui d'une procédure seule (E11-S05,
 * AC-f1), rien pour les autres genres.
 */
export function ChapoDuNoeud({ vue, resume, modifiable }: ChapoDuNoeudProps) {
  if (!resumeMontre(genreDuNoeud(vue))) return null
  if (!modifiable) return <p className="oto-body">{resume}</p>
  // Une procédure a l'aide d'une page (M59, fiche D104).
  return <ResumeModifiable resume={resume} revisionServie={vue.revision} tamponServi={vue.draft?.draftStamp ?? null} />
}
