// Les refus du moteur que l'écran Connecteurs dit par leur raison : un outil fermé par un administrateur, un propriétaire
// non admis, un plafond de l'offre, un nom déjà porté, trop de tests. Lus par l'ajout, le renommage, le test et la
// réactivation : sans ce module, chacun écrirait ses phrases, et le même refus se dirait de quatre façons.
import type { ErreurPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"

const FERME = "Cet outil a été bloqué pour l'organisation par un administrateur"

/** Les administrateurs qu'un refus `closed` nomme (`details.administrators`), trois au plus : chacun peut rouvrir l'outil. */
function administrateurs(details: ErreurPlateforme["details"]): string {
  const lus: unknown = details?.administrators
  if (!Array.isArray(lus)) return ""
  const noms = lus.flatMap((un: unknown) => (typeof un === "object" && un !== null && "name" in un && typeof un.name === "string" ? [un.name] : []))
  return noms.length > 0 ? ` : ${noms.slice(0, 3).join(", ")}` : ""
}

/** Les plafonds de l'offre que la table commune des limites ne connaît pas. */
const PLAFONDS: Readonly<Record<string, string>> = {
  accounts_per_owner_max: "Le nombre de connecteurs de ce propriétaire est au plafond de l'offre.",
  account_owner_kinds: "L'offre de l'organisation n'admet pas ce propriétaire pour un connecteur.",
}

const PROPRES: MessagesDuGeste = {
  owner_kind: "Cet outil n'admet pas ce propriétaire.",
  not_disabled: "Ce connecteur est déjà actif. Rechargez la page.",
  no_probe: "Pas de test automatique pour cet outil.",
  limit: "Un plafond de l'offre de l'organisation est atteint.",
}

/** Ce que la réactivation dit de ses refus, par raison (`ActionPlateforme`). */
export const REFUS_DE_LA_REACTIVATION: MessagesDuGeste = { ...PROPRES, closed: `${FERME}. Un administrateur peut le débloquer.` }

/** Un nom déjà porté par un connecteur du même propriétaire. */
export const NOM_PRIS = "Un connecteur du même propriétaire porte déjà ce nom."

export const estNomPris = (erreur: ErreurPlateforme) => erreur.code === "conflict" && erreur.raison === "label_taken"

/**
 * Le plafond d'outils de l'offre atteint, pour un outil que l'organisation n'utilise pas encore : dit avant la saisie à
 * qui lit les capacités (un administrateur), au refus de l'ajout pour les autres. La même phrase aux deux endroits.
 */
export function plafondDesOutils(max: number, outil: string, administre = false): string {
  const sortie = administre ? "relevez la limite" : "demandez à un administrateur de relever la limite"
  return `Votre organisation utilise déjà ${max} ${max > 1 ? "outils" : "outil"}, le maximum de son offre. ${outil} n'en fait pas partie. Ajoutez un connecteur à un outil déjà utilisé, ou ${sortie}.`
}

/** Le plafond de connecteurs d'un outil pour une même personne, désactivés exclus (`accounts_per_owner_max`), et sa sortie. */
function plafondDeLOutil(max: number, outil: string): string {
  return `Vous avez déjà ${max} ${max > 1 ? `connecteurs ${outil} actifs` : `connecteur ${outil} actif`}, le maximum. Désactivez-en un pour en ajouter un autre, ou demandez à un administrateur.`
}

/** Ce que l'ajout sait du refus : l'outil, et un connecteur pour soi (le plafond par propriétaire se dit alors à « vous »). */
export type ContexteDuRefus = { outil: string; pourMoi: boolean }

/** Un plafond que l'ajout dit avec l'outil : le nombre d'outils de l'offre, ou les connecteurs de l'outil à soi. */
function plafondDeLAjout(erreur: ErreurPlateforme, contexte: ContexteDuRefus | undefined): string | null {
  const limit = erreur.details?.limit
  const max = erreur.details?.max
  if (!contexte || erreur.code !== "forbidden" || erreur.raison !== "limit" || typeof max !== "number") return null
  if (limit === "connectors_max") return plafondDesOutils(max, contexte.outil)
  if (limit === "accounts_per_owner_max" && contexte.pourMoi) return plafondDeLOutil(max, contexte.outil)
  return null
}

/** La phrase d'un refus de l'ajout (avec son contexte), du renommage ou d'un test. */
export function refusDuConnecteur(erreur: ErreurPlateforme, contexte?: ContexteDuRefus): string {
  const dansLAjout = plafondDeLAjout(erreur, contexte)
  if (dansLAjout) return dansLAjout
  if (erreur.code === "not_enabled" && erreur.raison === "closed") return `${FERME}. Un administrateur peut le débloquer${administrateurs(erreur.details)}.`
  if (erreur.code === "rate_limited") {
    const attente = erreur.details?.retry_after_s
    const secondes = typeof attente === "number" ? Math.ceil(attente) : null
    return secondes === null ? "Trop de tests : réessayez dans un instant." : `Trop de tests : réessayez dans ${secondes} ${secondes > 1 ? "secondes" : "seconde"}.`
  }
  const plafond = erreur.details?.limit
  if (erreur.code === "forbidden" && erreur.raison === "limit" && typeof plafond === "string" && Object.hasOwn(PLAFONDS, plafond)) return PLAFONDS[plafond]
  if (estNomPris(erreur)) return NOM_PRIS
  return messageDErreur(erreur, PROPRES)
}
