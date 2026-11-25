// Les lignes de la liste de l'écran Connecteurs : ce que l'adresse demande (filtre, recherche, compte ouvert), puis
// chaque compte que la personne voit, en textes et en adresses prêts à rendre, filtrés, cherchés et rangés. Module sans
// « use client » : l'écran, rendu par le serveur, le calcule et ne passe à ses îlots que des données (comme
// `equipes/lignes-des-personnes.ts`). Sans lui, la liste, ses filtres et son tri se décideraient dans un îlot client, hors
// de l'adresse.
import { connectorLogoAddress, normalizeTitle, type AccountLevelName, type AccountView, type ConnectorAccountForm, type OrgConnector } from "../../../schemas"
import { connexionDe, estAMoi, etatDuCompte, formulaireDuCompte, type BloqueurDeLOutil, type EtatDuCompte } from "./etat-du-compte"
import { NIVEAUX_DU_COMPTE } from "./libelles-des-partages"

/**
 * Les partages d'un compte, tels que `listAccountRules` les rend : les règles des équipes et des personnes, nommées, et à
 * part celle de toute l'organisation (`general`).
 */
export type PartagesDuCompte = {
  rules: { id: string; subject: { kind: "team" | "user"; id: string; name: string }; level: AccountLevelName }[]
  general: { id: string; level: AccountLevelName } | null
}

const FILTRES = ["all", "mine", "shared"] as const

type FiltreDesConnecteurs = (typeof FILTRES)[number]

/** Ce que l'adresse de l'écran demande : le filtre, la recherche, et le compte dont le détail est ouvert. */
/** `partager` : le détail ouvert l'est sur son partage (`?share=1`, au retour d'un partage qui n'a pas pu se poser). */
export type VueDesConnecteurs = { filtre: FiltreDesConnecteurs; q: string; compte: string | null; partager?: true }

/** La vue lue dans la query de l'écran (`?filter=mine&q=…&connector=<id>`) ; une valeur inconnue vaut son défaut. */
export function vueDesConnecteurs(query: Readonly<Record<string, string | string[] | undefined>>): VueDesConnecteurs {
  const lu = (nom: string) => {
    const valeur = query[nom]
    return typeof valeur === "string" ? valeur : ""
  }
  const compte = lu("connector") || null
  return { filtre: FILTRES.find((filtre) => filtre === lu("filter")) ?? "all", q: lu("q").trim().slice(0, 80), compte, ...(compte && lu("share") === "1" ? { partager: true as const } : {}) }
}

/** Les paramètres d'une vue, sans ses valeurs par défaut. */
function parametresDe({ filtre, q, compte, partager }: VueDesConnecteurs): [string, string][] {
  const parametres: [string, string][] = []
  if (filtre !== "all") parametres.push(["filter", filtre])
  if (q) parametres.push(["q", q])
  if (compte) parametres.push(["connector", compte])
  if (compte && partager) parametres.push(["share", "1"])
  return parametres
}

/** L'adresse de l'écran pour une vue. */
export function adresseDeLaVue(ici: string, vue: VueDesConnecteurs): string {
  const requete = new URLSearchParams(parametresDe(vue)).toString()
  return requete ? `${ici}?${requete}` : ici
}

/** Les comptes dont la page lit les partages : ceux de la personne, que la liste résume, et le compte ouvert s'il le gère. */
export function comptesAuxPartagesLus(comptes: readonly AccountView[], moi: string, ouvert: string | null): AccountView[] {
  return comptes.filter((compte) => compte.viewerLevel === "manage" && (estAMoi(compte, moi) || compte.id === ouvert))
}

/** Le libellé lisible d'un connecteur : celui de sa déclaration, à défaut son nom technique. */
export function libelleDuConnecteur(connecteur: string, formulaires: readonly ConnectorAccountForm[]): string {
  return formulaires.find((formulaire) => formulaire.connector === connecteur)?.label ?? connecteur
}

/** Le geste d'une ligne : un lien vers le détail, où se saisit la clé, ou la connexion chez le tiers. */
type GesteDeLigne =
  | { genre: "detail"; libelle: string }
  | { genre: "connexion"; libelle: string; ressource: "connector-consent" | "hosted-link"; connecteur: string; acces?: string }

/** Une ligne de la liste, ses textes et ses adresses calculés par l'écran. */
export type LigneDeConnecteur = {
  id: string
  libelle: string
  /** Le nom lisible de l'outil. */
  outil: string
  /** L'adresse du logo de l'outil (`logoDe`), `null` sans domaine déclaré. */
  logo: string | null
  /** La description écrite par qui le gère : elle remplace le nom de l'outil sous le libellé. */
  description: string | null
  acces: string
  /** Sous l'accès : le niveau de la personne, ou « Vous seul ». */
  niveau: string
  etat: Pick<EtatDuCompte, "mot" | "precision" | "point">
  /** Désactivé, ou bloqué avec son outil : plus aucun assistant ne s'en sert, la ligne se grise. */
  desactive: boolean
  geste: GesteDeLigne | null
  /** L'adresse qui ouvre le détail, filtre et recherche gardés. */
  ouverture: string
}

const LIBELLES_DES_GESTES = { saisir: "Saisir la clé", remplacer: "Remplacer la clé", connecter: "Connecter", reconnecter: "Reconnecter" } as const

