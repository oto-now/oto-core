// L'état d'un compte de connecteur tel que l'écran Connecteurs le dit : un mot, une précision, et le geste qui le
// répare pour qui peut le faire. Fonction pure, lue par la liste et par le détail : sans elle, chacun recomposait l'état
// depuis le mode, la marque, le secret et le consentement. Il porte aussi la façon d'un accès (`faconDeLAcces`), lue par
// le catalogue de l'ajout et par la page de connexion d'un connecteur. Module sans « use client » : l'écran, rendu par
// le serveur, l'appelle.
import type { AccountView, ConnectorAccountForm, ProbeFailureCode } from "../../../schemas"
import { dateLisible } from "../../format/dates"

/** Comment se connecte un compte d'un connecteur : saisi à la main, par consentement, ou branché chez le tiers. */
export type Connexion = "saisie" | "consentement" | "branchement"

export const connexionDe = (formulaire: ConnectorAccountForm | undefined): Connexion =>
  formulaire?.consent === true ? "consentement" : formulaire?.hosted ? "branchement" : "saisie"

/**
 * Le formulaire d'un compte : celui de son connecteur et, pour un connecteur à plusieurs accès, de l'accès que le compte
 * retient (un formulaire par accès) ; aucun si l'accès n'a pas de formulaire.
 */
export const formulaireDuCompte = (formulaires: readonly ConnectorAccountForm[], compte: Pick<AccountView, "connector" | "access">): ConnectorAccountForm | undefined =>
  formulaires.find((formulaire) => formulaire.connector === compte.connector && formulaire.access?.name === compte.access)

/**
 * Un accès tel que sa façon se dit : son nom, son libellé déclaré, s'il se connecte chez le tiers, et pour qui la
 * personne peut l'ouvrir (les propriétaires que l'écran lui offre, ou l'espace que la page de connexion lui donne).
 */
export type AccesADire = { nom: string; libelle: string; chezLeTiers: boolean; proprietaires: readonly string[] }

function phraseDeLaFacon(outil: string, { chezLeTiers, proprietaires }: AccesADire): string {
  if (chezLeTiers) return `Avec mon compte ${outil}`
  if (proprietaires.includes("user")) return proprietaires.some((genre) => genre !== "user") ? "Avec une clé" : "Avec ma clé"
  if (proprietaires.includes("org")) return "Avec une clé, pour l'organisation"
  return proprietaires.includes("team") ? "Avec une clé, pour une équipe" : "Avec une clé"
}

/**
 * La façon d'ouvrir un accès d'un outil à plusieurs, dite à qui l'ajoute : d'après comment on s'y connecte et pour qui,
 * jamais par le libellé de l'accès, écrit pour qui déclare le connecteur (« Service account of the organization »).
 * Deux accès offerts qui se diraient pareil prennent ce libellé entre parenthèses. Lue par la fiche d'ajout et par la
 * page de connexion d'un connecteur : sans elle, chacune dirait l'accès à sa manière.
 */
export function faconDeLAcces(outil: string, acces: AccesADire, offerts: readonly AccesADire[]): string {
  const dite = phraseDeLaFacon(outil, acces)
  const jumeau = offerts.some((autre) => autre.nom !== acces.nom && phraseDeLaFacon(outil, autre) === dite)
  return jumeau ? `${dite} (${acces.libelle})` : dite
}

/**
 * La façon d'un compte d'un outil qui s'ouvre de plusieurs façons, dite dans la liste après son outil : « clé » ou
 * « connexion au service » ; `null` pour un outil à une seule façon, ou un compte qui n'en retient aucune.
 */
export function faconDuCompte(formulaire: ConnectorAccountForm | undefined): string | null {
  if (!formulaire?.access) return null
  return connexionDe(formulaire) === "saisie" ? "clé" : "connexion au service"
}

/**
 * Un compte qui ne retient aucun accès alors que son outil s'ouvre maintenant par plusieurs : le moteur le refuse à
 * chaque appel, et aucun geste ne lui donne un accès.
 */
export const sansAcces = (formulaires: readonly ConnectorAccountForm[], compte: Pick<AccountView, "connector" | "access">): boolean =>
  compte.access === undefined && formulaires.some((formulaire) => formulaire.connector === compte.connector && formulaire.access !== undefined)

