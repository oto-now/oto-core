"use client"

// Bloquer un outil pour toute l'organisation (écran Connecteurs), le geste d'un administrateur sur l'outil, là où il
// apparaît : l'icône « sens interdit » d'une carte du catalogue, révélée au survol et au focus, avec son infobulle, ou
// « Bloquer… » dans la zone « Arrêter » du détail d'un connecteur. Les deux ouvrent la même confirmation, qui liste les
// effets lus dans `DeactivationImpact` (les connecteurs que l'administrateur voit, les procédures publiées qui appellent
// l'outil), puis ferment l'outil (`DELETE admin/connectors/<nom>/activation`, la fermeture du moteur, inchangée).
// « Débloquer » le rouvre (`POST …/activation`), grisé au plafond d'outils de l'offre. Sans ce module, la carte et le
// détail écriraient chacun leur confirmation, et le même blocage se dirait de deux façons.
import { useRef, useState, type ReactNode } from "react"
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { Lock } from "@phosphor-icons/react/dist/csr/Lock"
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit"
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure"
import type { DeactivationImpact } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { ActionPlateforme } from "../../components/action-plateforme"
import { replierLeFocusSur } from "../../components/focus"
import { ConfirmDialog } from "../../ds/react/confirm-dialog"
import { Icon, type Glyphe } from "../../ds/react/icon"
import { Alert, Button, IconButton } from "../../ds/react/primitives"
import { Tooltip } from "../../ds/react/tooltip"
import { useRafraichir } from "../../hote/rafraichir"

/** Un effet d'un geste confirmé : son glyphe (rouge, sauf `calme`) et sa phrase. */
export type Effet = { glyphe: Glyphe; texte: ReactNode; calme?: boolean }

/**
 * Les procédures publiées qui appellent l'outil s'arrêteront à cette étape : comptées, jamais nommées par leur chemin
 * (`DeactivationImpact` ne rend pas leur titre).
 */
function procedures(outil: string, chemins: readonly string[]): Effet[] {
  if (chemins.length === 0) return []
  const qui = chemins.length === 1 ? "1 procédure publiée" : `${chemins.length} procédures publiées`
  return [{ glyphe: TreeStructure, texte: <><b>{qui}</b>{` ${chemins.length === 1 ? "s'arrêtera" : "s'arrêteront"} à l'étape qui appelle ${outil}.`}</> }]
}

/**
 * Ce que le blocage arrête, effet par effet. Un outil ouvert : tous ses connecteurs de l'organisation se taisent, sans
 * compte (`DeactivationImpact` ne compte que ceux que l'administrateur voit, pas ceux privés des membres), ouvert par
 * défaut compris ; un outil payé par la clé de l'application et pas encore adopté : personne n'en a ajouté, rien ne s'arrête.
 */
function effets(outil: string, impact: DeactivationImpact | undefined, actif: boolean): Effet[] {
  const arret: Effet[] = actif
    ? [{ glyphe: Prohibit, texte: <><b>Tous les connecteurs {outil} de l&apos;organisation</b> cessent de répondre aussitôt. Ils ne sont pas supprimés.</> }, ...procedures(outil, impact?.procedures ?? [])]
    : [{ glyphe: Info, calme: true, texte: `Personne n'a encore ajouté de connecteur ${outil} : rien ne s'arrête.` }]
  return [
    ...arret,
    { glyphe: Lock, texte: `Plus personne ne pourra ajouter de connecteur ${outil}.` },
    { glyphe: Info, calme: true, texte: `Vous pourrez le débloquer depuis « Ajouter un connecteur »${actif ? " : les connecteurs repartiront tels quels" : ""}.` },
  ]
}

/** Les effets d'un geste, un par ligne : la confirmation d'un blocage, celle d'un premier partage. */
export function ListeDesEffets({ id, liste }: { id: string; liste: Effet[] }) {
  return (
    <ul id={id} className="flex flex-col gap-3">
      {liste.map(({ glyphe, texte, calme }, rang) => (
        // Une liste composée une fois, jamais réordonnée : le rang est l'identité de la ligne.
        <li key={rang} className="flex items-start gap-3 text-sm text-ink">
          <span aria-hidden="true" className={calme ? "mt-0.5 text-mute" : "oto-etat mt-0.5"} data-state={calme ? undefined : "failed"}>
            <Icon as={glyphe} size="sm" />
          </span>
          <span>{texte}</span>
        </li>
      ))}
    </ul>
  )
}

