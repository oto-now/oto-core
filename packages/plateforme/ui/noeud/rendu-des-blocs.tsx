// Le rendu d'un bloc, un par type (E05-S02, AC4, AC5 ; ADR-011 § 2) : servi aux lecteurs par l'écran
// serveur (lien de l'hôte) et aux rangées de l'éditeur au repos (`"a"`). Ni directive ni état : il sert des
// deux côtés. Aucun `dangerouslySetInnerHTML` : le texte en ligne devient des éléments React
// (`security-patterns.md § XSS Prevention`). Chaque bloc porte l'ancre `id` = sa référence. Sans lui,
// lecture et édition rendraient un bloc de deux façons.
//
// Porté d'oto-frontend (`components/noeud/corps-du-noeud.tsx`, `ReadOnlyBlock`) : un rendu par type sur les
// primitives du lecteur (`ReaderHeading`, `ReaderParagraph`, `ReaderList`), les titres décalés sous le
// `<h1>` (HN-E05S02-4), le tableau markdown et le code en `oto-code`, le code en ligne en `oto-mono`, un
// contenu cité en encart (`EmbedCard`, rangé ailleurs), un type inconnu jamais effacé (E05-S09, partie c1).
// Retiré : la marque d'origine par `Symbol` (le texte d'un bloc est toujours lu en balisage, M15).
//
// E05-S10 : une adresse web est un lien, l'adresse entière au survol, ouvert dans un nouvel onglet (AC-a8).
//
// E05-S11 (retour 11, fiche D107) : une page citée se lit par son titre dans la phrase (`titreDuLien`) ; parmi
// les cibles que l'écran connaît (`cibles`), une page invisible ou à la corbeille se lit en texte, sans lien,
// et une page déplacée mène à sa nouvelle place. Un chemin inconnu (page publique) garde son lien.
//
// M64 : les liens sortants lus après la page (`lecture`) ne suspendent que le titre de chaque lien, jamais le
// texte autour : un repli qui recopiait le document le servait deux fois pendant le flux, ancres comprises.
//
// E10-S04 : un titre prend la balise de son niveau (AC-b3, remplace E05-S10 AC-a5), une liste ses sous-listes
// (AC-b1) ; tableau simple, séparateur et repli (AC-a1 à AC-a3) ; barré et saut de ligne en ligne (AC-c1).
//
// E10-S02 (lot b) : une image jointe se lit à la route de ses octets, toute image à sa largeur, agrandie au clic
// (AC-b1, AC-b3) ; un fichier joint, en carte (AC-b2, `fichier-du-bloc.tsx`). Lot c : les routes des fichiers d'un lien
// public (`routeDesFichiers`, AC-c5), celles d'une personne connectée par défaut.
//
// E11-S15 (AC-b1) : l'en-tête d'un tableau simple sur le fond teinté du primary (`data-simple`, `editeur.css`).
import { Suspense, use, type ReactNode } from "react"
import { LIST_DEPTH_MAX, simpleTableOf, type ImageWidth } from "../../schemas/blocks"
import { filePath } from "../../schemas/files"
import { fencedParts } from "../../schemas/link-syntax"
import { isRecord } from "../../schemas/tables"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { EmbedCard } from "../ds/react/embed-card"
import { ReaderHeading, ReaderList, ReaderParagraph } from "../ds/react/reader"
import { texteDUnAppel } from "../procedure/libelles"
import { CadreIntegre } from "./cadre-integre"
import { DiagrammeMermaid } from "./diagramme-mermaid"
import { adresseSansIdentifiants, cibleDe, estUnTableau, libelleDUneAdresse, segmentsEnLigne, texteLu, titreDuLien, type CiblesDesLiens, type Segment } from "./en-ligne"
import { CarteDeFichier, ImageAgrandissable } from "./fichier-du-bloc"
import { GlypheDeNature } from "./glyphes"
import { CADRE_DU_TABLEAU, DIAGRAMME, ECRAN } from "./libelles"
import { ChevronDeSection, DepliantLu } from "./plis-lus"
import { ciblesLues } from "./sous-pages"

