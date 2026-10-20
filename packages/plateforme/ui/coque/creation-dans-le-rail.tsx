"use client"

// Porté d'oto-frontend (src/components/coque/creation-dans-le-rail.tsx et page-privee-dans-le-rail.tsx) :
// le « + » du rail, un seul menu pour tous les « + », la destination portée par le geste (« Dans … »),
// aucun optimiste — on attend la réponse, puis on ouvre la page créée ; l'échec se dit sans rien
// déplacer. Changé : l'API du paquet (`POST /api/platform/nodes`, le service de `write`) ; le menu
// propose page, tableau et procédure (AC-a4), partout, Privé comprise (E05-S11, AC-34), chacun à son glyphe
// du rail (`GLYPHES`, AC-35).
// E05-S10 (partie b, AC-b3) : plus de dialogue, comme oto-frontend — le nœud naît tout de suite, « Sans
// titre », avec le résumé par défaut de son genre (E05-S11, AC-e21) et, pour un tableau, une colonne clé ; son adresse est la première
// libre parmi `sans_titre`, `sans_titre_2`… (HN-E05S10b-3) ; sa page s'ouvre, où le titre s'écrit en place.
// Partie b2 : la page ouverte est celle de l'adresse que le service rend (il en choisit une autre quand un
// « Sans titre » de la corbeille tient celle demandée) ; le nœud créé paraît aussitôt dans le rail, avant la
// relecture de l'arbre (AC-c2), qui le remplace.
// E10-S01 (AC-a3, AC-b1) : « Importer un fichier… » ouvre le dialogue d'import sous l'endroit du « + » ; un fichier
// lâché sur une ligne l'ouvre aussi (`deposer`) ; les adresses d'un fichier importé suivent la même règle, sur le
// segment tiré de son nom. La page importée s'ouvre, avec l'encart des éléments gardés en texte (AC-a2), annoncé par
// la région de statut du rail et retiré quand la personne ouvre une autre adresse.
// Retiré : poignées `doc_id`, projection du rail, messages propres au serveur d'Oto.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple"
import { nodePathSchema, type TreeNode } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { RACINE } from "../arbre/depuis-l-arbre"
import { AnimatedIcon, type Glyphe } from "../ds/react/icon"
import type { MenuItem } from "../ds/react/overlays"
import { Alert } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { useRafraichir } from "../hote/rafraichir"
import { GLYPHES } from "./arbre-du-rail"
import { ImportDeFichier, type ImportFait } from "./import-de-fichier"
import { aplatir } from "./freres"
import { CREATION, IMPORT } from "./libelles"
import { useAdresseCourante } from "./noeud-ouvert"

type Genre = "page" | "table" | "procedure"

/**
 * Où le « + » cliqué range ce qu'il crée : le nom de l'endroit, et le chemin du parent (`""` : la racine de l'arbre).
 * `sousUneProcedure` : le parent est une procédure, sous laquelle ne se rangent que des pages et des tableaux (ses
 * sous-étapes, qu'elle cite) ; une procédure rangée là serait routée à sa place.
 */
export type CibleDeCreation = { nom: string; parent: string; sousUneProcedure?: boolean }

type Demande = CibleDeCreation & { genre: Genre }

/** Le segment d'un nœud neuf ; pris, `sans_titre_2`, `sans_titre_3`… */
const SEGMENT = "sans_titre"
/** Les adresses essayées par création : les chemins visibles sont écartés d'avance, un autre refus en coûte une. */
const ESSAIS = 5
/** Les rangs parcourus pour trouver des adresses que l'arbre visible ne montre pas. */
const RANGS = 200

const cheminDe = (parent: string, segment: string) => (parent ? `${parent}/${segment}` : segment)

/** Les adresses à essayer sous un parent, hors des chemins visibles (`pris`), dans l'ordre : `<segment>`, `<segment>_2`… ; lues aussi par la conversion d'un tableau simple. */
export function adressesAEssayer(parent: string, pris: ReadonlySet<string>, segment = SEGMENT): string[] {
  const chemins = Array.from({ length: RANGS }, (_vide, rang) => cheminDe(parent, rang === 0 ? segment : `${segment}_${rang + 1}`))
  return chemins.filter((chemin) => !pris.has(chemin)).slice(0, ESSAIS)
}

