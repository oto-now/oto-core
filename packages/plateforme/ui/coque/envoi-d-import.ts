// Ce que prépare et envoie un import (E10-S01, AC-a3, AC-b1 à AC-b5, AC-b7) : le plan d'un CSV (noms, types, clé,
// lignes) que le dialogue montre et que `checkImport` contrôle ; une page tirée d'un `.md`, en une requête (`POST
// nodes`, opérations en mode tolérant) ; les lignes d'un CSV, par lots de 500 (`POST tables/import`), le premier
// créant le tableau. Chaque création essaie les adresses tirées du nom du fichier, comme le « + » du rail. Fichier à
// part du dialogue (`import-de-fichier.tsx`) pour la borne de 300 lignes d'ESLint ; la conversion d'un tableau
// simple (`gestes-du-menu.ts`) envoie ses lignes par le même chemin. Aucune règle du service n'y est refaite : les
// lectures et le contrôle viennent de `schemas/` (`portage-ecrans.md § 6`).
import {
  columnNameOf,
  columnNames,
  IMPORT_LOT_ROWS,
  inferTable,
  readPageMarkdown,
  withLineKey,
  type ColumnType,
  type CsvTable,
  type ImportColumn,
  type ImportPlan,
  type TableHeader,
  type TableImportBody,
} from "../../schemas"
import { tableColumnSchema } from "../../schemas/tables"
import { appelerPlateforme, type ErreurPlateforme } from "../api/client"

/** L'encodage d'un CSV lu (AC-b1) : UTF-8 s'il se décode sans faute, sinon Windows-1252 ; modifiable. */
export type Encodage = "utf-8" | "windows-1252"

export function encodageDe(octets: ArrayBuffer): Encodage {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(octets)
    return "utf-8"
  } catch {
    // Une suite d'octets qu'UTF-8 refuse : un export de tableur sous Windows.
    return "windows-1252"
  }
}

export const decoder = (octets: ArrayBuffer, encodage: Encodage) => new TextDecoder(encodage).decode(octets)

/** Les réglages d'un tableau nouveau (AC-b1) : le type choisi d'une colonne, la clé choisie (`null` : générée). */
export type Choix = { types: Readonly<Record<string, ColumnType>>; cle?: string | null }

/** Un plan d'import : ce que `checkImport` contrôle, les colonnes ignorées, et l'en-tête d'un tableau à créer. */
export type PlanDuCsv = ImportPlan & {
  ignorees: string[]
  entete: NonNullable<TableImportBody["create"]>["header"] | null
  cleGeneree: boolean
  /** L'en-tête du fichier, cellule par cellule, que le dialogue montre au-dessus du nom tiré de chacune (AC-b1). */
  entetes: string[]
}

/** Les valeurs distinctes d'une colonne, les options d'une colonne `enum` choisie à l'écran (HN-E10S01-3). */
function valeursDe(lignes: readonly (readonly string[])[], rang: number): string[] {
  return [...new Set(lignes.map((ligne) => (ligne[rang] ?? "").trim()).filter((valeur) => valeur !== ""))]
}

/** Une colonne déduite, au type choisi : une liste prend ses valeurs, un autre type perd `max_length`. */
function colonneChoisie(colonne: ImportColumn, type: ColumnType | undefined, options: () => string[]): ImportColumn {
  if (type === undefined || type === colonne.type) return colonne
  if (type === "enum") return { name: colonne.name, type, options: options() }
  return type === "text" ? { ...colonne, type } : { name: colonne.name, type }
}

/**
 * Une colonne créée par l'import, avec son en-tête d'origine pour libellé (#228) : rogné, quand il diffère du nom tiré
 * et tient dans un libellé ; « Montant estimé » le garde, « ref » ne prend rien.
 */
function avecLibelle(colonne: ImportColumn, cellule: string | undefined): ImportColumn & { label?: string } {
  const libelle = (cellule ?? "").trim()
  // La borne et le rognage sont ceux du schéma de la colonne : un libellé qu'il refuse n'est pas posé.
  if (libelle === colonne.name || !tableColumnSchema.shape.label.safeParse(libelle).success) return colonne
  return { ...colonne, label: libelle }
}

