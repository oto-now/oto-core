// La visionneuse d'un fichier joint (E10-S02 lot c : AC-c2, AC-c4, AC-c5 ; ADR-017 § 1, § 5) : ce que « Voir » ouvre
// dans un nouvel onglet pour un fichier `html` ou `md`, à l'adresse du contenu suivie de `?view=<id>`, dans
// l'organisation comme par un lien public. Elle remplace l'écran du nœud, en pleine largeur de la zone de contenu,
// sans marge de lecture. Son en-tête, hors du contenu : le nom, la taille, « Télécharger » et « Ouvrir la page
// <titre> ». Un `.md` : ses blocs, rendus en lecture seule comme une page (`RenduDUnBloc`). Un `html` : la bannière,
// hors de l'iframe et de la portée de ses scripts, puis l'iframe isolée (`CadreDuFichier`). Quatre états
// (`portage-ecrans.md § 4`) : le fichier, introuvable (`null` : la même phrase pour tout ce qui n'est pas servi),
// l'échec dit avec « Réessayer ». Server Component ; seule l'iframe est client. Sans elle, « Voir » d'un `html` ou
// d'un `md` n'ouvrirait rien.
//
// Repris de l'artefact de Claude ouvert seul : un en-tête, la bannière, le contenu en pleine fenêtre.
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { File as FichierQuelconque } from "@phosphor-icons/react/dist/ssr/File"
import { FILE_ADDRESS } from "../../schemas/api"
import { fileHtmlPath, filePath, type FileView } from "../../schemas/files"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { Icon } from "../ds/react/icon"
import { Island } from "../ds/react/island"
import { Alert } from "../ds/react/primitives"
import { Reader } from "../ds/react/reader"
import { ScreenHeader } from "../ds/react/screen-header"
import { tailleLisible } from "../format/nombres"
import { LienBouton } from "../tableau/lien-bouton"
import { CadreDuFichier } from "./cadre-du-fichier"
import { PAGE_VIDE } from "./libelles"
import { FICHIERS } from "./libelles-des-fichiers"
import { ligneDOrigine } from "./origine-du-fichier"
import { RenduDUnBloc } from "./rendu-des-blocs"

export type VisionneuseProps = {
  /** Ce que sert le service (`fileView`, `publicFileView`) ; `null` : introuvable, sans dire pourquoi. */
  fichier: Resultat<FileView | null>
  /** Le nom de l'organisation, dans la bannière d'un fichier HTML (AC-c4). */
  nomOrganisation: string
  /** La page du fichier : « Ouvrir la page <titre> » y mène, sans `?view`. */
  page: { titre: string; href: string }
  /** L'adresse de la visionneuse, que « Réessayer » relit. */
  ici: string
  /** Les routes des fichiers : l'adresse d'un fichier (`FILE_ADDRESS`), ou celles d'un lien public (`publicFilesRoute`). */
  routeDesFichiers?: string
  /** Le lien de l'hôte (en-tête, liens d'un `.md`) et l'adresse d'un chemin cité par un `.md`. */
  Lien: LienDeLHote
  hrefDuChemin: (chemin: string) => string
}

type VueProps = Omit<VisionneuseProps, "fichier" | "ici"> & { vue: FileView; route: string }

/** L'en-tête, hors du contenu (AC-c2) : nom, taille et origine, « Télécharger », « Ouvrir la page <titre> ». */
function EnTete({ vue, page, route, Lien }: Pick<VueProps, "vue" | "page" | "route" | "Lien">) {
  return (
    <ScreenHeader
      icon={<Icon as={FichierQuelconque} size="sm" />}
      title={vue.name}
      meta={[tailleLisible(vue.size), ligneDOrigine(vue.origin)].filter(Boolean).join(" · ")}
      actions={
        <>
          <a href={filePath(vue.id, route)} download="" aria-label={FICHIERS.telechargerNom(vue.name)} className="oto-btn" data-variant="ghost" data-size="sm">
            <Icon as={DownloadSimple} size="xs" />
            <span>{FICHIERS.telecharger}</span>
          </a>
          <LienBouton Lien={Lien} href={page.href} variante="secondary">
            {FICHIERS.ouvrirLaPage(page.titre)}
          </LienBouton>
        </>
      }
    />
  )
}

/** Le contenu : un `html` sous sa bannière, dans l'iframe isolée (AC-c4) ; un `.md`, ses blocs en lecture seule. */
function Contenu({ vue, route, nomOrganisation, Lien, hrefDuChemin }: VueProps) {
  if (vue.type === "html") {
    return (
      <>
        {/* Hors de l'iframe, et hors de la portée de ses scripts (ADR-017 § 5) : une note, pas une alerte. */}
        <Alert tone="review" role="note">
          {FICHIERS.banniere(nomOrganisation)}
        </Alert>
        <CadreDuFichier source={fileHtmlPath(vue.id, route)} titre={vue.name} />
      </>
    )
  }
  return (
    <Island aria-label={FICHIERS.contenuDe(vue.name)}>
      <Reader>
        {vue.blocks.length === 0 ? (
          <EmptyState title={PAGE_VIDE} />
        ) : (
          // Un bloc lu d'un fichier n'a pas d'identité : son rang dans un fichier dont l'identité est ailleurs.
          vue.blocks.map((bloc, rang) => <RenduDUnBloc key={rang} bloc={bloc} Lien={Lien} hrefDuChemin={hrefDuChemin} routeDesFichiers={route} />)
        )}
      </Reader>
    </Island>
  )
}

export function VisionneuseDeFichier({ fichier, ici, routeDesFichiers = FILE_ADDRESS, ...props }: VisionneuseProps) {
  const { page, Lien } = props
  // Pleine largeur de la zone de contenu (pas de `data-width`), et la hauteur qui reste pour l'iframe.
  const colonne = "oto-content-max flex min-h-0 flex-1 flex-col gap-(--gap)"
  if (fichier.error !== undefined) {
    return (
      <div className={colonne}>
        {/* Le fichier existe peut-être (pas en UTF-8, stockage en panne) : l'en-tête ne dit pas « introuvable ». */}
        <ScreenHeader title={FICHIERS.fichier} />
        <ErreurDeLecture message={fichier.error} href={ici} Lien={Lien} />
      </div>
    )
  }
  if (fichier.data === null) {
    return (
      <div className={colonne}>
        <ScreenHeader title={FICHIERS.introuvable} />
        <EmptyState
          icon={<Icon as={FichierQuelconque} size="lg" />}
          title={FICHIERS.introuvable}
          action={
            <LienBouton Lien={Lien} href={page.href} variante="secondary">
              {FICHIERS.ouvrirLaPage(page.titre)}
            </LienBouton>
          }
        />
      </div>
    )
  }
  return (
    <div className={colonne}>
      <EnTete vue={fichier.data} page={page} route={routeDesFichiers} Lien={Lien} />
      <Contenu vue={fichier.data} route={routeDesFichiers} {...props} />
    </div>
  )
}
