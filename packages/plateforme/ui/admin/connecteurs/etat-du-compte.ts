// L'état d'un compte de connecteur tel que l'écran Connecteurs le dit : un mot, une précision, et le geste qui le
// répare pour qui peut le faire. Fonction pure, lue par la liste et par le détail : sans elle, chacun recomposait l'état
// depuis le mode, la marque, le secret et le consentement. Module sans « use client » : l'écran, rendu par le serveur,
// l'appelle.
import type { AccountView, ConnectorAccountForm } from "../../../schemas"
import { dateLisible } from "../../format/dates"

/** Comment se connecte un compte d'un connecteur : saisi à la main, par consentement, ou branché chez le tiers. */
export type Connexion = "saisie" | "consentement" | "branchement"

export const connexionDe = (formulaire: ConnectorAccountForm | undefined): Connexion =>
  formulaire?.consent === true ? "consentement" : formulaire?.hosted ? "branchement" : "saisie"

/** Le geste qui répare un état : saisir ou remplacer la clé (dans le détail), connecter ou reconnecter chez le tiers. */
export type GesteDuCompte = "saisir" | "remplacer" | "connecter" | "reconnecter"

export type EtatDuCompte = {
  code: "non_teste" | "a_terminer" | "a_reconnecter" | "cle_refusee" | "credits_epuises" | "desactive"
  /** Le mot de l'état, toujours écrit : la couleur du point ne le dit jamais seule. */
  mot: string
  precision: string | null
  /** L'état du point du design system (`.oto-dot`). */
  point: "rest" | "review" | "failed" | "paused"
  /** Vrai pour un état qui attend quelqu'un : ces comptes viennent en tête de la liste. */
  demandeUnGeste: boolean
  /** Le geste offert à qui regarde ; `null` : aucun, ou pas pour lui. */
  geste: GesteDuCompte | null
}

/** Le titre de l'état dans le détail d'un compte : le focus y va quand un geste emporte le contrôle qui l'avait. */
export const ANCRE_DE_L_ETAT = "detail-du-connecteur-etat"

/** Un compte personnel de la personne `moi`. */
export const estAMoi = (compte: Pick<AccountView, "owner">, moi: string) => compte.owner.kind === "user" && compte.owner.userId === moi

/** La clé d'un compte réel est posée : un champ au moins, ou une date de saisie. */
const clePosee = (compte: AccountView) => (compte.secret?.fields.length ?? 0) > 0 || Boolean(compte.secret?.updatedAt)

/** Un compte à consentement dont les jetons ne sont jamais arrivés. */
const jamaisConnecte = (compte: AccountView) => !compte.secret?.updatedAt

function aReconnecter(compte: AccountView, formulaire: ConnectorAccountForm | undefined, aMoi: boolean): EtatDuCompte {
  const connexion = connexionDe(formulaire)
  const reconnectable = connexion === "consentement" || (connexion === "branchement" && formulaire?.hosted?.ready === true)
  const qui = compte.owner.kind === "user" ? (compte.owner.userName ?? "son propriétaire") : "qui le gère"
  return {
    code: "a_reconnecter",
    mot: "À reconnecter",
    precision: aMoi ? "La connexion au service est à refaire." : `Demandez à ${qui} de le reconnecter.`,
    point: "failed",
    demandeUnGeste: true,
    geste: aMoi && reconnectable ? "reconnecter" : null,
  }
}

function marque(compte: AccountView, formulaire: ConnectorAccountForm | undefined, gere: boolean): EtatDuCompte | null {
  if (!compte.mark) return null
  const date = dateLisible(compte.mark.at)
  if (compte.mark.reason === "quota_exhausted") {
    return { code: "credits_epuises", mot: "Crédits épuisés", precision: `${date ? `Depuis le ${date}. ` : ""}La clé reste bonne.`, point: "review", demandeUnGeste: true, geste: null }
  }
  const remplacable = gere && compte.mode === "reel" && formulaire !== undefined && connexionDe(formulaire) === "saisie"
  return { code: "cle_refusee", mot: "Clé refusée", precision: date ? `Refusée par le service le ${date}.` : "Refusée par le service.", point: "failed", demandeUnGeste: true, geste: remplacable ? "remplacer" : null }
}

function aTerminer(compte: AccountView, formulaire: ConnectorAccountForm | undefined, droits: { gere: boolean; aMoi: boolean }): EtatDuCompte | null {
  if (compte.mode !== "reel") return null
  const connexion = connexionDe(formulaire)
  const base = { code: "a_terminer", mot: "À terminer", point: "review", demandeUnGeste: true } as const
  if (connexion === "consentement") {
    return jamaisConnecte(compte) ? { ...base, precision: "Pas encore connecté au service.", geste: droits.aMoi ? "connecter" : null } : null
  }
  // Un connecteur sans champ de secret n'attend aucune clé ; un compte branché naît connecté.
  if (connexion !== "saisie" || formulaire?.fields.length === 0 || clePosee(compte)) return null
  return { ...base, precision: "Aucune clé saisie.", geste: droits.gere && formulaire ? "saisir" : null }
}

/**
 * L'état d'un compte pour la personne `moi` : désactivé, à reconnecter, marqué (clé refusée, crédits épuisés), à
 * terminer, sinon sain. L'état sain se dit « Non testé » : aucun test de connexion n'est encore gardé sur le compte.
 */
export function etatDuCompte(compte: AccountView, formulaire: ConnectorAccountForm | undefined, moi: string): EtatDuCompte {
  if (compte.status === "disabled") return { code: "desactive", mot: "Désactivé", precision: null, point: "paused", demandeUnGeste: false, geste: null }
  const gere = compte.viewerLevel === "manage"
  const aMoi = estAMoi(compte, moi)
  if (compte.status === "error") return aReconnecter(compte, formulaire, aMoi)
  return (
    marque(compte, formulaire, gere) ??
    aTerminer(compte, formulaire, { gere, aMoi }) ?? {
      code: "non_teste",
      mot: "Non testé",
      precision: compte.mode === "simule" ? "Connecteur simulé : rien ne sort du serveur." : null,
      point: "rest",
      demandeUnGeste: false,
      geste: null,
    }
  )
}