/** Le corps de la création : titre et résumé par défaut de son genre ; un tableau reçoit sa colonne clé, en texte. */
function corpsDe(path: string, genre: Genre) {
  const tableau = genre === "table" ? { header: { columns: [{ name: CREATION.cle, type: "text" }], key: CREATION.cle } } : {}
  return { path, title: CREATION.sansTitre, summary: CREATION.resumeParDefaut[genre], kind: genre, ...tableau }
}

/**
 * Un refus qui dit « cette adresse est prise » : un nœud invisible ou un ancien chemin (`conflict`), un nœud
 * existant que la requête modifierait sans révision (`stale_revision`, rien n'est écrit) ; l'adresse suivante
 * s'essaie.
 */
const adressePrise = (code: string) => code === "conflict" || code === "stale_revision"

async function creerLeNoeud({ parent, genre }: Demande, pris: ReadonlySet<string>): Promise<{ chemin: string } | { erreur: string }> {
  for (const chemin of adressesAEssayer(parent, pris)) {
    if (!nodePathSchema.safeParse(chemin).success) return { erreur: CREATION.tropProfond }
    const reponse = await appelerPlateforme<{ path: string }>({ methode: "POST", ressource: "nodes", corps: corpsDe(chemin, genre) })
    if (!reponse.erreur) return { chemin: reponse.data.path }
    if (!adressePrise(reponse.erreur.code)) return { erreur: messageDErreur(reponse.erreur) }
  }
  return { erreur: CREATION.aucuneAdresse }
}

/** Ce que dit une création : « Création… » ou les éléments d'un import gardés en texte à l'annonceur, puis le refus, en alerte, sous les sections. */
function RetourDeCreation({ annonce, erreur }: { annonce: string; erreur: string | null }) {
  return (
    <>
      <p role="status" className="oto-sr-only">
        {annonce}
      </p>
      {erreur && <Alert tone="fail">{erreur}</Alert>}
    </>
  )
}

export type MenuDeCreation = {
  /** Les items d'un « + » d'espace ou de ligne : une page, un tableau, une procédure. */
  itemsPour: (cible: CibleDeCreation) => MenuItem[]
  /** À rendre une fois : l'annonce de la création en cours, puis son refus ; le dialogue d'import et son encart. */
  retour: ReactNode
  /** Un fichier lâché sur une ligne (E10-S01) : le dialogue d'import s'ouvre sous elle, le fichier lu. */
  deposer: (cible: CibleDeCreation, fichier: File) => void
}

/** Les ancêtres d'un chemin, du plus proche à la racine : `a/b/c` → `a/b`, `a`, `guide`. */
function ancetresDe(chemin: string): string[] {
  const segments = chemin.split("/")
  return [...segments.slice(0, -1).map((_segment, rang) => segments.slice(0, segments.length - 1 - rang).join("/")), RACINE]
}

/** L'arbre avec un nœud créé, dernier enfant de son plus proche ancêtre visible (au premier niveau sans lui). */
function avecLeNoeudCree(arbre: readonly TreeNode[], noeud: TreeNode): TreeNode[] {
  const chemins = new Set(aplatir(arbre).map((lu) => lu.path))
  if (chemins.has(noeud.path)) return [...arbre]
  const parent = ancetresDe(noeud.path).find((chemin) => chemins.has(chemin))
  if (parent === undefined) return [...arbre, noeud]
  const inserer = (noeuds: readonly TreeNode[]): TreeNode[] =>
    noeuds.map((lu) => (lu.path === parent ? { ...lu, children: [...lu.children, noeud] } : { ...lu, children: inserer(lu.children) }))
  return inserer(arbre)
}

const AUCUN: readonly TreeNode[] = []

/**
 * L'arbre montré par le rail (AC-c2) : l'arbre servi, et les nœuds que le rail vient de créer jusqu'à la relecture
 * suivante de l'arbre, qui les porte. `ajouter` : un nœud créé, tiré de la réponse du service.
 */
export function useArbreAvecLesCreations(arbre: TreeNode[]): { montre: TreeNode[]; ajouter: (noeud: TreeNode) => void } {
  const [crees, setCrees] = useState<{ pour: TreeNode[]; noeuds: readonly TreeNode[] }>({ pour: arbre, noeuds: AUCUN })
  const lus = crees.pour === arbre ? crees.noeuds : AUCUN
  const montre = useMemo(() => lus.reduce<TreeNode[]>(avecLeNoeudCree, arbre), [arbre, lus])
  const ajouter = useCallback(
    (noeud: TreeNode) => setCrees((avant) => ({ pour: arbre, noeuds: [...(avant.pour === arbre ? avant.noeuds : AUCUN), noeud] })),
    [arbre],
  )
  return { montre, ajouter }
}

