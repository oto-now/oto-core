"use client"

// L'inscription d'une organisation (E12-S01, ADR-023) : l'îlot que la page de l'hôte monte dans
// `EcranDAuthentification`, sous sa `CoquilleOto`, pour une personne connectée qui n'appartient à aucune organisation.
// Un seul champ, le nom : l'adresse (slug) et le préfixe des outils s'en déduisent sans champ à l'écran, et ne
// redeviennent saisissables que s'il le faut (adresse ou préfixe déjà pris, nom dont on ne tire rien de valide). Le nom
// se juge à la sortie de son champ ou à Entrée, jamais pendant la frappe : un nom en cours donne une adresse trop
// courte, et les champs clignoteraient. L'adresse
// que l'hôte donnera se lit sous le champ au fil de la frappe : après une pause, l'aperçu de `POST /api/platform/signup`
// (sans `confirm`, rien n'est écrit) la rend, ou dit qu'elle est prise ; un seul bouton, « Créer l'organisation », envoie
// la confirmation, puis la personne part à l'adresse de sa nouvelle organisation dès que celle-ci répond
// (`DepartVersLOrganisation`). Les champs se contrôlent sur le schéma de l'API
// (`signupSchema`). Sans lui, l'hôte recréerait le formulaire et ses règles.
import { useEffect, useRef, useState, type FormEvent } from "react"
import { signupSchema, type SignupInput } from "../../schemas"
import { appelerPlateforme, type ErreurPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { IlotDAuthentification } from "../authentification/ilot-d-authentification"
import { LIEN } from "../components/classes"
import { Checkbox } from "../ds/react/checkbox"
import { Field, Input } from "../ds/react/forms"
import { Button } from "../ds/react/primitives"
import { DepartVersLOrganisation } from "./depart-vers-l-organisation"

/** Ce que rend la route : l'aperçu (adresses), ou l'organisation créée et ses adresses. */
type Apercu = { created: false; addresses: { hosts: string[] } }
type Creee = { created: true; hosts: string[] }

const MESSAGES = {
  conflict: "Cette adresse ou ce préfixe est déjà pris : choisissez-en un autre.",
  invalid_arguments: "Vérifiez le nom, l'adresse et le préfixe.",
} as const

/** Dit quand le nom ne donne ni adresse ni préfixe valides (nom tout en chiffres, caractères non latins). */
const A_CHOISIR = "Ce nom ne donne pas d'adresse ou de préfixe valide : choisissez-les."

/** Une adresse compte au moins deux caractères (`orgSlugSchema`) : en dessous, c'est le nom qui est trop court. */
const NOM_MIN = 2
const TROP_COURT = `Le nom doit compter au moins ${NOM_MIN} caractères.`

/** L'aperçu de l'adresse part après une courte pause de frappe (`forms-patterns.md § Validation asynchrone`). */
const PAUSE_MS = 400

/** Ce que vaut le nom une fois saisi : trop court, sans adresse ni préfixe à en tirer, ou bon (`null`). */
type Verdict = "court" | "a_choisir" | null

function verdictDuNom(nom: string): Verdict {
  const saisi = nom.trim()
  if (saisi === "") return null
  if (saisi.length < NOM_MIN) return "court"
  const slug = slugPropose(saisi)
  return deduits(slug, prefixePropose(slug)) ? null : "a_choisir"
}

/** L'adresse et le préfixe passent-ils les règles de l'API (`signupSchema`) ? */
function deduits(slug: string, prefixe: string): boolean {
  return signupSchema.shape.org.safeParse(slug).success && signupSchema.shape.prefix.safeParse(prefixe).success
}

/** Le nom réduit en étiquette d'adresse : minuscules sans accents, tirets, 40 caractères, comme `orgSlugSchema`. */
export function slugPropose(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
}

/** Le préfixe des outils tiré de l'adresse : lettres et chiffres, une lettre d'abord, 12 au plus, comme `toolPrefixSchema`. */
export function prefixePropose(slug: string): string {
  const lettres = slug.replace(/[^a-z0-9]/g, "").replace(/^[0-9]+/, "")
  return lettres.slice(0, 12)
}

/** Un refus dit en français ; le texte du contrôle d'abus de l'hôte, dans sa langue, tel quel. */
function refusDit(erreur: ErreurPlateforme): string {
  const texteDeLHote = erreur.details?.text
  if (erreur.raison === "signup_refused" && typeof texteDeLHote === "string") return texteDeLHote
  return messageDErreur(erreur, MESSAGES)
}

/**
 * `conditions` : les conditions de l'hôte (libellé et adresse) ; posées, une case obligatoire, cochée avant tout envoi,
 * part en `accepted_terms` vers `admit`, qui en garde la preuve. Sans elles, aucune case.
 */
export type FormulaireDInscriptionProps = { conditions?: { libelle: string; url: string } }

export function FormulaireDInscription({ conditions }: FormulaireDInscriptionProps = {}) {
  const [nom, setNom] = useState("")
  const [acceptees, setAcceptees] = useState(false)
  const [slug, setSlug] = useState<string | null>(null)
  const [prefixe, setPrefixe] = useState<string | null>(null)
  const [adresse, setAdresse] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [pris, setPris] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)
  // Un conflit dit par l'aperçu pendant que le nom se tape : les champs ne viennent qu'à la sortie du champ.
  const [conflitVu, setConflitVu] = useState(false)
  const [creee, setCreee] = useState<string | null>(null)
  const nomActif = useRef(false)
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Le rang de la dernière demande : la réponse d'un aperçu dépassé (frappe ou envoi depuis) est ignorée.
  const demande = useRef(0)

  // Tant que la personne ne les touche pas, adresse et préfixe suivent le nom.
  const slugVu = slug ?? slugPropose(nom)
  const prefixeVu = prefixe ?? prefixePropose(slugVu)
  // Les deux champs ne se montrent que s'il le faut : refus `conflict`, nom jugé sans rien de valide à en tirer, ou
  // champs déjà repris en main (ils ne disparaissent pas sous la frappe).
  const inexploitable = verdict === "a_choisir"
  const aSaisir = pris || inexploitable || slug !== null || prefixe !== null
  const tropCourt = verdict === "court" && nom.trim().length < NOM_MIN
  const saisie: SignupInput = { name: nom.trim(), org: slugVu, prefix: prefixeVu, ...(conditions ? { accepted_terms: acceptees } : {}) }
  const apercevable = signupSchema.safeParse(saisie).success
  const valide = apercevable && (!conditions || acceptees)
  const cle = JSON.stringify(saisie)

  // L'aperçu : rien n'est écrit. Un conflit se dit ; tout autre refus se tait ici et se dira à l'envoi (le contrôle
  // d'abus de l'hôte peut refuser tant que ses conditions ne sont pas cochées).
  useEffect(() => {
    if (!apercevable) return
    const rang = ++demande.current
    minuterie.current = setTimeout(() => {
      void appelerPlateforme<Apercu | Creee>({ methode: "POST", ressource: "signup", corps: { ...JSON.parse(cle), confirm: false } }).then((reponse) => {
        if (demande.current !== rang) return
        if (reponse.erreur) {
          if (reponse.erreur.code !== "conflict") return
          setErreur(refusDit(reponse.erreur))
          if (nomActif.current) setConflitVu(true)
          else setPris(true)
          return
        }
        if (!reponse.data.created) setAdresse(reponse.data.addresses.hosts[0] ?? null)
      })
    }, PAUSE_MS)
    return () => clearTimeout(minuterie.current)
  }, [cle, apercevable])

  function changer(action: () => void) {
    action()
    setAdresse(null)
    setErreur(null)
    setConflitVu(false)
  }

  function quitterLeNom() {
    nomActif.current = false
    setVerdict(verdictDuNom(nom))
    if (conflitVu) setPris(true)
  }

  async function envoyer(evenement: FormEvent) {
    evenement.preventDefault()
    if (!valide || envoi) return
    // L'envoi dépasse tout aperçu en attente ou en route.
    clearTimeout(minuterie.current)
    demande.current += 1
    setEnvoi(true)
    setErreur(null)
    const reponse = await appelerPlateforme<Apercu | Creee>({ methode: "POST", ressource: "signup", corps: { ...saisie, confirm: true } })
    if (reponse.erreur) {
      if (reponse.erreur.code === "conflict") setPris(true)
      setErreur(refusDit(reponse.erreur))
      return void setEnvoi(false)
    }
    const hote = reponse.data.created ? reponse.data.hosts[0] : undefined
    if (hote) setCreee(`${window.location.protocol}//${hote}/`)
    else setEnvoi(false)
  }

  if (creee) return <DepartVersLOrganisation adresse={creee} />

  const pied = (
    <Button type="submit" form="inscription" variant="primary" block disabled={!valide || envoi} aria-busy={envoi}>
      {envoi ? "Envoi…" : "Créer l'organisation"}
    </Button>
  )

  return (
    <IlotDAuthentification titre="Créer votre organisation" pied={pied}>
      <form id="inscription" noValidate onSubmit={(evenement) => void envoyer(evenement)} className="flex flex-col gap-3">
        <Field label="Nom de l'organisation">
          <Input
            type="text"
            autoComplete="organization"
            value={nom}
            maxLength={80}
            onChange={(e) => changer(() => setNom(e.target.value))}
            onFocus={() => {
              nomActif.current = true
            }}
            onBlur={quitterLeNom}
            onKeyDown={(e) => {
              if (e.key === "Enter") setVerdict(verdictDuNom(nom))
            }}
          />
        </Field>
        {tropCourt && <p className="text-sm text-ink">{TROP_COURT}</p>}
        {aSaisir && (
          <>
            {inexploitable && !pris && <p className="text-sm text-ink">{A_CHOISIR}</p>}
            <Field label="Adresse" hint="Lettres minuscules, chiffres et tirets.">
              <Input type="text" autoComplete="off" value={slugVu} maxLength={40} onChange={(e) => changer(() => setSlug(e.target.value.toLowerCase()))} />
            </Field>
            <Field label="Préfixe des outils" hint="Il nomme les outils de vos assistants (préfixe_context…) et ne changera plus.">
              <Input type="text" autoComplete="off" value={prefixeVu} maxLength={12} onChange={(e) => changer(() => setPrefixe(e.target.value.toLowerCase()))} />
            </Field>
          </>
        )}
        {conditions && (
          <Checkbox
            required
            checked={acceptees}
            onChange={(e) => {
              setAcceptees(e.target.checked)
              setErreur(null)
            }}
            label={
              <>
                {"J'accepte les "}
                <a href={conditions.url} target="_blank" rel="noreferrer" className={LIEN}>
                  {conditions.libelle}
                </a>
              </>
            }
          />
        )}
        <p aria-live="polite" className="text-sm text-ink">
          {adresse ? `Votre organisation sera servie à ${adresse}.` : ""}
        </p>
        {erreur && (
          <p role="alert" className="text-sm text-ink">
            {erreur}
          </p>
        )}
      </form>
    </IlotDAuthentification>
  )
}
