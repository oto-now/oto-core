// Les gestes des fichiers joints dans l'éditeur (E10-S02, lot b : AC-b1, AC-b2, AC-b4 à AC-b7) : joindre un fichier
// après un bloc (le « + », un dépôt, un collage d'image), en montrant un bloc local pendant l'envoi, puis écrire le
// bloc de l'image ou du fichier à la confirmation, et seulement alors ; annuler un envoi ; choisir au dépôt d'un `.md`
// ou d'un `.csv` ; importer un CSV, déposé ou joint, en tableau sous la page, puis citer ce tableau après le bloc.
// Chacun applique une opération pure du modèle, confie à la file ce qui doit partir, et signale la frappe à la
// publication seule. Sans lui, `actions.ts` et `gestes-du-menu.ts` dépasseraient les 300 lignes d'ESLint.
import { fileExtension, fileTypeOf, FILE_TYPES } from "../../../schemas"
import { filePath } from "../../../schemas/files"
import { lireUnFichier } from "../../api/client"
import { FICHIERS } from "../libelles-des-fichiers"
import { verrouille, type EtatDeLEditeur } from "./actions"
import { blocDuFichier, EN_DEPOT, envoyerUnFichier, genreDe, messageDEnvoi, nommer, type Depot, type Genre } from "./envoi-de-fichier"
import * as modeleDEdition from "./modele"
import type { BlocEdite, Rangee } from "./modele"

/** Le choix au dépôt d'un `.md` ou d'un `.csv` (AC-b5). */
export type OptionDuDepot = "contenu" | "joindre" | "tableau"

/**
 * `deposerDuMarkdown` : le dépôt d'E10-S01 (un `.md` inséré en mode tolérant), qui s'applique seul quand le stockage
 * est désactivé, et que « Insérer le contenu » reprend (AC-b5).
 */
