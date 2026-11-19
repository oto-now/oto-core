"use client"

// « Dupliquer » et « Supprimer » du « ⋯ » d'une ligne du rail (E05-S10, partie b2, AC-b8, AC-b10, AC-b11),
// où ils remplacent « Renommer » (le titre s'écrit dans la page, AC-a1). « Dupliquer » envoie
// `POST /api/platform/nodes/duplicate` : la copie, « <titre> (copie) » juste sous l'original, s'ouvre et
// reste sélectionnée dans le rail. « Supprimer » demande d'abord, par un `ConfirmDialog`, en disant combien
// de sous-contenus partent avec (l'arbre visible les compte : le service refuse un sous-arbre qui porte un
// contenu que la personne ne voit pas, HN-E05S10e-3), puis envoie `POST trash` ; la page ouverte partie avec
// lui, son parent s'ouvre ; le focus va à la ligne qui la précède. Droits décidés par le service, refus dit
// dans le rail. Écrit dans le style du menu d'oto-frontend, qui avait retiré ces gestes faute de service.
// E10-S01 (AC-a5, AC-b6) : « Télécharger en .md » d'une page, d'une procédure ou d'un Contexte, « Télécharger en
// .csv » d'un tableau, par `GET nodes/export` et `GET tables/export` ; le fichier rendu part au navigateur.
// 1.8.0 : avant la question de « Supprimer », `GET trash/impact` dit qui perd l'accès (un contenu partagé hors de son
// équipe) ; une lecture refusée ou en panne laisse la question d'avant, le service contrôlant la suppression.
import { useEffect, useState, type ReactNode } from "react"
import { Copy } from "@phosphor-icons/react/dist/csr/Copy"
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { nodePathBodySchema, type NodeKind, type TrashImpact } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { telechargerLExport } from "../api/telecharger"
import { RACINE } from "../arbre/depuis-l-arbre"
import { ConfirmDialog } from "../ds/react/confirm-dialog"
import { AnimatedIcon } from "../ds/react/icon"
import type { MenuItem } from "../ds/react/overlays"
import { Alert } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { useRafraichir } from "../hote/rafraichir"
import { parentDe } from "./freres"
import { EXPORTS, GESTES_DU_RAIL } from "./libelles"
import { useAdresseCourante } from "./noeud-ouvert"

/** Une ligne du rail ; `genre` choisit son export (E10-S01). */
type Cible = { chemin: string; nom: string; genre?: NodeKind }

/** La suppression demandée : la ligne, et qui perd l'accès quand le service a pu le dire. */
type Suppression = Cible & { partage: TrashImpact["shared"] | null }

/**
 * « Support, Ventes et 2 personnes n'y auront plus accès. » : les équipes par leur nom, toute l'organisation, puis les
 * personnes, comptées ; liste à la française, verbe au pluriel dès deux sujets ou plus d'une personne ; `null` sans partage.
 */
export function phraseDuPartage({ teams, people, org }: TrashImpact["shared"]): string | null {
  const sujets = [...teams.map((equipe) => equipe.name), ...(org ? [GESTES_DU_RAIL.touteLOrganisation] : []), ...(people > 0 ? [GESTES_DU_RAIL.personnes(people)] : [])]
  if (sujets.length === 0) return null
  const liste = sujets.length === 1 ? sujets[0] : `${sujets.slice(0, -1).join(", ")} et ${sujets.at(-1)}`
  const phrase = sujets.length > 1 || (teams.length === 0 && !org && people > 1) ? GESTES_DU_RAIL.perdentLAcces(liste) : GESTES_DU_RAIL.perdLAcces(liste)
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
}

