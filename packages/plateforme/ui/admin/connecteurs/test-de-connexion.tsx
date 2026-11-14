"use client"

// Le test d'une connexion (écran Connecteurs) : la clé essayée avant l'ajout (`POST admin/connectors/<nom>/probe`, qui
// n'écrit rien) et « Tester » dans le détail d'un connecteur (`POST admin/accounts/<id>/probe`, dont le résultat est
// gardé sur le compte). L'issue se dit en français ; la raison d'un échec, que le moteur écrit en anglais pour
// l'assistant, se montre telle quelle, repliée. Un test refusé par la route (trop de tests, outil fermé) se dit par sa
// raison (`refusDuConnecteur`).
import { useRef, useState } from "react"
import type { AccountHealth, AccountProbe, ConnectorProbeInput } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { Button } from "../../ds/react/primitives"
import { useRafraichir } from "../../hote/rafraichir"
import { refusDuConnecteur } from "./refus-des-connecteurs"

/** L'issue d'un test : rien encore, en cours, réussi, échoué (avec la phrase du moteur), ou refusé par la route. */
export type Essai = { etat: "aucun" | "en_cours" | "reussi" | "echoue" | "refuse"; texte: string; detail: string | null }

const AUCUN: Essai = { etat: "aucun", texte: "", detail: null }
const EN_COURS: Essai = { etat: "en_cours", texte: "Test de la connexion…", detail: null }

const issueDe = (sonde: AccountHealth): Essai =>
  sonde.healthy ? { etat: "reussi", texte: "Connexion réussie.", detail: null } : { etat: "echoue", texte: "Le test a échoué.", detail: sonde.reason }

/** Un test raté ou refusé : l'ajout demande alors « Ajouter quand même ». */
export const essaiRate = (essai: Essai) => essai.etat === "echoue" || essai.etat === "refuse"

/** L'issue d'un test : deux régions montées vides, le succès et l'attente annoncés, l'échec en alerte. */
export function AnnonceDeLEssai({ essai }: { essai: Essai }) {
  const rate = essaiRate(essai)
  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="oto-caption">
        {rate ? "" : essai.texte}
      </p>
      <p role="alert" className="text-sm text-ink">
        {rate ? essai.texte : ""}
      </p>
      {essai.detail && <DetailDuTest raison={essai.detail} />}
    </div>
  )
}

/** La raison d'un test en échec, telle que le moteur l'écrit (en anglais, pour l'assistant), repliée. */
export function DetailDuTest({ raison }: { raison: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-ink underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ink">Détail du test</summary>
      <p lang="en" className="oto-caption">
        {raison}
      </p>
    </details>
  )
}

/** Un test parti pour une saisie : sa promesse, et son issue une fois rendue. */
type Test = { saisie: string; promesse: Promise<Essai>; issue: Essai | null }

/**
 * La clé essayée avant l'ajout. Le dernier test se garde hors du rendu : un geste le lit tel qu'il est à cet instant,
 * jamais tel qu'un rendu passé l'a vu. La même saisie ne part ni à chaque frappe ni deux fois : `essayer` rend le test
 * déjà parti pour elle, en cours ou rendu. `issueConnue` : son issue, une fois rendue ; `enVue` : un test est parti
 * pour elle. Une réponse qui arrive après une saisie plus récente n'est pas annoncée.
 */
export function useEssaiDeLaCle(connecteur: string) {
  const [essai, setEssai] = useState<Essai>(AUCUN)
  const dernier = useRef<Test | null>(null)
  const pour = (corps: ConnectorProbeInput) => (dernier.current?.saisie === JSON.stringify(corps) ? dernier.current : null)

  function essayer(corps: ConnectorProbeInput): Promise<Essai> {
    const parti = pour(corps)
    if (parti) return parti.promesse
    setEssai(EN_COURS)
    const test: Test = {
      saisie: JSON.stringify(corps),
      issue: null,
      promesse: appelerPlateforme<{ probe: AccountHealth }>({ methode: "POST", ressource: `admin/connectors/${encodeURIComponent(connecteur)}/probe`, corps }).then((reponse): Essai => {
        const lue: Essai = reponse.erreur ? { etat: "refuse", texte: refusDuConnecteur(reponse.erreur), detail: null } : issueDe(reponse.data.probe)
        test.issue = lue
        if (dernier.current === test) setEssai(lue)
        return lue
      }),
    }
    dernier.current = test
    return test.promesse
  }

  return { essai, essayer, issueConnue: (corps: ConnectorProbeInput) => pour(corps)?.issue ?? null, enVue: (corps: ConnectorProbeInput) => pour(corps) !== null }
}

/** « Tester » dans le détail d'un connecteur, pour qui le gère : le résultat est gardé sur le compte, la page se relit. */
export function TestDuConnecteur({ compte }: { compte: { id: string; label: string } }) {
  const rafraichir = useRafraichir()
  const [essai, setEssai] = useState<Essai>(AUCUN)

  async function tester() {
    setEssai(EN_COURS)
    const reponse = await appelerPlateforme<{ probe: AccountProbe }>({ methode: "POST", ressource: `admin/accounts/${encodeURIComponent(compte.id)}/probe`, corps: {} })
    if (reponse.erreur) {
      setEssai({ etat: "refuse", texte: refusDuConnecteur(reponse.erreur), detail: null })
      return
    }
    // La raison d'un échec n'est pas redite ici : la page relue la montre avec l'état du connecteur.
    setEssai({ ...issueDe(reponse.data.probe), detail: null })
    rafraichir()
  }

  const enCours = essai.etat === "en_cours"
  return (
    <div className="flex w-full flex-col gap-2">
      <div>
        <Button type="button" variant="secondary" disabled={enCours} aria-busy={enCours} onClick={() => void tester()}>
          Tester
          <span className="oto-sr-only">{` ${compte.label}`}</span>
        </Button>
      </div>
      <AnnonceDeLEssai essai={essai} />
    </div>
  )
}
