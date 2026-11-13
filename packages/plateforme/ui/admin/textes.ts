// Textes communs des écrans d'administration (E08-S03, E08-S09) : la réserve des pages `/admin/*`,
// les questions des gestes destructeurs et les échecs propres à ces écrans. Les codes génériques
// passent par `messageDErreur` (`ui/api/messages.ts`) ; ici, les phrases qui nomment ce que la table
// ne connaît pas. Sans ce module, chaque page `/admin/*` écrirait sa réserve, chaque écran ses refus.
import type { DeactivationImpact } from "../../schemas"
import type { ErreurPlateforme } from "../api/client"
import { messageDErreur, type MessagesDuGeste } from "../api/messages"

/** L'état d'erreur d'une page `/admin/*` ouverte par un membre qui n'administre pas l'organisation (AC1). */
export function reserveAuxAdministrateurs(nom: string): string {
  return `Cette page est réservée aux administrateurs de ${nom}.`
}

/** Procédures nommées dans la question d'une désactivation (AC5) : au-delà, leur nombre suffit. */
const PROCEDURES_NOMMEES = 10

/** Les procédures publiées qui citent le connecteur, dans la question de sa désactivation (AC5). */
function procedures(chemins: readonly string[]): string {
  if (chemins.length === 0) return "Aucune procédure publiée ne le cite."
  const nommes = chemins.slice(0, PROCEDURES_NOMMEES).join(", ") + (chemins.length > PROCEDURES_NOMMEES ? ", …" : "")
  return chemins.length === 1
    ? `1 procédure publiée le cite dans ses blocs d'appel : ${nommes}.`
    : `${chemins.length} procédures publiées le citent dans leurs blocs d'appel : ${nommes}.`
}

function comptes(nombre: number): string {
  if (nombre === 0) return "Il n'a aucun compte."
  return nombre === 1 ? "Son compte est conservé." : `Ses ${nombre} comptes sont conservés.`
}

/**
 * « Désactiver « mail » ? … » : ce que la désactivation arrête, composé depuis son impact (AC5) ; sans
 * impact lu, la question ne dit que l'arrêt des fonctions, jamais « aucune procédure ».
 */
export function questionDeDesactivation(connecteur: string, impact: DeactivationImpact | undefined): string {
  const question = `Désactiver « ${connecteur} » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde.`
  return impact ? `${question} ${procedures(impact.procedures)} ${comptes(impact.accounts)}` : question
}

/** La question de la désactivation d'un compte de connecteur, dans les mots de l'écran : « connecteur », jamais « compte ». */
export function questionDeDesactivationDuCompte(libelle: string): string {
  return `Désactiver « ${libelle} » ? Aucun assistant ne pourra plus s'en servir, dès maintenant. Un connecteur désactivé ne se réactive pas : il faudra en ajouter un autre.`
}

/** Un libellé de compte déjà pris dans l'organisation, sans casse (AC6) : sous le champ Libellé. */
export const LIBELLE_PRIS = "Un compte porte déjà ce libellé dans l'organisation."

/** Les drapeaux écrits entre la lecture de la page et le geste (AC8). */
export const MESSAGES_DES_DRAPEAUX: MessagesDuGeste = {
  conflict: "Les drapeaux ont changé entre-temps : rechargez la page, puis recommencez.",
}

const REGLAGES = new Map([
  ["forbidden", "Seul un administrateur de l'organisation peut modifier ces réglages."],
  ["conflict", "L'organisation a changé entre-temps : rechargez la page avant d'enregistrer."],
])

/**
 * L'échec d'un enregistrement des réglages (AC3), choisi sur le code, jamais sur le texte du serveur.
 * Les refus que la porte rend à tout geste (session expirée, personne retirée, adresse détachée)
 * gardent la phrase de `messageDErreur` : réessayer y échouerait pareil (`forms-patterns.md`).
 */
export function echecDesReglages(erreur: ErreurPlateforme): string {
  if (erreur.code === "reseau") return "La connexion au serveur a échoué. Rien n'a été enregistré."
  if (erreur.statut === 401 || erreur.code === "not_member" || erreur.code === "unknown_org") return messageDErreur(erreur)
  return REGLAGES.get(erreur.code) ?? "Les réglages n'ont pas pu être enregistrés. Réessayez dans un instant."
}