/** Qui perd l'accès si ce contenu part, lu avant la question ; `null` quand la lecture est refusée ou en panne. */
async function lireLePartage(chemin: string): Promise<TrashImpact["shared"] | null> {
  const requete = nodePathBodySchema.safeParse({ path: chemin })
  if (!requete.success) return null
  const reponse = await appelerPlateforme<TrashImpact>({ methode: "GET", ressource: `trash/impact?${new URLSearchParams(requete.data)}` })
  return reponse.erreur ? null : reponse.data.shared
}

/** Les refus qui ont leur phrase : les droits de chaque geste (HN-E05S10e-3, HN-E05S10e-6), et la course de « Supprimer » (HN-E05S10e-24). */
const REFUS = {
  dupliquer: { forbidden: "Dupliquer ce contenu vous est refusé : il faut le lire et pouvoir écrire sous son parent." },
  supprimer: {
    forbidden: "Supprimer ce contenu vous est refusé : il faut sa gestion, et voir tout ce qui est dessous.",
    conflict: "Un contenu vient d'être rangé dessous : rien n'est parti. Réessayez.",
  },
} as const

/** Le pli d'un envoi : le corps `{ path }` validé par le schéma de l'API, puis la réponse. */
async function envoyerLeGeste<T>(ressource: string, chemin: string) {
  const corps = nodePathBodySchema.safeParse({ path: chemin })
  if (!corps.success) return { erreur: { code: "invalid_arguments", statut: 400 } } as const
  return appelerPlateforme<T>({ methode: "POST", ressource, corps: corps.data })
}

/** La ligne de l'arbre du rail d'un chemin, par son lien : celle qui reçoit le focus quand la ligne supprimée part. */
export function ligneDuRail(prefixe: string, chemin: string): HTMLElement | undefined {
  const adresse = `${prefixe}${chemin}`
  return [...document.querySelectorAll<HTMLElement>(".oto-rail-tree a[href]")].find((lien) => lien.getAttribute("href") === adresse)
}

export type GestesDuRail = {
  /** Les items du « ⋯ » d'une ligne qui se déplace : « Dupliquer », le téléchargement, puis « Supprimer ». */
  itemsPour: (cible: Cible) => MenuItem[]
  /** Le téléchargement seul, pour une ligne qui ne se déplace pas (un Contexte, E10-S01). */
  exportPour: (cible: Cible) => MenuItem[]
  /** À rendre une fois : la confirmation de la suppression, l'annonce et le refus. */
  retour: ReactNode
}

type Lecture = {
  prefixe: string
  /** Les sous-contenus visibles d'un nœud, qui partent avec lui. */
  sousContenus: (chemin: string) => number
  /** La ligne qui précède un nœud à l'écran (son frère d'avant, sinon son parent), où va le focus quand il part. */
  precedente: (chemin: string) => string | null
}