/** Le plan d'un tableau nouveau (AC-b1, AC-b2) : noms, types déduits puis choisis, libellés, clé proposée, sinon `ligne` générée. */
function planNouveau(entete: readonly string[], lignes: string[][], choix: Choix): PlanDuCsv {
  const noms = columnNames(entete)
  const deduit = inferTable(lignes, noms)
  const colonnes = deduit.columns.map((colonne, rang) => avecLibelle(colonneChoisie(colonne, choix.types[colonne.name], () => valeursDe(lignes, rang)), entete[rang]))
  const cle = choix.cle === undefined ? deduit.key : choix.cle
  if (cle !== null) return { columns: colonnes, key: cle, names: noms, rows: lignes, ignorees: [], entete: { columns: colonnes, key: cle }, cleGeneree: false, entetes: [...entete] }
  const genere = withLineKey(noms, lignes)
  const avecLaCle = [{ name: genere.key, type: "text" as const }, ...colonnes]
  const entetes = [genere.key, ...entete]
  return { columns: avecLaCle, key: genere.key, names: genere.names, rows: genere.rows, ignorees: [], entete: { columns: avecLaCle, key: genere.key }, cleGeneree: true, entetes }
}

/**
 * Le plan d'un tableau existant (AC-b5) : chaque en-tête rapproché d'une colonne par `columnNameOf` ; une colonne
 * inconnue, nommée deux fois ou l'état d'une file de travail, ignorée et listée (HN-E10S01-5) ; les types du tableau.
 */
function planExistant(entete: readonly string[], lignes: string[][], tableau: TableHeader): PlanDuCsv {
  const pris = new Set<string>()
  const ignorees: string[] = []
  const noms = entete.map((cellule, rang) => {
    const nom = columnNameOf(cellule, rang + 1)
    const connue = tableau.columns.some((colonne) => colonne.name === nom) && nom !== tableau.lifecycle?.column && !pris.has(nom)
    if (!connue) ignorees.push(cellule.trim() || nom)
    else pris.add(nom)
    return connue ? nom : null
  })
  return { columns: tableau.columns, key: tableau.key, names: noms, rows: lignes, ignorees, entete: null, cleGeneree: false, entetes: [...entete] }
}

/** Le plan d'un CSV lu (AC-b1 à AC-b5) : sa première ligne est l'en-tête. */
export function planDuCsv(lu: CsvTable, cible: { tableau: TableHeader | null; choix: Choix }): PlanDuCsv {
  const [entete = [], ...lignes] = lu.rows
  const plan = cible.tableau ? planExistant(entete, lignes, cible.tableau) : planNouveau(entete, lignes, cible.choix)
  return { ...plan, lines: lu.lines.slice(1) }
}

/** Un refus de création qui dit « cette adresse est prise » : l'adresse suivante s'essaie (`creation-dans-le-rail.tsx`). */
const adressePrise = (code: string) => code === "conflict" || code === "stale_revision"

/** L'issue d'un envoi : `adresses` quand toutes les adresses essayées étaient prises. */
export type Refus = ErreurPlateforme | "adresses"

/**
 * Une page tirée d'un `.md` (AC-a3) : titre, résumé et morceaux de `readPageMarkdown`, en opérations `insert_after`
 * sans bloc, du dernier morceau au premier (l'ordre du fichier, en une seule requête), en mode tolérant ; publiée (écrire publie, E11-S02).
 */
export async function importerUnePage(fichier: { nom: string; texte: string }, adresses: readonly string[]): Promise<{ chemin: string; conserves: number } | { refus: Refus }> {
  const page = readPageMarkdown(fichier.texte, fichier.nom)
  const ops = [...page.chunks].reverse().map((text) => ({ op: "insert_after" as const, text }))
  for (const chemin of adresses) {
    const corps = { path: chemin, title: page.title, summary: page.summary, kind: "page", ops, tolerant: true }
    const reponse = await appelerPlateforme<{ path: string; kept_as_text?: number }>({ methode: "POST", ressource: "nodes", corps })
    if (!reponse.erreur) return { chemin: reponse.data.path, conserves: reponse.data.kept_as_text ?? 0 }
    if (!adressePrise(reponse.erreur.code)) return { refus: reponse.erreur }
  }
  return { refus: "adresses" }
}

