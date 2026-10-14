// La page publique d'un lien de partage (E05-S10, AC-d2 à AC-d4 ; ADR-013 § 3, § 4) : ce que `readPublicNode`
// sert, lu hors session par la page de l'hôte (`/p/<jeton>`) et monté sous sa `CoquilleOto` au thème de
// l'organisation de l'adresse ; en lecture seule, sans éditeur ni rail : le titre, le résumé, les blocs publiés
// par le seul rendu des blocs du paquet (`RenduDUnBloc`), les lignes d'un tableau en grille (`TableServeur`,
// `Cellule`, sans tri ni filtre ni geste ; D103), les contenus dessous quand le lien les couvre. Un lien
// interne vers un contenu que le lien couvre mène à son adresse publique (le même jeton) ; tout autre lien
// interne se lit en texte, sans cible (AC-d4). Server Component, sans état : un ERP hôte le monte comme la page
// de l'hôte. Sans lui, un lien public n'aurait rien à montrer.
//
// Repris de l'écran de nœud (`ecran-de-noeud.tsx`, `corps-du-noeud.tsx`) : la colonne de lecture
// (`.oto-content-max[data-width="document"]`), l'en-tête d'écran, le document en îlot (`Reader`), la page
// vide dite. Retiré : l'en-tête d'actions, le fil de l'arbre, « Contenus liés », tout ce qui écrit.
//
// E11-S05 : le visiteur télécharge ce que la page a lu (lot d, HN-E11S05-10), le `.csv` des lignes chargées d'un
// tableau ou le `.md` d'une page, composés ici par les fonctions du service (`rowCells`, `toCsv`, `pageMarkdown`), sans requête
// au clic ; le résumé ne se montre que pour une procédure (AC-f2).
// E10-S02 (lot c, AC-c5) : les fichiers des blocs se lisent aux routes du lien (`routeDesFichiers`) ; `?view=<id>` :
// la visionneuse du fichier, en pleine largeur, avec la même bannière que dans l'organisation.
import type { ComponentProps, ReactNode } from "react"
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText"
import { pageMarkdown, PUBLIC_TABLE_ROWS_MAX, rowCells, toCsv, type FileView, type PublicNodeView, type PublicTable, type TableColumn } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { FichierRendu } from "../api/telecharger"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import { BoutonTelecharger } from "../components/bouton-telecharger"
import { LIEN } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { TableServeur } from "../components/table-serveur"
import { EXPORTS } from "../coque/libelles"
import { EmptyState } from "../ds/react/empty-state"
import { Icon } from "../ds/react/icon"
import { Island, IslandBody, IslandFoot } from "../ds/react/island"
import { Content, Desk } from "../ds/react/layout"
import { Reader } from "../ds/react/reader"
import { ScreenHeader } from "../ds/react/screen-header"
import { dateLisible } from "../format/dates"
import { nombreLisible } from "../format/nombres"
import { LogoDOrganisation } from "../marque/logo-d-organisation"
import type { MarqueDOrganisation } from "../marque/types"
import { GlypheDeNature } from "../noeud/glyphes"
import { dernierSegment } from "../noeud/en-ligne"
import { PAGE_VIDE, resumeMontre } from "../noeud/libelles"
import { BlocsRepliables } from "../noeud/blocs-repliables"
import { RenduDUnBloc } from "../noeud/rendu-des-blocs"
import { VisionneuseDeFichier } from "../noeud/visionneuse-de-fichier"
import { Cellule } from "../tableau/cellule"
import { GRILLE } from "../tableau/libelles"

/** Les phrases de la page publique. */
export const PAGE_PUBLIQUE = {
  misAJour: (quand: string) => `Mis à jour le ${quand}`,
  dessous: "Dessous",
  retour: (titre: string) => `Retour à ${titre}`,
  lectureSeule: "Page publiée en lecture seule par un lien de partage.",
  lignesDu: (titre: string) => `Lignes de ${titre}`,
  tronque: `Les ${nombreLisible(PUBLIC_TABLE_ROWS_MAX)} premières lignes, dans l'ordre de leur clé.`,
  /** Le `.csv` d'un tableau coupé : il ne porte que les lignes que la page montre (AC-d1). */
  csvTronque: `${EXPORTS.csv} (${nombreLisible(PUBLIC_TABLE_ROWS_MAX)} premières lignes)`,
  echec: "Cette page n'a pas pu être chargée",
  introuvable: "Page introuvable",
  introuvableDetail: "Ce lien n'existe pas ou n'est plus actif.",
  /** L'auteur d'un fichier HTML vu, dans la bannière, quand la marque de l'adresse manque (AC-c5). */
  organisation: "l'organisation",
} as const