/** Le lien d'un bloc : celui de l'hôte (écran serveur) ou `"a"` (éditeur, îlot client). */
type LienDUnBloc = LienDeLHote | "a"

/** Un bloc servi, ou un bloc de l'éditeur : sans référence tant qu'il n'est pas écrit ; l'`id` garde l'état d'un pli. */
type BlocARendre = { type: string; text: string | null; data: Record<string, unknown>; ref?: string; id?: string }

/**
 * Ce que lit le rendu d'un lien : le lien de l'hôte, l'adresse d'un chemin, les cibles connues (E05-S11, AC-26),
 * et les champs de `read` sur le nœud (ses liens sortants), lus par l'hôte après la page.
 */
type Liens = { Lien: LienDUnBloc; hrefDuChemin: (chemin: string) => string; cibles?: CiblesDesLiens; lecture?: Promise<Resultat<Record<string, unknown>>> }

/** `routeDesFichiers` : les routes des fichiers d'un lien public (`publicFilesRoute`, AC-c5) ; `FILES_ROUTE` sans elle. */
type RenduProps = Liens & { bloc: BlocARendre; routeDesFichiers?: string }

/** `numeroter` : chaque lien rendu porte son rang dans `liensDuTexte` (`data-lien`), que l'éditeur lit au clic (E11-S06, AC-b2). */
type EnLigneProps = Liens & { texte: string; numeroter?: boolean }

/** Le rang du prochain lien rendu d'un texte, compté dans l'ordre du texte, comme `liensDuTexte`. */
type Compteur = { rang: number }

const BALISES_DE_TITRE = ["h2", "h3", "h4", "h5", "h6"] as const

/**
 * La balise d'un titre de niveau N (E10-S04, AC-b3, qui remplace E05-S10 AC-a5) : `h(N+1)`, le titre du nœud
 * étant le seul `<h1>` (AC4, AC14) ; sous un titre de même niveau que le sien (`base` `"h3"`, un Contexte dans
 * un îlot de réglages, E05-S11 AC-24), `h(N+2)` ; bornée à `h6`. Un niveau illisible vaut 1.
 */
export function baliseDuTitre(niveau: unknown, base: "h2" | "h3" = "h2"): (typeof BALISES_DE_TITRE)[number] {
  const lu = typeof niveau === "number" && Number.isInteger(niveau) && niveau >= 1 ? niveau : 1
  return BALISES_DE_TITRE[Math.min(BALISES_DE_TITRE.length - 1, lu - 1 + (base === "h3" ? 1 : 0))]
}

/** L'écart d'un bloc lu que le lecteur ne pose pas lui-même (code, image, cases), au rythme de ses paragraphes. */
const APRES = "mb-3.5"

/**
 * Une adresse web (AC-a8) : un lien vers un autre site, ouvert dans un nouvel onglet, sans l'adresse de la page
 * qui le porte (`noreferrer`) ; son libellé raccourci, l'adresse entière au survol (`title`). Une adresse nue coupée
 * (E11-S15, AC-b10) se nomme par l'adresse entière ; un libellé écrit (`[texte](https://…)`) reste le nom du lien.
 * L'infobulle et le nom ne montrent jamais l'identifiant ni le mot de passe écrits avant l'hôte (H-b8).
 */
export function AdresseWeb({ adresse, libelle, className = LIEN, rang }: { adresse: string; libelle: string; className?: string; rang?: number }) {
  const montree = adresseSansIdentifiants(adresse)
  const coupee = libelle !== montree && libelle === libelleDUneAdresse(adresse)
  return (
    <a href={adresse} title={montree} aria-label={coupee ? montree : undefined} target="_blank" rel="noopener noreferrer nofollow" className={className} data-lien={rang}>
      {libelle}
    </a>
  )
}

type LienInterneProps = Liens & { lien: Extract<Segment, { genre: "lien" }>; rang?: number }

/**
 * Une page citée (AC-26, AC-27) : son titre, lien vers sa place ; sans page visible qui y réponde, son titre en
 * texte ; un chemin que l'écran ne connaît pas garde son lien. Les liens sortants à venir (`lecture`) : le lien
 * lu dans l'arbre en attendant, puis celui qu'ils complètent (M64).
 */
