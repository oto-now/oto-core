"use client"

// Ce qu'un déplacement change pour qui voit le contenu (E05-S10, partie b2, AC-b7) : l'aperçu du service
// (`GET /api/platform/nodes/impact`, `moveImpact` : chaque membre, son niveau avant et après, et le
// propriétaire), lu avant l'envoi ; sans changement, le déplacement part sans question ; sinon un
// `ConfirmDialog` nomme ceux qui gagnent, perdent ou changent d'accès, avec les mots de « Partager ». Sans
// lui, la confirmation ne voyait que l'espace du chemin (HN-E05S10b-9) : une page rangée sous une page aux
// accès propres, dans le même espace, partait sans rien dire.
import { ACCESS_LEVEL_NAMES, moveImpactQuerySchema, type AccessChange, type MoveImpact } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { ConfirmDialog } from "../ds/react/confirm-dialog"
import type { RefusDuDeplacement } from "../noeud/deplacement-du-noeud"
import { NIVEAUX_D_ACCES } from "../noeud/libelles"
import { DEPLACEMENT_RAIL } from "./libelles"

/**
 * L'aperçu d'un déplacement, ou son refus dit ; `disparu` : le nœud ou sa destination ne sont plus visibles
 * (`not_found`), le rail se relit.
 */
export async function lireLImpact(chemin: string, nouveauChemin: string): Promise<{ impact: MoveImpact } | RefusDuDeplacement> {
  const requete = moveImpactQuerySchema.safeParse({ path: chemin, new_path: nouveauChemin })
  if (!requete.success) return { message: messageDErreur({ code: "invalid_arguments", statut: 400 }), disparu: false }
  const parametres = new URLSearchParams(requete.data)
  const reponse = await appelerPlateforme<MoveImpact>({ methode: "GET", ressource: `nodes/impact?${parametres}` })
  if (!reponse.erreur) return { impact: reponse.data }
  return { message: messageDErreur(reponse.erreur, DEPLACEMENT_RAIL.refusDeLImpact), disparu: reponse.erreur.code === "not_found" }
}

/** « Ada, Léo et 3 autres » : les membres listés (20 au plus), puis ceux que le total ajoute. */
function noms(membres: readonly AccessChange[], total: number, decrire: (membre: AccessChange) => string): string {
  const reste = total - membres.length
  const liste = membres.map(decrire).join(", ")
  return reste > 0 ? DEPLACEMENT_RAIL.etAutres(liste, reste) : liste
}

const niveau = (valeur: AccessChange["before"]) => NIVEAUX_D_ACCES[ACCESS_LEVEL_NAMES[valeur]]

/** Les phrases de l'aperçu : qui gagne, perd ou change d'accès ; le propriétaire seul, quand personne ne change. */
function phrasesDeLImpact(impact: MoveImpact): string[] {
  const { gained, lost, changed, totals } = impact
  const phrases = [
    ...(totals.gained > 0 ? [DEPLACEMENT_RAIL.gagnent(noms(gained, totals.gained, (membre) => `${membre.name} (${niveau(membre.after)})`))] : []),
    ...(totals.lost > 0 ? [DEPLACEMENT_RAIL.perdent(noms(lost, totals.lost, (membre) => membre.name))] : []),
    ...(totals.changed > 0 ? [DEPLACEMENT_RAIL.changent(noms(changed, totals.changed, (membre) => `${membre.name} (${niveau(membre.before)} → ${niveau(membre.after)})`))] : []),
  ]
  return phrases.length > 0 ? phrases : [DEPLACEMENT_RAIL.proprietaireSeul]
}

function PhrasesDeLImpact({ impact }: { impact: MoveImpact }) {
  return phrasesDeLImpact(impact).map((phrase) => <p key={phrase}>{phrase}</p>)
}

/** Un déplacement demandé, avec son aperçu : le nœud, son nom, ses sous-contenus, les espaces quitté et d'arrivée. */
export type DemandeConfirmee = { nom: string; sousContenus: number; impact: MoveImpact }

type ConfirmationProps = { demande: DemandeConfirmee; enCours: boolean; confirmer: () => void; renoncer: () => void }

/** La confirmation d'un déplacement qui change qui voit le contenu (AC-b7) : ce qui change, puis « Déplacer » ou « Annuler ». */
export function ConfirmationDuDeplacement({ demande, enCours, confirmer, renoncer }: ConfirmationProps) {
  return (
    <ConfirmDialog open title={DEPLACEMENT_RAIL.confirmer(demande.nom)} confirmLabel={DEPLACEMENT_RAIL.geste} onConfirm={confirmer} onCancel={renoncer} busy={enCours}>
      {/* L'espace est écrit sur le nœud (20261103150000) : un déplacement ne le change pas, la section du chemin n'est que l'adresse. */}
      <PhrasesDeLImpact impact={demande.impact} />
      {demande.sousContenus > 0 && <p>{DEPLACEMENT_RAIL.sousContenus(demande.sousContenus)}</p>}
    </ConfirmDialog>
  )
}