/** L'`href` d'un chemin que le lien ne couvre pas : `LienPublic` le rend en texte (AC-d4). */
const SANS_CIBLE = "#sans-cible"

type LienPublicProps = Omit<ComponentProps<"a">, "href"> & { href: string; children: ReactNode }

/**
 * Le lien d'un bloc sur la page publique : une adresse publique est un lien de page ; un chemin que le lien ne
 * couvre pas se lit en texte, sans cible ni soulignement de lien (le nom d'un encart garde son style).
 */
function LienPublic({ href, className, children, ...rest }: LienPublicProps) {
  if (href.startsWith(SANS_CIBLE)) return <span className={className === LIEN ? undefined : className}>{children}</span>
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  )
}

/** L'adresse publique d'un contenu : le contenu partagé à l'adresse du lien, un contenu dessous sous elle. */
function adresseDe(adresse: string, racine: string, chemin: string): string {
  return chemin === racine ? adresse : `${adresse}/${chemin}`
}

function Organisation({ marque }: { marque: MarqueDOrganisation | null }) {
  if (!marque) return null
  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
      <LogoDOrganisation nom={marque.nomAffiche} logo={marque.logo} taille={28} />
      <span>{marque.nomAffiche}</span>
    </p>
  )
}

function Dessous({ vue, adresse }: { vue: PublicNodeView; adresse: string }) {
  if (vue.children.length === 0) return null
  return (
    <nav aria-labelledby="page-publique-dessous" className="flex flex-col gap-2">
      <h2 id="page-publique-dessous" className="oto-pop-label">
        {PAGE_PUBLIQUE.dessous}
      </h2>
      <ul className="flex flex-col gap-1">
        {vue.children.map((enfant) => (
          <li key={enfant.path} className="flex items-center gap-2">
            <GlypheDeNature nature={natureDuGenre(enfant.kind)} />
            <a href={adresseDe(adresse, vue.root.path, enfant.path)} className={LIEN}>
              {enfant.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Document({ vue, adresse, routeDesFichiers }: { vue: PublicNodeView; adresse: string; routeDesFichiers?: string }) {
  const couverts = new Map(vue.links.map((lien) => [lien.path, lien.to]))
  const hrefDuChemin = (chemin: string) => {
    const cible = couverts.get(chemin)
    return cible === undefined ? SANS_CIBLE : adresseDe(adresse, vue.root.path, cible)
  }
  // Les lignes d'un tableau se lisent dans `table`, jamais comme des blocs : tant que le service les sert aussi
  // dans `blocks` (avant E01-S12 partie c), elles n'y sont pas rendues.
  const blocs = vue.blocks.filter((bloc) => bloc.type !== "row")
  // Un tableau sans texte de document n'a que sa grille : pas d'îlot vide au-dessus.
  if (blocs.length === 0 && vue.node.kind === "table") return null
  return (
    <Island aria-label={vue.node.title}>
      <Reader>
        {blocs.length === 0 ? (
          <EmptyState title={PAGE_VIDE} />
        ) : (
          <BlocsRepliables
            blocs={blocs}
            rendre={(bloc) => <RenduDUnBloc bloc={{ ...bloc, ref: bloc.key ?? undefined }} Lien={LienPublic} hrefDuChemin={hrefDuChemin} routeDesFichiers={routeDesFichiers} />}
          />
        )}
      </Reader>
    </Island>
  )
}

/** Les types mis en forme par `Cellule` ; tout autre type servi se lit en texte. */
const TYPES_MIS_EN_FORME = ["number", "date", "datetime", "bool", "url"] as const satisfies readonly TableColumn["type"][]

/** Une colonne servie, lue comme une colonne déclarée : son nom, et son type s'il se met en forme. */
function colonneLue(colonne: PublicTable["columns"][number]): TableColumn {
  return { name: colonne.name, type: TYPES_MIS_EN_FORME.find((type) => type === colonne.type) ?? "text" }
}

/**
 * Les cellules d'une ligne servie, lues par `rowCells` comme celles d'une ligne connectée (portage-ecrans.md § 6) :
 * la clé d'une colonne clé `number` en nombre ; la grille et le `.csv` les montrent comme l'écran et l'export.
 */
const cellulesDe = (ligne: PublicTable["rows"][number], table: PublicTable, cle: string | null) => rowCells({ key: ligne.key, data: ligne.cells }, { key: cle, columns: table.columns })

type TableauPublicProps = { table: PublicTable; titre: string; cle: string | null }

/**
 * Les lignes d'un tableau (D103), en lecture seule : en-têtes, lignes, valeurs au format de leur type
 * (`Cellule`), la colonne clé en en-tête de ligne ; la table défile en largeur dans son îlot ; au-delà de
 * 500 lignes, le pied le dit. Aucun tri, filtre ni geste.
 */
function TableauPublic({ table, titre, cle }: TableauPublicProps) {
  const colonnes = table.columns.map(colonneLue)
  return (
    <Island aria-label={PAGE_PUBLIQUE.lignesDu(titre)}>
      {table.rows.length === 0 ? (
        <IslandBody>
          <EmptyState title={GRILLE.vide} />
        </IslandBody>
      ) : (
        <IslandBody flush>
          <TableServeur legende={PAGE_PUBLIQUE.lignesDu(titre)} colonnes={colonnes.map((colonne) => ({ entete: colonne.name, numerique: colonne.type === "number" }))}>
            {table.rows.map((ligne) => {
              const cellules = cellulesDe(ligne, table, cle)
              return (
                <tr key={ligne.key}>
                  {colonnes.map((colonne) => {
                    const cellule = <Cellule colonne={colonne} valeur={cellules.get(colonne.name)} />
                    return colonne.name === cle ? (
                      <th key={colonne.name} scope="row">
                        {cellule}
                      </th>
                    ) : (
                      <td key={colonne.name} data-numeric={colonne.type === "number" ? "" : undefined}>
                        {cellule}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </TableServeur>
        </IslandBody>
      )}
      {table.truncated && (
        <IslandFoot>
          <p className="oto-caption">{PAGE_PUBLIQUE.tronque}</p>
        </IslandFoot>
      )}
    </Island>
  )
}

/** La colonne clé d'un tableau servi (`meta.key`), ou `null`. */
const cleDu = (vue: PublicNodeView): string | null => (typeof vue.node.meta.key === "string" ? vue.node.meta.key : null)

/**
 * Le `.csv` des lignes que la page a lues (AC-d1, AC-d3) : les colonnes dans l'ordre servi, la clé dans sa colonne,
 * écrit par `toCsv` (BOM, séparateur et décimale de la langue de l'organisation, formules neutralisées).
 */
function csvDuTableau(vue: PublicNodeView, table: PublicTable): FichierRendu {
  const cle = cleDu(vue)
  const lignes = table.rows.map((ligne) => cellulesDe(ligne, table, cle))
  return { filename: `${dernierSegment(vue.node.path)}.csv`, content: toCsv(table.columns, lignes, vue.language) }
}

/** Le fichier que la page donne (lot d) : le `.csv` d'un tableau, sinon le `.md` de ses blocs publics, comme l'export (E10-S01, AC-a5). */
function Telechargement({ vue }: { vue: PublicNodeView }) {
  if (vue.table) {
    return <BoutonTelecharger format="csv" libelle={vue.table.truncated ? PAGE_PUBLIQUE.csvTronque : EXPORTS.csv} fichier={csvDuTableau(vue, vue.table)} />
  }
  const blocs = vue.blocks.filter((bloc) => bloc.type !== "row")
  return <BoutonTelecharger format="md" libelle={EXPORTS.markdown} fichier={{ filename: `${dernierSegment(vue.node.path)}.md`, content: pageMarkdown(vue.node.title, blocs) }} />
}

function Contenu({ vue, adresse, routeDesFichiers }: { vue: PublicNodeView; adresse: string; routeDesFichiers?: string }) {
  const quand = dateLisible(vue.node.updatedAt)
  const racine = vue.node.path !== vue.root.path
  return (
    <>
      <ScreenHeader
        breadcrumb={
          racine ? (
            <a href={adresse} className={LIEN}>
              {PAGE_PUBLIQUE.retour(vue.root.title)}
            </a>
          ) : undefined
        }
        icon={<GlypheDeNature nature={natureDuGenre(vue.node.kind)} taille="sm" />}
        title={vue.node.title}
        meta={quand ? PAGE_PUBLIQUE.misAJour(quand) : undefined}
        actions={<Telechargement vue={vue} />}
      />
      {resumeMontre(vue.node.kind) && <p className="text-ink">{vue.node.summary}</p>}
      <Document vue={vue} adresse={adresse} routeDesFichiers={routeDesFichiers} />
      {vue.table && <TableauPublic table={vue.table} titre={vue.node.title} cle={cleDu(vue)} />}
      <Dessous vue={vue} adresse={adresse} />
    </>
  )
}

/**
 * La colonne de la page, sur le bureau sans rail des écrans hors session ; `large` : toute la zone de contenu et sa
 * hauteur, pour la visionneuse d'un fichier (AC-c5).
 */
function Colonne({ marque, pied, large, children }: { marque: MarqueDOrganisation | null; pied?: string; large?: boolean; children: ReactNode }) {
  return (
    <Desk rail={false}>
      <Content>
        <div className={`oto-content-max flex flex-col gap-(--gap)${large ? " min-h-0 flex-1" : ""}`} data-width={large ? undefined : "document"}>
          <Organisation marque={marque} />
          {children}
          {pied && <p className="oto-caption">{pied}</p>}
        </div>
      </Content>
    </Desk>
  )
}

export type PagePubliqueProps = {
  /** Ce que sert `readPublicNode` ; un lien inconnu, désactivé ou hors de portée est le 404 de l'hôte. */
  resultat: Resultat<PublicNodeView>
  /** L'adresse du lien dans l'hôte (`/p/<jeton>`) : le contenu partagé y est, un contenu dessous à `<adresse>/<chemin>`. */
  adresse: string
  /** La marque de l'organisation de l'adresse ; `null` sans elle. */
  marque: MarqueDOrganisation | null
  /**
   * Les routes des fichiers du lien (`publicFilesRoute(<jeton>)`, E10-S02 AC-c5) : image, « Voir » et « Télécharger »
   * d'un bloc ; sans elles, celles d'une personne connectée, qu'un visiteur ne lit pas.
   */
  routeDesFichiers?: string
  /** `?view=<id>` (AC-c5) : l'identifiant demandé et ce que sert `publicFileView` (`null` : introuvable). */
  fichier?: { id: string; resultat: Resultat<FileView | null> }
}

/** La visionneuse d'un fichier du lien (AC-c5) : la page du fichier en sortie, les liens d'un `.md` en texte. */
type FichierDuLienProps = Omit<PagePubliqueProps, "resultat" | "fichier"> & { vue: PublicNodeView; fichier: NonNullable<PagePubliqueProps["fichier"]> }

function FichierDuLien({ vue, adresse, marque, routeDesFichiers, fichier }: FichierDuLienProps) {
  const page = { titre: vue.node.title, href: adresseDe(adresse, vue.root.path, vue.node.path) }
  return (
    <VisionneuseDeFichier
      fichier={fichier.resultat}
      nomOrganisation={marque?.nomAffiche ?? PAGE_PUBLIQUE.organisation}
      page={page}
      ici={`${page.href}?view=${encodeURIComponent(fichier.id)}`}
      routeDesFichiers={routeDesFichiers}
      Lien={LienPublic}
      hrefDuChemin={() => SANS_CIBLE}
    />
  )
}

export function PagePublique({ resultat, adresse, marque, routeDesFichiers, fichier }: PagePubliqueProps) {
  if (fichier && resultat.error === undefined) {
    return (
      <Colonne marque={marque} pied={PAGE_PUBLIQUE.lectureSeule} large>
        <FichierDuLien vue={resultat.data} adresse={adresse} marque={marque} routeDesFichiers={routeDesFichiers} fichier={fichier} />
      </Colonne>
    )
  }
  return (
    <Colonne marque={marque} pied={PAGE_PUBLIQUE.lectureSeule}>
      {resultat.error !== undefined ? (
        <>
          <ScreenHeader title={PAGE_PUBLIQUE.echec} />
          <ErreurDeLecture message={resultat.error} />
        </>
      ) : (
        <Contenu vue={resultat.data} adresse={adresse} routeDesFichiers={routeDesFichiers} />
      )}
    </Colonne>
  )
}

/**
 * Le 404 d'un lien public (AC-d5) : la même page pour un jeton inconnu, désactivé ou hors de portée, et pour un
 * contenu que le lien ne couvre pas ; elle ne dit pas lequel.
 */
export function PagePubliqueIntrouvable({ marque }: { marque: MarqueDOrganisation | null }) {
  return (
    <Colonne marque={marque}>
      <ScreenHeader title={PAGE_PUBLIQUE.introuvable} />
      <EmptyState icon={<Icon as={FileText} size="lg" />} title={PAGE_PUBLIQUE.introuvableDetail} />
    </Colonne>
  )
}
