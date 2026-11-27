"use client"

// La file des écritures d'un nœud (E05-S02, AC10 à AC18 ; HN-E05S02-1, HN-E05S02-18) : une seule, posée
// par l'écran autour de la colonne de la page, servant l'éditeur, l'en-tête et la publication. Elle
// envoie une écriture après l'autre, dans l'ordre des gestes, à `POST /api/platform/nodes`, avec la
// révision publiée lue ; l'en-tête et la publication partent avec le dernier tampon du brouillon. Elle
// adopte la révision et le tampon de chaque réponse, reprend ceux d'une relecture quand rien n'est en
// vol, s'arrête au premier refus et repart de l'écriture refusée. Sans elle, deux gestes rapides
// partiraient dans le désordre, et l'en-tête partirait sur le tampon du chargement, refusé dès le
// premier bloc enregistré (M02).
//
// E05-S10 (AC-a6) : elle relie aussi la publication seule aux champs de la page. Un champ y signale chaque
// frappe (`frapper`) et y inscrit ce qu'il fait avant une publication (`participer` : envoyer son texte en
// attente, dire s'il la retient) ; la publication écoute les frappes et publie 3 s après la dernière. Sans ce
// relais, l'en-tête d'un tableau, qui n'a pas d'éditeur de blocs, ne publierait jamais seul.
//
// E10-S01 : la réponse dit ce que le mode tolérant a gardé en texte (`kept_as_text`, AC-a2), et la file donne le
// chemin de sa page, sous lequel la conversion d'un tableau simple range le tableau (AC-b7).
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import type { WriteNodeBody } from "../../../schemas"
import { appelerPlateforme, type ErreurPlateforme } from "../../api/client"

/** Le corps d'une écriture, sans le chemin, la révision publiée ni le tampon, que la file pose. */
export type CorpsDEnvoi = Omit<WriteNodeBody, "path" | "base_revision" | "draft_stamp">

/** Ce que rend `POST /api/platform/nodes` (E03-S03, AC37) et que l'écran lit. */
export type ReponseDEcriture = {
  revision: number
  status: string
  draft_stamp: string | null
  touched: { op: string; blocks: { id: string; ref: string; revision: number }[] }[]
  /** Les constructions gardées en texte par le mode tolérant (E10-S01, AC-a2) ; absent en mode strict. */
  kept_as_text?: number
  /** Les avertissements d'une publication (liens, conseils d'une procédure), en anglais ; absent sans avertissement. */
  warnings?: string[]
}

export type IssueDEnvoi =
  | { data: ReponseDEcriture; erreur?: never }
  | { data?: never; erreur: ErreurPlateforme; revisionEnvoyee: number }

/**
 * Une écriture en attente : son corps, calculé au moment de l'envoi (les `id` adoptés entre-temps y
 * entrent ; `null` : plus rien à envoyer), le tampon s'il le faut, et ce que devient l'écriture.
 */
export type Envoi = {
  corps: () => CorpsDEnvoi | null
  tampon?: boolean
  /** La requête survit à la fermeture de l'onglet : la publication, qui part aussi à la sortie de la page (AC-a6). */
  keepalive?: boolean
  issue: (issue: IssueDEnvoi) => void
}

/** `ecrit` : une écriture de cette page a abouti ; le brouillon ouvert est alors celui de la personne (E05-S10, AC-a6). */
type Instantane = { revision: number; tampon: string | null; brouillon: boolean; occupee: boolean; arretee: boolean; ecrit: boolean }

/**
 * Un champ de la page, pour la publication seule (E05-S10, AC-a6) : `vider` envoie son texte en attente,
 * `retient` dit qu'il la retient (texte refusé par le contrôle, conflit ouvert).
 */
export type Participant = { vider: () => void; retient: () => boolean }

