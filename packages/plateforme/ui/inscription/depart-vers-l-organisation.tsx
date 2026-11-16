"use client"

// L'attente après la création d'une organisation (E12-S01) : son adresse est neuve, et un sous-domaine attend son
// certificat une à deux minutes ; y partir aussitôt mène à une erreur du navigateur. L'écran dit ce qui est fait et ce
// qui reste (trois étapes), avance une barre qui ne finit qu'avec la sonde, apprend à la personne ce qu'elle va trouver,
// puis la conduit à l'adresse dès qu'elle répond. Au bout de deux minutes sans réponse, il le dit et donne alors le lien
// (jamais avant : l'adresse ne répond pas encore), sans cesser de sonder : il part seul dès qu'elle répond. Sans lui,
// `FormulaireDInscription` porterait la sonde, ses minuteurs et cet écran.
import { useEffect, useState, type CSSProperties } from "react"
import { Check } from "@phosphor-icons/react/dist/csr/Check"
import { CircleNotch } from "@phosphor-icons/react/dist/csr/CircleNotch"
import { adresseRepond } from "../api/client"
import { IlotDAuthentification } from "../authentification/ilot-d-authentification"
import { useMediaQuery } from "../ds/react/hooks"
import { Icon } from "../ds/react/icon"

/** L'adresse est sondée trois secondes après chaque réponse ; le retard se dit à deux minutes d'horloge, pas au compte des
 * sondes : un onglet en arrière-plan espace ses minuteurs. */
const SONDE_MS = 3000
const RETARD_MS = 120_000
/** Le temps de voir l'aboutissement avant le départ. */
const DEPART_MS = 600
/** Un texte reste sept secondes. */
const TEXTE_S = 7

const TEXTES = [
  "Dans votre espace, vos pages forment le Contexte que lisent vos assistants : ce que vous y écrivez, ils le savent.",
  "Les équipes rangent les pages par métier : chacune a son dossier, à côté de ce qui est commun à tous.",
  "Une fois arrivé, branchez votre assistant (Claude, ChatGPT) : il lira et écrira dans votre espace, avec vos droits.",
] as const

type Etat = "attente" | "pret" | "retard"

/** La barre avance vite puis ralentit, sans atteindre la fin avant que l'adresse réponde : aucune fausse fin. */
function avancement(secondes: number): number {
  return Math.round(92 * (1 - Math.exp(-secondes / 30)))
}

function Etape({ titre, detail, faite }: { titre: string; detail?: string; faite: boolean }) {
  return (
    <li className="oto-step" data-state={faite ? "done" : "current"}>
      <span className="oto-step-marker">{faite ? <Icon as={Check} size="xs" /> : <Icon as={CircleNotch} size="xs" className="oto-spin" />}</span>
      <span className="oto-step-body">
        <span className="oto-step-title">
          {titre}
          <span className="oto-sr-only">{faite ? " (fait)" : " (en cours)"}</span>
        </span>
        {detail && <span className="oto-step-desc">{detail}</span>}
      </span>
    </li>
  )
}

/** `adresse` : l'origine de la nouvelle organisation (`https://<hôte>/`). */
export function DepartVersLOrganisation({ adresse }: { adresse: string }) {
  const [etat, setEtat] = useState<Etat>("attente")
  const [secondes, setSecondes] = useState(0)
  // Mouvement réduit : la barre ne bouge plus, les textes ne tournent plus.
  const reduit = useMediaQuery("(prefers-reduced-motion: reduce)")
  const hote = new URL(adresse).host

  useEffect(() => {
    const debut = Date.now()
    let minuteur: ReturnType<typeof setTimeout> | undefined
    let quitte = false
    async function sonder() {
      const repond = await adresseRepond(adresse)
      if (quitte) return
      if (repond) {
        setEtat("pret")
        minuteur = setTimeout(() => window.location.assign(adresse), DEPART_MS)
        return
      }
      if (Date.now() - debut >= RETARD_MS) setEtat("retard")
      minuteur = setTimeout(() => void sonder(), SONDE_MS)
    }
    void sonder()
    return () => {
      quitte = true
      clearTimeout(minuteur)
    }
  }, [adresse])

  const enVol = etat === "attente" && !reduit
  useEffect(() => {
    if (!enVol) return
    const horloge = setInterval(() => setSecondes((ecoulees) => ecoulees + 1), 1000)
    return () => clearInterval(horloge)
  }, [enVol])

  const progres = etat === "pret" ? 100 : reduit ? 50 : avancement(secondes)
  const rang = Math.floor(secondes / TEXTE_S) % TEXTES.length

  return (
    <IlotDAuthentification titre="Votre espace se prépare" statut={etat === "pret" ? "C'est prêt : ouverture de votre espace." : "Votre organisation est créée."}>
      <div className="flex flex-col gap-3">
        <ol className="oto-stepper m-0 list-none p-0" data-orientation="vertical">
          <Etape titre="Organisation créée" faite />
          <Etape titre="Adresse réservée" detail={hote} faite />
          <Etape titre="Mise en ligne sécurisée" detail="Le certificat de votre adresse s'installe." faite={etat === "pret"} />
        </ol>
        {etat !== "retard" && (
          <>
            <div className="oto-progress" role="progressbar" aria-label="Mise en ligne de votre espace">
              <div className="oto-progress-bar" style={{ "--progress": `${progres}%` } as CSSProperties} />
            </div>
            <p className="text-sm text-ink">En général moins d&apos;une minute, deux au plus. Vous pouvez rester sur cette page : elle s&apos;ouvrira toute seule.</p>
            {/* Hauteur réservée : le texte change sans déplacer la page ; il n'est pas annoncé, seul le statut l'est. */}
            <p key={rang} className="oto-in-fade min-h-16 text-sm text-mute">
              {TEXTES[rang]}
            </p>
          </>
        )}
        {/* Montée vide : le retard s'y écrit, et s'annonce. */}
        <p role="status" className="text-sm text-ink">
          {etat === "retard" ? "La mise en ligne prend plus de temps que prévu. Votre organisation est bien créée, et cette page s'ouvrira dès que l'adresse répondra." : ""}
        </p>
        {/* Le lien seulement au retard : avant, l'adresse ne répond pas, et il mènerait à l'erreur du navigateur. */}
        {etat === "retard" && (
          <a href={adresse} className="text-sm text-ink underline underline-offset-2">
            {`Ouvrir ${hote}`}
          </a>
        )}
      </div>
    </IlotDAuthentification>
  )
}
