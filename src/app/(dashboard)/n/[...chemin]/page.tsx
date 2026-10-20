import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { cache, Suspense, use, type ReactNode } from "react"
import {
  fileViewParamSchema,
  nodePathSchema,
  nodeVersionParamSchema,
  tableHeaderSchema,
  type NodeView,
  type TableHeader,
} from "@otomata_tech/oto_platform/schemas"
import {
  fileView,
  isPlatformError,
  lastConnections,
  listMembers,
  listNodeRules,
  loadNode,
  nodeLinks,
  previewContext,
  resolveReferencesForScreen,
  ROOT_PATH,
  tableGridRows,
  tableGridSummary,
  tableReviewQueue,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import {
  adresseDesReglages,
  AnnexesDuContexte,
  blocsAffiches,
  EcranDeNoeud,
  EcranDeTableauChargement,
  MESSAGES_DE_LA_VISIONNEUSE,
  MESSAGES_DU_TABLEAU,
  referencesRendues,
  reglagesDepuisLAdresse,
  resultatDe,
  TableauDuNoeud,
  titreDuContexte,
  type Reglages,
  type ReglagesLus,
  type TableauDuNoeudProps,
} from "@otomata_tech/oto_platform/ui"
import { lireLArbre, lireLesEquipes } from "@/lib/plateforme/lectures"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { loginPath } from "@/lib/schemas/auth"

// Les pages de l'arbre (E05-S02) : la page lit le nœud, l'arbre visible, les équipes, les membres et
// les règles du nœud avec le jeton de la session, en parallèle, chacun par `resultatDe` ; l'écran
// envoie ses écritures à `/api/platform/nodes` et demande la relecture au fournisseur du layout.
// E05-S10 (partie b) : les règles, les équipes et les membres vont au panneau « Partager » de l'écran
// (AC-b5) ; les liens du nœud (ses encarts, E11-S05, AC-e1), lus par `nodeLinks` dès le chemin connu, arrivent
// après la page, sous leur `<Suspense>` (M58). E05-S10 (partie c) : l'arbre et les équipes sont ceux que le
// layout a lus (`lectures.ts`, une fois par rendu).
// Les droits sont décidés par les services (H123) : la page ne décide rien, elle traduit un nœud
// introuvable en une seule phrase (H68). Un tableau (E07-S03) : ses réglages lus dans l'adresse, puis
// ses lignes, son résumé et sa file de revue, en parallèle, sous leur propre `<Suspense>` ; une page,
// une procédure ou un Contexte : ses blocs `reference` rendus en place, par `id` de bloc.
//
// E05-S04 : un Contexte reçoit ses annexes et ce que le modèle en recevra (`previewContext` sans phrase) ;
// E05-S11 : « Ma fiche » part vers Profil (AC-8) ; l'aperçu part avec les lectures d'E05-S02 quand le
// chemin est celui d'un Contexte. Une procédure s'affiche comme une page (D104, M59) : ni contrôle du
// brouillon ni « Tester une phrase », donc ni `checkProcedure` ni aperçu d'une phrase.
// E10-S02 (lot c, AC-c2) : `?view=<id>` ouvre la visionneuse d'un fichier joint au nœud, décidée par `fileView`.

const PREFIXE = "/n/"
const CONTEXTE = "contexte"
/** La vue « Contexte » (E11-S10, AC-e4) : l'encart d'un Contexte y mène, ligne par ligne (AC-11). */
const CONTEXTE_SERVI = "/context"
/** Une lecture impossible sans identité (panne de sa résolution) : l'écran la dit à chaque place. */
const ECHEC: { data?: never; error: string } = { error: "Une erreur est survenue. Réessayez." }
/**
 * Les chemins d'un Contexte (P39, `is_context_path`) : son aperçu se demande avant la lecture du nœud. Un ancien
 * chemin `perso/…` (alias, D107) le demande après, dans `complementsDuNoeud`.
 */
const CHEMIN_DE_CONTEXTE = /^(?:contexte|private\/[a-z0-9_]+\/contexte|[a-z0-9_]+\/contexte)$/

const hrefDuChemin = (chemin: string) => `${PREFIXE}${chemin}`

type Parametres = {
  params: Promise<{ chemin: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Le chemin de l'adresse validé (H51) ; mal formé (`Ventes`, `relance-devis`) : `null`, introuvable sans lecture (AC6). */
function cheminDe(segments: readonly string[]): string | null {
  const lu = nodePathSchema.safeParse(segments.join("/"))
  return lu.success ? lu.data : null
}

/** Inconnu ou invisible : `null`, la même phrase que mal formé (H68). */
function sauf404<T>(lecture: Promise<T>): Promise<T | null> {
  return lecture.catch((erreur: unknown) => {
    if (isPlatformError(erreur) && erreur.code === "not_found") return null
    throw erreur
  })
}

/** La lecture du nœud, une fois par requête : `generateMetadata` et la page la partagent (`cache`). */
const lireLeNoeud = cache(async (chemin: string) => {
  const identite = await getPlatformIdentitySafely("n/[...chemin]")
  if (!identite?.data) return ECHEC
  return resultatDe(sauf404(loadNode(identite.data.session.db, identite.data.identity, { path: chemin })))
})

/**
 * Le titre d'un Contexte, « Contexte · <section> » comme son `<h1>` (E05-S11, AC-17) ; le titre enregistré ne
 * change pas. Les équipes sont celles que le layout a lues (`lectures.ts`) ; illisibles, la section se dit par
 * le premier segment, comme à l'écran.
 */
async function titreDuContexteLu(chemin: string): Promise<string> {
  const identite = await getPlatformIdentitySafely("n/[...chemin] metadata")
  if (!identite?.data) return titreDuContexte(chemin, null, null)
  const { session, identity } = identite.data
  // Une panne se dit dans le rail et dans l'écran (la même lecture, `cache`) : le titre n'a qu'à s'en passer.
  const equipes = await lireLesEquipes(session.db, identity).catch(() => null)
  return titreDuContexte(chemin, equipes, identity.member.profile.handle ?? null)
}

export async function generateMetadata({ params }: Pick<Parametres, "params">): Promise<Metadata> {
  const chemin = cheminDe((await params).chemin)
  const noeud = chemin ? await lireLeNoeud(chemin) : null
  const vue = noeud?.data
  const titre = vue?.kind === "context" ? await titreDuContexteLu(vue.path) : (vue?.title ?? "Page")
  return { title: titre, robots: { index: false } }
}

type Lu = Awaited<ReturnType<typeof lire>>

/**
 * Les sujets qu'on peut ajouter dans « Partager » (AC-b5) : les équipes et les membres, ou l'échec de
 * l'une des deux lectures, dit par le panneau (jamais une liste partielle, portage § 4).
 */
function sujetsDe({ equipes, membres }: Pick<Lu, "equipes" | "membres">) {
  if (equipes.error !== undefined) return { error: equipes.error }
  if (membres.error !== undefined) return { error: membres.error }
  return {
    data: {
      equipes: equipes.data.map((equipe) => ({ id: equipe.id, nom: equipe.name })),
      personnes: membres.data.map((membre) => ({ id: membre.userId, nom: membre.name })),
    },
  }
}

/** L'aperçu d'un Contexte, sans phrase (E05-S04, AC12), demandé dès son chemin connu. */
function apercuDemande(db: PlatformDb, identity: Identity, chemin: string | null) {
  return chemin !== null && CHEMIN_DE_CONTEXTE.test(chemin) ? resultatDe(previewContext(db, identity, {})) : undefined
}

async function lire(db: PlatformDb, identity: Identity, chemin: string | null) {
  const [noeud, arbre, equipes, membres, regles, apercu] = await Promise.all([
    chemin ? lireLeNoeud(chemin) : { data: null },
    resultatDe(lireLArbre(db, identity)),
    resultatDe(lireLesEquipes(db, identity)),
    resultatDe(listMembers(db, identity)),
    chemin ? resultatDe(sauf404(listNodeRules(db, identity, chemin))) : undefined,
    apercuDemande(db, identity, chemin),
  ])
  // Un nœud lu par un ancien chemin (E03-S07) : ses règles se relisent sous son chemin courant.
  const courant = noeud.data?.path
  const reglesDuNoeud = courant && courant !== chemin ? await resultatDe(sauf404(listNodeRules(db, identity, courant))) : regles
  return { noeud, arbre, equipes, membres, regles: reglesDuNoeud, apercu }
}

type Complements = { db: PlatformDb; identity: Identity; vue: NodeView; lu: Lu; ici: string }

/**
 * Ce qu'un Contexte ajoute à l'écran (E05-S04) : ses annexes et l'aperçu sans phrase (AC12), dont chaque ligne
 * mène à la vue « Contexte » de l'accueil (E05-S11, AC-11) ; « Ma fiche » est partie vers Profil (AC-8). Une
 * procédure n'ajoute rien (D104). Les droits restent aux services (H123).
 */
async function complementsDuNoeud({ db, identity, vue, lu, ici }: Complements) {
  if (vue.kind !== "context") return {}
  const apercu = lu.apercu ?? (await resultatDe(previewContext(db, identity, {})))
  const annexes = (
    <AnnexesDuContexte
      cheminCourant={vue.path}
      handle={identity.member.profile.handle ?? null}
      apercu={apercu}
      // Les équipes de l'organisation ; en panne (dite dans l'arbre), celles de la personne, que l'aperçu sert.
      equipes={lu.equipes.error === undefined ? lu.equipes.data : identity.teams}
      hrefDuContexteServi={CONTEXTE_SERVI}
      ici={ici}
      Lien={Link}
    />
  )
  return { annexes }
}

type LecturesDuTableau = Pick<TableauDuNoeudProps, "lignes" | "resume" | "revue" | "assistant">

/**
 * L'assistant le plus récent de la personne (E11-S05, AC-h1, HN-E11S05-17), qui nomme qui écrira les lignes d'un
 * tableau vide : lu seulement quand le tableau n'a aucune ligne ; une lecture en échec se tait (« votre assistant »).
 */
async function assistantDuVide(db: PlatformDb, identity: Identity, lignes: LecturesDuTableau["lignes"]): Promise<string | undefined> {
  if (lignes.data?.count !== 0) return undefined
  const connexions = await resultatDe(lastConnections(db, identity))
  return connexions.data?.[0]?.family
}

/**
 * Les lignes, le résumé et la file de revue d'un tableau (E07-S03), en parallèle, chacun par `resultatDe`
 * aux phrases de l'écran d'un tableau (`too_large` : plus de lignes que la borne des filtres, N6) ; puis, sans
 * ligne, l'assistant de la personne (E11-S05).
 */
async function lireLeTableau(db: PlatformDb, identity: Identity, table: { path: string; entete: TableHeader; reglages: ReglagesLus }): Promise<LecturesDuTableau> {
  const { path, entete, reglages } = table
  const selection = { table: path, filter: reglages.filtre, q: reglages.q }
  const tri = reglages.tri ? { column: reglages.tri.colonne, direction: reglages.tri.sens } : null
  const [lignes, resume, revue] = await Promise.all([
    resultatDe(tableGridRows(db, identity, { ...selection, sort: tri, limit: reglages.n }), MESSAGES_DU_TABLEAU),
    resultatDe(tableGridSummary(db, identity, selection), MESSAGES_DU_TABLEAU),
    entete.lifecycle?.review ? resultatDe(tableReviewQueue(db, identity, { table: path }), MESSAGES_DU_TABLEAU) : undefined,
  ])
  return { lignes, resume, revue, assistant: await assistantDuVide(db, identity, lignes) }
}

/** Le tableau lu, sous son propre `<Suspense>` : l'en-tête du nœud paraît sans attendre ses lignes (AC9). */
function TableauLu({ lecture, ...props }: Omit<TableauDuNoeudProps, keyof LecturesDuTableau> & { lecture: Promise<LecturesDuTableau> }) {
  return <TableauDuNoeud {...props} {...use(lecture)} />
}

/**
 * Le complément d'un tableau (E07-S03) : ses réglages lus dans l'adresse contre son en-tête publié ; les
 * champs d'un formulaire « Filtrer » sont réécrits en `f` par une redirection. Jamais publié : ni
 * colonne ni ligne, la méta le dit.
 */
function complementDuTableau(db: PlatformDb, identity: Identity, vue: NodeView, parametres: Record<string, string | string[] | undefined>): ReactNode {
  const entete = tableHeaderSchema.safeParse(vue.meta)
  if (!entete.success) return undefined
  const reglages = reglagesDepuisLAdresse(parametres, entete.data)
  const hrefDuTableau = (suite: Reglages) => {
    const recherche = adresseDesReglages(suite)
    return `${hrefDuChemin(vue.path)}${recherche ? `?${recherche}` : ""}`
  }
  if (reglages.aReecrire) redirect(hrefDuTableau(reglages))
  const lecture = lireLeTableau(db, identity, { path: vue.path, entete: entete.data, reglages })
  return (
    <Suspense fallback={<EcranDeTableauChargement />}>
      <TableauLu
        lecture={lecture}
        chemin={vue.path}
        titre={vue.title}
        entete={entete.data}
        reglages={reglages}
        niveau={vue.level}
        Lien={Link}
        hrefDuTableau={hrefDuTableau}
        adresse={hrefDuChemin(vue.path)}
        prefixeDesPages={PREFIXE}
      />
    </Suspense>
  )
}

/** Les blocs `reference` des blocs montrés, rendus en place (E07-S03) ; sans bloc `reference`, aucune lecture. */
async function referencesDuNoeud(db: PlatformDb, identity: Identity, vue: NodeView, versionPubliee: boolean) {
  const blocs = blocsAffiches(vue, versionPubliee)
  if (!blocs.some((bloc) => bloc.type === "reference")) return undefined
  const resolutions = await resultatDe(resolveReferencesForScreen(db, identity, blocs))
  return referencesRendues({ resolutions, blocs, Lien: Link, hrefDuChemin })
}

export default async function NoeudPage({ params, searchParams }: Parametres) {
  const segments = (await params).chemin
  // Depuis P39, la racine est technique : les pages de Tout le monde commencent à son Contexte.
  if (segments.join("/") === ROOT_PATH) redirect(hrefDuChemin(CONTEXTE))
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("n/[...chemin]")
  if (identite?.error?.code === "unauthenticated") redirect(loginPath(hrefDuChemin(segments.join("/"))))
  if (identite?.error) redirect("/no-organization")

  const chemin = cheminDe(segments)
  const parametres = await searchParams
  const versionPubliee = nodeVersionParamSchema.parse(parametres.version) === "published"
  const commun = { chemin: chemin ?? segments.join("/"), versionPubliee, Lien: Link, hrefDuChemin, prefixeDesPages: PREFIXE }
  if (!identite) return <EcranDeNoeud {...commun} nomOrganisation="l'organisation" handle={null} noeud={ECHEC} arbre={ECHEC} equipes={ECHEC} />

  const { identity, session } = identite.data
  // Les liens du nœud (M58), lus dès le chemin connu, en parallèle des lectures de la page (E05-S10, partie c) ;
  // non attendus ici : l'écran les attend sous son `<Suspense>`, la page part sans eux. Un ancien chemin mène
  // aux liens du nœud courant (`findNode`), comme sa lecture. Introuvable : rien au log (`sauf404`), l'écran ne
  // montre alors pas ces liens.
  const liensLus = chemin ? resultatDe(sauf404(nodeLinks(session.db, identity, { path: chemin })).then((lus) => lus ?? {})) : undefined
  const lu = await lire(session.db, identity, chemin)
  const ici = `${hrefDuChemin(commun.chemin)}${versionPubliee ? "?version=published" : ""}`
  const partage = lu.regles && lu.noeud.data ? { regles: lu.regles, sujets: sujetsDe(lu), gestionAccordable: identity.member.role === "admin", moi: identity.user.id } : undefined
  const vue = lu.noeud.data ?? null
  // La visionneuse d'un fichier joint (E10-S02, AC-c2) : le service décide ; un tableau n'a pas de fichier à voir.
  const vu = fileViewParamSchema.parse(parametres.view)
  if (vue && vu !== undefined && vue.kind !== "table") {
    const resultat = await resultatDe(sauf404(fileView(session.db, identity, { node: vue.id, file: vu })), MESSAGES_DE_LA_VISIONNEUSE)
    const handle = identity.member.profile.handle ?? null
    return <EcranDeNoeud {...commun} nomOrganisation={identity.org.name} handle={handle} noeud={lu.noeud} arbre={lu.arbre} equipes={lu.equipes} fichierVu={{ id: vu, resultat }} />
  }
  const liens = vue ? liensLus : undefined
  const complement = vue?.kind === "table" ? complementDuTableau(session.db, identity, vue, parametres) : undefined
  // Les blocs `reference` (E07-S03) et ce qu'un Contexte ajoute (E05-S04), en parallèle.
  const [references, complements] = await Promise.all([
    vue && vue.kind !== "table" ? referencesDuNoeud(session.db, identity, vue, versionPubliee) : undefined,
    vue ? complementsDuNoeud({ db: session.db, identity, vue, lu, ici }) : {},
  ])
  return (
    <EcranDeNoeud
      {...commun}
      nomOrganisation={identity.org.name}
      handle={identity.member.profile.handle ?? null}
      noeud={lu.noeud}
      arbre={lu.arbre}
      equipes={lu.equipes}
      partage={partage}
      liens={liens}
      complement={complement}
      referencesRendues={references}
      // Un tableau ne devient ni procédure ni Contexte (E03-S03) : son complément et ceux-ci ne se recouvrent pas.
      {...complements}
    />
  )
}
