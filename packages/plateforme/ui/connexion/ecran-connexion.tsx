// « Brancher mon Claude, ChatGPT ou Mistral » (E02-S04, E11-S09, FR-CONN-04, `mcp-patterns.md § 9`) : pour
// l'organisation de l'adresse, la dernière connexion de chaque assistant en ligne d'état, au format de
// l'accueil, puis le guide (`GuideDeBranchement`, le même que la fenêtre de l'accueil). Server Component.
// Les connexions arrivent en `resultat` (portage § 4) ; l'adresse ne lit pas la base, le guide reste affiché
// quand la lecture échoue.
//
// Porté d'oto-frontend (`src/components/accueil/branchement-ia.tsx` et la grammaire de ses écrans,
// `src/routes/settings.profile.lazy.tsx`) : l'en-tête d'écran (`ScreenHeader`), l'îlot du guide (`Island`,
// `IslandBody`), la colonne d'un écran qui se lit (`.oto-content-max[data-width="document"]`). Retiré : la
// carte de l'accueil, le tutoriel « Bientôt » (→ le guide), l'îlot « Vos connexions » (→ la ligne d'état),
// `lucide-react`.
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { COMPTE } from "../coque/libelles"
import { Icon } from "../ds/react/icon"
import { Island, IslandBody } from "../ds/react/island"
import { ScreenHeader } from "../ds/react/screen-header"
import { Skeleton } from "../ds/react/skeleton"
import { ConnexionsRecentes } from "./connexions-recentes"
import { GuideDeBranchement } from "./guide-de-branchement"
import type { AdresseDeConnexion, DerniereConnexion } from "./types"

type EcranConnexionProps = {
  adresse: AdresseDeConnexion
  /** Une ligne par famille d'assistants, de la plus récente à la plus ancienne (AC7). */
  connexions: Resultat<DerniereConnexion[]>
  Lien: LienDeLHote
  /** L'adresse de la page dans l'hôte : « Réessayer » d'une lecture en échec y ramène. */
  ici: string
  /** @deprecated Plus lu : l'écran ne montre plus de demandes à essayer. Gardé pour qu'un hôte qui le passe compile encore. */
  prompts?: unknown
}

/** Déjà branché : une ligne par assistant (`ConnexionsRecentes`) ; rien tant qu'aucun ne s'est connecté. */
function LigneDEtat({ connexions, Lien, ici }: Pick<EcranConnexionProps, "connexions" | "Lien" | "ici">) {
  if (connexions.error !== undefined) return <ErreurDeLecture message={connexions.error} href={ici} Lien={Lien} />
  if (connexions.data.length === 0) return null
  return <ConnexionsRecentes connexions={connexions.data} />
}

export function EcranConnexion({ adresse, connexions, Lien, ici }: EcranConnexionProps) {
  return (
    <>
      <ScreenHeader title={COMPTE.brancher} icon={<Icon as={Robot} size="md" />} />
      <div className="oto-content-max flex flex-col gap-3" data-width="document">
        <LigneDEtat connexions={connexions} Lien={Lien} ici={ici} />
        {/* Sans en-tête : le titre de l'écran le nomme déjà. */}
        <Island>
          <IslandBody>
            <GuideDeBranchement adresse={adresse} />
          </IslandBody>
        </Island>
      </div>
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC8) : l'en-tête et l'îlot du guide en attente. */
export function EcranConnexionChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="oto-sr-only">Chargement de la page de branchement…</span>
      <Skeleton width="16rem" height="1.75rem" />
      <Skeleton shape="card" />
    </div>
  )
}
