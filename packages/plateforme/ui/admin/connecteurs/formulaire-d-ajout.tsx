"use client"

// Le formulaire d'un outil à clé, ou sans clé à saisir, dans la fenêtre « Ajouter un connecteur » : les champs de sa
// déclaration, la clé essayée dès qu'elle est complète (`useEssaiDeLaCle`, sans rien écrire), le nom, proposé d'après le
// propriétaire que le partage décide et recalculé tant que la personne n'y a pas touché (`nomDuConnecteur`), avec une
// description facultative quand ce propriétaire a déjà un connecteur de l'outil, « Qui pourra s'en servir », puis ce
// que l'assistant pourra faire. « Ajouter le connecteur » crée le compte (`POST admin/accounts`), pose sa clé (`…/secret`), sa description
// (`PATCH`), puis le teste pour que le résultat soit gardé (`…/probe`). Après un test raté, seul le bouton
// « Ajouter quand même », distinct, crée le compte, et seulement pour la clé qui a échoué. Une suite qui échoue après la
// création se dit dans la fenêtre, avec sa raison, avant d'ouvrir le détail. La clé ne part qu'à la sonde et à la route
// du secret, et ne se réaffiche jamais : la fenêtre se ferme avec le formulaire.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FormProvider, useForm, useFormContext } from "react-hook-form"
import type * as z from "zod/v4"
import { ACCOUNT_DESCRIPTION_MAX, createAccountSchema, type ConnectorAccountForm, type ConnectorProbeInput } from "../../../schemas"
import { appelerPlateforme, type ErreurPlateforme } from "../../api/client"
import { Field, Input } from "../../ds/react/forms"
import { Alert, Button } from "../../ds/react/primitives"
import { Textarea } from "../../ds/react/textarea"
import { useRafraichir } from "../../hote/rafraichir"
import type { SujetsDeRegle } from "../../equipes/types"
import { nomDuConnecteur, type Nommage, type OutilAAjouter, type ProprietaireDuConnecteur } from "./catalogue-des-connecteurs"
import { chargeDeLaSaisie, ChampsDuCompte, saisieDeDepart, type SaisieDesChamps } from "./champs-du-compte"
import { FonctionsDuConnecteur } from "./fonctions-du-connecteur"
import { PiedDeLaFiche } from "./pied-de-la-fiche"
import { actionsParClasse, nomDe, REFUS_DE_L_OUVERTURE } from "./libelles-des-partages"
import { partageDeDepart, PartageALAjout, poserLePartage, proprietaireCree, proprietaireDuPartage, proprietairesDe, type PartageDeLAjout } from "./partage-a-l-ajout"
import { estNomPris, NOM_PRIS, refusDuConnecteur } from "./refus-des-connecteurs"
import { AnnonceDeLEssai, essaiRate, useEssaiDeLaCle } from "./test-de-connexion"

// Les champs hors du schéma de création sont facultatifs dans le type : le resolver ne connaît que ceux du schéma.
type Saisie = z.input<typeof createAccountSchema> & Partial<SaisieDesChamps> & { description?: string }
type Equipe = { id: string; name: string }

const NOM_INVALIDE = "Le nom est vide ou trop long."
const SANS_PROPRIETAIRE = "Ouvrez-le à toute l'organisation ou à une seule équipe : cet outil ne se connecte pas pour une personne."
const SANS_CHAMPS: SaisieDesChamps = { secret: {}, effacer: {}, settings: {} }

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
  return { fields, ...(Object.keys(settings).length > 0 ? { settings } : {}), ...(formulaire.access ? { access: formulaire.access.name } : {}) }
}

