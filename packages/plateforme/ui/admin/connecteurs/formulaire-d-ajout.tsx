"use client"

// Le formulaire d'un outil à clé, ou sans clé à saisir, dans la fenêtre « Ajouter un connecteur » : les champs de sa
// déclaration, la clé essayée dès qu'elle est complète (`useEssaiDeLaCle`, sans rien écrire), le nom, la description et,
// pour qui administre, le propriétaire. « Ajouter » crée le compte (`POST admin/accounts`), pose sa clé (`…/secret`), sa
// description (`PATCH`), puis le teste pour que le résultat soit gardé (`…/probe`). Après un test raté, seul le bouton
// « Ajouter quand même », distinct, crée le compte, et seulement pour la clé qui a échoué. Une suite qui échoue après la
// création se dit dans la fenêtre, avec sa raison, avant d'ouvrir le détail. La clé ne part qu'à la sonde et à la route
// du secret, et ne se réaffiche jamais : la fenêtre se ferme avec le formulaire.
import { useEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form"
import type * as z from "zod/v4"
import { ACCOUNT_DESCRIPTION_MAX, createAccountSchema, type ConnectorAccountForm, type ConnectorProbeInput } from "../../../schemas"
import { appelerPlateforme, type ErreurPlateforme } from "../../api/client"
import { Field, Input } from "../../ds/react/forms"
import { Alert, Button } from "../../ds/react/primitives"
import { Radio } from "../../ds/react/radio"
import { Select } from "../../ds/react/select"
import { Textarea } from "../../ds/react/textarea"
import { useRafraichir } from "../../hote/rafraichir"
import type { OutilAAjouter } from "./catalogue-des-connecteurs"
import { chargeDeLaSaisie, ChampsDuCompte, saisieDeDepart, type SaisieDesChamps } from "./champs-du-compte"
import { estNomPris, NOM_PRIS, refusDuConnecteur } from "./refus-des-connecteurs"
import { AnnonceDeLEssai, essaiRate, useEssaiDeLaCle } from "./test-de-connexion"

// Les champs hors du schéma de création sont facultatifs dans le type : le resolver ne connaît que ceux du schéma.
type Saisie = z.input<typeof createAccountSchema> & Partial<SaisieDesChamps> & { description?: string }
type Equipe = { id: string; name: string }

const NOM_INVALIDE = "Le nom est vide ou trop long."
const EQUIPE_MANQUANTE = "Choisissez une équipe."
const SANS_CHAMPS: SaisieDesChamps = { secret: {}, effacer: {}, settings: {} }
const PROPRIETAIRES = { user: "Moi", org: "L'organisation", team: "Une équipe" } as const

const champsDe = ({ secret = {}, effacer = {}, settings = {} }: Partial<SaisieDesChamps>): SaisieDesChamps => ({ secret, effacer, settings })

/** La clé à essayer : tous les champs de l'outil saisis, et les réglages posés ; `null` tant qu'un champ manque. */
function cleAEssayer(saisie: SaisieDesChamps, formulaire: ConnectorAccountForm): ConnectorProbeInput | null {
  const fields: Record<string, string> = {}
  for (const { name } of formulaire.fields) {
    const valeur = saisie.secret[name]?.trim() ?? ""
    if (!valeur) return null
    fields[name] = valeur
  }
  if (Object.keys(fields).length === 0) return null
  const settings = Object.fromEntries(formulaire.settings.flatMap(({ name }) => (saisie.settings[name]?.trim() ? [[name, saisie.settings[name].trim()]] : [])))
  return { fields, ...(Object.keys(settings).length > 0 ? { settings } : {}) }
}

/**
 * Crée le compte. Un outil sans formulaire est réel (servi par la clé de l'hôte) ou simulé, ce que l'écran ne sait pas :
 * il le crée réel, et le recrée simulé quand le service répond qu'un compte réel n'existe pas pour lui
 * (`unavailable_in_v1`).
 */
async function creerLeCompte(compte: z.input<typeof createAccountSchema>, sansFormulaire: boolean) {
  const creer = (mode: "reel" | "simule") => appelerPlateforme<{ account: { id: string; label: string } }>({ methode: "POST", ressource: "admin/accounts", corps: { ...compte, mode } })
  const reel = await creer("reel")
  return sansFormulaire && reel.erreur?.code === "unavailable_in_v1" ? creer("simule") : reel
}

function ChoixDeLEquipe({ equipes, erreur }: { equipes: readonly Equipe[]; erreur?: string }) {
  const { register } = useFormContext<Saisie>()
  return (
    <Field label="Équipe" error={erreur}>
      <Select {...register("team_id", { shouldUnregister: true, setValueAs: (valeur: string) => valeur || undefined })}>
        <option value="">Choisir une équipe</option>
        {equipes.map((equipe) => (
          <option key={equipe.id} value={equipe.id}>
            {equipe.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** Pour qui est le connecteur, quand la personne a le choix ; une équipe ne se propose que s'il en existe une. */
function ChoixDuProprietaire({ proprietaires, equipes, erreur }: { proprietaires: OutilAAjouter["proprietaires"]; equipes: readonly Equipe[]; erreur?: string }) {
  const { register } = useFormContext<Saisie>()
  const genre = useWatch<Saisie, "owner_kind">({ name: "owner_kind" })
  return (
    <>
      <fieldset className="oto-radio-group" data-orientation="horizontal">
        <legend>Pour qui</legend>
        {proprietaires
          .filter((un) => un !== "team" || equipes.length > 0)
          .map((un) => (
            <Radio key={un} value={un} label={PROPRIETAIRES[un]} {...register("owner_kind")} />
          ))}
      </fieldset>
      {genre === "team" && <ChoixDeLEquipe equipes={equipes} erreur={erreur} />}
    </>
  )
}

/** Ce que le pied dit du connecteur à naître, selon son propriétaire. */
function Pied() {
  const genre = useWatch<Saisie, "owner_kind">({ name: "owner_kind" })
  return <p className="oto-caption">{genre === "user" ? "Privé : vous seul pourrez l'utiliser. Vous le partagerez ensuite si vous voulez." : "Il servira l'organisation ou l'équipe choisie, selon ses partages."}</p>
}

/** Le compte est créé, mais une suite a échoué : ce qui reste à terminer, avec sa raison, puis le détail. */
function SuitesDeLAjout({ nom, suites, ouvrir }: { nom: string; suites: string[]; ouvrir: () => void }) {
  const titre = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    titre.current?.focus()
  }, [])
  return (
    <div className="flex flex-col gap-3">
      <p ref={titre} tabIndex={-1} className="font-medium text-ink">{`« ${nom} » est ajouté, mais il reste à terminer.`}</p>
      <ul className="flex flex-col gap-1 text-sm text-ink">
        {suites.map((suite) => (
          <li key={suite}>{suite}</li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="primary" onClick={ouvrir}>
          Ouvrir le connecteur
        </Button>
      </div>
    </div>
  )
}

type FormulaireDAjoutProps = {
  outil: OutilAAjouter
  equipes: Equipe[]
  /** Un nom que la personne ne porte pas encore. */
  nomPropose: string
  annuler: () => void
  /** Le compte est créé : la fenêtre se ferme et son détail s'ouvre. */
  apresAjout: (compte: { id: string }) => void
}

export function FormulaireDAjout({ outil, equipes, nomPropose, annuler, apresAjout }: FormulaireDAjoutProps) {
  const rafraichir = useRafraichir()
  const { formulaire } = outil
  const sonde = formulaire?.probe.available === true
  const { essai, essayer, issueConnue, enVue } = useEssaiDeLaCle(outil.connecteur)
  /** Le test raté, sur « Ajouter », demande confirmation : seul « Ajouter quand même » crée alors le compte. */
  const [question, setQuestion] = useState(false)
  const [reste, setReste] = useState<{ id: string; nom: string; suites: string[] } | null>(null)
  const form = useForm<Saisie>({
    // `raw` : la clé, les réglages et la description, hors du schéma de création, restent dans la saisie rendue.
    resolver: zodResolver(createAccountSchema, undefined, { raw: true }),
    mode: "onBlur",
    defaultValues: { connector: outil.connecteur, owner_kind: outil.proprietaires[0], label: nomPropose, description: "", ...(formulaire ? saisieDeDepart(formulaire) : SANS_CHAMPS) },
  })
  const { errors, isSubmitting } = form.formState
  const erreurDuNom = errors.label ? (errors.label.type === "server" ? errors.label.message : NOM_INVALIDE) : undefined
  const cleDe = (saisie: Partial<SaisieDesChamps>) => (sonde && formulaire ? cleAEssayer(champsDe(saisie), formulaire) : null)

  /** À la sortie d'un champ : la clé complète et pas encore essayée part à la sonde, et la question tombe. */
  function essayerSiPrete() {
    const cle = cleDe(form.getValues())
    if (!cle || enVue(cle)) return
    setQuestion(false)
    void essayer(cle)
  }

  async function creer({ secret, effacer, settings, description = "", ...compte }: Saisie) {
    const cree = await creerLeCompte(compte, formulaire === null)
    if (cree.erreur) {
      if (estNomPris(cree.erreur)) form.setError("label", { type: "server", message: NOM_PRIS }, { shouldFocus: true })
      else form.setError("root", { type: "server", message: refusDuConnecteur(cree.erreur) })
      return
    }
    const { id, label } = cree.data.account
    const adresse = `admin/accounts/${encodeURIComponent(id)}`
    const charge = formulaire ? chargeDeLaSaisie(champsDe({ secret, effacer, settings }), formulaire) : null
    const suites: string[] = []
    const dire = (quoi: string, erreur: ErreurPlateforme | undefined) => erreur && suites.push(`${quoi} : ${refusDuConnecteur(erreur)}`)
    const pose = charge ? await appelerPlateforme({ methode: "POST", ressource: `${adresse}/secret`, corps: charge }) : null
    dire("Sa clé n'est pas posée", pose?.erreur)
    if (description.trim()) dire("Sa description n'est pas enregistrée", (await appelerPlateforme({ methode: "PATCH", ressource: adresse, corps: { description: description.trim() } })).erreur)
    if (sonde && pose && !pose.erreur) dire("Il n'a pas été testé", (await appelerPlateforme({ methode: "POST", ressource: `${adresse}/probe`, corps: {} })).erreur)
    rafraichir()
    if (suites.length > 0) setReste({ id, nom: label, suites })
    else apresAjout({ id })
  }

  /** « Ajouter » : la clé se teste d'abord si elle ne l'est pas ; un test raté pose la question au lieu de créer. */
  async function ajouter(saisie: Saisie) {
    const cle = cleDe(saisie)
    if (cle && essaiRate(await essayer(cle))) return setQuestion(true)
    await creer(saisie)
  }

  /** « Ajouter quand même » : seulement pour la clé qui vient d'échouer ; une clé changée repasse par son test. */
  async function ajouterQuandMeme(saisie: Saisie) {
    const cle = cleDe(saisie)
    if (cle && !issueConnue(cle)) return ajouter(saisie)
    setQuestion(false)
    await creer(saisie)
  }

  if (reste) return <SuitesDeLAjout nom={reste.nom} suites={reste.suites} ouvrir={() => apresAjout({ id: reste.id })} />
  return (
    <FormProvider {...form}>
      <form noValidate aria-label={`Ajouter ${outil.libelle}`} onSubmit={(evenement) => void form.handleSubmit(ajouter)(evenement)} className="flex flex-col gap-3">
        {formulaire && (
          <div className="flex flex-col gap-3" onBlur={essayerSiPrete}>
            <ChampsDuCompte formulaire={formulaire} />
          </div>
        )}
        {sonde && <AnnonceDeLEssai essai={essai} />}
        {formulaire && !sonde && <p className="oto-caption">Pas de test automatique pour cet outil : essayez-le dans votre assistant.</p>}
        {!formulaire && <p className="oto-caption">Aucune clé à saisir pour cet outil.</p>}
        <Field label="Nom" error={erreurDuNom}>
          <Input type="text" {...form.register("label")} />
        </Field>
        <Field label="Description (facultatif)" hint="Ce à quoi sert ce connecteur : votre assistant la lit pour choisir le bon.">
          <Textarea maxLength={ACCOUNT_DESCRIPTION_MAX} {...form.register("description")} />
        </Field>
        {outil.proprietaires.length > 1 && <ChoixDuProprietaire proprietaires={outil.proprietaires} equipes={equipes} erreur={errors.team_id ? EQUIPE_MANQUANTE : undefined} />}
        {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
        <Pied />
        {question && (
          <div role="group" aria-label="Ajouter quand même ?" className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">Le test a échoué. Ajouter quand même ?</span>
            <Button type="button" variant="secondary" disabled={isSubmitting} onClick={(evenement) => void form.handleSubmit(ajouterQuandMeme)(evenement)}>
              Ajouter quand même
            </Button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Ajout…" : "Ajouter"}
          </Button>
          <Button type="button" variant="ghost" onClick={annuler}>
            Annuler
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}