export function useGestesDuRail({ prefixe, sousContenus, precedente }: Lecture): GestesDuRail {
  const { naviguer } = useHote()
  // L'adresse de la page ouverte, un ancien chemin reconnu (AC-b12) : supprimée, elle ne reste pas ouverte.
  const adresse = useAdresseCourante(prefixe)
  const rafraichir = useRafraichir()
  const [aSupprimer, setASupprimer] = useState<Suppression | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [annonce, setAnnonce] = useState("")
  const [focusVers, setFocusVers] = useState<string | null>(null)

  // Après la fermeture du dialogue, qui rend d'abord le focus à son déclencheur, parti avec la ligne.
  useEffect(() => {
    if (focusVers === null) return
    ligneDuRail(prefixe, focusVers)?.focus()
    setFocusVers(null)
  }, [focusVers, prefixe])

  function commencer(libelle: string) {
    setRefus(null)
    setAnnonce("")
    setEnCours(libelle)
  }

  async function dupliquer(cible: Cible) {
    commencer(GESTES_DU_RAIL.duplicationEnCours)
    const reponse = await envoyerLeGeste<{ path: string }>("nodes/duplicate", cible.chemin)
    setEnCours(null)
    if (reponse.erreur) {
      setRefus(messageDErreur(reponse.erreur, REFUS.dupliquer))
      if (reponse.erreur.code === "not_found") rafraichir()
      return
    }
    naviguer(`${prefixe}${reponse.data.path}`)
    rafraichir()
  }

  /** La question de « Supprimer », après la lecture de qui perd l'accès. */
  async function demanderLaSuppression(cible: Cible) {
    commencer(GESTES_DU_RAIL.lectureDuPartage)
    const partage = await lireLePartage(cible.chemin)
    setEnCours(null)
    setASupprimer({ ...cible, partage })
  }

  async function supprimer(cible: Cible) {
    commencer(GESTES_DU_RAIL.suppressionEnCours)
    const reponse = await envoyerLeGeste<{ path: string; count: number }>("trash", cible.chemin)
    setEnCours(null)
    setASupprimer(null)
    if (reponse.erreur) {
      setRefus(messageDErreur(reponse.erreur, REFUS.supprimer))
      if (reponse.erreur.code === "not_found") rafraichir()
      return
    }
    setAnnonce(GESTES_DU_RAIL.supprime(cible.nom))
    setFocusVers(precedente(cible.chemin))
    // La page ouverte est partie avec lui : son parent s'ouvre (la racine ouvre le Contexte de l'organisation).
    const ouverte = adresse.startsWith(prefixe) ? adresse.slice(prefixe.length) : null
    if (ouverte === cible.chemin || ouverte?.startsWith(`${cible.chemin}/`)) naviguer(`${prefixe}${parentDe(cible.chemin) || RACINE}`)
    rafraichir()
  }

  async function exporter(cible: Cible) {
    commencer(EXPORTS.enCours)
    const issue = await telechargerLExport(cible.chemin, cible.genre === "table" ? "csv" : "md")
    setEnCours(null)
    if (issue.erreur) return setRefus(messageDErreur(issue.erreur, EXPORTS.refus))
    setAnnonce(EXPORTS.pret(issue.fichier.filename))
  }

  const exportPour = (cible: Cible): MenuItem[] => [
    { label: cible.genre === "table" ? EXPORTS.csv : EXPORTS.markdown, icon: <AnimatedIcon as={DownloadSimple} size="xs" />, onSelect: () => void exporter(cible) },
  ]

  const nombre = aSupprimer ? sousContenus(aSupprimer.chemin) : 0
  const perdent = aSupprimer?.partage ? phraseDuPartage(aSupprimer.partage) : null
  const retour = (
    <>
      {/* Montée vide : l'envoi, puis la suppression faite, s'annoncent. */}
      <p role="status" className="oto-sr-only">
        {enCours ?? annonce}
      </p>
      {refus && <Alert tone="fail">{refus}</Alert>}
      {aSupprimer && (
        <ConfirmDialog
          open
          title={GESTES_DU_RAIL.confirmerLaSuppression(aSupprimer.nom)}
          confirmLabel={GESTES_DU_RAIL.supprimer}
          onConfirm={() => void supprimer(aSupprimer)}
          onCancel={() => setASupprimer(null)}
          busy={enCours !== null}
        >
          <p>{GESTES_DU_RAIL.corbeille}</p>
          {nombre > 0 && <p>{GESTES_DU_RAIL.partentAvec(nombre)}</p>}
          {perdent && <p>{perdent}</p>}
        </ConfirmDialog>
      )}
    </>
  )

  return {
    itemsPour: (cible) => [
      { label: GESTES_DU_RAIL.dupliquer, icon: <AnimatedIcon as={Copy} size="xs" />, onSelect: () => void dupliquer(cible) },
      ...exportPour(cible),
      { separator: true },
      { label: GESTES_DU_RAIL.supprimer, icon: <AnimatedIcon as={Trash} size="xs" />, destructive: true, onSelect: () => void demanderLaSuppression(cible) },
    ],
    exportPour,
    retour,
  }
}
