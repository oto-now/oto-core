// La dernière connexion de chaque assistant, une ligne par famille, de la plus récente à la plus ancienne : la ligne
// d'état de l'aparté de l'accueil (`BranchementIA`) et de la page `/connect` (`EcranConnexion`), une seule source
// là où deux copies divergeraient. Le vide et l'échec restent à chacun : l'accueil dit « aucun », `/connect` ne dit
// rien et ramène à sa page. Le point est décoratif, le mot le porte (`accessibility-patterns.md § Couleurs & Contraste`).
import { BRANCHEMENT } from "../accueil/libelles"
import { StatusDot } from "../ds/react/status-dot"
import { dateLisible } from "../format/dates"
import type { DerniereConnexion } from "./types"

/** Le nom de la liste pour le lecteur d'écran : elle n'a pas de titre visible. */
const VOS_CONNEXIONS = "Vos connexions"

export function ConnexionsRecentes({ connexions }: { connexions: readonly DerniereConnexion[] }) {
  return (
    <ul aria-label={VOS_CONNEXIONS} className="flex flex-col gap-1">
      {connexions.map(({ famille, date }) => (
        <li key={famille} className="oto-caption flex items-center gap-2">
          <StatusDot state="ok" aria-hidden="true" />
          {BRANCHEMENT.derniere(famille, dateLisible(date) ?? "?")}
        </li>
      ))}
    </ul>
  )
}