export type File = Instantane & {
  /** Le chemin de la page, que la file écrit. */
  chemin: string
  envoyer: (envoi: Envoi) => void
  /** Renvoie l'écriture refusée, puis les suivantes (AC15, AC18). */
  relancer: () => void
  /** Remplace l'écriture refusée (texte final d'un conflit), ou l'abandonne (`null`), puis repart. */
  remplacerLArret: (envoi: Envoi | null) => void
  /** Une frappe, un geste de la personne : la publication seule repart de là (E05-S10, AC-a6). */
  frapper: () => void
  ecouterLesFrappes: (ecouteur: () => void) => () => void
  participer: (participant: Participant) => () => void
  /**
   * Chaque champ envoie son texte en attente ; `true` si rien ne retient la publication. `sortie` : l'onglet se
   * ferme peut-être (`pagehide`, onglet caché) ; les textes vidés partent alors en `keepalive`, comme la publication.
   */
  preparer: (sortie?: boolean) => boolean
  /** Un brouillon est ouvert, lu à l'instant de l'envoi : une publication sans brouillon ne part pas. */
  aUnBrouillon: () => boolean
}

type Servi = { revision: number; tampon: string | null }

function plusRecent(courant: string | null, servi: string | null): string | null {
  if (courant === null || servi === null) return courant ?? servi
  return Date.parse(servi) > Date.parse(courant) ? servi : courant
}

/** Une relecture : une révision plus haute l'emporte ; à révision égale, le tampon le plus récent. */
function avecServi(courant: Servi, servi: Servi): Servi {
  if (servi.revision !== courant.revision) return servi.revision > courant.revision ? servi : courant
  return { revision: courant.revision, tampon: plusRecent(courant.tampon, servi.tampon) }
}

class FileDEnvois {
  private envois: Envoi[] = []
  private enVol = false
  private arretee = false
  private ecrit = false
  /** Pendant `preparer(true)` : les écritures que les champs y envoient survivent à la fermeture de l'onglet. */
  private aLaSortie = false
  private etat: Servi
  private instantane: Instantane
  private readonly abonnes = new Set<() => void>()
  private readonly ecouteurs = new Set<() => void>()
  private readonly participants = new Set<Participant>()

  constructor(
    private readonly chemin: string,
    servi: Servi,
  ) {
    this.etat = servi
    this.instantane = this.photo()
  }

  abonner = (abonne: () => void) => {
    this.abonnes.add(abonne)
    return () => void this.abonnes.delete(abonne)
  }

  lire = () => this.instantane

  private photo(): Instantane {
    const { revision, tampon } = this.etat
    return { revision, tampon, brouillon: tampon !== null, occupee: this.envois.length > 0, arretee: this.arretee, ecrit: this.ecrit }
  }

  frapper = () => {
    for (const ecouteur of this.ecouteurs) ecouteur()
  }

  ecouterLesFrappes = (ecouteur: () => void) => {
    this.ecouteurs.add(ecouteur)
    return () => void this.ecouteurs.delete(ecouteur)
  }

  participer = (participant: Participant) => {
    this.participants.add(participant)
    return () => void this.participants.delete(participant)
  }

  preparer = (sortie = false): boolean => {
    this.aLaSortie = sortie
    try {
      for (const participant of this.participants) participant.vider()
    } finally {
      this.aLaSortie = false
    }
    return !this.arretee && ![...this.participants].some((participant) => participant.retient())
  }

  aUnBrouillon = () => this.etat.tampon !== null

  private changer(): void {
    this.instantane = this.photo()
    for (const abonne of this.abonnes) abonne()
  }

  envoyer = (envoi: Envoi) => {
    this.envois.push(this.aLaSortie ? { ...envoi, keepalive: true } : envoi)
    this.changer()
    void this.pomper()
  }

  relancer = () => {
    if (!this.arretee) return
    this.arretee = false
    this.changer()
    void this.pomper()
  }

  remplacerLArret = (envoi: Envoi | null) => {
    if (!this.arretee) return
    this.envois.shift()
    if (envoi) this.envois.unshift(envoi)
    this.relancer()
  }

