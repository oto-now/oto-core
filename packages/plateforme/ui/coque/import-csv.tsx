"use client"

// Les réglages d'un CSV à importer (E10-S01, AC-b1 à AC-b5) : l'encodage et le séparateur lus puis modifiables, le
// nom et le type déduits de chaque colonne, modifiables pour un tableau nouveau (`enum` compris), la clé proposée
// ou générée, les colonnes ignorées d'un tableau existant, les dix premiers problèmes de `checkImport` joué sur tout
// le fichier, un aperçu des 20 premières lignes (`Table`), puis l'envoi par lots de 500 avec sa progression et la
// reprise d'un lot refusé. Le fichier est lu par le navigateur, jamais téléversé : seules partent les lignes, en
// JSON. Fichier à part du dialogue (`import-de-fichier.tsx`) pour la borne de 300 lignes d'ESLint.
import { useMemo, useState, type ReactNode } from "react"
import {
  checkImport,
  CSV_SEPARATORS,
  detectSeparator,
  fileBaseName,
  NODE_HEAD_MAX,
  parseCsv,
  segmentOf,
  type ColumnType,
  type CsvSeparator,
  type ImportProblem,
  type TableHeader,
} from "../../schemas"
import { COLUMN_TYPES, KEY_COLUMN_TYPES } from "../../schemas/tables"
import { messageDErreur } from "../api/messages"
import { Field } from "../ds/react/forms"
import { Alert, Button } from "../ds/react/primitives"
import { Progress } from "../ds/react/progress"
import { Select } from "../ds/react/select"
import { Table, type Column } from "../ds/react/table"
import { nombreLisible } from "../format/nombres"
import { colonnesEnvoyees, decoder, encodageDe, envoyerLesLots, planDuCsv, type Choix, type Encodage, type PlanDuCsv, type Refus } from "./envoi-d-import"
import { IMPORT } from "./libelles"

/** Lignes de l'aperçu (AC-b1), problèmes listés avant « et N autres » (AC-b4). */
const APERCU = 20
const PROBLEMES_MONTRES = 10

/** Une valeur citée par un problème : coupée à 50 caractères (AC-b4). */
const coupee = (valeur: string) => (Array.from(valeur).length > 50 ? `${Array.from(valeur).slice(0, 49).join("")}…` : valeur)

/** La phrase d'un problème, en français, par sa nature (le texte anglais est servi au modèle). */
export function phraseDuProbleme(probleme: ImportProblem): string {
  const ligne = probleme.line ?? 0
  const colonne = probleme.column ?? ""
  if (probleme.kind === "cells") return IMPORT.cellules(ligne, probleme.value, probleme.expected)
  if (probleme.kind === "key_missing") return IMPORT.cleAbsente(colonne)
  if (probleme.kind === "value") return IMPORT.cellule(ligne, colonne, coupee(probleme.value), IMPORT.attendus[probleme.type ?? "text"])
  if (probleme.first !== undefined) return IMPORT.cleEnDouble(ligne, colonne, coupee(probleme.value), probleme.first)
  return probleme.value.trim() === "" ? IMPORT.cleVide(ligne, colonne) : IMPORT.cleInvalide(ligne, colonne, coupee(probleme.value))
}

function Problemes({ problemes }: { problemes: readonly ImportProblem[] }) {
  if (problemes.length === 0) return null
  const reste = problemes.length - PROBLEMES_MONTRES
  return (
    <Alert tone="fail" title={IMPORT.problemes}>
      {problemes.slice(0, PROBLEMES_MONTRES).map(phraseDuProbleme).join(" ")}
      {reste > 0 ? ` ${IMPORT.etAutres(reste)}.` : ""}
    </Alert>
  )
}

const optionsDesTypes = COLUMN_TYPES.map((type) => ({ value: type, label: IMPORT.types[type] }))
const optionsDEncodage = [
  { value: "utf-8", label: "UTF-8" },
  { value: "windows-1252", label: "Windows-1252" },
]
const optionsDesSeparateurs = CSV_SEPARATORS.map((un) => ({ value: un, label: IMPORT.separateurs[un] }))
const typeDe = (valeur: string): ColumnType => COLUMN_TYPES.find((type) => type === valeur) ?? "text"