/**
 * Le menu de création, partagé par tous les « + » du rail : c'est la demande qui porte l'endroit, pas le
 * bouton. `pris` : les chemins de l'arbre visible, qu'aucune création n'essaie ; `montrer` : le nœud créé,
 * dans le rail avant la relecture (AC-c2).
 */
export function useMenuDeCreation(prefixe: string, pris: ReadonlySet<string>, montrer: (noeud: TreeNode) => void): MenuDeCreation {
  const { naviguer } = useHote()
  const rafraichir = useRafraichir()
  const [etat, setEtat] = useState<{ enCours: boolean; erreur: string | null }>({ enCours: false, erreur: null })
  const [importation, setImportation] = useState<{ cible: CibleDeCreation; fichier: File | null } | null>(null)
  // Les éléments gardés en texte d'un `.md` importé, dits tant que sa page est l'adresse ouverte. `vue` : l'adresse
  // ouverte au dernier rendu ; quand elle change pour une autre que la page, l'état part (un retour arrière ne le
  // réaffiche pas).
  const [conserves, setConserves] = useState<{ adresse: string; nombre: number; vue: string } | null>(null)
  const courante = useAdresseCourante(prefixe)
  if (conserves !== null && conserves.vue !== courante) setConserves(courante === conserves.adresse ? { ...conserves, vue: courante } : null)
  const nombreConserve = conserves !== null && conserves.adresse === courante ? conserves.nombre : 0
  // Un second choix pendant l'envoi ne crée pas un second nœud.
  const envoi = useRef(false)

  async function creer(demande: Demande) {
    if (envoi.current) return
    envoi.current = true
    setEtat({ enCours: true, erreur: null })
    const issue = await creerLeNoeud(demande, pris)
    envoi.current = false
    if ("erreur" in issue) {
      setEtat({ enCours: false, erreur: issue.erreur })
      return
    }
    setEtat({ enCours: false, erreur: null })
    // Créé publié (`POST nodes` sans `publish` : écrire publie, E11-S02, AC-c1).
    montrer({ path: issue.chemin, title: CREATION.sansTitre, kind: demande.genre, status: "published", children: [] })
    naviguer(`${prefixe}${issue.chemin}`)
    rafraichir()
  }

  function importer(cible: CibleDeCreation, fichier: File | null) {
    setConserves(null)
    setImportation({ cible, fichier })
  }

  function importe(fait: ImportFait) {
    setImportation(null)
    const adresse = `${prefixe}${fait.chemin}`
    setConserves(fait.conserves > 0 ? { adresse, nombre: fait.conserves, vue: courante } : null)
    naviguer(adresse)
    rafraichir()
  }

  const item = (label: string, glyphe: Glyphe, suite: Demande): MenuItem => ({
    label,
    icon: <AnimatedIcon as={glyphe} size="xs" />,
    onSelect: () => void creer(suite),
  })
  return {
    itemsPour: (cible) => [
      item(CREATION.page, GLYPHES.page, { ...cible, genre: "page" }),
      item(CREATION.tableau, GLYPHES.tableau, { ...cible, genre: "table" }),
      ...(cible.sousUneProcedure ? [] : [item(CREATION.procedure, GLYPHES.procedure, { ...cible, genre: "procedure" })]),
      { separator: true },
      { label: IMPORT.entree, icon: <AnimatedIcon as={UploadSimple} size="xs" />, onSelect: () => importer(cible, null) },
    ],
    retour: (
      <>
        <RetourDeCreation annonce={etat.enCours ? CREATION.enCours : nombreConserve > 0 ? IMPORT.conserves(nombreConserve) : ""} erreur={etat.erreur} />
        {/* L'encart se voit, l'annonceur le dit : `note`, pas une seconde région de statut montée pleine. */}
        {nombreConserve > 0 && (
          <Alert tone="review" role="note">
            {IMPORT.conserves(nombreConserve)}
          </Alert>
        )}
        {importation && (
          <ImportDeFichier
            cible={{ genre: "sous", parent: importation.cible.parent, nom: importation.cible.nom, adresses: (segment) => adressesAEssayer(importation.cible.parent, pris, segment) }}
            fichier={importation.fichier}
            fermer={() => setImportation(null)}
            termine={importe}
          />
        )}
      </>
    ),
    deposer: (cible, fichier) => importer(cible, fichier),
  }
}
