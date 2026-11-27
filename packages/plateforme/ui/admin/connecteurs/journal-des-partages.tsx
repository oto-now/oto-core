"use client"

// « Journal des partages » d'un compte (partage des comptes) : un lien discret à droite du titre « Qui peut s'en servir »
// du détail d'un compte que la personne gère, le journal ouvert sur toute la largeur sous ce titre,
// lu à l'ouverture par `GET /api/platform/admin/accounts/<id>/share-journal`, qui le réserve à qui gère le compte (pour
// un compte personnel, sa seule personne). Chaque ligne dit quand, qui, quel geste, vers qui et à quel niveau ; un
// sujet ou un auteur sans nom (équipe supprimée, personne qui n'est plus membre) et un geste hors d'une session se
// disent tels quels.
import { useState } from "react"
import type { AccountShareEventView, AccountView } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { LIEN } from "../../components/classes"
import { Alert } from "../../ds/react/primitives"
import { dateEtHeureLisibles } from "../../format/dates"
import { NIVEAUX_DU_COMPTE as NIVEAUX, sujetDuPartage } from "./libelles-des-partages"
import { LIEN_DISCRET } from "./niveaux-du-partage"

/** « 17 octobre 2026 à 09:12 · Claire Morel a partagé à l'équipe Ventes (Lecture et écriture, avant : Lecture seule) ». */
export function ligneDuJournal(evenement: AccountShareEventView): string {
  const quand = dateEtHeureLisibles(evenement.at) ?? evenement.at
  const qui = evenement.by === null ? "Hors session" : (evenement.by.name ?? "Une personne qui n'est plus membre")
  const geste =
    evenement.action === "removed"
      ? `a retiré le partage à ${sujetDuPartage(evenement.subject)} (${NIVEAUX[evenement.level]})`
      : `a partagé à ${sujetDuPartage(evenement.subject)} (${NIVEAUX[evenement.level]}${evenement.previous ? `, avant : ${NIVEAUX[evenement.previous]}` : ""})`
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

  // Deux enfants de la rangée du titre : le lien à sa droite, le journal ouvert passe à la ligne, sur toute la largeur.
  return (
    <>
      <button type="button" aria-expanded={ouvert} onClick={() => void ouvrir()} className={`${LIEN_DISCRET} ${LIEN}`}>
        Journal des partages
        <span className="oto-sr-only">{` de ${compte.label}`}</span>
      </button>
      {ouvert && <Journal compte={compte} etat={etat} />}
    </>
  )
}

function Journal({ compte, etat }: { compte: Pick<AccountView, "label">; etat: Etat }) {
  return (
    <div className="flex basis-full flex-col gap-1">
      {!etat.lu && <p className="oto-caption">Lecture du journal…</p>}
      {etat.lu && "erreur" in etat && <Alert tone="fail" title={etat.erreur} />}
      {etat.lu && "evenements" in etat && (
        etat.evenements.length === 0 ? (
          <p className="oto-caption">Aucun partage posé ni retiré sur ce connecteur.</p>
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
