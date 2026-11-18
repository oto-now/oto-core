"use client"

// Les champs d'un compte réel tirés de la déclaration de son connecteur (comptes à plusieurs champs) : ceux du secret,
// en saisie masquée pour un champ secret et jamais préremplis (un secret posé ne se relit pas : « posé », et une case
// pour l'effacer), puis les réglages, préremplis de leur valeur (une région, une adresse). Partagés par « Créer un
// compte » et « Secret et réglages » d'un compte ; la charge envoyée à `POST admin/accounts/<id>/secret` se compose
// ici (`chargeDeLaSaisie`) : un champ laissé vide est gardé, un champ coché « Effacer » ou un réglage vidé est effacé.
import { useFormContext } from "react-hook-form"
import type { AccountSecretInput, AccountView, ConnectorAccountForm } from "../../../schemas"
import { Checkbox } from "../../ds/react/checkbox"
import { Field, Input } from "../../ds/react/forms"
import { Select } from "../../ds/react/select"

/** La saisie d'un compte : les champs du secret, ceux à effacer, les réglages. */
export type SaisieDesChamps = { secret: Record<string, string>; effacer: Record<string, boolean>; settings: Record<string, string> }

type Champ = ConnectorAccountForm["fields"][number]
type Reglage = ConnectorAccountForm["settings"][number]

/** Les valeurs de départ : rien du secret, les réglages posés, sinon le défaut d'une liste. */
export function saisieDeDepart(formulaire: ConnectorAccountForm, compte?: AccountView): SaisieDesChamps {
  const settings: Record<string, string> = {}
  for (const reglage of formulaire.settings) {
    settings[reglage.name] = compte?.settings?.[reglage.name] ?? (reglage.type === "choice" ? (reglage.default ?? reglage.choices[0]) : "")
  }
  return { secret: {}, effacer: {}, settings }
}

/**
 * La charge de `POST admin/accounts/<id>/secret` : un champ du secret saisi, ou effacé par sa case ; un réglage
 * changé, ou effacé s'il est vidé. `null` : rien à envoyer.
 */
export function chargeDeLaSaisie(saisie: SaisieDesChamps, formulaire: ConnectorAccountForm, compte?: AccountView): AccountSecretInput | null {
  const secret: Record<string, string | null> = {}
  for (const { name } of formulaire.fields) {
    const valeur = saisie.secret[name]?.trim() ?? ""
    if (valeur) secret[name] = valeur
    else if (saisie.effacer[name]) secret[name] = null
  }
  const settings: Record<string, string | null> = {}
  for (const { name } of formulaire.settings) {
    const valeur = saisie.settings[name]?.trim() ?? ""
    const pose = compte?.settings?.[name]
    if (valeur === (pose ?? "")) continue
    settings[name] = valeur || null
  }
  const charge = { ...(Object.keys(secret).length > 0 ? { secret } : {}), ...(Object.keys(settings).length > 0 ? { settings } : {}) }
  return Object.keys(charge).length > 0 ? charge : null
}

/** Un champ du secret : jamais prérempli ; posé, il le dit et propose de l'effacer ; à la création, il ne dit rien. */
function ChampDuSecret({ champ, pose, existe }: { champ: Champ; pose: boolean; existe: boolean }) {
  const { register } = useFormContext<SaisieDesChamps>()
  const indice = pose ? "Posé. Laissez vide pour le garder." : existe ? "Non posé." : undefined
  return (
    <div className="flex flex-col gap-1">
      <Field label={champ.label} hint={indice}>
        <Input type={champ.secret ? "password" : "text"} autoComplete="off" spellCheck={false} {...register(`secret.${champ.name}`)} />
      </Field>
      {pose && <Checkbox label={`Effacer ${champ.label}`} {...register(`effacer.${champ.name}`)} />}
    </div>
  )
}

/** Un réglage : une liste fermée, un texte à motif, une adresse `https://`. */
function ChampDuReglage({ reglage }: { reglage: Reglage }) {
  const { register } = useFormContext<SaisieDesChamps>()
  if (reglage.type === "choice") {
    return (
      <Field label={reglage.label}>
        <Select options={reglage.choices.map((choix) => ({ value: choix, label: choix }))} {...register(`settings.${reglage.name}`)} />
      </Field>
    )
  }
  const indice = reglage.type === "url" ? "Une adresse https://, jamais une adresse interne." : "Lettres, chiffres, - et _."
  return (
    <Field label={reglage.label} hint={indice}>
      <Input type={reglage.type === "url" ? "url" : "text"} spellCheck={false} {...register(`settings.${reglage.name}`)} />
    </Field>
  )
}

/** Les champs du secret puis les réglages d'un compte du connecteur, dans l'ordre de sa déclaration. */
export function ChampsDuCompte({ formulaire, compte }: { formulaire: ConnectorAccountForm; compte?: AccountView }) {
  const poses = compte?.secret?.fields ?? []
  return (
    <>
      <ListeDesChamps champs={formulaire.fields} poses={poses} existe={compte !== undefined} />
      <ListeDesReglages reglages={formulaire.settings} />
    </>
  )
}

function ListeDesChamps({ champs, poses, existe }: { champs: Champ[]; poses: string[]; existe: boolean }) {
  return (
    <>
      {champs.map((champ) => (
        <ChampDuSecret key={champ.name} champ={champ} pose={poses.includes(champ.name)} existe={existe} />
      ))}
    </>
  )
}

function ListeDesReglages({ reglages }: { reglages: Reglage[] }) {
  return (
    <>
      {reglages.map((reglage) => (
        <ChampDuReglage key={reglage.name} reglage={reglage} />
      ))}
    </>
  )
}
