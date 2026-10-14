// Les écrans de l'hôte hors de l'arbre, une seule table (E05-S09, AC-a4, AC-a7) : le menu de l'entreprise
// les range sous ses deux titres, le pied du rail et le menu du compte prennent les leurs, la palette les
// propose tous sous « Aller à ». Sans elle, deux listes des mêmes écrans divergeraient au premier écran
// ajouté. E05-S11 : « Marque », « Drapeaux » et « Accès plateforme » n'y sont plus (AC-31, AC-33 ; leurs
// adresses redirigent vers « Organisation » et « Équipes & accès ») ; « Connecteurs » passe au pied du rail
// (AC-32) ; la Corbeille et Profil au menu du compte (AC-e22, AC-6). E05-S13 (AC-10) : « Journal » se range dans
// les réglages, après « Équipes & accès » ; au suivi restent Usage et Retours, que l'hôte ne donne qu'à qui y a droit.
// E11-S10 (AC-e1) : la vue « Contexte » en tête du menu du compte, hors de l'accueil. 1.1.3 : Usage et Retours
// sortent du menu (« Suivi de l'entreprise » disparaît), outils de l'équipe d'Oto : la palette les garde.
// 2026-10-14 : les écrans propres à l'hôte (`AdressesDuRail.ecransDeLHote`) entrent dans cette même table, après ceux du
// paquet ; Accueil se range « en tête », où le rail les pose sous lui.
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings"
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar"
import { ChatCircleText } from "@phosphor-icons/react/dist/csr/ChatCircleText"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise"
import { CreditCard } from "@phosphor-icons/react/dist/csr/CreditCard"
import { Plug } from "@phosphor-icons/react/dist/csr/Plug"
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { Robot } from "@phosphor-icons/react/dist/csr/Robot"
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { UserCircle } from "@phosphor-icons/react/dist/csr/UserCircle"
import { Users } from "@phosphor-icons/react/dist/csr/Users"
import type { Glyphe } from "../ds/react/icon"
import { GLYPHE_DE_L_HOTE_PAR_DEFAUT, GLYPHES_DE_L_HOTE } from "./glyphes-de-l-hote"
import { COMPTE, ENTREPRISE, RAIL } from "./libelles"
import type { AdressesDuRail, EcranDeLHote, Rangement } from "./types"

type Ecran = { cle: Exclude<keyof AdressesDuRail, "pages" | "ecransDeLHote">; libelle: string; glyphe: Glyphe; rangement: Rangement; admin: boolean }

const ECRANS: readonly Ecran[] = [
  { cle: "accueil", libelle: RAIL.accueil, glyphe: SquaresFour, rangement: "tete", admin: false },
  { cle: "usage", libelle: ENTREPRISE.usage, glyphe: ChartBar, rangement: "hors-menu", admin: true },
  { cle: "retours", libelle: ENTREPRISE.retours, glyphe: ChatCircleText, rangement: "hors-menu", admin: true },
  { cle: "organisation", libelle: ENTREPRISE.organisation, glyphe: Buildings, rangement: "reglages", admin: true },
  { cle: "equipes", libelle: ENTREPRISE.equipes, glyphe: Users, rangement: "reglages", admin: false },
  { cle: "journal", libelle: ENTREPRISE.journal, glyphe: ClockCounterClockwise, rangement: "reglages", admin: false },
  // E12-S02 : l'abonnement de l'hôte qui vend le paquet, s'il en donne l'adresse.
  { cle: "abonnement", libelle: ENTREPRISE.abonnement, glyphe: CreditCard, rangement: "reglages", admin: true },
  { cle: "connecteurs", libelle: RAIL.connecteurs, glyphe: Plug, rangement: "pied", admin: true },
  { cle: "contexte", libelle: COMPTE.contexte, glyphe: Info, rangement: "compte", admin: false },
  { cle: "profil", libelle: COMPTE.profil, glyphe: UserCircle, rangement: "compte", admin: false },
  { cle: "brancher", libelle: COMPTE.brancher, glyphe: Robot, rangement: "compte", admin: false },
  { cle: "corbeille", libelle: RAIL.corbeille, glyphe: Trash, rangement: "compte", admin: false },
]

export type EcranPermis = { libelle: string; glyphe: Glyphe; adresse: string; rangement: Rangement }

type EcranDeLaTable = Omit<Ecran, "cle"> & { adresse: string | undefined }

/** Un écran de l'hôte dans la table : son glyphe lu par son nom ; un nom hors de la table est une erreur de l'hôte. */
function versLaTable({ libelle, adresse, glyphe = GLYPHE_DE_L_HOTE_PAR_DEFAUT, rangement, admin = false }: EcranDeLHote): EcranDeLaTable {
  if (!Object.hasOwn(GLYPHES_DE_L_HOTE, glyphe)) throw new Error(`Écran de l'hôte « ${libelle} » : glyphe inconnu « ${glyphe} » (GLYPHES_DE_L_HOTE).`)
  return { libelle, glyphe: GLYPHES_DE_L_HOTE[glyphe], adresse, rangement, admin }
}

/** La table entière : les écrans du paquet aux adresses que l'hôte donne, puis les siens, chacun à une adresse libre. */
function tableDesEcrans(adresses: AdressesDuRail): EcranDeLaTable[] {
  const duPaquet = ECRANS.map(({ cle, ...ecran }) => ({ ...ecran, adresse: adresses[cle] }))
  const prises = new Set(duPaquet.flatMap(({ adresse }) => (adresse === undefined ? [] : [adresse])))
  const deLHote = (adresses.ecransDeLHote ?? []).map((ecran) => {
    if (prises.has(ecran.adresse)) throw new Error(`Écran de l'hôte « ${ecran.libelle} » : l'adresse « ${ecran.adresse} » est déjà celle d'un autre écran.`)
    prises.add(ecran.adresse)
    return versLaTable(ecran)
  })
  return [...duPaquet, ...deLHote]
}

/** Les écrans que l'hôte sert et que la personne peut ouvrir : ceux d'administration pour qui administre. */
export function ecransPermis(adresses: AdressesDuRail, administre: boolean): EcranPermis[] {
  return tableDesEcrans(adresses).flatMap(({ libelle, glyphe, adresse, rangement, admin }) =>
    adresse !== undefined && (administre || !admin) ? [{ libelle, glyphe, adresse, rangement }] : [],
  )
}
