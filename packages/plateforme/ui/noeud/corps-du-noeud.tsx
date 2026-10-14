// Le corps d'un nœud (E05-S02, AC3, AC4, AC7 à AC9, AC17 ; E05-S09, partie c1) : l'avis de la version
// publiée, le document dans son îlot (ses blocs lus, ou l'éditeur au niveau écriture), et le complément de
// l'hôte ; les sous-pages sont dans l'encart « Sous-pages », hors du document (E11-S05, AC-e1). Un tableau n'a pas d'éditeur : son brouillon (titre et résumé en
// attente, en-tête écrit en place) a sa publication, sa grille vit dans le complément (E07-S03,
// HN-E05S02-27) ; ni bandeau ni lien « Voir la version publiée » depuis E11-S02 (AC-c3). Server Component.
// Sans lui, l'écran n'aurait que son en-tête.
//
// Porté d'oto-frontend (`routes/n.$nodeId.lazy.tsx`, `NoeudCharge`, et `components/noeud/corps-du-noeud.tsx`,
// `CorpsDuNoeud`) : le document dans un îlot nommé par le titre, le corps de lecture (`Reader`), les blocs
// dans l'ordre, la clé de chaque bloc son `id`. Retiré : le
// corps d'une page héritée (`CorpsHerite`), la méta d'un tableau par sa première page de lignes.
//
// E05-S11 : une page citée se lit par son titre (AC-26, AC-27), d'abord par l'arbre visible (`cibles`), puis par
// les liens sortants lus (`liens`, que seul le titre d'un lien attend, M64) ; l'indication
// d'enregistrement d'un tableau se pose en haut à droite de son brouillon (AC-1).
// E11-S05 (AC-g2) : une page vide dont le titre est écrit s'ouvre le focus dans son Texte vide.
import type { ReactNode } from "react"
import type { BlockView, NodeView } from "../../schemas"
import { listItemTexts, tableCells } from "../../schemas/blocks"
import { fencedParts } from "../../schemas/link-syntax"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { CREATION } from "../coque/libelles"
import { EmptyState } from "../ds/react/empty-state"
import { Island } from "../ds/react/island"
import { Alert } from "../ds/react/primitives"
import { Reader } from "../ds/react/reader"
import { EditeurDeBlocs } from "./editeur/editeur-de-blocs"
import { IndicationDEnregistrement } from "./editeur/lignes-d-etat"
import { cheminsCitesDans, type CiblesDesLiens } from "./en-ligne"
import { ECRAN, genreDuNoeud, PAGE_VIDE } from "./libelles"
import { Publication } from "./publication"
import { BlocsRepliables } from "./blocs-repliables"
import { RenduDUnBloc } from "./rendu-des-blocs"

/** Le niveau d'écriture de l'écran (AC9) : celui d'un rédacteur hors de la version publiée, sinon aucun. */
export function niveauDEcritureDe(vue: NodeView, versionPubliee: boolean): 2 | 3 | null {
  return vue.level === 1 || versionPubliee ? null : vue.level
}

/**
 * Les blocs que l'écran montre (AC9) : le brouillon quand l'écran écrit (`niveauDEcritureDe`), sinon
 * les blocs publiés. La page de l'hôte en résout les références (E07-S03).
 */
export function blocsAffiches(vue: NodeView, versionPubliee: boolean): BlockView[] {
  return niveauDEcritureDe(vue, versionPubliee) !== null && vue.draft ? vue.draft.blocks : vue.blocks
}

/**
 * Les textes d'un bloc qui peuvent citer une page : son texte, et chaque élément d'une liste, sous-éléments
 * compris, ou d'une liste à cocher ; les cellules d'un tableau simple, le résumé d'un repli et son corps hors de
 * ses clôtures de code (E10-S04, AC-a4), comme la publication les lit (`server/nodes/links.ts`).
 */
function textesDe(bloc: BlockView): string[] {
  if (bloc.type === "simple_table") return tableCells(bloc.data)
  if (bloc.type === "toggle") {
    const resume = typeof bloc.data.summary === "string" ? [bloc.data.summary] : []
    return [...resume, ...fencedParts(bloc.text ?? "").flatMap((partie) => (partie.code ? [] : [partie.text]))]
  }
  return [bloc.text ?? "", ...listItemTexts(bloc.data.items)]
}