/** « Bloquer X pour l'organisation » : le nom de l'effet, celui de l'infobulle et du bouton. */
export const nomDuBlocage = (outil: string) => `Bloquer ${outil} pour l'organisation`

type BlocageProps = {
  connecteur: string
  /** Le nom lisible de l'outil. */
  outil: string
  impact: DeactivationImpact | undefined
  /** L'outil est ouvert dans l'organisation : des connecteurs s'arrêtent. */
  actif: boolean
  /** L'icône d'une carte du catalogue, ou le bouton de la zone « Arrêter » du détail. */
  presentation: "icone" | "bouton"
  /** Le titre qui reçoit le focus quand le blocage emporte le déclencheur. */
  ancre: string
}

function Declencheur({ outil, presentation, ouvrir }: Pick<BlocageProps, "outil" | "presentation"> & { ouvrir: () => void }) {
  if (presentation === "bouton") {
    return (
      // Secondaire, le texte au ton du danger : le rouge plein ne vient qu'à la confirmation.
      <Button variant="secondary" onClick={ouvrir}>
        <span className="oto-etat" data-state="failed">
          Bloquer…<span className="oto-sr-only">{` ${outil} pour l'organisation`}</span>
        </span>
      </Button>
    )
  }
  // Révélée au survol de la carte et au focus clavier, toujours visible sous un doigt (`ui-patterns.md § Fiches et gestes`),
  // sa cible élargie à 44 px par un pseudo-élément, sans changer sa taille.
  return (
    <Tooltip content={nomDuBlocage(outil)}>
      <IconButton
        label={nomDuBlocage(outil)}
        size="sm"
        onClick={ouvrir}
        className="relative opacity-0 transition-opacity pointer-coarse:before:absolute pointer-coarse:before:-inset-2 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
      >
        <span aria-hidden="true" className="oto-etat flex" data-state="failed">
          <Icon as={Prohibit} size="sm" />
        </span>
      </IconButton>
    </Tooltip>
  )
}

export function BlocageDeLOutil({ connecteur, outil, impact, actif, presentation, ancre }: BlocageProps) {
  const rafraichir = useRafraichir()
  const [ouvert, setOuvert] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState("")
  const racine = useRef<HTMLSpanElement>(null)
  const idDesEffets = `effets-du-blocage-${connecteur}`

  async function bloquer() {
    setEnvoi(true)
    setErreur("")
    const reponse = await appelerPlateforme({ methode: "DELETE", ressource: `admin/connectors/${encodeURIComponent(connecteur)}/activation` })
    setEnvoi(false)
    if (reponse.erreur) return setErreur(messageDErreur(reponse.erreur))
    setOuvert(false)
    rafraichir()
    // La relecture range l'outil parmi les bloqués : le déclencheur part, le focus attend au titre.
    queueMicrotask(() => replierLeFocusSur(ancre, racine.current))
  }

  return (
    <span ref={racine} className="contents">
      <Declencheur outil={outil} presentation={presentation} ouvrir={() => setOuvert(true)} />
      {ouvert && (
        <ConfirmDialog
          open
          role="alertdialog"
          aria-describedby={idDesEffets}
          title={`Bloquer ${outil} pour toute l'organisation ?`}
          size="md"
          onCancel={() => setOuvert(false)}
          confirmLabel={`Bloquer ${outil}`}
          onConfirm={() => void bloquer()}
          busy={envoi}
        >
          <div className="flex flex-col gap-3">
            <ListeDesEffets id={idDesEffets} liste={effets(outil, impact, actif)} />
            {erreur && <Alert tone="fail" title={erreur} />}
          </div>
        </ConfirmDialog>
      )}
    </span>
  )
}

type DeblocageProps = {
  connecteur: string
  outil: string
  /** Un outil payé par la clé de l'application, jamais adopté : « Adopter » au lieu de « Débloquer », le même geste. */
  adopter?: boolean
  ancre: string
}

/**
 * « Débloquer » : l'outil rouvert pour l'organisation, sans question (réversible), sans plafond : le nombre d'outils
 * n'est plus limité. « Adopter » pour un outil payé par la clé de l'application, qu'aucun administrateur n'a adopté.
 */
export function DeblocageDeLOutil({ connecteur, outil, adopter = false, ancre }: DeblocageProps) {
  const libelle = adopter ? "Adopter" : "Débloquer"
  return (
    <ActionPlateforme
      libelle={libelle}
      nomAccessible={`${libelle} ${outil}`}
      requete={{ methode: "POST", ressource: `admin/connectors/${encodeURIComponent(connecteur)}/activation`, corps: {} }}
      ancre={ancre}
    />
  )
}