/** Le geste qui répare un état : saisir ou remplacer la clé (dans le détail), connecter ou reconnecter chez le tiers. */
type GesteDuCompte = "saisir" | "remplacer" | "connecter" | "reconnecter"

export type EtatDuCompte = {
  code: "non_teste" | "fonctionne" | "test_en_echec" | "a_terminer" | "a_reconnecter" | "a_remplacer" | "cle_refusee" | "credits_epuises" | "desactive" | "bloque"
  /** Le mot de l'état, toujours écrit : la couleur du point ne le dit jamais seule. */
  mot: string
  precision: string | null
  /** Une précision plus courte pour la liste, quand la phrase entière n'y tient pas ; le détail garde `precision`. */
  precisionCourte?: string
  /** L'état du point du design system (`.oto-dot`). */
  point: "rest" | "ok" | "review" | "failed" | "paused"
  /** Vrai pour un état qui attend quelqu'un : ces comptes viennent en tête de la liste. */
  demandeUnGeste: boolean
  /** Le geste offert à qui regarde ; `null` : aucun, ou pas pour lui. */
  geste: GesteDuCompte | null
}

/** Le titre de l'état dans le détail d'un compte : le focus y va quand un geste emporte le contrôle qui l'avait. */
export const ANCRE_DE_L_ETAT = "detail-du-connecteur-etat"

/** Le titre « Qui peut s'en servir » du détail d'un compte : le focus y va quand un accès retiré emporte sa ligne. */
export const ANCRE_DU_PARTAGE = "partage-du-connecteur"

/** Un compte personnel de la personne `moi`. */
export const estAMoi = (compte: Pick<AccountView, "owner">, moi: string) => compte.owner.kind === "user" && compte.owner.userId === moi

/** La clé d'un compte réel est posée : un champ au moins, ou une date de saisie. */
const clePosee = (compte: AccountView) => (compte.secret?.fields.length ?? 0) > 0 || Boolean(compte.secret?.updatedAt)

/** Un compte à consentement dont les jetons ne sont jamais arrivés. */
const jamaisConnecte = (compte: AccountView) => !compte.secret?.updatedAt

/** À qui demander un geste sur un compte qu'on ne gère pas. */
const aQuiDemander = (compte: AccountView) => (compte.owner.kind === "user" ? (compte.owner.userName ?? "son propriétaire") : "qui le gère")

/** Un compte sans accès (`sansAcces`) : rien ne le répare, il se remplace par un connecteur ajouté de nouveau. */
function aRemplacer(compte: AccountView): EtatDuCompte {
  const geste = compte.viewerLevel === "manage" ? "Ajoutez-en un nouveau, puis désactivez celui-ci." : `Demandez à ${aQuiDemander(compte)} d'en ajouter un nouveau.`
  const precision = `Cet outil se connecte maintenant de plusieurs façons : ${geste.charAt(0).toLowerCase()}${geste.slice(1)}`
  return { code: "a_remplacer", mot: "À remplacer", precision, precisionCourte: geste, point: "failed", demandeUnGeste: true, geste: null }
}

function aReconnecter(compte: AccountView, formulaire: ConnectorAccountForm | undefined, aMoi: boolean): EtatDuCompte {
  const connexion = connexionDe(formulaire)
  const reconnectable = connexion === "consentement" || (connexion === "branchement" && formulaire?.hosted?.ready === true)
  const qui = aQuiDemander(compte)
  // Un compte à clé ne se reconnecte pas chez le tiers : il se répare par une clé neuve, que pose qui le gère.
  const parCle = connexion === "saisie" && compte.mode === "reel" && formulaire !== undefined
  const gere = compte.viewerLevel === "manage"
  return {
    code: "a_reconnecter",
    mot: "À reconnecter",
    precision: aMoi || (parCle && gere) ? "La connexion au service est à refaire." : `Demandez à ${qui} de le reconnecter.`,
    point: "failed",
    demandeUnGeste: true,
    geste: parCle ? (gere ? "remplacer" : null) : aMoi && reconnectable ? "reconnecter" : null,
  }
}

