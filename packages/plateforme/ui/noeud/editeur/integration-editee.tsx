"use client"

// Le dialogue d'un bloc « Intégration » (1.4.3) : l'adresse de la page à intégrer, contrôlée comme la base la contrôle
// (`embedUrlSchema`), avant d'écrire le bloc après la rangée (le « + », « / ») ou de changer l'adresse d'un cadre (son
// menu). Échap ferme sans rien écrire. Sans lui, un cadre ne s'ajouterait que par un assistant.
//
// 1.4.6 : le champ prend aussi le code `<iframe …>` qu'un site donne (« Intégrer », « Embed ») ; seule son adresse `src`
// est gardée, le reste (largeur, attributs) part : le cadre a sa hauteur et son isolement propres.
import { useState, type FormEvent } from "react"
import { embedUrlSchema } from "../../../schemas/blocks"
import { Dialog } from "../../ds/react/dialog"
import { Field, Input } from "../../ds/react/forms"
import { Button } from "../../ds/react/primitives"
import { INTEGRATION } from "../libelles"
import { useGestes } from "./gestes"

/** Le premier attribut `src` d'un code `<iframe …>`, `src` seul (pas `data-src`), entre guillemets ou non ; `null` sans lui. */
function srcDeLIframe(code: string): string | null {
  const bas = code.toLowerCase()
  for (let rang = bas.indexOf("src", 1); rang !== -1; rang = bas.indexOf("src", rang + 3)) {
    if (bas[rang - 1].trim() !== "") continue
    let at = rang + 3
    while (bas[at] === " ") at++
    if (bas[at] !== "=") continue
    at++
    while (bas[at] === " ") at++
    const guillemet = code[at] === '"' || code[at] === "'" ? code[at] : null
    if (guillemet) {
      const fin = code.indexOf(guillemet, at + 1)
      return fin === -1 ? null : code.slice(at + 1, fin)
    }
    let fin = at
    while (fin < code.length && code[fin].trim() !== "" && code[fin] !== ">") fin++
    return code.slice(at, fin)
  }
  return null
}

/**
 * L'adresse que porte la saisie : celle du code `<iframe …>` collé, `&amp;` relu en `&`, ou la saisie elle-même ; sans
 * blancs de bord. Lue en un parcours (`security-patterns.md § Validation des inputs`), puis contrôlée par `embedUrlSchema`.
 */
export function adresseDeLaSaisie(saisie: string): string {
  const texte = saisie.trim()
  if (!texte.toLowerCase().startsWith("<iframe")) return texte
  return (srcDeLIframe(texte) ?? texte).replaceAll("&amp;", "&").trim()
}

export function ChoixDeLIntegration({ adresse, modifier }: { adresse: string; modifier: boolean }) {
  const gestes = useGestes()
  const [saisie, setSaisie] = useState(adresse)
  const [refus, setRefus] = useState<string | null>(null)
  const valider = (evenement: FormEvent<HTMLFormElement>) => {
    evenement.preventDefault()
    const lue = embedUrlSchema.safeParse(adresseDeLaSaisie(saisie))
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
            inputMode="url"
            autoFocus
            value={saisie}
            placeholder="https://… ou <iframe src=…>"
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