/** Les chemins que citent des blocs (E05-S11, AC-27) : l'écran n'en lit les cibles que pour eux. */
export function cheminsCites(blocs: readonly BlockView[]): string[] {
  return blocs.flatMap((bloc) => textesDe(bloc).flatMap(cheminsCitesDans))
}

export type CorpsDuNoeudProps = {
  vue: NodeView
  niveauDEcriture: 2 | 3 | null
  /** Le titre montré : il nomme l'îlot du document. */
  titre: string
  versionPubliee: boolean
  Lien: LienDeLHote
  hrefDuChemin: (chemin: string) => string
  prefixeDesPages: string
  referencesRendues?: Readonly<Record<string, ReactNode>>
  complement?: ReactNode
  /** Les cibles des pages que citent les blocs montrés, lues dans l'arbre visible (AC-26, AC-27). */
  cibles?: CiblesDesLiens
  /** Les champs de `read` sur le nœud (ses liens sortants), lus par l'hôte après la page. */
  liens?: Promise<Resultat<Record<string, unknown>>>
}

type LectureProps = Pick<CorpsDuNoeudProps, "Lien" | "hrefDuChemin" | "referencesRendues" | "cibles" | "liens"> & { blocs: BlockView[] }

/**
 * Le document lu (AC4) : ses blocs dans l'ordre ; vide, il le dit (AC7). Rendu une fois : seul le titre d'une page
 * citée attend les liens sortants, les titres de l'arbre d'abord (M64).
 */
function Lecture({ blocs, Lien, hrefDuChemin, referencesRendues, cibles, liens }: LectureProps) {
  return (
    <Reader>
      {blocs.length === 0 ? (
        <EmptyState title={PAGE_VIDE} />
      ) : (
        <BlocsRepliables
          blocs={blocs}
          rendre={(bloc) => <RenduDUnBloc bloc={bloc} Lien={Lien} hrefDuChemin={hrefDuChemin} cibles={cibles} lecture={liens} rendu={referencesRendues?.[bloc.id]} />}
        />
      )}
    </Reader>
  )
}

/**
 * Le brouillon d'un tableau (AC9, AC17) : sa publication seule, dès le niveau écriture (E11-S02, AC-a2) : son
 * en-tête écrit en place se publie comme le texte d'une page (E05-S10, AC-a10) ; la grille est dans le complément.
 */
function BrouillonDuTableau() {
  return (
    <div className="relative flex flex-col gap-2">
      <IndicationDEnregistrement />
      <Publication />
    </div>
  )
}

export function CorpsDuNoeud(props: CorpsDuNoeudProps) {
  const { vue, niveauDEcriture, titre, versionPubliee, Lien, hrefDuChemin } = props
  const blocs = blocsAffiches(vue, versionPubliee)
  return (
    <>
      {versionPubliee && vue.level > 1 && (
        <Alert
          tone="idle"
          title={ECRAN.versionPubliee(vue.revision)}
          actions={
            <Lien href={hrefDuChemin(vue.path)} className={LIEN}>
              {ECRAN.revenirAuxModifications}
            </Lien>
          }
        />
      )}
      {vue.kind === "table" ? (
        niveauDEcriture !== null && <BrouillonDuTableau />
      ) : (
        <Island aria-label={titre}>
          {niveauDEcriture === null ? (
            <Lecture blocs={blocs} Lien={Lien} hrefDuChemin={hrefDuChemin} referencesRendues={props.referencesRendues} cibles={props.cibles} liens={props.liens} />
          ) : (
            <EditeurDeBlocs
              key={vue.id}
              blocs={blocs}
              revisionServie={vue.revision}
              prefixeDesPages={props.prefixeDesPages}
              referencesRendues={props.referencesRendues}
              cibles={props.cibles}
              liens={props.liens}
              // Le genre du brouillon s'il en change (E05-S04 : la publication d'un Contexte).
              genre={genreDuNoeud(vue)}
              // Un nœud neuf garde le focus à son titre (E05-S10, AC-b3) ; une page vide déjà titrée le donne au Texte.
              focusALOuverture={blocs.length === 0 && titre !== CREATION.sansTitre}
            />
          )}
        </Island>
      )}
      {props.complement}
    </>
  )
}
