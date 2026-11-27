"use client"

// L'îlot du formulaire de dépôt (E10-S02 lot f, AC-f15 ; ADR-018 § 8) : la zone de dépôt d'E10-S01 (glisser-déposer ou
// sélection, limites dites avant), puis l'envoi du fichier, tel quel, à la route à session du ticket, qui le consomme.
// « Déposé » en `role="status"`, un refus en `role="alert"`, régions montées vides ; un seul envoi (le lien sert une
// fois). La zone, qui tenait le focus, part après « Déposé » ou après un refus qui a servi le lien : le focus va à la
// région qui le dit (`accessibility-patterns.md § Après une action`). Sans lui, un assistant sans shell ni adresse
// publique n'aurait aucun moyen de déposer un fichier.
//
// Après « Déposé », l'onglet mène à la page qui contient le fichier, après un court délai qui laisse lire l'annonce,
// par la navigation de l'hôte (`useHote().naviguer`) ; « Ouvrir la page » reste offert si elle n'aboutit pas. Pas de
// `window.close()` : il n'agit que sur un onglet ouvert par un script, pas sur `form_url` ouvert depuis la conversation.
import { useEffect, useRef, useState } from "react"
import { fileTypeOf, UPLOAD_BYTES_MAX, type UploadDone, type UploadKind } from "../../schemas"
import { deposerParLeLien, type ErreurPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { LIEN } from "../components/classes"
import { ZoneDeDepot } from "../coque/import-de-fichier"
import { useHote } from "../hote/navigation"
import { adresseDeVue } from "../noeud/fichier-du-bloc"
import { DEPOT, REFUS_DU_DEPOT } from "./libelles"

/** Le temps de lire « Déposé » avant que la page s'ouvre. */
const DELAI_D_OUVERTURE_MS = 1_500

type Etat =
  | { phase: "repos" }
  | { phase: "envoi" }
  | { phase: "depose"; chemin: string; adresse: string }
  /** `clos` : le refus a servi le lien, ou le lien ne sert plus ; un nouvel essai rendrait `not_found`. */
  | { phase: "refus"; message: string; clos: boolean }

type FormulaireDeDepotProps = {
  jeton: string
  genre: UploadKind
  /** Ce que propose le choix du système : l'extension du fichier attendu, ou `.md`, ou `.csv`. */
  accepte: string
}

/**
 * Un refus qui laisse le lien valable : le réseau, une session à reprendre (401), une panne sans code sûr, ou un fichier
 * de plus de 1 Mo, refusé avant la consommation (ADR-018 § 5). Tout autre refus vient après elle (AC-f4, étape 5), ou
 * dit un lien qui ne sert plus.
 */
function lienEncoreValable(erreur: ErreurPlateforme, fichier: File): boolean {
  if (erreur.code === "reseau" || erreur.code === "internal" || erreur.statut === 401) return true
  return erreur.code === "too_large" && fichier.size > UPLOAD_BYTES_MAX
}

/**
 * Où mène un dépôt réussi : l'adresse de la page que rend le service (`url`, `/n/<chemin>`, à l'origine même du
 * formulaire, que la route exige), suivie de `?view=<id>` pour un fichier joint que la page montre dans sa visionneuse
 * (`adresseDeVue` : `html`, `md`) ; tout autre fichier, un `.md` importé ou un CSV : la page.
 */
function adresseDuDepot(depose: UploadDone): string {
  const vue = depose.file ? adresseDeVue(depose.file.id, fileTypeOf(depose.file.name)) : null
  return vue?.startsWith("?") ? `${depose.url}${vue}` : depose.url
}

export function FormulaireDeDepot({ jeton, genre, accepte }: FormulaireDeDepotProps) {
  const { Lien, naviguer } = useHote()
  const [etat, setEtat] = useState<Etat>({ phase: "repos" })
  // Un second dépôt arrive avant que l'état soit rendu : ce verrou tient l'envoi unique.
  const enCours = useRef(false)
  const statut = useRef<HTMLParagraphElement>(null)
  const alerte = useRef<HTMLParagraphElement>(null)
  // La région qui reçoit le focus au rendu qui suit l'issue, une seule fois.
  const focusSur = useRef<HTMLParagraphElement | null>(null)

  useEffect(() => {
    if (!focusSur.current) return
    focusSur.current.focus()
    focusSur.current = null
  })

  const ouvrir = etat.phase === "depose" ? etat.adresse : null
  useEffect(() => {
    if (ouvrir === null) return
    const minuteur = setTimeout(() => naviguer(ouvrir), DELAI_D_OUVERTURE_MS)
    return () => clearTimeout(minuteur)
  }, [ouvrir, naviguer])

  async function deposer(fichier: File) {
    if (enCours.current) return
    enCours.current = true
    setEtat({ phase: "envoi" })
    const reponse = await deposerParLeLien<UploadDone>(jeton, fichier)
    if (reponse.erreur) {
      const clos = !lienEncoreValable(reponse.erreur, fichier)
      // Un refus avant la consommation laisse le lien valable : un autre fichier peut partir.
      enCours.current = clos
      if (clos) focusSur.current = alerte.current
      setEtat({ phase: "refus", message: messageDErreur(reponse.erreur, REFUS_DU_DEPOT), clos })
      return
    }
    focusSur.current = statut.current
    setEtat({ phase: "depose", chemin: reponse.data.path, adresse: adresseDuDepot(reponse.data) })
  }

  const annonce = etat.phase === "envoi" ? DEPOT.envoi : etat.phase === "depose" ? DEPOT.depose(etat.chemin) : ""
  const zoneOfferte = etat.phase === "repos" || etat.phase === "envoi" || (etat.phase === "refus" && !etat.clos)
  return (
    <div className="flex flex-col gap-2" aria-busy={etat.phase === "envoi" || undefined}>
      {zoneOfferte && <ZoneDeDepot limites={DEPOT.limites(genre)} accepte={accepte} choisir={(fichier) => void deposer(fichier)} />}
      {etat.phase === "refus" && etat.clos && <p className="text-sm text-mute">{DEPOT.clos}</p>}
      <p ref={statut} tabIndex={-1} role="status" className="text-sm text-ink">
        {annonce}
      </p>
      {etat.phase === "depose" && (
        <Lien href={etat.adresse} className={`self-start text-sm ${LIEN}`}>
          {DEPOT.ouvrir}
        </Lien>
      )}
      <p ref={alerte} tabIndex={-1} role="alert" className="text-sm text-ink">
        {etat.phase === "refus" ? etat.message : ""}
      </p>
    </div>
  )
}