function LienInterne({ lecture, ...props }: LienInterneProps) {
  if (!lecture) return <LienDesCibles {...props} />
  return (
    <Suspense fallback={<LienDesCibles {...props} />}>
      <LienLu {...props} lecture={lecture} />
    </Suspense>
  )
}

function LienLu({ lecture, ...props }: LienInterneProps & { lecture: Promise<Resultat<Record<string, unknown>>> }) {
  return <LienDesCibles {...props} cibles={ciblesLues(props.cibles, use(lecture))} />
}

function LienDesCibles({ lien, Lien, hrefDuChemin, cibles, rang }: Omit<LienInterneProps, "lecture">) {
  const titre = titreDuLien(lien, cibles)
  const cible = cibleDe(cibles, lien.chemin)
  if (cible === null) return titre
  const chemin = cible?.chemin ?? lien.chemin
  const ancre = lien.reference === null ? "" : `#${encodeURIComponent(lien.reference)}`
  return (
    <Lien href={`${hrefDuChemin(chemin)}${ancre}`} className={LIEN} data-lien={rang}>
      {titre}
    </Lien>
  )
}

/** Des segments en éléments : un lien ou du code peuvent être en gras ou en italique ; `compteur`, les liens numérotés. */
function rendre(segments: readonly Segment[], liens: Liens, compteur?: Compteur): ReactNode[] {
  return segments.map((segment, rang) => {
    // Un segment n'a pas d'identité : son rang dans un texte dont l'identité est ailleurs.
    if (segment.genre === "lien") return <LienInterne key={rang} lien={segment} {...liens} rang={compteur ? compteur.rang++ : undefined} />
    if (segment.genre === "web") return <AdresseWeb key={rang} adresse={segment.adresse} libelle={segment.libelle} rang={compteur ? compteur.rang++ : undefined} />
    // `oto-mono`, le rôle « mono en ligne » du design system ; `oto-code` est un bloc.
    if (segment.genre === "code") return <code key={rang} className="oto-mono">{segment.texte}</code>
    if (segment.genre === "gras") return <strong key={rang}>{rendre(segment.contenu, liens, compteur)}</strong>
    if (segment.genre === "italique") return <em key={rang}>{rendre(segment.contenu, liens, compteur)}</em>
    // E10-S04 (AC-c1) : le barré, et le saut de ligne écrit `<br>`, rendus par React, jamais en HTML injecté.
    if (segment.genre === "barre") return <s key={rang}>{rendre(segment.contenu, liens, compteur)}</s>
    if (segment.genre === "saut") return <br key={rang} />
    return segment.texte
  })
}

/**
 * Le texte en ligne d'un bloc (AC5) : `<code>`, `<strong>`, `<em>` et les liens, le reste en texte. L'éditeur
 * le rend aussi sur le champ d'un bloc au repos (E05-S11, AC-26).
 */
export function EnLigne({ texte, numeroter = false, ...liens }: EnLigneProps): ReactNode {
  return rendre(segmentsEnLigne(texte), liens, numeroter ? { rang: 0 } : undefined)
}

const chaine = (valeur: unknown): string => (typeof valeur === "string" ? valeur : "")

function elements(data: Record<string, unknown>): unknown[] {
  return Array.isArray(data.items) ? data.items : []
}

type ListeProps = Liens & { donnees: Record<string, unknown>; id?: string; niveau: number }

/**
 * Une liste, sous-listes comprises (E10-S04, AC-b1) : des `ul` et `ol` imbriqués, chacun sa numérotation ; un
 * élément est une chaîne, ou son texte et sa sous-liste (`children`), lue jusqu'au troisième niveau.
 */