/** Le type de chaque colonne d'un tableau nouveau, modifiable (AC-b1). */
function TypesDesColonnes({ plan, choisir }: { plan: PlanDuCsv; choisir: (colonne: string, type: ColumnType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {plan.columns.map((colonne) => (
        <Field key={colonne.name} label={colonne.name}>
          <Select value={colonne.type} options={optionsDesTypes} aria-label={IMPORT.type(colonne.name)} onChange={(evenement) => choisir(colonne.name, typeDe(evenement.target.value))} />
        </Field>
      ))}
    </div>
  )
}

/** L'en-tête d'une colonne de l'aperçu (AC-b1) : la cellule d'en-tête du fichier, puis le nom qui en est tiré. */
function EnTeteDeColonne({ entete, nom }: { entete: string; nom: string | null }) {
  return (
    <>
      {entete}
      <span className="oto-caption block">{nom ?? IMPORT.colonneIgnoree}</span>
    </>
  )
}

/** Les colonnes de l'aperçu : l'en-tête du fichier et le nom de chaque colonne ; `null`, une colonne ignorée. */
function colonnesDeLApercu(plan: PlanDuCsv): Column<{ id: number; cellules: readonly string[] }>[] {
  return plan.names.map((nom, rang) => ({ key: String(rang), header: <EnTeteDeColonne entete={plan.entetes[rang] ?? ""} nom={nom} />, render: (ligne) => ligne.cellules[rang] ?? "" }))
}

function Apercu({ plan }: { plan: PlanDuCsv }) {
  const lignes = plan.rows.slice(0, APERCU).map((cellules, id) => ({ id, cellules }))
  return <Table caption={IMPORT.apercu(lignes.length, nombreLisible(plan.rows.length))} responsive="scroll" columns={colonnesDeLApercu(plan)} rows={lignes} />
}

/** Les choix d'une clé (AC-b2) : les colonnes qui peuvent la porter, puis la colonne générée. */
function optionsDeLaCle(plan: PlanDuCsv): { value: string; label: string }[] {
  const colonnes = plan.columns.filter((colonne) => KEY_COLUMN_TYPES.includes(colonne.type) && !(plan.cleGeneree && colonne.name === plan.key))
  return [...colonnes.map((colonne) => ({ value: colonne.name, label: colonne.name })), { value: "", label: IMPORT.cleGeneree("ligne") }]
}

type Arret = { refus: Refus; chemin: string | null; faites: number }

type Proprietes = {
  nom: string
  octets: ArrayBuffer
  /** Un tableau existant (AC-b5) ; sans lui, un tableau nouveau sous `adresses` (AC-b3). */
  tableau: { chemin: string; entete: TableHeader } | null
  adresses: (segment: string) => string[]
  termine: (chemin: string) => void
  pied: (action: ReactNode) => ReactNode
  /** Dit au dialogue l'envoi des lots, pendant lequel rien ne le ferme. */
  occuper: (occupe: boolean) => void
}

/** L'envoi et sa reprise (AC-b3, AC-b4) : les lots depuis une ligne, la progression, l'arrêt sur un refus. */
function useEnvoi({ nom, tableau, adresses, termine, occuper }: Proprietes, plan: PlanDuCsv | null) {
  const [progression, setProgression] = useState<{ faites: number; total: number } | null>(null)
  const [arret, setArret] = useState<Arret | null>(null)
  async function envoyer(depuis: number, dejaCree: string | null) {
    if (!plan) return
    const { colonnes, lignes } = colonnesEnvoyees(plan)
    const titre = fileBaseName(nom).slice(0, NODE_HEAD_MAX) || nom.slice(0, NODE_HEAD_MAX)
    const creation = plan.entete ? { title: titre, summary: IMPORT.resumeDuTableau(nom, nombreLisible(lignes.length)).slice(0, NODE_HEAD_MAX), header: plan.entete } : null
    const cible = tableau?.chemin ?? dejaCree
    const lots = { tableau: cible !== null || !creation ? { chemin: cible ?? "" } : { adresses: adresses(segmentOf(nom)), creation }, source: { file_name: nom }, colonnes, lignes }
    setArret(null)
    setProgression({ faites: depuis, total: lignes.length })
    occuper(true)
    const issue = await envoyerLesLots(lots, depuis, (faites) => setProgression({ faites, total: lignes.length }))
    setProgression(null)
    occuper(false)
    if ("refus" in issue) return setArret(issue)
    termine(issue.chemin)
  }
  return { progression, arret, envoyer }
}

function phraseDuRefus(refus: Refus): string {
  return refus === "adresses" ? IMPORT.aucuneAdresse : messageDErreur(refus, IMPORT.refus)
}

export function ReglagesDuCsv(proprietes: Proprietes) {
  const { octets, tableau } = proprietes
  const [encodage, setEncodage] = useState<Encodage>(() => encodageDe(octets))
  const texte = useMemo(() => decoder(octets, encodage), [octets, encodage])
  const [separateur, setSeparateur] = useState<CsvSeparator>(() => detectSeparator(texte))
  const [choix, setChoix] = useState<Choix>({ types: {} })
  const lu = useMemo(() => parseCsv(texte, separateur), [texte, separateur])
  const plan = useMemo(() => ("unclosedQuote" in lu ? null : planDuCsv(lu, { tableau: tableau?.entete ?? null, choix })), [lu, tableau, choix])
  const controle = useMemo(() => (plan ? checkImport(plan) : null), [plan])
  const envoi = useEnvoi(proprietes, plan)
  const pret = controle !== null && controle.tooLarge === null && controle.problems.length === 0 && envoi.progression === null
  const total = plan ? nombreLisible(plan.rows.length) : "0"
  const action = (
    <Button variant="primary" disabled={!pret} loading={envoi.progression !== null} onClick={() => void envoi.envoyer(0, null)}>
      {envoi.progression ? IMPORT.envoi : IMPORT.importer}
    </Button>
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label={IMPORT.encodage}>
          <Select value={encodage} options={optionsDEncodage} onChange={(evenement) => setEncodage(evenement.target.value === "utf-8" ? "utf-8" : "windows-1252")} />
        </Field>
        <Field label={IMPORT.separateur}>
          <Select value={separateur} options={optionsDesSeparateurs} onChange={(evenement) => setSeparateur(CSV_SEPARATORS.find((un) => un === evenement.target.value) ?? ";")} />
        </Field>
      </div>
      {"unclosedQuote" in lu && <Alert tone="fail">{IMPORT.guillemet(lu.unclosedQuote)}</Alert>}
      {plan && !tableau && (
        <Field label={IMPORT.cle}>
          <Select value={plan.cleGeneree ? "" : plan.key} options={optionsDeLaCle(plan)} onChange={(evenement) => setChoix({ ...choix, cle: evenement.target.value || null })} />
        </Field>
      )}
      {plan && !tableau && <TypesDesColonnes plan={plan} choisir={(colonne, type) => setChoix({ ...choix, types: { ...choix.types, [colonne]: type } })} />}
      {plan && plan.ignorees.length > 0 && <p className="text-sm text-mute">{IMPORT.ignorees(plan.ignorees.join(", "))}</p>}
      {controle?.tooLarge && <Alert tone="fail">{IMPORT.tropGrand}</Alert>}
      {controle && <Problemes problemes={controle.problems} />}
      {plan && <Apercu plan={plan} />}
      {/* La progression de l'envoi (AC-b3). */}
      {envoi.progression && <Progress label={IMPORT.progression} value={envoi.progression.faites} max={envoi.progression.total} />}
      {envoi.arret && (
        <Alert tone="fail" actions={<Button onClick={() => void envoi.envoyer(envoi.arret?.faites ?? 0, envoi.arret?.chemin ?? null)}>{IMPORT.reprendre}</Button>}>
          {`${phraseDuRefus(envoi.arret.refus)} ${IMPORT.ecrites(nombreLisible(envoi.arret.faites), total)}`}
        </Alert>
      )}
      {proprietes.pied(action)}
    </>
  )
}
