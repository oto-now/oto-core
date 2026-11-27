// Les textes du tiroir « Historique des versions » (maquette validée de la refonte) et la ligne de résumé d'une version,
// tirée de ce que le service compte (`HistorySummary`). Sans module directive : lu par le tiroir et par ses tests.
import type { NodeKind } from "../../../schemas"
import type { HistoryEntry, HistorySummary } from "../../../schemas/node-history"

// « 12 nov., 16:42 » : le jour et la minute d'une version, `fr-FR`, Europe/Paris comme les autres dates du paquet
// (`format/dates.ts`, où ce format pourrait rejoindre les autres).
const QUAND = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export function quandLaVersion(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : QUAND.format(date)
}

export const HISTORIQUE = {
  titre: "Historique des versions",
  fermer: "Fermer",
  portee: "Portée de l'historique",
  page: "Page",
  bloc: "Ce bloc",
  liste: "Versions, de la plus récente à la plus ancienne",
  vide: "Aucune version publiée",
  videDuBloc: "Ce bloc n'a changé dans aucune version publiée.",
  chargement: "Chargement de l'historique",
  echec: "Chargement impossible",
  echecDeLaListe: "L'historique n'a pas pu être lu.",
  echecDeLEcart: "Ce qui a changé n'a pas pu être lu.",
  reessayer: "Réessayer",
  plus: "Voir les versions plus anciennes",
  ancienMembre: "Ancien membre",
  lignesDuTableau: "L'historique des lignes viendra plus tard.",
  debutDeLaPage: "Début de la page",
  autresBlocs: (n: number) => (n === 1 ? "Voir l'autre bloc" : `Voir les ${n} autres blocs`),
  aucunTexte: "Le texte n'a pas changé.",
  version: (quand: string) => `Version du ${quand}`,
  revenir: "Revenir à cette version",
  question: "Publier de nouveau cette version ? La version actuelle reste dans l'historique.",
  confirmer: "Revenir",
  revenu: (quand: string) => `La version du ${quand} est publiée de nouveau.`,
  lectureSeule: "Seuls ceux qui écrivent ce contenu peuvent revenir à une version.",
  courante: "C'est la version actuelle.",
} as const

/** Les mots de l'écart, ceux de la maquette. */
export const MOTS_DE_L_ECART = { deleted: "Supprimé", added: "Ajouté" } as const

const CREE: Record<NodeKind, string> = { page: "Page créée", procedure: "Procédure créée", context: "Contexte créé", table: "Tableau créé" }

const blocs = (n: number, participe: string) => (n === 1 ? `1 bloc ${participe}` : `${n} blocs ${participe}s`)

/** La ligne sous l'auteur : « Page créée », « Section Possible ajoutée », « Titre modifié, 3 blocs modifiés »… */
export function resumeDeLaVersion(resume: HistorySummary, genre: NodeKind): string {
  if (resume.created) return CREE[genre]
  const entete = [resume.title && "Titre modifié", resume.summary && "Résumé modifié", resume.kind && "Genre modifié", resume.schema && "Colonnes modifiées"].filter(
    (part): part is string => typeof part === "string",
  )
  const section = resume.section && `Section ${resume.section.title} ${resume.section.change === "added" ? "ajoutée" : "supprimée"}`
  const touches = resume.added + resume.changed + resume.moved + resume.deleted
  const corps = section
    ? [section]
    : touches === 0
      ? []
      : touches === resume.added
        ? [blocs(touches, "ajouté")]
        : touches === resume.deleted
          ? [blocs(touches, "supprimé")]
          : touches === resume.moved
            ? [blocs(touches, "déplacé")]
            : [blocs(touches, "modifié")]
  const parts = [...entete, ...corps]
  return parts.length > 0 ? parts.join(", ") : "Aucun changement"
}

/**
 * Qui a écrit la version : le nom de la personne, même quand son assistant a écrit pour elle (décision de JB : le nom
 * seul, la porte reste dans la réponse du service), ou « Ancien membre ».
 */
export function auteurDeLaVersion(version: Pick<HistoryEntry, "author">): string {
  return version.author?.name ?? HISTORIQUE.ancienMembre
}
