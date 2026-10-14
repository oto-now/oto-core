"use client"

// Le dialogue d'un bloc « Intégration » (1.4.3) : l'adresse de la page à intégrer, contrôlée comme la base la contrôle
// (`embedUrlSchema`), avant d'écrire le bloc après la rangée (le « + », « / ») ou de changer l'adresse d'un cadre (son
// menu). Échap ferme sans rien écrire. Sans lui, un cadre ne s'ajouterait que par un assistant.
import { useState, type FormEvent } from "react"
import { embedUrlSchema } from "../../../schemas/blocks"
import { Dialog } from "../../ds/react/dialog"
import { Field, Input } from "../../ds/react/forms"
import { Button } from "../../ds/react/primitives"
import { INTEGRATION } from "../libelles"
import { useGestes } from "./gestes"

export function ChoixDeLIntegration({ adresse, modifier }: { adresse: string; modifier: boolean }) {
  const gestes = useGestes()
  const [saisie, setSaisie] = useState(adresse)
  const [refus, setRefus] = useState<string | null>(null)
  const valider = (evenement: FormEvent<HTMLFormElement>) => {
    evenement.preventDefault()
    const lue = embedUrlSchema.safeParse(saisie.trim())
    if (!lue.success) return setRefus(INTEGRATION.invalide)
    gestes.integrer(lue.data)
  }
  const pied = (
    <>
      <Button variant="secondary" onClick={gestes.fermerLeDialogue}>
        {INTEGRATION.annuler}
      </Button>
      <Button variant="primary" type="submit" form="oto-integration">
        {modifier ? INTEGRATION.modifier : INTEGRATION.valider}
      </Button>
    </>
  )
  return (
    <Dialog open onClose={gestes.fermerLeDialogue} title={modifier ? INTEGRATION.modifier : INTEGRATION.dialogue} size="md" footer={pied}>
      <form id="oto-integration" onSubmit={valider} noValidate>
        <Field label={INTEGRATION.adresse} hint={INTEGRATION.aide} error={refus}>
          <Input
            type="url"
            inputMode="url"
            autoFocus
            value={saisie}
            placeholder="https://"
            onChange={(evenement) => {
              setSaisie(evenement.target.value)
              setRefus(null)
            }}
          />
        </Field>
      </form>
    </Dialog>
  )
}
