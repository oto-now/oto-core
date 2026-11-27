"use client"

// « Importer un fichier… » (E10-S01, AC-a3, AC-b1 à AC-b5) : un dialogue (`Dialog` du design system) dont la zone de
// dépôt est doublée d'un `<input type="file">` accessible au clavier, les limites dites avant la sélection
// (`uploads-patterns.md § Côté composant`). Le fichier est lu par le navigateur, jamais téléversé (HN-E10S01-1) :
// un `.md` devient une page publiée (titre, résumé, morceaux de `readPageMarkdown` ; écrire publie, E11-S02) ;
// un `.csv`, un tableau nouveau ou les lignes d'un tableau existant (`import-csv.tsx`). Ouvert par le « + » du rail, par un fichier lâché
// sur une ligne du rail (`DeposerSurLeRail`), ou sur un tableau (`DepotSurLeTableau`). Sans lui, un fichier ne se
// range qu'à travers un assistant.
import { createContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple"
import { fileExtension, IMPORT_COLUMNS_MAX, IMPORT_FILE_BYTES_MAX, IMPORT_ROWS_MAX, PAGE_MAX, readPageMarkdown, segmentOf, type TableHeader } from "../../schemas"
import { chars } from "../../schemas/blocks"
import { messageDErreur } from "../api/messages"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import { Alert, Button } from "../ds/react/primitives"
import { nombreLisible } from "../format/nombres"
import { useRafraichir } from "../hote/rafraichir"
import { importerUnePage } from "./envoi-d-import"
import { ReglagesDuCsv } from "./import-csv"
import { IMPORT } from "./libelles"

/** Où va un fichier : sous un nœud du rail (une page ou un tableau nouveaux), ou dans un tableau existant (AC-b5). */
export type CibleDImport =
  | { genre: "sous"; parent: string; nom: string; adresses: (segment: string) => string[] }
  | { genre: "tableau"; chemin: string; nom: string; entete: TableHeader }

/** Un import réussi : la page ou le tableau, et les éléments gardés en texte par le mode tolérant (AC-a2). */
export type ImportFait = { chemin: string; conserves: number }

type Lu = { genre: "md"; nom: string; texte: string } | { genre: "csv"; nom: string; octets: ArrayBuffer }

const MEGAOCTETS = nombreLisible(IMPORT_FILE_BYTES_MAX / (1024 * 1024))
const LIMITES = IMPORT.limites(nombreLisible(IMPORT_ROWS_MAX), nombreLisible(IMPORT_COLUMNS_MAX), MEGAOCTETS)
const LIMITES_DU_TABLEAU = IMPORT.limitesDuTableau(nombreLisible(IMPORT_ROWS_MAX), MEGAOCTETS)

/** Un glisser qui porte un fichier, pas une ligne du rail : `dataTransfer.types` contient `Files`. */
export const aDesFichiers = (evenement: DragEvent) => Array.from(evenement.dataTransfer?.types ?? []).includes("Files")

/** Un fichier lâché sur une ligne du rail (AC-a3, AC-b1) : le dialogue s'ouvre sous ce nœud, le fichier lu. */
export const DeposerSurLeRail = createContext<((chemin: string, fichier: File) => void) | null>(null)

/** Un fichier lu par le navigateur, jamais téléversé (HN-E10S01-1) ; ou pourquoi il est refusé avant tout envoi. */
async function lire(fichier: File, cible: CibleDImport): Promise<Lu | { erreur: string }> {
  const extension = fileExtension(fichier.name)
  const markdown = extension === "md" || extension === "markdown"
  if (!markdown && extension !== "csv") return { erreur: IMPORT.formatRefuse }
  if (markdown && cible.genre === "tableau") return { erreur: IMPORT.tableauSeulement }
  if (fichier.size > IMPORT_FILE_BYTES_MAX) return { erreur: IMPORT.tropLourd(MEGAOCTETS) }
  const octets = await fichier.arrayBuffer()
  if (octets.byteLength === 0) return { erreur: IMPORT.vide }
  if (!markdown) return { genre: "csv", nom: fichier.name, octets }
  const texte = new TextDecoder("utf-8").decode(octets)
  if (texte.trim() === "") return { erreur: IMPORT.vide }
  if (chars(texte) > PAGE_MAX) return { erreur: IMPORT.pageTropLongue(nombreLisible(PAGE_MAX)) }
  return { genre: "md", nom: fichier.name, texte }
}

/**
 * La zone de dépôt, qui est aussi le champ de fichier : un clic ou Entrée ouvre le choix du système. `accepte` : ce que
 * propose ce choix, un `.md` ou un `.csv` sans lui ; E10-S02 la reprend pour joindre une image ou un fichier (AC-b4).
 */
export function ZoneDeDepot({ limites, choisir, accepte = ".md,.markdown,.csv,text/markdown,text/csv" }: { limites: string; choisir: (fichier: File) => void; accepte?: string }) {
  const id = useId()
  const [survol, setSurvol] = useState(false)
  const lacher = (evenement: DragEvent<HTMLLabelElement>) => {
    setSurvol(false)
    const fichier = evenement.dataTransfer.files[0]
    if (!fichier) return
    evenement.preventDefault()
    choisir(fichier)
  }
  return (
    <label
      htmlFor={id}
      data-dragover={survol ? "" : undefined}
      // La zone du design system (`oto-filedrop`, survol en `data-dragover`) ; le focus est celui du champ caché qu'elle contient.
      className="oto-filedrop focus-within:ring-2 focus-within:ring-ink"
      onDragOver={(evenement) => {
        if (!aDesFichiers(evenement)) return
        evenement.preventDefault()
        setSurvol(true)
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={lacher}
    >
      <AnimatedIcon as={UploadSimple} size="md" />
      <span className="text-ink">{IMPORT.zone}</span>
      <span>{limites}</span>
      <input
        id={id}
        type="file"
        accept={accepte}
        className="oto-sr-only"
        onChange={(evenement) => {
          const fichier = evenement.target.files?.[0]
          evenement.target.value = ""
          if (fichier) choisir(fichier)
        }}
      />
    </label>
  )
}

/** Un `.md` en page (AC-a3) : le titre et le résumé tirés du fichier, puis la création, publiée, en une requête. */
type PanneauMarkdownProps = {
  lu: Extract<Lu, { genre: "md" }>
  adresses: (segment: string) => string[]
  termine: (fait: ImportFait) => void
  pied: (action: ReactNode) => ReactNode
  /** Dit au dialogue l'envoi en cours, pendant lequel rien ne le ferme. */
  occuper: (occupe: boolean) => void
}

function PanneauMarkdown({ lu, adresses, termine, pied, occuper }: PanneauMarkdownProps) {
  const page = useMemo(() => readPageMarkdown(lu.texte, lu.nom), [lu])
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  async function importer() {
    setEnvoi(true)
    occuper(true)
    setErreur(null)
    const issue = await importerUnePage(lu, adresses(segmentOf(lu.nom)))
    setEnvoi(false)
    occuper(false)
    if ("refus" in issue) return setErreur(issue.refus === "adresses" ? IMPORT.aucuneAdresse : messageDErreur(issue.refus, IMPORT.refus))
    termine(issue)
  }
  return (
    <>
      <dl className="grid gap-1 text-sm">
        <dt className="text-mute">{IMPORT.pageTitre}</dt>
        <dd className="text-ink">{page.title}</dd>
        <dt className="text-mute">{IMPORT.pageResume}</dt>
        <dd className="text-ink">{page.summary}</dd>
      </dl>
      {erreur && <Alert tone="fail">{erreur}</Alert>}
      {pied(
        <Button variant="primary" loading={envoi} onClick={() => void importer()}>
          {envoi ? IMPORT.envoi : IMPORT.importer}
        </Button>,
      )}
    </>
  )
}

type ImportDeFichierProps = {
  cible: CibleDImport
  /** Un fichier déjà lâché (sur le rail ou un tableau) : lu à l'ouverture. */
  fichier?: File | null
  fermer: () => void
  termine: (fait: ImportFait) => void
}

export function ImportDeFichier({ cible, fichier, fermer, termine }: ImportDeFichierProps) {
  const [lu, setLu] = useState<Lu | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [lecture, setLecture] = useState(false)
  async function choisir(choisi: File) {
    setErreur(null)
    setLecture(true)
    // Un fichier que le navigateur ne lit pas (retiré du disque, droits) se dit comme un refus.
    const issue = await lire(choisi, cible).catch(() => ({ erreur: IMPORT.illisible }))
    setLecture(false)
    if ("erreur" in issue) {
      setLu(null)
      return setErreur(issue.erreur)
    }
    setLu(issue)
  }
  // Un fichier lâché est lu une fois, à l'ouverture du dialogue.
  const lache = useRef(fichier ?? null)
  useEffect(() => {
    const premier = lache.current
    lache.current = null
    if (premier) void choisir(premier)
  })
  // Pendant un envoi, rien ne ferme le dialogue (« Annuler », Échap, clic sur le fond, « Fermer ») : il n'arrêterait
  // pas les requêtes déjà parties.
  const [occupe, setOccupe] = useState(false)
  const fermerSiLibre = () => {
    if (!occupe) fermer()
  }
  const pied = (action: ReactNode) => (
    <div className="flex justify-end gap-2">
      <Button onClick={fermer} disabled={occupe}>
        {IMPORT.annuler}
      </Button>
      {action}
    </div>
  )
  const titre = cible.genre === "tableau" ? IMPORT.titreDans(cible.nom) : IMPORT.titre
  return (
    <Dialog open onClose={fermerSiLibre} title={titre} size="lg" description={cible.genre === "tableau" ? LIMITES_DU_TABLEAU : LIMITES}>
      <div className="flex flex-col gap-3">
        {!lu && <ZoneDeDepot limites={cible.genre === "tableau" ? LIMITES_DU_TABLEAU : LIMITES} choisir={(choisi) => void choisir(choisi)} />}
        <p role="status" className="oto-sr-only">
          {lecture ? IMPORT.lecture : ""}
        </p>
        {erreur && <Alert tone="fail">{erreur}</Alert>}
        {lu?.genre === "md" && cible.genre === "sous" && <PanneauMarkdown lu={lu} adresses={cible.adresses} termine={termine} pied={pied} occuper={setOccupe} />}
        {lu?.genre === "csv" && (
          <ReglagesDuCsv
            nom={lu.nom}
            octets={lu.octets}
            tableau={cible.genre === "tableau" ? { chemin: cible.chemin, entete: cible.entete } : null}
            adresses={cible.genre === "sous" ? cible.adresses : () => []}
            termine={(chemin) => termine({ chemin, conserves: 0 })}
            pied={pied}
            occuper={setOccupe}
          />
        )}
        {!lu && pied(null)}
      </div>
    </Dialog>
  )
}

type TableauCible = { chemin: string; titre: string; entete: TableHeader }

/** Le dialogue ouvert sur un tableau, un fichier lâché déjà lu ou non ; après l'import, la page se relit. */
function ImportDansCeTableau({ chemin, titre, entete, fichier, fermer }: TableauCible & { fichier: File | null; fermer: () => void }) {
  const rafraichir = useRafraichir()
  return (
    <ImportDeFichier
      cible={{ genre: "tableau", chemin, nom: titre, entete }}
      fichier={fichier}
      fermer={fermer}
      termine={() => {
        fermer()
        rafraichir()
      }}
    />
  )
}

/**
 * « Importer un fichier… » d'un tableau (E11-S15, AC-a7), dans la rangée des boutons de l'en-tête (« Télécharger… »,
 * « Réglages ») : le dialogue s'ouvre sur ce tableau, au clavier comme au pointeur.
 */
export function ImportDansLeTableau(cible: TableauCible) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" iconStart={<AnimatedIcon as={UploadSimple} size="xs" />} onClick={() => setOuvert(true)}>
        {IMPORT.entree}
      </Button>
      {ouvert && <ImportDansCeTableau {...cible} fichier={null} fermer={() => setOuvert(false)} />}
    </>
  )
}

/**
 * Un tableau qui reçoit un `.csv` lâché sur lui (AC-b5), pour qui l'écrit : le dialogue s'ouvre sur ce tableau, le
 * fichier lu. Le bouton qui l'ouvre au clavier est dans l'en-tête (`ImportDansLeTableau`, E11-S15, AC-a7).
 */
export function DepotSurLeTableau({ children, ...cible }: TableauCible & { children: ReactNode }) {
  const [lache, setLache] = useState<File | null>(null)
  const lacher = (evenement: DragEvent<HTMLDivElement>) => {
    const fichier = evenement.dataTransfer.files[0]
    if (!fichier) return
    evenement.preventDefault()
    setLache(fichier)
  }
  return (
    <div
      className="flex flex-col gap-2"
      onDragOver={(evenement) => {
        if (aDesFichiers(evenement)) evenement.preventDefault()
      }}
      onDrop={lacher}
    >
      {children}
      {lache && <ImportDansCeTableau {...cible} fichier={lache} fermer={() => setLache(null)} />}
    </div>
  )
}