/** Des lignes à envoyer (AC-b3, AC-b5, AC-b7) : le tableau, ou ses adresses et son en-tête pour le créer au premier lot. */
export type LotsDImport = {
  tableau: { chemin: string } | { adresses: readonly string[]; creation: NonNullable<TableImportBody["create"]> }
  source: { file_name: string } | { converted_from: string }
  colonnes: string[]
  lignes: string[][]
}

export type IssueDesLots = { chemin: string } | { refus: Refus; chemin: string | null; faites: number }

/** Les colonnes gardées d'un plan et leurs cellules : les colonnes ignorées ne partent pas (AC-b5). */
export function colonnesEnvoyees(plan: PlanDuCsv): { colonnes: string[]; lignes: string[][] } {
  const rangs = plan.names.flatMap((nom, rang) => (nom === null ? [] : [rang]))
  return { colonnes: rangs.map((rang) => plan.names[rang] ?? ""), lignes: plan.rows.map((ligne) => rangs.map((rang) => ligne[rang] ?? "")) }
}

function envoyerUnLot(corps: TableImportBody) {
  return appelerPlateforme<{ path: string }>({ methode: "POST", ressource: "tables/import", corps })
}

/** Le tableau qu'un lot refusé a quand même créé (`details.created`, HN-E10S01-21) : la reprise le remplit. */
function tableauCree(erreur: ErreurPlateforme): string | null {
  const cree = erreur.details?.created
  return typeof cree === "string" ? cree : null
}

/**
 * Le premier lot d'un tableau à créer : chaque adresse essayée jusqu'à une libre. Un refus après la création (le
 * tableau existe, vide) arrête les essais, même `conflict`, et rend son chemin.
 */
async function creerAvec(lots: LotsDImport, lignes: string[][], essai: { adresses: readonly string[]; creation: NonNullable<TableImportBody["create"]> }): Promise<{ chemin: string } | { refus: Refus; cree: string | null }> {
  for (const adresse of essai.adresses) {
    const reponse = await envoyerUnLot({ table: adresse, ...lots.source, create: essai.creation, columns: lots.colonnes, rows: lignes })
    if (!reponse.erreur) return { chemin: reponse.data.path }
    const cree = tableauCree(reponse.erreur)
    if (cree !== null || !adressePrise(reponse.erreur.code)) return { refus: reponse.erreur, cree }
  }
  return { refus: "adresses", cree: null }
}

/**
 * Les lignes par lots de 500, un par requête, depuis la ligne `depuis` (la reprise d'un lot refusé, AC-b4) ; le
 * premier lot crée le tableau quand il le faut. `suivre` reçoit les lignes écrites après chaque lot. Un refus
 * arrête l'envoi : l'issue dit le chemin du tableau (créé, même par un premier lot refusé, ou non) et les lignes
 * déjà écrites ; la reprise écrit dans ce tableau, sans le recréer.
 */
export async function envoyerLesLots(lots: LotsDImport, depuis: number, suivre: (faites: number) => void): Promise<IssueDesLots> {
  let chemin = "chemin" in lots.tableau ? lots.tableau.chemin : null
  const debuts = Array.from({ length: Math.max(1, Math.ceil(lots.lignes.length / IMPORT_LOT_ROWS)) }, (_, rang) => rang * IMPORT_LOT_ROWS).filter((debut) => debut >= depuis)
  for (const debut of debuts) {
    const lignes = lots.lignes.slice(debut, debut + IMPORT_LOT_ROWS)
    if (chemin === null && "adresses" in lots.tableau) {
      const cree = await creerAvec(lots, lignes, lots.tableau)
      if ("refus" in cree) return { refus: cree.refus, chemin: cree.cree, faites: debut }
      chemin = cree.chemin
    } else {
      const reponse = await envoyerUnLot({ table: chemin ?? "", ...lots.source, columns: lots.colonnes, rows: lignes })
      if (reponse.erreur) return { refus: reponse.erreur, chemin, faites: debut }
    }
    suivre(debut + lignes.length)
  }
  return { chemin: chemin ?? "" }
}
