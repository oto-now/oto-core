// Les appels du tiroir « Historique des versions » à l'API du paquet (`api/node-history.ts`) : la liste des versions
// (de la page ou d'un bloc, par pages), l'écart d'une version, et le retour à une version. Sans ce module, le tiroir
// écrirait ses adresses et la forme de leurs réponses.
import type { NodeHistoryDiffView, NodeHistoryView, RestoreRevisionResult } from "../../../schemas/node-history"
import { appelerPlateforme } from "../../api/client"

function adresse(chemin: string, parametres: Record<string, string | number | undefined>): string {
  const recherche = new URLSearchParams({ path: chemin })
  for (const [nom, valeur] of Object.entries(parametres)) if (valeur !== undefined) recherche.set(nom, String(valeur))
  return recherche.toString()
}

/** `bloc` : les seules versions où ce bloc a changé ; `curseur` : la page sous cette révision. */
export function lireLHistorique(chemin: string, bloc?: string, curseur?: number) {
  return appelerPlateforme<NodeHistoryView>({ methode: "GET", ressource: `nodes/history?${adresse(chemin, { block: bloc, cursor: curseur })}` })
}

export function lireLEcart(chemin: string, revision: number, bloc?: string) {
  return appelerPlateforme<NodeHistoryDiffView>({ methode: "GET", ressource: `nodes/history/diff?${adresse(chemin, { revision, block: bloc })}` })
}

/** Publie de nouveau `revision`, sur la révision lue (`base`). */
export function revenirALaVersion(chemin: string, revision: number, base: number) {
  return appelerPlateforme<RestoreRevisionResult>({ methode: "POST", ressource: "nodes/restore", corps: { path: chemin, revision, base_revision: base } })
}