/** Le compte est créé, mais une suite a échoué : ce qui reste à terminer, avec sa raison, puis le détail. */
function SuitesDeLAjout({ nom, suites, ouvrir }: { nom: string; suites: string[]; ouvrir: () => void }) {
  const titre = useRef<HTMLParagraphElement>(null)
  // Dans le rendu même qui pose le message : un effet passif le focalisait plus tard, et le titre de la fiche
  // gardait le focus entre les deux.
  useLayoutEffect(() => {
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

/** Le corps du propriétaire, tel que la création l'attend : `team_id` seulement pour une équipe. */
const corpsDuProprietaire = (proprietaire: ProprietaireDuConnecteur) =>
  proprietaire.owner_kind === "team" ? { owner_kind: proprietaire.owner_kind, team_id: proprietaire.team_id } : { owner_kind: proprietaire.owner_kind, team_id: undefined }

type NomEtDescriptionProps = {
  /** Le nom de départ, et le nom proposé d'après le propriétaire (`nomDuConnecteur`) ; absent sans `nommage`. */
  nomPropose: string
  nom: { nom: string; aide: string; deja: number } | null
  /** Le champ s'intitule « Nom » quand il suit le partage, « Nom (facultatif) » sinon. */
  suitLePartage: boolean
  erreur: string | undefined
  /** Une description se demande quand le propriétaire a déjà un connecteur de l'outil. */
  description: boolean
}

/** Le nom, qui suit le nom proposé tant que la personne n'y a pas touché, puis la description quand elle les distingue. */
function NomEtDescription({ nomPropose, nom, suitLePartage, erreur, description }: NomEtDescriptionProps) {
  const form = useFormContext<Saisie>()
  const nomTouche = useRef(false)
  const nomSuivi = nom?.nom
  useEffect(() => {
    if (nomSuivi !== undefined && !nomTouche.current) form.setValue("label", nomSuivi)
  }, [form, nomSuivi])
  return (
    <>
      <Field label={suitLePartage ? "Nom" : "Nom (facultatif)"} error={erreur} hint={nom?.aide ?? "C'est ce nom que vous direz à votre assistant."}>
        {/* Vidé, le nom proposé : il reste celui qu'on dira à l'assistant. */}
        <Input
          type="text"
          {...form.register("label", {
            setValueAs: (valeur: string) => valeur.trim() || (nomSuivi ?? nomPropose),
            onChange: () => {
              nomTouche.current = true
            },
          })}
        />
      </Field>
      {description && (
        <Field label="Description (facultatif)" hint="Dites quand l'utiliser : l'assistant la lit pour choisir entre vos connecteurs.">
          <Textarea maxLength={ACCOUNT_DESCRIPTION_MAX} {...form.register("description")} />
        </Field>
      )}
    </>
  )
}

type FormulaireDAjoutProps = {
  outil: OutilAAjouter
  equipes: Equipe[]
  /** Le nom de départ, sans `nommage` (page de connexion d'un connecteur) : celui de l'outil. */
  nomPropose: string
  /** Ce que le nom proposé lit pour suivre le propriétaire que le partage décide ; absent, le nom reste `nomPropose`. */
  nommage?: Nommage
  /** Le plafond d'outils de l'offre est atteint pour cet outil : la fiche le dit, l'ajout ne part pas. */
  bloque: boolean
  /** À qui partager dès l'ajout, et qui regarde : « Qui pourra s'en servir ». */
  sujets: SujetsDeRegle
  moi: string
  administre: boolean
  annuler: () => void
  /** Le compte est créé : la fenêtre se ferme et son détail s'ouvre. */
  apresAjout: (compte: { id: string }) => void
  /** L'équipe déjà choisie, pour un compte d'équipe : la page de connexion d'un connecteur la pose depuis son adresse. */
  equipe?: string
  /** Sans « Qui pourra s'en servir » : la page de connexion d'un connecteur n'a ni annuaire ni partage à poser. */
  sansPartage?: boolean
  /** L'envoi commence ou finit : la fiche ferme le choix de la façon pendant ce temps. */
  signalerLEnvoi?: (enCours: boolean) => void
}

export function FormulaireDAjout({ outil, equipes, nomPropose, nommage, bloque, sujets, moi, administre, annuler, apresAjout, equipe, sansPartage = false, signalerLEnvoi }: FormulaireDAjoutProps) {
  const rafraichir = useRafraichir()
  const { formulaire } = outil
  const sonde = formulaire?.probe.available === true
  const { essai, essayer, issueConnue, enVue } = useEssaiDeLaCle(outil.connecteur)
  /** Le test raté, sur « Ajouter », demande confirmation : seul « Ajouter quand même » crée alors le compte. */
  const [question, setQuestion] = useState(false)
  const [reste, setReste] = useState<{ id: string; nom: string; suites: string[] } | null>(null)
  // Sans `nommage`, le premier connecteur d'un outil prend son nom sans le demander ; un nom refusé fait paraître le champ.
  const [nomDemande, setNomDemande] = useState(nommage !== undefined || outil.miens.length > 0)
  const nomAFocaliser = useRef(false)
  const proprietaires = proprietairesDe(outil.proprietaires, equipes, nomDe(sujets, moi))
  // L'équipe que l'adresse a choisie (page de connexion d'un connecteur, sans partage) est le propriétaire de départ.
  const proprietaire = proprietaires.find(({ valeur }) => equipe !== undefined && valeur === `team:${equipe}`)?.valeur ?? proprietaires[0]?.valeur ?? "user"
  const [partage, setPartage] = useState<PartageDeLAjout>(() => partageDeDepart(outil.proprietaires, equipes))
  // Avec le partage, c'est lui qui décide du propriétaire ; sans, celui de départ.
  const deduit = sansPartage ? null : proprietaireDuPartage(partage, outil.proprietaires, equipes)
  const nom = nommage && deduit ? nomDuConnecteur(outil, deduit, nommage) : null
  const form = useForm<Saisie>({
    // `raw` : la clé et les réglages, hors du schéma de création, restent dans la saisie rendue.
    resolver: zodResolver(createAccountSchema, undefined, { raw: true }),
    mode: "onBlur",
    defaultValues: { connector: outil.connecteur, ...proprietaireCree(proprietaire), label: nom?.nom ?? nomPropose, ...(formulaire ? saisieDeDepart(formulaire) : SANS_CHAMPS) },
  })
  const { errors, isSubmitting } = form.formState
  // Le compte créé (ses suites dites), le choix reste fermé : une autre façon remonterait le corps, et créerait un second compte.
  useEffect(() => {
    signalerLEnvoi?.(isSubmitting || reste !== null)
  }, [isSubmitting, reste, signalerLEnvoi])
  // Après chaque rendu : le champ du nom, paru sur un nom déjà porté, prend le focus une fois monté.
  useEffect(() => {
    if (!nomAFocaliser.current || !nomDemande) return
    nomAFocaliser.current = false
    form.setFocus("label")
  })
  const erreurDuNom = errors.label ? (errors.label.type === "server" ? errors.label.message : NOM_INVALIDE) : undefined
  const cleDe = (saisie: Partial<SaisieDesChamps>) => (sonde && formulaire ? cleAEssayer(champsDe(saisie), formulaire) : null)

  /** À la sortie d'un champ : la clé complète et pas encore essayée part à la sonde, et la question tombe. */
  function essayerSiPrete() {
    const cle = cleDe(form.getValues())
    if (!cle || enVue(cle)) return
    setQuestion(false)
    void essayer(cle)
  }

  async function creer({ secret, effacer, settings, description = "", ...saisi }: Saisie) {
    if (!sansPartage && !deduit) return form.setError("root", { type: "client", message: SANS_PROPRIETAIRE })
    const compte = deduit ? { ...saisi, ...corpsDuProprietaire(deduit) } : saisi
    const cree = await appelerPlateforme<{ account: { id: string; label: string } }>({ methode: "POST", ressource: "admin/accounts", corps: { ...compte, mode: outil.mode, ...(outil.acces ? { access: outil.acces.nom } : {}) } })
    if (cree.erreur) {
      if (estNomPris(cree.erreur)) {
        // Le champ caché paraît au rendu suivant : le focus l'y attend (effet ci-dessus).
        nomAFocaliser.current = true
        setNomDemande(true)
        form.setError("label", { type: "server", message: NOM_PRIS }, { shouldFocus: true })
      } else form.setError("root", { type: "server", message: refusDuConnecteur(cree.erreur, { outil: outil.libelle, pourMoi: compte.owner_kind === "user" }) })
      return
    }
    const { id, label } = cree.data.account
    const adresse = `admin/accounts/${encodeURIComponent(id)}`
    const charge = formulaire ? chargeDeLaSaisie(champsDe({ secret, effacer, settings }), formulaire) : null
    const suites: string[] = []
    const dire = (quoi: string, erreur: ErreurPlateforme | undefined) => erreur && suites.push(`${quoi} : ${refusDuConnecteur(erreur)}`)
    const pose = charge ? await appelerPlateforme({ methode: "POST", ressource: `${adresse}/secret`, corps: charge }) : null
    dire("Sa clé n'est pas posée", pose?.erreur)
    suites.push(...(await poserLePartage(id, partage, deduit)))
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

  const idDuFormulaire = `ajout-${useId()}`
  if (reste) return <SuitesDeLAjout nom={reste.nom} suites={reste.suites} ouvrir={() => apresAjout({ id: reste.id })} />
  // Au plafond d'outils : rien à saisir ; ce que l'outil ferait, et la sortie.
  if (bloque) {
    return (
      <>
        {outil.fonctions.length > 0 && <FonctionsDuConnecteur titre="Ce que votre assistant pourra faire" fonctions={outil.fonctions} />}
        <PiedDeLaFiche>
          <Button type="button" variant="ghost" onClick={annuler}>
            Annuler
          </Button>
        </PiedDeLaFiche>
      </>
    )
  }
  return (
    <FormProvider {...form}>
      <form id={idDuFormulaire} noValidate aria-label={`Ajouter ${outil.libelle}`} onSubmit={(evenement) => void form.handleSubmit(ajouter)(evenement)} className="flex flex-col gap-3">
        {formulaire && (
          <div className="flex flex-col gap-3" onBlur={essayerSiPrete}>
            <ChampsDuCompte formulaire={formulaire} />
          </div>
        )}
        {sonde && <AnnonceDeLEssai essai={essai} />}
        {formulaire && !sonde && <p className="oto-caption">Pas de test automatique pour cet outil : essayez-le dans votre assistant.</p>}
        {!formulaire && <p className="oto-caption">Aucune clé à saisir pour cet outil.</p>}
        {nomDemande && <NomEtDescription nomPropose={nomPropose} nom={nom} suitLePartage={nommage !== undefined} erreur={erreurDuNom} description={(nom ? nom.deja : outil.miens.length) > 0} />}
        {!sansPartage && (
          <PartageALAjout
            partage={partage}
            changer={setPartage}
            proprietaire={deduit}
            nomDeMoi={nomDe(sujets, moi)}
            refusDeLOrganisation={administre ? undefined : REFUS_DE_L_OUVERTURE.organisation}
            equipesDotables={equipes}
            sujets={sujets}
            actions={outil.fonctions.length > 0 ? actionsParClasse(outil.fonctions) : null}
            administre={administre}
            moi={moi}
          />
        )}
        {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
        {question && (
          <div role="group" aria-label="Ajouter quand même ?" className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">Le test a échoué. Ajouter quand même ?</span>
            <Button type="button" variant="secondary" disabled={isSubmitting} onClick={(evenement) => void form.handleSubmit(ajouterQuandMeme)(evenement)}>
              Ajouter quand même
            </Button>
          </div>
        )}
        {outil.fonctions.length > 0 && <FonctionsDuConnecteur titre="Ce que votre assistant pourra faire" fonctions={outil.fonctions} />}
        {/* Dans le pied fixe de la fenêtre, hors du formulaire : le bouton principal le désigne (`form`). */}
        <PiedDeLaFiche>
          <Button type="button" variant="ghost" onClick={annuler}>
            Annuler
          </Button>
          <Button type="submit" form={idDuFormulaire} variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Ajout…" : "Ajouter le connecteur"}
          </Button>
        </PiedDeLaFiche>
      </form>
    </FormProvider>
  )
}
