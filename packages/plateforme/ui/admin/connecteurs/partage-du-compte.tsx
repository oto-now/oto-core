"use client"

// Partager un compte (écran Connecteurs ouvert aux membres) : à toute l'organisation ou à une équipe, à un niveau de
// l'échelle des comptes, envoyé à `POST /api/platform/admin/account-rules` après le schéma partagé avec l'API
// (`setAccountRuleSchema`) ; un partage au même sujet remplace son niveau. « Partage enregistré. » se dit dans une
// région `status` montée vide, puis la page se relit. `setAccountRule` décide le droit : la gestion du compte.
//
// Repris d'`AjoutDeRegle` (règle d'un nœud) : un seul champ pour le sujet. Changé : le sujet est l'organisation ou une
// équipe, jamais une personne ; les niveaux sont ceux d'un compte, sans la gestion, que seul un administrateur accorde ;
// pas de focus replié après un succès : le propriétaire d'un compte personnel le gère avant toute règle (décidé le
// 19/10, `droits-d-acces.md` § Partage d'un compte de connecteur), la relecture garde donc le formulaire.
import { useId, useState, useTransition, type FormEvent } from "react"
import { setAccountRuleSchema, type AccountLevelName } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"
import { Field } from "../../ds/react/forms"
import { Button } from "../../ds/react/primitives"
import { Select } from "../../ds/react/select"
import { useRafraichir } from "../../hote/rafraichir"
import { NIVEAUX_DU_COMPTE } from "./libelles-des-partages"

/** Les niveaux qu'on partage : la gestion d'un compte ne s'accorde que par un administrateur (`setAccountRule`). */
const NIVEAUX_PARTAGES: readonly AccountLevelName[] = ["read", "write", "sensitive"]

/** La valeur du sujet « toute l'organisation » ; une équipe s'écrit « team:<id> ». */
const ORGANISATION = "org"

const REFUS: MessagesDuGeste = {
  forbidden: "Seule une personne qui gère ce compte peut le partager.",
  not_found: "Ce compte n'existe plus ou ne vous est plus visible. Rechargez la page.",
}

type PartageDuCompteProps = {
  compte: { id: string; label: string }
  equipes: { id: string; name: string }[]
}

/** Le sujet du partage tel que le champ le porte : l'organisation, ou une équipe. */
function sujetDe(valeur: string) {
  if (valeur === ORGANISATION) return { kind: "org" }
  const [kind, id] = valeur.split(":")
  return { kind, id }
}

export function PartageDuCompte({ compte, equipes }: PartageDuCompteProps) {
  const id = useId()
  const rafraichir = useRafraichir()
  const [erreur, setErreur] = useState("")
  const [annonce, setAnnonce] = useState("")
  const [enCours, demarrer] = useTransition()

  function partager(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault()
    setErreur("")
    setAnnonce("")
    const champs = new FormData(evenement.currentTarget)
    const saisie = setAccountRuleSchema.safeParse({ accountId: compte.id, subject: sujetDe(String(champs.get("sujet") ?? "")), level: champs.get("niveau") })
    if (!saisie.success) {
      setErreur("Choisissez à qui partager, et un niveau.")
      return
    }
    demarrer(async () => {
      const reponse = await appelerPlateforme({ methode: "POST", ressource: "admin/account-rules", corps: saisie.data })
      if (reponse.erreur) {
        setErreur(messageDErreur(reponse.erreur, REFUS))
        return
      }
      setAnnonce("Partage enregistré.")
      rafraichir()
    })
  }

  return (
    <form noValidate onSubmit={partager} aria-label={`Partager ${compte.label}`} className="flex flex-col gap-2">
      <div role="status" className="oto-caption">
        {annonce}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field id={`${id}-sujet`} label="Partager à">
          <Select name="sujet" defaultValue={ORGANISATION}>
            <option value={ORGANISATION}>toute l&apos;organisation</option>
            {equipes.length > 0 && (
              <optgroup label="Équipes">
                {equipes.map((equipe) => (
                  <option key={equipe.id} value={`team:${equipe.id}`}>{`l'équipe ${equipe.name}`}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field id={`${id}-niveau`} label="Niveau">
          <Select name="niveau" defaultValue="read" options={NIVEAUX_PARTAGES.map((niveau) => ({ value: niveau, label: NIVEAUX_DU_COMPTE[niveau] }))} />
        </Field>
        <Button type="submit" variant="secondary" disabled={enCours} aria-busy={enCours}>
          Partager
        </Button>
      </div>
      {erreur && <p role="alert">{erreur}</p>}
    </form>
  )
}
