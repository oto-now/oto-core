"use client"

// « Journal des partages » d'un compte (partage des comptes) : replié sous la ligne d'un compte que la personne gère,
// lu à l'ouverture par `GET /api/platform/admin/accounts/<id>/share-journal`, qui le réserve à qui gère le compte (pour
// un compte personnel, sa seule personne). Chaque ligne dit quand, qui, quel geste, vers qui et à quel niveau ; un
// sujet ou un auteur sans nom (équipe supprimée, personne qui n'est plus membre) et un geste hors d'une session se
// disent tels quels.
import { useState } from "react"
import type { AccountLevelName, AccountShareEventView, AccountView } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Alert, Button } from "../../ds/react/primitives"
import { dateEtHeureLisibles } from "../../format/dates"

const NIVEAUX: Record<AccountLevelName, string> = {
  none: "sans accès",
  read: "en lecture",
  write: "en écriture",
  sensitive: "jusqu'aux fonctions sensibles",
  manage: "en gestion",
}

/** Le sujet d'une ligne : l'organisation, l'équipe ou la personne, nommée à la lecture. */
function sujet(evenement: AccountShareEventView): string {
  const { kind, name } = evenement.subject
  if (kind === "org") return `toute l'organisation${name ? ` (${name})` : ""}`
  if (kind === "team") return name ? `l'équipe ${name}` : "une équipe supprimée"
  return name ?? "une personne qui n'est plus membre"
}

/** « 17 octobre 2026 à 09:12 · Claire Morel a partagé à l'équipe Ventes en écriture (avant : en lecture) ». */
export function ligneDuJournal(evenement: AccountShareEventView): string {
  const quand = dateEtHeureLisibles(evenement.at) ?? evenement.at
  const qui = evenement.by === null ? "Hors session" : (evenement.by.name ?? "Une personne qui n'est plus membre")
  const geste =
    evenement.action === "removed"
      ? `a retiré le partage à ${sujet(evenement)} (${NIVEAUX[evenement.level]})`
      : `a partagé à ${sujet(evenement)} ${NIVEAUX[evenement.level]}${evenement.previous ? ` (avant : ${NIVEAUX[evenement.previous]})` : ""}`
  return `${quand} · ${qui} ${geste}`
}

type Etat = { lu: false } | { lu: true; evenements: AccountShareEventView[] } | { lu: true; erreur: string }

export function JournalDesPartages({ compte }: { compte: Pick<AccountView, "id" | "label"> }) {
  const [ouvert, setOuvert] = useState(false)
  const [etat, setEtat] = useState<Etat>({ lu: false })

  async function ouvrir() {
    const suivant = !ouvert
    setOuvert(suivant)
    if (!suivant) return
    const reponse = await appelerPlateforme<{ events: AccountShareEventView[] }>({
      methode: "GET",
      ressource: `admin/accounts/${encodeURIComponent(compte.id)}/share-journal`,
    })
    setEtat(reponse.erreur ? { lu: true, erreur: messageDErreur(reponse.erreur) } : { lu: true, evenements: reponse.data.events })
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" aria-expanded={ouvert} onClick={() => void ouvrir()}>
          {`Journal des partages de ${compte.label}`}
        </Button>
      </div>
      {ouvert && !etat.lu && <p className="oto-caption">Lecture du journal…</p>}
      {ouvert && etat.lu && "erreur" in etat && <Alert tone="fail" title={etat.erreur} />}
      {ouvert && etat.lu && "evenements" in etat && (
        etat.evenements.length === 0 ? (
          <p className="oto-caption">Aucun partage posé ni retiré sur ce compte.</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={`Journal des partages de ${compte.label}`}>
            {etat.evenements.map((evenement, rang) => (
              <li key={`${evenement.at}-${rang}`} className="oto-caption">
                {ligneDuJournal(evenement)}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
