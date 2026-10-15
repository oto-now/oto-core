// Les gestes qu'E05-S10 ajoute à l'éditeur (partie a) : « Dupliquer » et les cases d'une liste à cocher, du
// menu de la poignée (AC-a2) ; le glisser-déposer de la poignée (AC-a3), qui déplace le modèle rang par rang et
// n'envoie l'ordre qu'au dépôt ; le lien inséré par « @ » (AC-a9) ; le texte final d'un conflit, que la
// publication seule suit désormais. Chacun applique une opération pure du
// modèle (`modele.ts`), confie à la file ce qui doit partir, et signale la frappe à la publication seule
// (AC-a6). Sans lui, `actions.ts` dépasserait les 300 lignes d'ESLint (`coding-standards.md § Complexité`).
//
// E10-S01 : un collage de plusieurs lignes et un `.md` lâché sur un bloc s'insèrent après lui en mode tolérant
// (AC-a1, AC-a4) ; « Convertir en tableau de données » crée le tableau d'un tableau simple sous la page, puis le
// remplace par sa référence (AC-b7). Chacun part derrière les écritures en attente, puis fait relire le brouillon.
import { columnNames, fileExtension, IMPORT_NAME_MAX, inferTable, NODE_HEAD_MAX, OP_TEXT_MAX, slugOf, withLineKey, type WriteOpBody } from "../../../schemas"
import { chars, simpleTableOf } from "../../../schemas/blocks"
import type { NodeHead } from "../../../schemas/search"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { adressesAEssayer } from "../../coque/creation-dans-le-rail"
import { envoyerLesLots } from "../../coque/envoi-d-import"
import { nombreLisible } from "../../format/nombres"
import { EDITEUR, MARKDOWN_DANS_L_EDITEUR } from "../libelles"
import { verrouille, type EtatDeLEditeur } from "./actions"
import * as modeleDEdition from "./modele"
import { formeDe, type Rangee } from "./modele"
import { controler, estVide } from "./operations"

/** Une opération `insert_after` d'un texte, après un bloc écrit, ou en tête (`null`). */
const insertion = (apres: string | null, text: string): WriteOpBody => ({ op: "insert_after", text, ...(apres === null ? {} : { block: apres }) })

/** L'`id` d'une rangée, lu à l'envoi : un bloc neuf a reçu le sien entre-temps. */
const idDe = (modele: readonly Rangee[], cle: string) => modele.find((rangee) => rangee.cle === cle)?.bloc.id

/**
 * Un texte de plusieurs lignes après le bloc entier (AC-a1, AC-a4) : le bloc garde son texte, qui part d'abord ; vide,
 * il est remplacé (retiré du modèle, et du brouillon s'il y est). L'ancre se lit à l'envoi, derrière les écritures en
 * attente ; le texte part en mode tolérant, puis le brouillon est relu.
 */
function insererDuMarkdown(etat: EtatDeLEditeur, envoyerLeTexte: (cle: string) => boolean, cle: string, texte: string): void {
  const { modele, changerModele, setErreur, setFocus, envois, frapper } = etat
  if (verrouille(etat)) return
  if (chars(texte) > OP_TEXT_MAX) return setErreur(cle, MARKDOWN_DANS_L_EDITEUR.tropLong(nombreLisible(OP_TEXT_MAX)))
  const rang = modele.current.findIndex((rangee) => rangee.cle === cle)
  const rangee = modele.current[rang]
  if (!rangee) return
  setErreur(cle, null)
  const refus = (erreur: Parameters<typeof messageDErreur>[0]) => messageDErreur(erreur, { too_large: EDITEUR.tropGrand })
  if (!estVide(rangee.bloc)) {
    envoyerLeTexte(cle)
    envois.envoyerEtRelire(cle, () => ({ ops: [insertion(idDe(modele.current, cle) ?? null, texte)], tolerant: true }), refus)
    return frapper()
  }
  const avant = modele.current.slice(0, rang).map((une) => une.cle)
  const retire = rangee.bloc.id
  changerModele(modele.current.filter((une) => une.cle !== cle))
  if (avant.length > 0) setFocus({ cle: avant[avant.length - 1], curseur: null })
  const corps = (): { ops: WriteOpBody[]; tolerant: true } => {
    if (retire !== undefined) return { ops: [insertion(retire, texte), { op: "delete_block", block: retire }], tolerant: true }
    const ancre = avant.map((une) => idDe(modele.current, une)).findLast((id) => id !== undefined) ?? null
    return { ops: [insertion(ancre, texte)], tolerant: true }
  }
  envois.envoyerEtRelire(cle, corps, refus)
  frapper()
}

/** Le texte du titre qui précède une rangée, s'il y en a un. */
function titreQuiPrecede(modele: readonly Rangee[], cle: string): string | null {
  const rang = modele.findIndex((rangee) => rangee.cle === cle)
  return modele.slice(0, Math.max(rang, 0)).findLast((rangee) => rangee.bloc.type === "heading")?.bloc.text ?? null
}

/** Un titre ou un résumé, coupé à sa borne. */
const coupe = (texte: string) => Array.from(texte).slice(0, NODE_HEAD_MAX).join("")

/**
 * « Convertir en tableau de données » (AC-b7) : le tableau créé sous la page (types et clé par `inferTable`, sinon
 * une colonne `ligne`), chaque valeur « Converti depuis <page> » ; puis le bloc remplacé par sa référence. Un refus
 * de création laisse tout en place ; un remplacement refusé laisse le tableau créé et le bloc en place, et le dit.
 */
