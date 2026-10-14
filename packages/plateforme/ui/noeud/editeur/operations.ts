// Ce qu'un geste envoie (E05-S02, AC10 à AC13, AC15, AC18) : le contrôle d'un bloc par
// `blockInputSchema` et les messages de l'AC13, les opérations par bloc du corps `writeNodeBodySchema`
// (`id` complet, révision lue, bloc structuré en `input`, jamais du markdown : HN-E05S02-17), et ce
// que devient un refus. Fonctions pures. Sans lui, la traduction vers l'API vivrait dans les composants.
import { blockInputSchema, type BlockInput, type BlockView, type WriteOpBody } from "../../../schemas"
import {
  isToggleFence,
  LIST_DEPTH_MAX,
  LIST_ITEMS_MAX,
  listItemTexts,
  SIMPLE_TABLE_COLUMNS_MAX,
  SIMPLE_TABLE_ROWS_MAX,
  simpleTableOf,
  TOGGLE_SUMMARY_MAX,
  trimBlanks,
} from "../../../schemas/blocks"
import type { ErreurPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { caracteres } from "../en-ligne"
import { EDITEUR } from "../libelles"
import { avecTableau, celluleEnvoyee, sansLignesBlanchesDeBord } from "./blocs-de-page"
import { texteDe, type BlocEdite, type Rangee } from "./modele"

/** Les messages d'un bloc refusé avant l'envoi (AC13 ; E10-S06, AC-b1, AC-b4) ; `invalide` : un refus du schéma qu'aucun autre ne dit. */
export const MESSAGES_DU_BLOC = {
  titreVide: "Un titre ne peut pas être vide.",
  titreUneLigne: "Un titre tient sur une ligne.",
  titreLong: "Un titre compte 200 caractères au plus.",
  tropLong: "Ce bloc est trop long : découpez-le en plusieurs blocs.",
  listeLongue: `Une liste compte ${LIST_ITEMS_MAX} éléments au plus, sous-éléments compris : coupez-la en deux.`,
  troisNiveaux: "Trois niveaux de liste au plus.",
  colonnes: `${SIMPLE_TABLE_COLUMNS_MAX} colonnes au plus.`,
  rangees: `${SIMPLE_TABLE_ROWS_MAX} rangées au plus.`,
  resumeVide: "Le repli a besoin d'un résumé.",
  resumeLong: `Le résumé tient en ${TOGGLE_SUMMARY_MAX} caractères.`,
  repliDansRepli: "Un repli ne contient pas d'autre repli.",
  invalide: "Ce bloc ne peut pas être enregistré tel quel.",
} as const

/** Bornes de `blockInputSchema` (E01-S06), dites en français avant qu'il ne refuse. */
const TITRE_MAX = 200
const TEXTE_MAX = 100_000

/** Le nombre de niveaux d'une liste frappée (E10-S04, AC-b2) : 1 sans sous-liste. */
function niveauxDe(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let niveaux = 1
  for (const item of items) {
    const enfants = typeof item === "object" && item !== null && "children" in item && typeof item.children === "object" && item.children !== null && "items" in item.children ? item.children.items : null
    if (enfants !== null) niveaux = Math.max(niveaux, 1 + niveauxDe(enfants))
  }
  return niveaux
}

/**
 * Le bloc tel qu'il part (E10-S06) : les cellules d'un tableau sans blanc de bord, chaque `|` échappé (AC-b1) ; le
 * résumé d'un repli sans blanc de bord, son corps sans ligne blanche de bord (AC-b4). Tout autre bloc, tel quel.
 */
function telQuIlPart(bloc: BlocEdite): BlocEdite {
  if (bloc.type === "simple_table") {
    const { columns, rows, align } = simpleTableOf(bloc.data)
    return { ...bloc, data: avecTableau(bloc.data, { columns: columns.map(celluleEnvoyee), rows: rows.map((rangee) => rangee.map(celluleEnvoyee)), align }) }
  }
  if (bloc.type !== "toggle") return bloc
  const resume = typeof bloc.data.summary === "string" ? trimBlanks(bloc.data.summary) : ""
  return { ...bloc, text: sansLignesBlanchesDeBord((bloc.text ?? "").split("\n")).join("\n"), data: { ...bloc.data, summary: resume } }
}

/** Le bloc tel que `blockInputSchema` le lit : type, texte, données et clé, tels qu'ils partent. */
function entreeDe(bloc: BlocEdite): unknown {
  return { type: bloc.type, ...(bloc.text === null ? {} : { text: bloc.text }), data: bloc.data, ...(bloc.key === null ? {} : { key: bloc.key }) }
}

/**
 * Les blocs que l'écran écrit sans champ de texte : un séparateur (E10-S06, AC-a4), une image (son texte alternatif, sa
 * largeur) et un fichier joint (E10-S02, AC-b1, AC-b3). Jamais vides, ils partent comme un texte.
 */
export const SANS_TEXTE: ReadonlySet<string> = new Set(["divider", "image", "file", "embed"])

/** Un bloc sans texte : un Texte, un titre, une liste, un tableau ou un repli vidés ; jamais un bloc de `SANS_TEXTE`. */
export function estVide(bloc: BlocEdite): boolean {
  return !SANS_TEXTE.has(bloc.type) && texteDe(bloc).trim() === ""
}

/** Ce que le contrôle dit d'un tableau ou d'un repli avant le schéma (E10-S06, AC-b1, AC-b4) ; `null` : rien. */
function messageDeLaForme(bloc: BlocEdite): string | null {
  if (bloc.type === "simple_table") {
    const { columns, rows } = simpleTableOf(bloc.data)
    if (columns.length > SIMPLE_TABLE_COLUMNS_MAX) return MESSAGES_DU_BLOC.colonnes
    return rows.length > SIMPLE_TABLE_ROWS_MAX ? MESSAGES_DU_BLOC.rangees : null
  }
  if (bloc.type !== "toggle") return null
  const resume = typeof bloc.data.summary === "string" ? bloc.data.summary : ""
  if (resume === "") return MESSAGES_DU_BLOC.resumeVide
  if (caracteres(resume) > TOGGLE_SUMMARY_MAX) return MESSAGES_DU_BLOC.resumeLong
  return (bloc.text ?? "").split("\n").some(isToggleFence) ? MESSAGES_DU_BLOC.repliDansRepli : null
}

/** Le bloc confronté à `blockInputSchema` avant tout envoi (AC13) : l'entrée validée, ou le message. */
export function controler(bloc: BlocEdite): { entree: BlockInput } | { message: string } {
  const propre = messageDeLaForme(telQuIlPart(bloc))
  if (propre) return { message: propre }
  if (bloc.type === "heading") {
    const texte = (bloc.text ?? "").replace(/^ +| +$/g, "")
    if (texte === "") return { message: MESSAGES_DU_BLOC.titreVide }
    if (/[\r\n]/.test(texte)) return { message: MESSAGES_DU_BLOC.titreUneLigne }
    if (caracteres(texte) > TITRE_MAX) return { message: MESSAGES_DU_BLOC.titreLong }
  }
  if (bloc.type === "list" && niveauxDe(bloc.data.items) > LIST_DEPTH_MAX) return { message: MESSAGES_DU_BLOC.troisNiveaux }
  if (bloc.type === "list" && listItemTexts(bloc.data.items).length > LIST_ITEMS_MAX) return { message: MESSAGES_DU_BLOC.listeLongue }
  if (bloc.text !== null && caracteres(bloc.text) > TEXTE_MAX) return { message: MESSAGES_DU_BLOC.tropLong }
  const lu = blockInputSchema.safeParse(entreeDe(telQuIlPart(bloc)))
  return lu.success ? { entree: lu.data } : { message: MESSAGES_DU_BLOC.invalide }
}

/** `replace_block` sur l'`id` complet, avec la révision lue du bloc (AC10). */
export function operationRemplacer(id: string, revision: number, entree: BlockInput): WriteOpBody {
  return { op: "replace_block", block: id, revision, input: entree }
}

/** `insert_after` un bloc, en tête sans lui (AC11) ; le bloc neuf part sans `id`. */
export function operationInserer(apres: string | null, entree: BlockInput): WriteOpBody {
  return { op: "insert_after", ...(apres === null ? {} : { block: apres }), input: entree }
}

/** `delete_block` avec la révision lue (AC12). */
export function operationSupprimer(id: string, revision: number): WriteOpBody {
  return { op: "delete_block", block: id, revision }
}

/** `move_block` après un bloc, en tête sans lui ; sans révision : un déplacement n'écrase rien (AC12). */
export function operationDeplacer(id: string, apres: string | null): WriteOpBody {
  return { op: "move_block", block: id, ...(apres === null ? {} : { after_block: apres }) }
}

/** L'`id` du plus proche bloc écrit qui précède une rangée, `null` en tête : l'ancre d'une insertion ou d'un déplacement. */
export function idPrecedent(modele: readonly Rangee[], cle: string): string | null {
  const rang = modele.findIndex((rangee) => rangee.cle === cle)
  return modele.slice(0, Math.max(rang, 0)).findLast((rangee) => rangee.bloc.id !== undefined)?.bloc.id ?? null
}

/** Ce que l'écran dit d'un refus sans relecture (AC18) ; `null` : la page est relue d'abord (AC15). */
export type AlerteDeRefus = { message: string; copier: boolean; recharger: boolean; reessayer: boolean }

export function alerteDuRefus(erreur: ErreurPlateforme): AlerteDeRefus | null {
  const alerte = (message: string, gestes: Partial<Omit<AlerteDeRefus, "message">> = {}) => ({ message, copier: false, recharger: false, reessayer: false, ...gestes })
  // Une session expirée répond 401 sous le code `forbidden` : la table le dit (E02-S01 N9) ; le geste
  // repart une fois la personne reconnectée ailleurs, son texte est copiable d'ici là (HN-E05S02-23).
  if (erreur.statut === 401) return alerte(messageDErreur(erreur), { copier: true, reessayer: true })
  if (erreur.code === "forbidden") return alerte(EDITEUR.refuse, { copier: true })
  // Personne retirée, organisation partie : une relecture quitterait l'écran sans le texte.
  if (erreur.code === "not_member" || erreur.code === "unknown_org") return alerte(messageDErreur(erreur), { copier: true })
  if (erreur.code === "not_found") return alerte(EDITEUR.disparu, { copier: true, recharger: true })
  if (erreur.code === "too_large") return alerte(EDITEUR.tropGrand, { reessayer: true })
  if (erreur.code === "reseau") return alerte(EDITEUR.reseau, { reessayer: true })
  if (erreur.code === "internal") return alerte(messageDErreur(erreur), { reessayer: true })
  return null
}

export type Verdict =
  | { genre: "conflit-du-bloc"; version: BlockView }
  | { genre: "supprime" }
  | { genre: "conflit-de-page" }
  | { genre: "message" }

/**
 * Le refus d'une opération par bloc, lu après relecture (AC15, HN-E05S02-6) : le bloc visé dont la
 * révision a changé est en conflit ; absent, il a été supprimé ; sinon, une page publiée entre-temps
 * (révision plus haute que celle envoyée) est un conflit de page ; sinon, le message du refus. Aucun
 * `details` n'est lu.
 */
export function verdictDuRefus(vise: { id: string; revision: number } | null, relu: { blocs: readonly BlockView[]; revision: number }, revisionEnvoyee: number): Verdict {
  if (vise) {
    const version = relu.blocs.find((bloc) => bloc.id === vise.id)
    if (!version) return { genre: "supprime" }
    if (version.revision !== vise.revision) return { genre: "conflit-du-bloc", version }
  }
  return relu.revision > revisionEnvoyee ? { genre: "conflit-de-page" } : { genre: "message" }
}
