import type { AdressesDuRail } from "@otomata_tech/oto_platform/ui"

// Les écrans de l'hôte, que le fil des écrans d'administration range sous leur groupe (E05-S09 partie d2) :
// les adresses que le layout donne au rail, pour que le fil et le menu de l'entreprise mènent aux mêmes
// pages. Sans elles, l'en-tête d'un écran d'administration n'a pas de fil. Les Retours, le layout et la page des
// retours les ajoutent pour qui les traite (AC-9, « Retours visibles »).
export const ADRESSES: AdressesDuRail = {
  pages: "/n/",
  accueil: "/",
  journal: "/journal",
  equipes: "/teams",
  brancher: "/connect",
  organisation: "/admin/organization",
  connecteurs: "/admin/connectors",
}