function Liste({ donnees, id, niveau, ...liens }: ListeProps) {
  const numerotee = donnees.ordered === true
  const debut = numerotee && typeof donnees.start === "number" ? donnees.start : undefined
  return (
    <ReaderList as={numerotee ? "ol" : "ul"} id={id} start={debut}>
      {elements(donnees).map((item, rang) => {
        const texte = isRecord(item) ? chaine(item.text) : chaine(item)
        const enfants = isRecord(item) && isRecord(item.children) && niveau < LIST_DEPTH_MAX ? item.children : null
        return (
          // Un élément n'a pas d'identité : son rang dans une liste dont l'identité est ailleurs.
          <li key={rang}>
            <EnLigne texte={texte} {...liens} />
            {enfants && <Liste donnees={enfants} niveau={niveau + 1} {...liens} />}
          </li>
        )
      })}
    </ReaderList>
  )
}

/** Un alignement de colonne (E10-S04, AC-a1) : celui du tableau du design system, `start` par défaut. */
function alignementDe(valeur: unknown): "center" | "end" | undefined {
  return valeur === "center" ? "center" : valeur === "right" ? "end" : undefined
}

/**
 * Le cadre d'un tableau lu : il défile en largeur (`oto-table-wrap`, `content.css`), jamais la page ; focusable et nommé,
 * pour que le clavier le fasse défiler. Toujours, faute de savoir sans mesure s'il défile (`portage-ecrans.md § 7`).
 */
const CADRE_DEFILANT = { tabIndex: 0, role: "region" } as const

/**
 * Un tableau simple (E10-S04, AC-a1) : le balisage et les classes de `TableauFixe` (`ui/equipes/tableau-fixe.tsx`),
 * en-têtes `scope="col"`, alignement par colonne ; il défile dans son bloc (`oto-table-wrap`), jamais la page.
 * Rendu aussi par le serveur : ni le `Table` client du design system, ni `TableauFixe`, dont les clés sont les
 * en-têtes (un en-tête markdown peut se répéter).
 */
