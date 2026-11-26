"use client"

// Le partage choisi dans la fiche d'un outil connecté chez le tiers (consentement, compte rattaché) : le compte ne naît
// qu'au retour, la fiche garde donc le partage dans l'onglet (`sessionStorage`) le temps de l'aller-retour, avec les
// connecteurs que la personne avait déjà de cet outil. Au retour réussi, l'écran retient le seul connecteur de cet outil
// absent de cette liste (jamais par l'adresse, qu'un lien forgé écrirait, ni par la date de sa connexion, qu'un
// renouvellement de jeton remet à jour) et y pose chaque règle (`POST admin/account-rules`). Le partage gardé s'efface sur
// tout retour, réussi ou non, et sur l'échec du départ. Aucun connecteur nouveau, ou plusieurs, ou un refus : l'écran le
// dit et mène au partage. Le stockage peut être bloqué : chaque lecture et écriture est gardée.
import { useEffect, useRef, useState } from "react"
import { Alert } from "../../ds/react/primitives"
import { useHote } from "../../hote/navigation"
import { useRafraichir } from "../../hote/rafraichir"
import { adresseDeLaVue } from "./lignes-des-connecteurs"
import { poserLePartage, type PartageDeLAjout } from "./partage-a-l-ajout"

const CLE = "oto-connecteurs:partage-au-retour"

/** Au-delà, un partage gardé est oublié : il ne se pose jamais sur un connecteur ajouté bien plus tard. */
const DUREE_MAX_MS = 30 * 60 * 1000

/** Ce que l'onglet garde : l'outil, son nom, le partage, l'heure du départ et les connecteurs déjà à soi de l'outil. */
type Garde = { connecteur: string; outil: string; partage: PartageDeLAjout; at: number; avant: string[] }

/** Garde le partage choisi le temps de la connexion chez le tiers ; `false` : l'onglet ne garde rien (stockage bloqué). */
export function garderLePartage(garde: Omit<Garde, "at">): boolean {
  try {
    window.sessionStorage.setItem(CLE, JSON.stringify({ ...garde, at: Date.now() } satisfies Garde))
    return true
  } catch {
    return false
  }
}

/** Oublie le partage gardé : le départ chez le tiers a échoué. */
export function oublierLePartage(): void {
  try {
    window.sessionStorage.removeItem(CLE)
  } catch {
    // Un stockage bloqué n'a rien gardé.
  }
}

/** L'onglet peut garder un partage : sinon la fiche le dit avant de partir. */
export function stockageDisponible(): boolean {
  try {
    window.sessionStorage.setItem(`${CLE}:essai`, "1")
    window.sessionStorage.removeItem(`${CLE}:essai`)
    return true
  } catch {
    return false
  }
}

const estUnPartage = (valeur: unknown): valeur is PartageDeLAjout =>
  typeof valeur === "object" && valeur !== null && "regles" in valeur && Array.isArray(valeur.regles) && "general" in valeur

/** Le partage gardé, s'il y en a un et qu'il est récent ; il est effacé dans tous les cas. */
function reprendreLePartage(): Garde | null {
  try {
    const texte = window.sessionStorage.getItem(CLE)
    window.sessionStorage.removeItem(CLE)
    if (!texte) return null
    const lu: unknown = JSON.parse(texte)
    if (typeof lu !== "object" || lu === null || !("connecteur" in lu) || !("outil" in lu) || !("at" in lu) || !("partage" in lu) || !("avant" in lu)) return null
    const { connecteur, outil, at, partage, avant } = lu
    if (typeof connecteur !== "string" || typeof outil !== "string" || typeof at !== "number" || !estUnPartage(partage) || Date.now() - at > DUREE_MAX_MS) return null
    if (!Array.isArray(avant) || !avant.every((id) => typeof id === "string")) return null
    return { connecteur, outil, at, partage, avant }
  } catch {
    return null
  }
}

/** Un connecteur personnel de la personne et son outil. */
export type ConnecteurAMoi = { id: string; connector: string }

/** Le connecteur du retour : le seul de l'outil gardé qui n'était pas à la personne au départ ; aucun sinon. */
function connecteurDuRetour(miens: readonly ConnecteurAMoi[], garde: Garde): ConnecteurAMoi | null {
  const nouveaux = miens.filter(({ id, connector }) => connector === garde.connecteur && !garde.avant.includes(id))
  return nouveaux.length === 1 ? nouveaux[0] : null
}

type PartageAuRetourProps = {
  /** L'issue du retour : réussi, le partage se pose ; échoué, il s'efface seulement. */
  issue: "connected" | "failed"
  /** Les connecteurs personnels de la personne, où chercher celui que le consentement vient de créer. */
  miens: ConnecteurAMoi[]
  /** L'adresse de l'écran : le détail d'un connecteur s'y ouvre, son partage ouvert. */
  ici: string
}

type Issue = "rien" | "pose" | "a_faire"

export function PartageAuRetour({ issue: retour, miens, ici }: PartageAuRetourProps) {
  const rafraichir = useRafraichir()
  const { Lien } = useHote()
  const [issue, setIssue] = useState<Issue>("rien")
  const [compte, setCompte] = useState<string | null>(null)
  const [outil, setOutil] = useState("")
  const fait = useRef(false)
  useEffect(() => {
    // Une seule fois par retour, même si React rejoue l'effet.
    if (fait.current) return
    fait.current = true
    const garde = reprendreLePartage()
    if (!garde || retour !== "connected") return
    setOutil(garde.outil)
    const cree = connecteurDuRetour(miens, garde)
    if (!cree) return setIssue("a_faire")
    setCompte(cree.id)
    void poserLePartage(cree.id, garde.partage).then((echecs) => {
      setIssue(echecs.length > 0 ? "a_faire" : "pose")
      rafraichir()
    })
  }, [retour, miens, rafraichir])
  if (issue === "pose") return <Alert tone="ok" title="Partagé comme vous l'aviez choisi." />
  if (issue === "rien") return null
  return (
    <Alert
      tone="review"
      title={compte ? "Le partage choisi avant la connexion n'a pas pu être posé." : `Le partage choisi avant la connexion n'a pas pu être posé. Ouvrez votre connecteur ${outil} et partagez-le.`}
      actions={
        <Lien
          href={compte ? adresseDeLaVue(ici, { filtre: "all", q: "", compte, partager: true }) : adresseDeLaVue(ici, { filtre: "mine", q: "", compte: null })}
          className="oto-btn anim-host"
          data-variant="secondary"
          data-size="sm"
        >
          <span>{compte ? "Partagez-le maintenant" : "Vos connecteurs"}</span>
        </Lien>
      }
    />
  )
}