async function convertirEnTableau(etat: EtatDeLEditeur, cle: string): Promise<void> {
  const { modele, setErreur, envois } = etat
  const rangee = modele.current.find((une) => une.cle === cle)
  const id = rangee?.bloc.id
  // Pas de tableau : un autre bloc, ou un tableau sans colonne (le schéma en veut une au moins).
  const simple = rangee?.bloc.type === "simple_table" ? simpleTableOf(rangee.bloc.data) : null
  if (verrouille(etat) || !id || !simple || simple.columns.length === 0) return
  const tete = await appelerPlateforme<NodeHead>({ methode: "GET", ressource: `nodes?path=${encodeURIComponent(envois.chemin)}` })
  if (tete.erreur) return setErreur(cle, messageDErreur(tete.erreur))
  const page = tete.data.title
  const titre = titreQuiPrecede(modele.current, cle) ?? MARKDOWN_DANS_L_EDITEUR.tableauDe(page)
  const noms = columnNames(simple.columns)
  const deduit = inferTable(simple.rows, noms)
  const genere = deduit.key === null ? withLineKey(noms, simple.rows) : null
  const colonnes = genere ? [{ name: genere.key, type: "text" as const }, ...deduit.columns] : deduit.columns
  const lignes = genere?.rows ?? simple.rows
  const adresses = adressesAEssayer(envois.chemin, new Set(), slugOf(titre, IMPORT_NAME_MAX) || "tableau")
  const header = { columns: colonnes, key: genere?.key ?? deduit.key ?? "" }
  const creation = { title: coupe(titre), summary: coupe(MARKDOWN_DANS_L_EDITEUR.convertiDepuis(page, nombreLisible(lignes.length))), header }
  const dejaCree = envois.convertis.current.get(cle)
  const tableau = dejaCree === undefined ? { adresses, creation } : { chemin: dejaCree }
  const lots = { tableau, source: { converted_from: envois.chemin }, colonnes: genere?.names ?? noms, lignes }
  const issue = await envoyerLesLots(lots, 0, () => undefined)
  if ("refus" in issue) {
    // Un premier lot refusé après la création laisse le tableau, vide : la relance le remplit (HN-E10S01-21).
    if (issue.chemin !== null) envois.convertis.current.set(cle, issue.chemin)
    return setErreur(cle, issue.refus === "adresses" ? EDITEUR.pageChangee : messageDErreur(issue.refus, MARKDOWN_DANS_L_EDITEUR.conversionRefusee))
  }
  envois.convertis.current.delete(cle)
  const reference: WriteOpBody = { op: "replace_block", block: id, input: { type: "reference", text: null, data: { path: issue.chemin } } }
  envois.envoyerEtRelire(cle, () => ({ ops: [reference] }), () => MARKDOWN_DANS_L_EDITEUR.tableauGarde(issue.chemin))
}

export function gestesDuMenu(etat: EtatDeLEditeur, envoyerLeTexte: (cle: string) => boolean) {
  const { modele, changerModele, fixes, setErreur, setFocus, envois, differer, frapper } = etat
  return {
    /** « Dupliquer » : la copie part tout de suite, sauf un bloc vide, qui part avec son texte. */
    dupliquer(cle: string) {
      if (verrouille(etat)) return
      const suite = modeleDEdition.dupliquer(modele.current, cle)
      const copie = suite.modele.find((rangee) => rangee.cle === suite.focus?.cle)
      changerModele(suite.modele)
      if (suite.focus) setFocus(suite.focus)
      if (!copie || (formeDe(copie.bloc) !== null && estVide(copie.bloc))) return
      const controle = controler(copie.bloc)
      if ("message" in controle) return setErreur(copie.cle, controle.message)
      fixes.current.set(copie.cle, copie.bloc)
      envois.envoyerInsertion(copie.cle)
      frapper()
    },
    /** Une case cochée ou décochée : l'état part tout de suite, comme un changement de style. */
    basculerLaCase(cle: string, ligne: number) {
      if (verrouille(etat)) return
      changerModele(modeleDEdition.basculerLaCase(modele.current, cle, ligne))
      envoyerLeTexte(cle)
      frapper()
    },
    /** Le dépôt : un seul `move_block`, après le bloc écrit qui précède désormais ; un bloc neuf part avec son texte. */
    deposer(cle: string) {
      if (fixes.current.has(cle)) envois.envoyerDeplacement(cle)
      frapper()
    },
    /** « @ » : le lien inséré s'écrit comme une frappe, le curseur posé juste après lui. */
    citer(cle: string, texte: string, curseur: number) {
      changerModele(modeleDEdition.ecrireTexte(modele.current, cle, texte).modele)
      setFocus({ cle, curseur })
      differer(cle)
      frapper()
    },
    // Le texte final d'un conflit, ou un texte réinséré, est écrit par la personne : la publication seule le suit.
    enregistrerLeTexteFinal(texte: string) {
      envois.enregistrerLeTexteFinal(texte)
      frapper()
    },
    reinsererMonTexte() {
      envois.reinsererMonTexte()
      frapper()
    },
    insererDuMarkdown: (cle: string, texte: string) => insererDuMarkdown(etat, envoyerLeTexte, cle, texte),
    /** Un fichier lâché sur un bloc : un `.md` seulement, lu par le navigateur, inséré comme un collage (AC-a4). */
    deposerUnFichier(cle: string, fichier: File) {
      const extension = fileExtension(fichier.name)
      if (extension !== "md" && extension !== "markdown") return setErreur(cle, MARKDOWN_DANS_L_EDITEUR.seulementMarkdown)
      void fichier.text().then((texte) => insererDuMarkdown(etat, envoyerLeTexte, cle, texte))
    },
    convertirEnTableau: (cle: string) => void convertirEnTableau(etat, cle),
  }
}
