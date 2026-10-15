"use client"

// Le « ⋯ » d'une équipe, au titre de sa section du rail : « Les personnes de … », pour toute personne (composer, pour
// l'administrateur ou un responsable), et « Supprimer l'équipe… », pour l'administrateur. Les deux dialogues sont ceux de
// l'écran Équipes (`PersonnesDeLEquipe`, `SuppressionDEquipe`), ouverts sur place, sur les données que lit
// `GET teams/<slug>` (`server/team-panel.ts`) à l'ouverture, puis après chaque geste (la relecture du rail). Sans lui,
// une équipe ne se composait ou ne se supprimait qu'en quittant la page pour l'écran Équipes.
import { useCallback, useEffect, useState } from "react"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import type { TeamPanel } from "../../schemas/teams"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { Alert, Button, IconButton } from "../ds/react/primitives"
import { PersonnesDeLEquipe } from "../equipes/personnes-de-l-equipe"
import { SuppressionDEquipe } from "../equipes/suppression-d-equipe"
import { MENU_DE_L_EQUIPE } from "./libelles"
import { surRelectureDuRail } from "./use-arbre-du-rail"

type Geste = "personnes" | "supprimer"

type Lecture = { etat: "chargement" } | { etat: "erreur"; message: string } | { etat: "pret"; panneau: TeamPanel }

/** Le panneau de l'équipe, lu à l'ouverture et relu après chaque geste (la relecture du rail, `useRafraichir`). */
function usePanneauDeLEquipe(slug: string) {
  const [lecture, setLecture] = useState<Lecture>({ etat: "chargement" })
  const lire = useCallback(async () => {
    const lu = await appelerPlateforme<TeamPanel>({ methode: "GET", ressource: `teams/${encodeURIComponent(slug)}` })
    setLecture(lu.erreur ? { etat: "erreur", message: messageDErreur(lu.erreur) } : { etat: "pret", panneau: lu.data })
  }, [slug])
  useEffect(() => {
    void lire()
    return surRelectureDuRail(() => void lire())
  }, [lire])
  return { lecture, relire: () => void lire() }
}

function PanneauDeLEquipe({ slug, nom, geste, onFermer }: { slug: string; nom: string; geste: Geste; onFermer: () => void }) {
  const { lecture, relire } = usePanneauDeLEquipe(slug)
  if (lecture.etat === "pret") {
    const { team, people, compose, admin } = lecture.panneau
    if (geste === "supprimer") return <SuppressionDEquipe equipe={team} onFermer={onFermer} apresUnDepart={() => undefined} />
    const personnes = people.map((personne) => ({ id: personne.id, nom: personne.name, email: personne.email }))
    return <PersonnesDeLEquipe equipe={team} personnes={personnes} compose={compose} nommeLesResponsables={admin} onFermer={onFermer} />
  }
  return (
    <Dialog open onClose={onFermer} title={MENU_DE_L_EQUIPE.personnes(nom)} size="md" footer={<Button variant="secondary" onClick={onFermer}>{MENU_DE_L_EQUIPE.fermer}</Button>}>
      {lecture.etat === "chargement" ? (
        <p role="status" aria-busy="true">
          {MENU_DE_L_EQUIPE.chargement}
        </p>
      ) : (
        <Alert tone="fail" title={MENU_DE_L_EQUIPE.echec}>
          {lecture.message}{" "}
          <Button variant="secondary" size="sm" onClick={relire}>
            {MENU_DE_L_EQUIPE.reessayer}
          </Button>
        </Alert>
      )}
    </Dialog>
  )
}

export function MenuDeLEquipe({ slug, nom, administre }: { slug: string; nom: string; administre: boolean }) {
  const [geste, setGeste] = useState<Geste | null>(null)
  const items: MenuItem[] = [
    { label: MENU_DE_L_EQUIPE.personnes(nom), icon: <AnimatedIcon as={UsersThree} size="xs" />, onSelect: () => setGeste("personnes") },
    ...(administre
      ? [{ separator: true }, { label: MENU_DE_L_EQUIPE.supprimer, icon: <AnimatedIcon as={Trash} size="xs" />, destructive: true, onSelect: () => setGeste("supprimer") }]
      : []),
  ]
  const declencheur = (
    <IconButton label={MENU_DE_L_EQUIPE.actions(nom)} size="sm">
      <AnimatedIcon as={DotsThree} size="xs" />
    </IconButton>
  )
  return (
    <>
      <DropdownMenu trigger={declencheur} items={items} />
      {geste && <PanneauDeLEquipe slug={slug} nom={nom} geste={geste} onFermer={() => setGeste(null)} />}
    </>
  )
}