function gesteDe(etat: EtatDuCompte, compte: AccountView, formulaire: ConnectorAccountForm | undefined): GesteDeLigne | null {
  if (!etat.geste) return null
  const libelle = LIBELLES_DES_GESTES[etat.geste]
  if (etat.geste === "saisir" || etat.geste === "remplacer") return { genre: "detail", libelle }
  const ressource = connexionDe(formulaire) === "branchement" ? "hosted-link" : "connector-consent"
  return { genre: "connexion", libelle, ressource, connecteur: compte.connector, ...(compte.access !== undefined ? { acces: compte.access } : {}) }
}

/** À qui est le compte et, dessous, ce que la personne y peut. */
function accesDe(compte: AccountView, moi: string, partages: PartagesDuCompte | undefined): Pick<LigneDeConnecteur, "acces" | "niveau"> {
  const niveau = NIVEAUX_DU_COMPTE[compte.viewerLevel]
  if (compte.owner.kind === "team") return { acces: `Équipe ${compte.owner.teamName ?? "inconnue"}`, niveau }
  if (compte.owner.kind === "org") return { acces: "Toute l'organisation", niveau }
  if (!estAMoi(compte, moi)) return { acces: `Partagé par ${compte.owner.userName ?? "une personne qui n'est plus membre"}`, niveau }
  const sujets = [...(partages?.general ? ["Toute l'organisation"] : []), ...(partages?.rules ?? []).map((regle) => (regle.subject.kind === "team" ? `Équipe ${regle.subject.name}` : regle.subject.name))]
  if (sujets.length === 0) return { acces: "Privé", niveau: "Non partagé" }
  return { acces: sujets.length === 1 ? sujets[0] : `${sujets[0]} +${sujets.length - 1}`, niveau: "Partagé par vous" }
}

/** Désactivé ou bloqué : personne ne le répare seul, sauf qui le gère ou un administrateur. */
const eteint = (etat: EtatDuCompte) => etat.code === "desactive" || etat.code === "bloque"

/** Ceux qui attendent un geste d'abord, les désactivés et les bloqués en dernier, et par libellé dans chaque rang. */
const rang = (etat: EtatDuCompte) => (eteint(etat) ? 2 : etat.demandeUnGeste ? 0 : 1)

type Sources = {
  comptes: readonly AccountView[]
  connecteurs: readonly OrgConnector[]
  formulaires: readonly ConnectorAccountForm[]
  partages: Partial<Record<string, PartagesDuCompte>>
  moi: string
  ici: string
}

/**
 * Les lignes de la vue, et le compte de chaque filtre (compté avant la recherche, qui ne change pas ses pastilles) :
 * « À moi », les comptes personnels de la personne ; « Partagés avec moi », tous les autres.
 */
export function lignesDesConnecteurs({ comptes, connecteurs, formulaires, partages, moi, ici }: Sources, vue: VueDesConnecteurs) {
  const miens = comptes.filter((compte) => estAMoi(compte, moi))
  const retenus = vue.filtre === "mine" ? miens : vue.filtre === "shared" ? comptes.filter((compte) => !estAMoi(compte, moi)) : comptes
  // Sans casse ni accent : « Écritures » se trouve en tapant « ecritures ».
  const cherche = normalizeTitle(vue.q)
  const lignes = retenus
    .map((compte) => {
      const formulaire = formulaireDuCompte(formulaires, compte)
      const etat = etatDuCompte(compte, formulaire, moi, bloquePar(compte.connector, connecteurs))
      const ligne: LigneDeConnecteur = {
        id: compte.id,
        libelle: compte.label,
        outil: libelleDuConnecteur(compte.connector, formulaires),
        logo: logoDe(compte.connector, connecteurs),
        description: compte.description,
        ...accesDe(compte, moi, partages[compte.id]),
        etat: { mot: etat.mot, precision: etat.precision, point: etat.point },
        desactive: eteint(etat),
        geste: gesteDe(etat, compte, formulaire),
        ouverture: adresseDeLaVue(ici, { filtre: vue.filtre, q: vue.q, compte: compte.id }),
      }
      return { ligne, rang: rang(etat) }
    })
    .filter(({ ligne }) => cherche === "" || [ligne.libelle, ligne.outil, ligne.description ?? ""].some((texte) => normalizeTitle(texte).includes(cherche)))
    .sort((a, b) => a.rang - b.rang || a.ligne.libelle.localeCompare(b.ligne.libelle, "fr"))
    .map(({ ligne }) => ligne)
  return { lignes, comptes: { tous: comptes.length, moi: miens.length, partages: comptes.length - miens.length } }
}

/** L'adresse du logo d'un connecteur qui déclare le domaine de son outil ; `null` sinon, et la tuile garde l'initiale. */
export function logoDe(connecteur: string, catalogue: readonly OrgConnector[]): string | null {
  return catalogue.some((candidat) => candidat.connector === connecteur && candidat.logoDomain !== undefined) ? connectorLogoAddress(connecteur) : null
}

/** Qui a bloqué l'outil d'un compte pour l'organisation (`closedBy` d'un connecteur fermé) ; `null` : il ne l'est pas. */
export function bloquePar(connecteur: string, catalogue: readonly OrgConnector[]): BloqueurDeLOutil {
  const outil = catalogue.find((candidat) => candidat.connector === connecteur)
  return outil && outil.state !== "active" ? outil.closedBy : null
}

/** Les fonctions d'un connecteur, telles que le catalogue les décrit ; aucune pour un connecteur qu'il ne décrit plus. */
export function fonctionsDe(connecteur: string, catalogue: readonly OrgConnector[]): OrgConnector["functions"] {
  return catalogue.find((candidat) => candidat.connector === connecteur)?.functions ?? []
}
