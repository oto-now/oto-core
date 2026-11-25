"use client"

// La confirmation du premier partage d'un connecteur personnel connecté chez le tiers (par autorisation), posée par le
// panneau « Partager » (`partage-du-connecteur.tsx`) avant la première règle : ce que le partage engage, une seule
// fois (l'autre agit par ce compte, au nom de son propriétaire ; l'autorisation reste cachée ; seul le propriétaire le
// reconnecte). Module à part : le panneau dépassait sa taille.
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { Lock } from "@phosphor-icons/react/dist/csr/Lock"
import type { AccountLevelName } from "../../../schemas"
import { ConfirmDialog } from "../../ds/react/confirm-dialog"
import { Button } from "../../ds/react/primitives"
import { ListeDesEffets, type Effet } from "./blocage-de-l-outil"
import { NIVEAUX_DU_COMPTE } from "./libelles-des-partages"

/** Une question du premier partage : à qui, à quel niveau (`null` : des niveaux différents), et la réponse attendue. */
export type Accord = { nom: string; niveau: AccountLevelName | null; repondre: (oui: boolean) => void }

/** Ce que le premier partage engage, effet par effet. */
function effets(accord: Accord): Effet[] {
  const qui = `${accord.nom.charAt(0).toUpperCase()}${accord.nom.slice(1)}`
  const niveau = accord.niveau ? `au niveau choisi : « ${NIVEAUX_DU_COMPTE[accord.niveau]} »` : "aux niveaux choisis"
  return [
    { glyphe: Info, calme: true, texte: `${qui} y agira par votre compte, en votre nom : ce que son assistant y lit ou y fait passe par lui.` },
    { glyphe: Info, calme: true, texte: `Le connecteur sert quand on le nomme, ${niveau}.` },
    { glyphe: Lock, calme: true, texte: "Votre autorisation reste cachée. C'est à vous de le reconnecter s'il le faut, et vous pouvez retirer ce partage à tout moment." },
  ]
}

/** Le premier partage d'un connecteur personnel connecté par autorisation : ce qu'il engage, une seule fois. */
export function PremierPartage({ libelle, accord }: { libelle: string; accord: Accord }) {
  return (
    <ConfirmDialog
      open
      role="alertdialog"
      aria-describedby="premier-partage-effets"
      title={`Partager « ${libelle} » avec ${accord.nom} ?`}
      size="md"
      onCancel={() => accord.repondre(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => accord.repondre(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => accord.repondre(true)}>
            Partager quand même
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ListeDesEffets id="premier-partage-effets" liste={effets(accord)} />
        <p className="oto-caption">Cette question ne se pose qu&apos;au premier partage d&apos;un connecteur connecté avec votre compte.</p>
      </div>
    </ConfirmDialog>
  )
}