/**
 * Un refus plus ancien que la dernière clé saisie ou la dernière connexion : le moteur ne lève la marque qu'au premier
 * appel réussi, l'écran ne la dit plus, sinon qui vient de réparer lirait que rien n'a changé.
 */
function refusPerime(compte: AccountView): boolean {
  if (compte.mark?.reason !== "credential_rejected" || !compte.secret?.updatedAt) return false
  return Date.parse(compte.secret.updatedAt) > Date.parse(compte.mark.at)
}

function marque(compte: AccountView, formulaire: ConnectorAccountForm | undefined, droits: { gere: boolean; aMoi: boolean }): EtatDuCompte | null {
  if (!compte.mark || refusPerime(compte)) return null
  const date = dateLisible(compte.mark.at)
  if (compte.mark.reason === "quota_exhausted") {
    return { code: "credits_epuises", mot: "Crédits épuisés", precision: `${date ? `Depuis le ${date}. ` : ""}La clé reste bonne.`, point: "review", demandeUnGeste: true, geste: null }
  }
  // Un compte connecté chez le tiers n'a pas de clé : un refus du service s'y répare en reconnectant.
  if (connexionDe(formulaire) !== "saisie") return aReconnecter(compte, formulaire, droits.aMoi)
  const remplacable = droits.gere && compte.mode === "reel" && formulaire !== undefined
  return { code: "cle_refusee", mot: "Clé refusée", precision: date ? `Refusée par le service le ${date}.` : "Refusée par le service.", point: "failed", demandeUnGeste: true, geste: remplacable ? "remplacer" : null }
}

function aTerminer(compte: AccountView, formulaire: ConnectorAccountForm | undefined, droits: { gere: boolean; aMoi: boolean }): EtatDuCompte | null {
  if (compte.mode !== "reel") return null
  const connexion = connexionDe(formulaire)
  const base = { code: "a_terminer", mot: "À terminer", point: "review", demandeUnGeste: true } as const
  if (connexion === "consentement") {
    return jamaisConnecte(compte) ? { ...base, precision: "Pas encore connecté au service.", geste: droits.aMoi ? "connecter" : null } : null
  }
  // Un connecteur sans formulaire (simulé, ou servi par la clé de l'hôte) ou sans champ de secret n'attend aucune clé ;
  // un compte branché naît connecté.
  if (connexion !== "saisie" || !formulaire || formulaire.fields.length === 0 || clePosee(compte)) return null
  return { ...base, precision: "Aucune clé saisie.", geste: droits.gere && formulaire ? "saisir" : null }
}

/** Pourquoi un test a échoué, par le code du moteur (`PROBE_FAILURE_CODES`) : une phrase par cas, sa phrase anglaise restant en détail. */
const RAISONS_DU_TEST: Readonly<Record<ProbeFailureCode, string>> = {
  credential_rejected: "Le service a refusé la clé.",
  quota_exhausted: "Les crédits de ce compte sont épuisés.",
  balance_low: "Le solde de ce compte est trop bas.",
  rate_limited: "Le service a reçu trop de demandes. Réessayez dans un instant.",
  timeout: "Le service n'a pas répondu à temps.",
  unreachable: "Le service est injoignable.",
  upstream_error: "Le service a répondu par une erreur.",
  unexpected_answer: "Le service a rendu une réponse inattendue.",
  account_not_ready: "Le connecteur n'est pas prêt : sa clé ou sa connexion manque.",
  other: "Le test a échoué.",
}

/** La phrase d'un test en échec ; un code absent, ou que cette version de l'écran ne connaît pas, se dit sans raison. */
export function raisonDuTest(code: ProbeFailureCode | null): string {
  const raisons: Readonly<Record<string, string | undefined>> = RAISONS_DU_TEST
  return (code ? raisons[code] : undefined) ?? RAISONS_DU_TEST.other
}

/** La phrase du moteur sur le dernier test, s'il a échoué : le détail la montre quel que soit l'état (désactivé, à terminer). */
export function echecDuDernierTest(compte: AccountView): string | null {
  const test = compte.lastProbe
  return test && !test.healthy ? test.reason : null
}