  recevoirServi = (servi: Servi) => {
    if (this.enVol) return
    const suite = avecServi(this.etat, servi)
    if (suite.revision === this.etat.revision && suite.tampon === this.etat.tampon) return
    this.etat = suite
    this.changer()
  }

  private async pomper(): Promise<void> {
    const envoi = this.envois[0]
    if (this.enVol || this.arretee || !envoi) return
    const corps = envoi.corps()
    if (corps === null) {
      this.envois.shift()
      this.changer()
      return this.pomper()
    }
    this.enVol = true
    const revisionEnvoyee = this.etat.revision
    const tampon = envoi.tampon && this.etat.tampon !== null ? { draft_stamp: this.etat.tampon } : {}
    const reponse = await appelerPlateforme<ReponseDEcriture>({
      methode: "POST",
      ressource: "nodes",
      // Chaque écriture garde le brouillon ; seule la publication, qui suit les frappes, pose `publish: true`
      // (E11-S02, AC-c2 : `write` publie par défaut, HN-E11S02-21).
      corps: { path: this.chemin, base_revision: revisionEnvoyee, ...tampon, publish: false, ...corps },
      keepalive: envoi.keepalive,
    })
    this.enVol = false
    if (reponse.erreur) {
      this.arretee = true
      this.changer()
      envoi.issue({ erreur: reponse.erreur, revisionEnvoyee })
      return
    }
    this.envois.shift()
    this.etat = { revision: reponse.data.revision, tampon: reponse.data.draft_stamp }
    this.ecrit = true
    this.changer()
    envoi.issue({ data: reponse.data })
    return this.pomper()
  }
}

const ContexteDeLaFile = createContext<File | null>(null)

/**
 * Le chemin seul, qui ne change pas quand la file s'occupe : un champ de l'éditeur qui le lit (« @ », les contenus
 * récents hors de la page) n'est pas rendu à nouveau à chaque écriture, comme le serait tout lecteur de la file.
 */
const ContexteDuChemin = createContext<string | null>(null)

/** La file de la page ouverte ; un îlot d'écriture n'est monté que sous `FileDOperations`. */
export function useFileDOperations(): File {
  const file = useContext(ContexteDeLaFile)
  if (!file) throw new Error("useFileDOperations : îlot monté hors de FileDOperations.")
  return file
}

/** Le chemin de la page que la file écrit, sans s'abonner à son état. */
export function useCheminDeLaFile(): string {
  const chemin = useContext(ContexteDuChemin)
  if (chemin === null) throw new Error("useCheminDeLaFile : îlot monté hors de FileDOperations.")
  return chemin
}

type FileDOperationsProps = { chemin: string; revisionPubliee: number; tampon: string | null; children: ReactNode }

export function FileDOperations({ chemin, revisionPubliee, tampon, children }: FileDOperationsProps) {
  const [file] = useState(() => new FileDEnvois(chemin, { revision: revisionPubliee, tampon }))
  useEffect(() => file.recevoirServi({ revision: revisionPubliee, tampon }), [file, revisionPubliee, tampon])
  const instantane = useSyncExternalStore(file.abonner, file.lire, file.lire)
  const valeur = useMemo<File>(
    () => ({
      ...instantane,
      chemin,
      envoyer: file.envoyer,
      relancer: file.relancer,
      remplacerLArret: file.remplacerLArret,
      frapper: file.frapper,
      ecouterLesFrappes: file.ecouterLesFrappes,
      participer: file.participer,
      preparer: file.preparer,
      aUnBrouillon: file.aUnBrouillon,
    }),
    [instantane, file, chemin],
  )
  return (
    <ContexteDuChemin.Provider value={chemin}>
      <ContexteDeLaFile.Provider value={valeur}>{children}</ContexteDeLaFile.Provider>
    </ContexteDuChemin.Provider>
  )
}