export function gestesDesFichiers(etat: EtatDeLEditeur, deposerDuMarkdown: (cle: string, fichier: File) => void) {
  const { modele, changerModele, fixes, setErreur, setFocus, envois, frapper, fichiers } = etat
  const existe = (cle: string) => modele.current.some((rangee) => rangee.cle === cle)
  const changerLeDepot = (cle: string, change: Partial<Depot>) => fichiers.setDepots((courants) => (courants[cle] ? { ...courants, [cle]: { ...courants[cle], ...change } } : courants))
  const oublierLeDepot = (cle: string) => fichiers.setDepots((courants) => Object.fromEntries(Object.entries(courants).filter(([une]) => une !== cle)))
  /** Un bloc donné, neuf, après une rangée : la rangée d'un Texte neuf (`insererApres`), qui prend ce bloc ; `null` sans la rangée. */
  const insererLeBloc = (apres: string, bloc: BlocEdite): { modele: Rangee[]; cle: string } | null => {
    const suite = modeleDEdition.insererApres(modele.current, apres)
    const cle = suite.focus?.cle
    return cle === undefined ? null : { modele: modeleDEdition.remplacerLeBloc(suite.modele, cle, bloc), cle }
  }

  /** Un bloc neuf après une rangée, qui part tout de suite : le bloc d'un fichier confirmé, une référence importée. */
  function ecrireApres(cle: string, bloc: BlocEdite, remplacer: boolean) {
    const suite = remplacer ? { modele: modeleDEdition.remplacerLeBloc(modele.current, cle, bloc), cle } : insererLeBloc(cle, bloc)
    if (suite === null) return
    changerModele(suite.modele)
    fixes.current.set(suite.cle, bloc)
    envois.envoyerInsertion(suite.cle)
    frapper()
  }

  /**
   * Un fichier joint après une rangée (AC-b1, AC-b2) : un bloc local montre l'aperçu et la progression ; à la
   * confirmation, et seulement alors, il devient le bloc de l'image ou du fichier, écrit par `writeNode` ; un refus
   * reste dans le bloc local, traduit (AC-b4).
   */
  function joindre(apres: string, choisi: File) {
    if (verrouille(etat)) return
    const fichier = nommer(choisi)
    const local = insererLeBloc(apres, { type: EN_DEPOT, text: null, data: { name: fichier.name }, key: null })
    if (local === null) return
    const { cle } = local
    changerModele(local.modele)
    const controleur = new AbortController()
    fichiers.controleurs.current.set(cle, controleur)
    fichiers.setDepots((courants) => ({ ...courants, [cle]: { fichier, genre: genreDe(fichier.name), progression: 0, erreur: null } }))
    void envoyerUnFichier(envois.chemin, fichier, (part) => changerLeDepot(cle, { progression: part }), controleur.signal).then((issue) => {
      fichiers.controleurs.current.delete(cle)
      if ("annule" in issue) return
      if ("erreur" in issue) return changerLeDepot(cle, { erreur: messageDEnvoi(issue.erreur, fichier) })
      oublierLeDepot(cle)
      // Le bloc local retiré entre-temps : rien ne s'écrit ; le fichier reste lié à la page (ADR-016 § 6).
      if (existe(cle)) ecrireApres(cle, blocDuFichier(issue.pret), true)
    })
  }

  /** « Annuler », ou « Retirer » après un refus (AC-b4) : l'envoi s'interrompt, le bloc local part, le focus va au voisin. */
  function annulerLEnvoi(cle: string) {
    fichiers.controleurs.current.get(cle)?.abort()
    fichiers.controleurs.current.delete(cle)
    oublierLeDepot(cle)
    const suite = modeleDEdition.retirer(modele.current, cle)
    changerModele(suite.modele)
    if (suite.focus) setFocus({ ...suite.focus, cible: "rangee" })
  }

  /**
   * Un fichier lâché sur un bloc (AC-b1, AC-b2, AC-b5) : stockage désactivé, le dépôt d'E10-S01 seul ; un `.md` ou un
   * `.csv`, le choix ; tout autre type admis, joint ; un type refusé, dit sous le bloc.
   */
  async function deposer(cle: string, fichier: File) {
    if (!(await fichiers.stockage.connaitre())) return deposerDuMarkdown(cle, fichier)
    const extension = fileExtension(fichier.name)
    if (extension === "md" || extension === "csv") return fichiers.setDialogue({ genre: "depot", cle, fichier, extension })
    if (fileTypeOf(fichier.name) !== null) return joindre(cle, fichier)
    if (extension === "markdown") return deposerDuMarkdown(cle, fichier)
    setErreur(cle, FICHIERS.typeRefuse(Object.keys(FILE_TYPES).join(", ")))
  }

  /** Une image collée (AC-b1) : jointe après le bloc ; stockage désactivé, la phrase d'AC-b7. */
  async function collerUneImage(cle: string, fichier: File) {
    if (!(await fichiers.stockage.connaitre())) return envois.annoncer(FICHIERS.desactives)
    joindre(cle, fichier)
  }

  /** « Convertir en tableau » d'un CSV joint (AC-b6) : ses octets lus par la route de lecture, puis le dialogue d'import d'E10-S01. */
  async function convertirLeCsv(cle: string) {
    const bloc = modele.current.find((rangee) => rangee.cle === cle)?.bloc
    const id = typeof bloc?.data.file_id === "string" ? bloc.data.file_id : null
    const nom = typeof bloc?.data.name === "string" ? bloc.data.name : "fichier.csv"
    if (verrouille(etat) || id === null) return
    const octets = await lireUnFichier(filePath(id))
    if (octets === null) return setErreur(cle, FICHIERS.illisible)
    setErreur(cle, null)
    fichiers.setDialogue({ genre: "import", cle, fichier: new File([octets], nom, { type: "text/csv" }) })
  }

  const fermer = () => fichiers.setDialogue(null)
  return {
    connaitreLesFichiers: () => void fichiers.stockage.connaitre(),
    /** « Image » ou « Fichier » du « + » (AC-b1, AC-b2) : le dialogue qui dit types et limites avant la sélection (AC-b4). */
    choisirUnFichier: (cle: string, quoi: Genre) => (verrouille(etat) ? undefined : fichiers.setDialogue({ genre: "choisir", cle, quoi })),
    /** Le fichier choisi par « Image » ou « Fichier » : joint, sans choix au dépôt (AC-b5). */
    fichierChoisi(fichier: File) {
      const ouvert = fichiers.dialogue
      fermer()
      if (ouvert?.genre === "choisir") joindre(ouvert.cle, fichier)
    },
    deposerUnFichierDansLaPage: (cle: string, fichier: File) => void deposer(cle, fichier),
    collerUneImage: (cle: string, fichier: File) => void collerUneImage(cle, fichier),
    annulerLEnvoi,
    /** Le choix au dépôt (AC-b5) : insérer le contenu (E10-S01), joindre, ou importer en tableau. */
    choisirAuDepot(option: OptionDuDepot) {
      const ouvert = fichiers.dialogue
      if (ouvert?.genre !== "depot") return fermer()
      if (option === "tableau") return fichiers.setDialogue({ genre: "import", cle: ouvert.cle, fichier: ouvert.fichier })
      fermer()
      if (option === "contenu") deposerDuMarkdown(ouvert.cle, ouvert.fichier)
      else joindre(ouvert.cle, ouvert.fichier)
    },
    /** Le tableau importé (AC-b5, AC-b6) : un bloc `reference` vers lui, après le bloc du dépôt ou du CSV joint. */
    tableauImporte(chemin: string) {
      const ouvert = fichiers.dialogue
      fermer()
      if (ouvert?.genre === "import" && !verrouille(etat)) ecrireApres(ouvert.cle, { type: "reference", text: null, data: { path: chemin }, key: null }, false)
    },
    convertirLeCsv: (cle: string) => void convertirLeCsv(cle),
    /** « Intégration » du « + » ou de « / », ou « Modifier l'adresse » d'un cadre (1.4.3) : le dialogue de son adresse. */
    ouvrirLIntegration: (cle: string, modifier = false, adresse = "") => (verrouille(etat) ? undefined : fichiers.setDialogue({ genre: "integration", cle, modifier, adresse })),
    /** L'adresse validée : un cadre neuf après la rangée, qui part tout de suite ; ou le cadre de la rangée, à sa nouvelle adresse. */
    integrer(url: string) {
      const ouvert = fichiers.dialogue
      fermer()
      if (ouvert?.genre !== "integration" || verrouille(etat)) return
      if (!ouvert.modifier) return ecrireApres(ouvert.cle, { type: "embed", text: null, data: { url }, key: null }, false)
      const avant = modele.current.find((rangee) => rangee.cle === ouvert.cle)?.bloc
      if (avant?.type !== "embed") return
      changerModele(modeleDEdition.remplacerLeBloc(modele.current, ouvert.cle, { ...avant, data: { ...avant.data, url } }))
      etat.differer(ouvert.cle)
      frapper()
    },
    fermerLeDialogue: fermer,
  }
}
