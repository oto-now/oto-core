// Les refus du moteur que l'écran Connecteurs dit par leur raison : un outil fermé par un administrateur, un propriétaire
// non admis, un plafond de l'offre, un nom déjà porté, trop de tests. Lus par l'ajout, le renommage, le test et la
// réactivation : sans ce module, chacun écrirait ses phrases, et le même refus se dirait de quatre façons.
import type { ErreurPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"

const FERME = "Cet outil a été fermé par un administrateur"

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
export const REFUS_DE_LA_REACTIVATION: MessagesDuGeste = { ...PROPRES, closed: `${FERME}. Un administrateur peut le rouvrir.` }

/** Un nom déjà porté par un connecteur du même propriétaire. */
export const NOM_PRIS = "Un connecteur du même propriétaire porte déjà ce nom."

export const estNomPris = (erreur: ErreurPlateforme) => erreur.code === "conflict" && erreur.raison === "label_taken"

/** La phrase d'un refus de l'ajout, du renommage ou d'un test. */
export function refusDuConnecteur(erreur: ErreurPlateforme): string {
  if (erreur.code === "not_enabled" && erreur.raison === "closed") return `${FERME}. Un administrateur peut le rouvrir${administrateurs(erreur.details)}.`
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
