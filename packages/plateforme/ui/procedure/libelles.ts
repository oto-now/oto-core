// Les libellés français des écrans d'une procédure (E05-S04, AC2 à AC9) : genres des refus de publication,
// emplacements, aide du résumé, texte d'un bloc `call`, liste des procédures. Tout autre refus prend le texte
// de `messageDErreur` (`ui/api/messages.ts`), jamais une seconde table. M59 (fiche D104) : à l'écran, une
// procédure est une page ; les champs d'appel, le contrôle du brouillon et l'aperçu d'une phrase sont partis.
import { PROCEDURE_MAX_CHARS, type ProcedureRefusalKind, type ProcedureSummary } from "../../schemas"
import { nombreLisible } from "../format/nombres"

/** Les huit genres d'un refus (E03-S06), dits en français (AC7) ; tout autre genre : `GENRE_INCONNU`. */
export const GENRES_DE_REFUS: Record<ProcedureRefusalKind, string> = {
  too_long: `procédure de plus de ${nombreLisible(PROCEDURE_MAX_CHARS)} caractères : déplacez les informations de référence dans une page et liez-la`,
  invalid_block: "bloc d'appel mal formé",
  unknown_function: "fonction inconnue",
  function_not_active: "fonction non activée pour l'organisation",
  unknown_key: "argument inconnu",
  missing_argument: "argument requis absent",
  invalid_value: "valeur refusée",
  check_failed: "contrôle de la fonction refusé",
}

export const GENRE_INCONNU = "problème à corriger"

/** « La publication est refusée : 3 problèmes à corriger. » (AC7). */
export function publicationRefusee(nombre: number): string {
  return `La publication est refusée : ${nombre} ${nombre > 1 ? "problèmes" : "problème"} à corriger.`
}

/** L'aide sous le résumé d'une procédure (AC5, P37). */
export const AIDE_DU_RESUME = "Dites ce que fait la procédure et comment on la demande : le routage lit le titre et le résumé."

/**
 * Un bloc `call` déjà écrit, lu comme un texte (M59, HN-M59-1) : « Appel de table.claim : { "table": … } »,
 * les arguments en JSON sur une ligne ; sans argument, « Appel de table.schema ». Le même texte se lit à
 * l'écran et s'écrit dans le champ : le modifier fait du bloc un Texte, le laisser le garde tel quel en base.
 */
export function texteDUnAppel(data: Record<string, unknown>): string {
  const fonction = typeof data.function === "string" && data.function !== "" ? data.function : "(fonction sans nom)"
  const args = data.args
  const vides = args === undefined || args === null || (typeof args === "object" && Object.keys(args).length === 0)
  // `JSON.stringify` échappe tout saut de ligne d'une chaîne : ceux qu'il rend sont ceux de l'indentation, repliés ici.
  return vides ? `Appel de ${fonction}` : `Appel de ${fonction} : ${JSON.stringify(args, null, 1).replace(/\n\s*/g, " ")}`
}

/** Les refus de publication (AC7). */
export const CONTROLE = {
  allerAuBloc: "Aller au bloc",
  detail: "Détail technique",
} as const

/** La liste des procédures (AC9). */
export const LISTE = {
  titre: "Procédures",
  equipe: "Équipe",
  toutes: "Toutes les équipes",
  filtrer: "Filtrer",
  // Sans équipe propriétaire ; une procédure d'un espace personnel se dit « Privé » (P39, D89, HN-E05S04-21).
  organisation: "Organisation",
  aucune: "Aucune procédure ne vous est encore partagée.",
  aucunePourLEquipe: "Aucune procédure pour cette équipe.",
  retirerLeFiltre: "Retirer le filtre",
  chargement: "Chargement des procédures…",
} as const

/**
 * L'état d'une procédure listée (AC9) : « Publiée · rév. 4 », « · modifications en attente » quand un
 * brouillon attend sa publication ; « Non publiée » sinon (E11-S02, AC-c4 : le mot « brouillon » ne se dit plus).
 */
export function etatDeLaProcedure(procedure: Pick<ProcedureSummary, "status" | "revision" | "hasDraft">): string {
  if (procedure.status !== "published") return "Non publiée"
  return `Publiée · rév. ${procedure.revision}${procedure.hasDraft ? " · modifications en attente" : ""}`
}
