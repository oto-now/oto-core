"use client"

// Le « ⋯ » d'une équipe, au titre de sa section du rail : « Les personnes de … », pour toute personne (composer, pour
// l'administrateur ou un responsable), « Renommer l'équipe… » et « Supprimer l'équipe… », pour l'administrateur (le service
// exige l'administrateur, `updateTeam`, `deleteTeam`). Les dialogues sont ceux de l'écran Équipes (`PersonnesDeLEquipe`,
// `ReglagesDEquipe`, `SuppressionDEquipe`), ouverts sur place, sur les données que lit
// `GET teams/<slug>` (`server/team-panel.ts`) à l'ouverture, puis après chaque geste (la relecture du rail). Sans lui,
// une équipe ne se composait ou ne se supprimait qu'en quittant la page pour l'écran Équipes.
import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import type { TeamPanel } from "../../schemas/teams"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { Alert, Button, IconButton } from "../ds/react/primitives"
import { MENU_DE_L_EQUIPE } from "./libelles"
import { surRelectureDuRail } from "./use-arbre-du-rail"

type Geste = "personnes" | "renommer" | "supprimer"

// Les dialogues se chargent à leur ouverture : chargés avec le rail, ils entraient dans le JavaScript de chaque page
// du tableau de bord, au-delà de son budget (`performance-patterns.md § Bundle Size`, job `packed-host-build`).
const PersonnesDeLEquipe = lazy(() => import("../equipes/personnes-de-l-equipe").then((module) => ({ default: module.PersonnesDeLEquipe })))
const SuppressionDEquipe = lazy(() => import("../equipes/suppression-d-equipe").then((module) => ({ default: module.SuppressionDEquipe })))
const ReglagesDEquipe = lazy(() => import("../equipes/reglages-d-equipe").then((module) => ({ default: module.ReglagesDEquipe })))

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

/** Le dialogue d'attente : la lecture du panneau, ou le code du dialogue, en cours ; la lecture en échec, avec « Réessayer ». */
function DialogueDAttente({ nom, erreur, relire, onFermer }: { nom: string; erreur: string | null; relire: () => void; onFermer: () => void }) {
  return (
    <Dialog open onClose={onFermer} title={MENU_DE_L_EQUIPE.personnes(nom)} size="md" footer={<Button variant="secondary" onClick={onFermer}>{MENU_DE_L_EQUIPE.fermer}</Button>}>
      {erreur === null ? (
        <p role="status" aria-busy="true">
          {MENU_DE_L_EQUIPE.chargement}
        </p>
      ) : (
        <Alert tone="fail" title={MENU_DE_L_EQUIPE.echec}>
          {erreur}{" "}
          <Button variant="secondary" size="sm" onClick={relire}>
            {MENU_DE_L_EQUIPE.reessayer}
          </Button>
        </Alert>
      )}
    </Dialog>
  )
}

type PanneauProps = { slug: string; nom: string; geste: Geste; prefixe: string; onFermer: () => void; annoncer: (texte: string) => void }

/** Le dialogue du geste, sur le panneau lu. */
function DialogueDuGeste({ panneau, geste, prefixe, onFermer, annoncer }: Omit<PanneauProps, "slug" | "nom"> & { panneau: TeamPanel }) {
  const { team, people, compose, admin } = panneau
  if (geste === "supprimer") return <SuppressionDEquipe equipe={team} onFermer={onFermer} apresUnDepart={() => undefined} prefixeDesPages={prefixe} />
  if (geste === "renommer") return <ReglagesDEquipe equipe={team} onFermer={onFermer} apresLeRenommage={(nouveau) => annoncer(MENU_DE_L_EQUIPE.renommee(nouveau))} />
  const personnes = people.map((personne) => ({ id: personne.id, nom: personne.name, email: personne.email }))
  return <PersonnesDeLEquipe equipe={team} personnes={personnes} compose={compose} nommeLesResponsables={admin} onFermer={onFermer} />
}

function PanneauDeLEquipe({ slug, nom, geste, prefixe, onFermer, annoncer }: PanneauProps) {
  const { lecture, relire } = usePanneauDeLEquipe(slug)
  const attente = <DialogueDAttente nom={nom} erreur={lecture.etat === "erreur" ? lecture.message : null} relire={relire} onFermer={onFermer} />
  if (lecture.etat !== "pret") return attente
  return (
    <Suspense fallback={attente}>
      <DialogueDuGeste panneau={lecture.panneau} geste={geste} prefixe={prefixe} onFermer={onFermer} annoncer={annoncer} />
    </Suspense>
  )
}

/** `prefixe` : celui des pages de l'hôte, que le rail reçoit (`adresses.pages`) ; une page qui bloque la suppression y mène. */
export function MenuDeLEquipe({ slug, nom, administre, prefixe }: { slug: string; nom: string; administre: boolean; prefixe: string }) {
  const [geste, setGeste] = useState<Geste | null>(null)
  // Le succès d'un renommage se dit ici : le dialogue est parti, la relecture du rail change le nom de la section.
  const [annonce, setAnnonce] = useState("")
  const items: MenuItem[] = [
    { label: MENU_DE_L_EQUIPE.personnes(nom), icon: <AnimatedIcon as={UsersThree} size="xs" />, onSelect: () => setGeste("personnes") },
    ...(administre
      ? [
          { label: MENU_DE_L_EQUIPE.renommer, icon: <AnimatedIcon as={PencilSimple} size="xs" />, onSelect: () => setGeste("renommer") },
          { separator: true },
          { label: MENU_DE_L_EQUIPE.supprimer, icon: <AnimatedIcon as={Trash} size="xs" />, destructive: true, onSelect: () => setGeste("supprimer") },
        ]
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
      {geste && <PanneauDeLEquipe slug={slug} nom={nom} geste={geste} prefixe={prefixe} onFermer={() => setGeste(null)} annoncer={setAnnonce} />}
      <span role="status" className="oto-sr-only">
        {annonce}
      </span>
    </>
  )
}