function TableauSimple({ bloc, ...liens }: RenduProps) {
  const { columns: colonnes, rows: rangees, align } = simpleTableOf(bloc.data)
  const alignements = (align ?? []).map(alignementDe)
  // Une cellule n'a pas d'identité : son rang dans une rangée, et la rangée le sien, dans un bloc qui a la sienne.
  return (
    <div id={bloc.ref} className={`oto-table-wrap ${APRES}`} {...CADRE_DEFILANT} aria-label={CADRE_DU_TABLEAU.simple}>
      <table className="oto-table" data-responsive="scroll" data-simple="">
        <thead>
          <tr>
            {colonnes.map((colonne, rang) => (
              <th key={rang} scope="col" data-align={alignements[rang]}>
                <span className="oto-th-cell">
                  <span className="oto-th-in">
                    <EnLigne texte={colonne} {...liens} />
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rangees.map((cellules, ligne) => (
            <tr key={ligne}>
              {colonnes.map((_, rang) => (
                <td key={rang} data-align={alignements[rang]}>
                  <EnLigne texte={cellules[rang] ?? ""} {...liens} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Un menu dépliant (E10-S04, AC-a3) : `DepliantLu`, `<details>` natif replié, au dessin de Notion, son état gardé dans
 * ce navigateur ; le corps, texte en ligne et sauts de ligne gardés, chaque clôture de code en bloc préformaté.
 */
function Repli({ bloc, ...liens }: RenduProps) {
  return (
    <DepliantLu id={bloc.id} ancre={bloc.ref} className={APRES} resume={<EnLigne texte={chaine(bloc.data.summary)} {...liens} />}>
      {fencedParts(bloc.text ?? "").map((partie, rang) =>
        // Une partie n'a pas d'identité : son rang dans un corps dont l'identité est ailleurs.
        partie.code ? (
          <Preformate key={rang} genre="code" legende={partie.language ? `Code · ${partie.language}` : "Code"} texte={partie.text} />
        ) : (
          <p key={rang} className="whitespace-pre-line text-sm text-ink">
            <EnLigne texte={partie.text} {...liens} />
          </p>
        ),
      )}
    </DepliantLu>
  )
}

/** Chaque case dit « fait » ou « à faire » en toutes lettres ; le glyphe ne sert qu'à l'œil. */
function Cases({ bloc, ...liens }: RenduProps) {
  return (
    <ul id={bloc.ref} className={`${APRES} space-y-1.5 text-sm text-ink`}>
      {elements(bloc.data).map((item, rang) => {
        const fait = typeof item === "object" && item !== null && "checked" in item && item.checked === true
        const texte = typeof item === "object" && item !== null && "text" in item ? chaine(item.text) : ""
        return (
          <li key={rang} className="flex gap-2">
            <span aria-hidden="true">{fait ? "☑" : "☐"}</span>
            <span>
              <EnLigne texte={texte} {...liens} />
              <span className="ml-1 text-mute">{fait ? "(fait)" : "(à faire)"}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Un bloc à légende (code, diagramme) : l'en-tête du bloc de code du design system, puis le texte préformaté, sur le
 * fond sombre du code (`data-kind`).
 */
function Preformate({ id, legende, texte, genre }: { id?: string; legende: string; texte: string; genre: "code" | "mermaid" }) {
  return (
    <figure id={id} data-kind={genre} className={`oto-code ${APRES}`}>
      <figcaption className="oto-code-head">{legende}</figcaption>
      <pre>
        <code>{texte}</code>
      </pre>
    </figure>
  )
}

/**
 * La largeur d'une image (AC-b3) : `small`, `medium`, sinon `full`, le défaut. Ici et non dans `fichier-du-bloc.tsx`
 * (`"use client"`), dont le serveur ne peut appeler aucun export (`portage-ecrans.md § 2`).
 */
export function largeurDe(valeur: unknown): ImageWidth {
  return valeur === "small" || valeur === "medium" ? valeur : "full"
}

/**
 * Une image (AC-b1, AC-b3) : un fichier joint se lit à sa route, une adresse `https` telle quelle ; l'hôte de la source
 * ne reçoit pas l'adresse de la page qui l'affiche (`no-referrer`), et une image sous le pli ne part que lorsqu'on
 * l'approche. Toute autre source n'est pas affichée.
 */
function ImageDuBloc({ bloc, routeDesFichiers, ...liens }: RenduProps) {
  const source = chaine(bloc.data.src)
  const jointe = chaine(bloc.data.file_id)
  const alternatif = chaine(bloc.data.alt)
  const adresse = jointe !== "" ? filePath(jointe, routeDesFichiers) : /^https:/i.test(source) ? source : null
  return (
    <figure id={bloc.ref} className={`${APRES} space-y-1`}>
      {adresse !== null ? (
        <ImageAgrandissable source={adresse} alt={alternatif} largeur={largeurDe(bloc.data.width)} jointe={jointe !== ""} />
      ) : (
        <p className="text-sm text-ink">{`Image non affichée : adresse non sûre. ${alternatif}`.trim()}</p>
      )}
      {bloc.text ? (
        <figcaption className="oto-caption">
          <EnLigne texte={bloc.text} {...liens} />
        </figcaption>
      ) : null}
    </figure>
  )
}

/**
 * Le rendu par défaut d'un bloc `reference` (H56, P18) : le chemin cité en encart, rangé ailleurs, son nom
 * portant le lien. E07-S03 le remplace par une vue ou une carte quand la référence est résolue, et le garde
 * sinon.
 */
export function ReferenceEnLien({ bloc, Lien, hrefDuChemin }: RenduProps) {
  const chemin = chaine(bloc.data.path)
  return <EmbedCard id={bloc.ref} as={Lien} href={hrefDuChemin(chemin)} icon={<GlypheDeNature nature="page" taille="sm" />} name={chemin} where={ECRAN.rangeAilleurs} whereKind="elsewhere" />
}

function Paragraphe({ bloc, ...liens }: RenduProps) {
  const texte = bloc.text ?? ""
  if (estUnTableau(texte)) {
    return (
      <pre id={bloc.ref} className={`oto-code ${APRES} overflow-x-auto p-3`} {...CADRE_DEFILANT} aria-label={CADRE_DU_TABLEAU.texte}>
        {texte}
      </pre>
    )
  }
  return (
    <ReaderParagraph id={bloc.ref} className="whitespace-pre-line">
      <EnLigne texte={texte} {...liens} />
    </ReaderParagraph>
  )
}

/**
 * Un bloc rendu par son type (AC4) ; un type inconnu affiche son texte, sinon le dit, jamais rien.
 * `rendu` : un bloc `reference` rendu en place par la page serveur (vue, carte ou avis, E07-S03),
 * sous l'ancre du bloc ; sans lui, `ReferenceEnLien`.
 * `baliseDeTitre` : la balise d'un titre de niveau 1 rendu sous un titre de même niveau que le sien, un Contexte
 * montré dans un îlot de réglages (E05-S11, AC-24) ; sans elle, `h2` (`baliseDuTitre`).
 */
export function RenduDUnBloc(props: RenduProps & { rendu?: ReactNode; baliseDeTitre?: "h3" }): ReactNode {
  const { bloc, rendu, baliseDeTitre, routeDesFichiers, ...liens } = props
  switch (bloc.type) {
    case "heading":
      // Le chevron du titre, que sa `SectionRepliable` sert (`BlocsRepliables`), rien ailleurs ; puis son texte dans une case.
      return (
        <ReaderHeading as={baliseDuTitre(bloc.data.level, baliseDeTitre)} id={bloc.ref} className="oto-titre-repliable">
          <ChevronDeSection nom={texteLu(bloc.text ?? "")} />
          <span>
            <EnLigne texte={bloc.text ?? ""} {...liens} />
          </span>
        </ReaderHeading>
      )
    case "paragraph":
      return <Paragraphe {...props} />
    case "list":
      return <Liste donnees={bloc.data} id={bloc.ref} niveau={1} {...liens} />
    case "simple_table":
      return <TableauSimple {...props} />
    case "divider":
      return <hr id={bloc.ref} className="oto-separator" data-orientation="horizontal" />
    case "toggle":
      return <Repli {...props} />
    case "checklist":
      return <Cases {...props} />
    case "code": {
      const langage = chaine(bloc.data.language)
      return <Preformate id={bloc.ref} genre="code" legende={langage ? `Code · ${langage}` : "Code"} texte={bloc.text ?? ""} />
    }
    // Un appel déjà écrit se lit comme un texte (M59, HN-M59-1), jamais exécuté par l'écran ; son texte n'est
    // pas lu en balisage : les arguments se montrent tels qu'ils sont.
    case "call":
      return (
        <ReaderParagraph id={bloc.ref} className="whitespace-pre-line">
          {texteDUnAppel(bloc.data)}
        </ReaderParagraph>
      )
    // Dessiné dans le navigateur (1.1.3) ; le texte, rendu ici, reste le repli (`diagramme-mermaid.tsx`).
    case "mermaid":
      return (
        <DiagrammeMermaid id={bloc.ref} texte={bloc.text ?? ""}>
          <Preformate genre="mermaid" legende={DIAGRAMME.legende} texte={bloc.text ?? ""} />
        </DiagrammeMermaid>
      )
    case "image":
      return <ImageDuBloc {...props} />
    case "callout":
      return (
        <div id={bloc.ref} role="note" className={`oto-alert ${APRES}`}>
          <EnLigne texte={bloc.text ?? ""} {...liens} />
        </div>
      )
    case "reference":
      return rendu === undefined ? <ReferenceEnLien {...props} /> : <div id={bloc.ref}>{rendu}</div>
    case "embed":
      return <CadreIntegre id={bloc.ref} adresse={chaine(bloc.data.url)} hauteur={bloc.data.height} />
    case "file":
      return (
        <div id={bloc.ref} className={APRES}>
          <CarteDeFichier
            id={chaine(bloc.data.file_id)}
            nom={chaine(bloc.data.name)}
            taille={typeof bloc.data.size === "number" ? bloc.data.size : 0}
            routeDesFichiers={routeDesFichiers}
          />
        </div>
      )
    default:
      return bloc.text ? (
        <ReaderParagraph id={bloc.ref} className="whitespace-pre-line">
          {bloc.text}
        </ReaderParagraph>
      ) : (
        <p id={bloc.ref} className="oto-caption">{`Bloc de type « ${bloc.type} » non affiché ici.`}</p>
      )
  }
}