/**
 * Ce que dit le dernier test gardé : « Fonctionne », avec sa date et le solde lu, ou « Test en échec » et sa raison.
 * Le moteur l'efface quand une clé saisie ou ses réglages changent ; une reconnexion chez le tiers le garde jusqu'au test
 * suivant.
 */
function teste(compte: AccountView): EtatDuCompte | null {
  const test = compte.lastProbe
  if (!test) return null
  const date = dateLisible(test.at)
  if (!test.healthy) return { code: "test_en_echec", mot: "Test en échec", precision: `${raisonDuTest(test.code)}${date ? ` Testé le ${date}.` : ""}`, point: "failed", demandeUnGeste: true, geste: null }
  const solde = test.balance && test.balance.value !== null ? ` Solde : ${test.balance.value.toLocaleString("fr-FR")} ${test.balance.unit}.` : ""
  return { code: "fonctionne", mot: "Connecté", precision: `${date ? `Testé le ${date}.` : "Testé."}${solde}`, point: "ok", demandeUnGeste: false, geste: null }
}

/** Qui a bloqué l'outil d'un compte pour toute l'organisation (`OrgConnector.closedBy`) ; `null` : l'outil n'est pas bloqué. */
export type BloqueurDeLOutil = { userId: string | null; name: string | null } | null

/**
 * L'outil bloqué par un administrateur : plus aucun assistant ne se sert du compte, que seul un administrateur
 * débloque. La fermeture ne garde pas sa date (`OrgConnector`) : la précision dit qui, pas quand.
 */
function bloque(par: NonNullable<BloqueurDeLOutil>, moi: string): EtatDuCompte {
  const qui = par.userId === moi ? "vous" : (par.name ?? "un administrateur")
  return { code: "bloque", mot: "Bloqué par un administrateur", precision: `Par ${qui}. Plus aucun assistant ne s'en sert ; rien n'est effacé.`, point: "paused", demandeUnGeste: false, geste: null }
}

/** Un compte que rien n'a encore testé, ou dont la clé a changé depuis : « Connecté » attend un test réussi. */
function nonTeste(compte: AccountView): EtatDuCompte {
  const precision = compte.mode === "simule" ? "Connecteur simulé : rien ne sort du serveur." : null
  return { code: "non_teste", mot: "Non testé", precision, point: "rest", demandeUnGeste: false, geste: null }
}

/** Ce que l'outil d'un compte dit de lui : bloqué par qui (`bloquePar`), et s'il s'ouvre maintenant par des accès que le compte ne retient pas (`sansAcces`). */
export type OutilDuCompte = { bloquePar?: BloqueurDeLOutil; sansSonAcces?: boolean }

/**
 * L'état d'un compte pour la personne `moi` : désactivé, bloqué avec son outil par un administrateur (`bloquePar`), à
 * remplacer (`sansSonAcces`, ce que rend `sansAcces`), à reconnecter (en erreur, ou refusé par un service où il se
 * connecte chez le tiers), marqué (clé refusée, crédits épuisés), à terminer, sinon ce que dit son dernier test
 * (« Connecté » et sa date, « Test en échec »), et « Non testé » sans test, ou quand la clé a changé depuis.
 */
export function etatDuCompte(compte: AccountView, formulaire: ConnectorAccountForm | undefined, moi: string, { bloquePar = null, sansSonAcces = false }: OutilDuCompte = {}): EtatDuCompte {
  if (compte.status === "disabled") return { code: "desactive", mot: "Désactivé", precision: null, point: "paused", demandeUnGeste: false, geste: null }
  if (bloquePar) return bloque(bloquePar, moi)
  if (sansSonAcces) return aRemplacer(compte)
  const gere = compte.viewerLevel === "manage"
  const aMoi = estAMoi(compte, moi)
  if (compte.status === "error") return aReconnecter(compte, formulaire, aMoi)
  return marque(compte, formulaire, { gere, aMoi }) ?? aTerminer(compte, formulaire, { gere, aMoi }) ?? teste(compte) ?? nonTeste(compte)
}

/** Un compte dont le dernier test a réussi : « Connecté », comme au catalogue, qui compte ceux-là. */
export const fonctionne = (etat: Pick<EtatDuCompte, "code">) => etat.code === "fonctionne"
