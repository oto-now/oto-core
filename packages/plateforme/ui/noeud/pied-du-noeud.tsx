// Le pied d'un contenu (refonte #217, maquette validée) : sous un filet, trois colonnes sans repli, « Sous-pages · N »,
// « Cité dans N contenus » et « Cite N contenus » (décision de JB du 27/11) ; chaque ligne est un lien précédé du glyphe de son genre (celui du rail), son nom
// sur une ligne coupé par « … » et entier au survol ; cinq lignes, puis « Voir les N autres ». Une colonne vide n'est
// pas rendue, un pied sans colonne n'a pas de filet. Un Contexte pose avant elles « Ce que reçoit votre assistant »
// (`avant`). Les colonnes s'empilent sur un téléphone. Server Component : « Sous-pages » est connu avec le nœud, les
// liens arrivent sous leur `<Suspense>`. Il remplace les encarts de la colonne de droite (`ContenusLies`, E11-S05, AC-e1).
import { Suspense, use, type ReactNode } from "react"
import type { NodeView, TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import type { NatureDeNoeud } from "../arbre/types"
import { LIEN } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { GlypheDeNature } from "./glyphes"
import { ENCARTS, PIED } from "./libelles"
import { liensDeLaLecture, naturesParChemin, type LiensDuNoeud, type NomsDesContextes } from "./sous-pages"
import { VoirLaSuite } from "./voir-la-suite"

/** Une ligne du pied ou du popover des liens : `href` nul, un contenu cité sans cible, lu en texte. */
export type LigneLiee = { chemin: string; nom: string; nature: NatureDeNoeud; href: string | null; note?: string }

type Navigation = { Lien: LienDeLHote; hrefDuChemin: (chemin: string) => string }

/** Les lignes de « Cité dans » et de « Cite » : un contenu rangé ailleurs mène à sa nouvelle place, un Contexte sous son nom montré. */
export function lignesDesLiens(liens: LiensDuNoeud, natures: ReadonlyMap<string, NatureDeNoeud>, contextes: NomsDesContextes, hrefDuChemin: (chemin: string) => string) {
  const citeDans: LigneLiee[] = liens.citant.map((source) => ({
    chemin: source.chemin,
    nom: contextes.get(source.chemin) ?? source.titre,
    nature: natures.get(source.chemin) ?? "page",
    href: hrefDuChemin(source.chemin),
  }))
  const cite: LigneLiee[] = liens.cites.map((lien) => {
    if (lien.etat === "missing") return { chemin: lien.chemin, nom: lien.chemin, nature: "page", href: null, note: ENCARTS.sansCible }
    const ici = lien.etat === "moved" && lien.vers ? lien.vers : lien.chemin
    return { chemin: lien.chemin, nom: contextes.get(ici) ?? lien.titre ?? lien.chemin, nature: natures.get(ici) ?? "page", href: hrefDuChemin(ici), note: ici !== lien.chemin ? ENCARTS.deplace(ici) : undefined }
  })
  return { citeDans, cite }
}

/** Le nom d'une ligne : sur une ligne, coupé par « … », entier au survol et pour un lecteur d'écran. */
function NomDeLaLigne({ ligne, Lien }: { ligne: LigneLiee; Lien: LienDeLHote }) {
  const nom = (
    <span className="oto-node-foot-name" title={ligne.nom}>
      {ligne.nom}
    </span>
  )
  return ligne.href === null ? (
    nom
  ) : (
    <Lien href={ligne.href} className={LIEN}>
      {nom}
    </Lien>
  )
}

function Ligne({ ligne, Lien, suite }: { ligne: LigneLiee; Lien: LienDeLHote; suite?: boolean }) {
  return (
    <li className="oto-node-foot-item" data-suite={suite ? "" : undefined}>
      <GlypheDeNature nature={ligne.nature} />
      <NomDeLaLigne ligne={ligne} Lien={Lien} />
      {ligne.note && <span className="oto-caption">{ligne.note}</span>}
    </li>
  )
}

/** `intitule` : l'intitulé entier (« Cité dans 3 contenus ») ; absent, `titre` suivi de « · N » (« Sous-pages · 3 »). */
type ColonneProps = { titre: string; intitule?: string; total: number; lignes: readonly LigneLiee[]; Lien: LienDeLHote }

/** Une colonne : son intitulé et son total, cinq lignes, la suite à la demande, puis ce que le service n'a pas servi. */
function Colonne({ titre, intitule, total, lignes, Lien }: ColonneProps) {
  if (total === 0) return null
  const premieres = lignes.slice(0, PIED.montres).map((ligne) => <Ligne key={ligne.chemin} ligne={ligne} Lien={Lien} />)
  const suite = lignes.slice(PIED.montres).map((ligne) => <Ligne key={ligne.chemin} ligne={ligne} Lien={Lien} suite />)
  return (
    <section className="oto-node-foot-column" aria-label={titre}>
      <h2 className="oto-group-title">
        {intitule ?? (
          <>
            {titre}
            <span className="oto-node-foot-count"> · {total}</span>
          </>
        )}
      </h2>
      {suite.length > 0 ? (
        <VoirLaSuite nom={titre} premieres={premieres} suite={suite} libelle={PIED.voirLesAutres(suite.length)} />
      ) : (
        <ul className="oto-node-foot-list" aria-label={titre}>
          {premieres}
        </ul>
      )}
      {total > lignes.length && <p className="oto-caption">{ENCARTS.autres(total - lignes.length)}</p>}
    </section>
  )
}

type LiensDuPiedProps = Navigation & { lecture: Promise<Resultat<Record<string, unknown>>>; natures: ReadonlyMap<string, NatureDeNoeud>; contextes: NomsDesContextes; ici: string }

/** « Cité dans » puis « Cite », lus après la page ; leur lecture en échec se dit à leur place, avec « Réessayer ». */
function LiensDuPied({ lecture, natures, contextes, Lien, hrefDuChemin, ici }: LiensDuPiedProps) {
  const lu = use(lecture)
  if (lu.error !== undefined) {
    return (
      <div className="oto-node-foot-wide">
        <ErreurDeLecture message={lu.error} href={ici} Lien={Lien} />
      </div>
    )
  }
  const liens = liensDeLaLecture(lu.data)
  const { citeDans, cite } = lignesDesLiens(liens, natures, contextes, hrefDuChemin)
  return (
    <>
      <Colonne titre={ENCARTS.citeDans} intitule={PIED.citeDansN(liens.totalCitant)} total={liens.totalCitant} lignes={citeDans} Lien={Lien} />
      <Colonne titre={ENCARTS.cite} intitule={PIED.citeN(liens.totalCites)} total={liens.totalCites} lignes={cite} Lien={Lien} />
    </>
  )
}

export type PiedDuNoeudProps = Navigation & {
  vue: Pick<NodeView, "children" | "childrenTotal">
  /** L'arbre visible : le genre d'un contenu cité ; `null` si sa lecture a échoué (le glyphe d'une page). */
  arbre: readonly TreeNode[] | null
  /** Les champs de `read` sur le nœud (ses liens), lus par l'hôte après la page ; absents, ni « Cité dans » ni « Cite ». */
  liens?: Promise<Resultat<Record<string, unknown>>>
  contextes: NomsDesContextes
  ici: string
  /** Une section posée avant les colonnes, sur toute la largeur : « Ce que reçoit votre assistant » d'un Contexte. */
  avant?: ReactNode
}

export function PiedDuNoeud({ vue, arbre, liens, contextes, ici, avant, Lien, hrefDuChemin }: PiedDuNoeudProps) {
  const sousPages: LigneLiee[] = vue.children.map((enfant) => ({ chemin: enfant.path, nom: contextes.get(enfant.path) ?? enfant.title, nature: natureDuGenre(enfant.kind), href: hrefDuChemin(enfant.path) }))
  return (
    // Sans colonne ni section, le pied part avec son filet (`:empty` ne compte pas les marques du flux).
    <footer className="oto-node-foot">
      {avant && <div className="oto-node-foot-wide">{avant}</div>}
      <Colonne titre={ENCARTS.sousPages} total={vue.childrenTotal} lignes={sousPages} Lien={Lien} />
      {liens && (
        <Suspense
          fallback={
            <p role="status" className="oto-caption">
              {ENCARTS.chargement}
            </p>
          }
        >
          <LiensDuPied lecture={liens} natures={naturesParChemin(arbre)} contextes={contextes} ici={ici} Lien={Lien} hrefDuChemin={hrefDuChemin} />
        </Suspense>
      )}
    </footer>
  )
}
