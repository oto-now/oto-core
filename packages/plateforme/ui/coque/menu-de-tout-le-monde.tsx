"use client"

// Le « ⋯ » de la section Tout le monde du rail, pour qui administre (décidé par JB le 28/10) : « Droits de Tout le
// monde… » ouvre le panneau « Partager » de la racine (`PartageDuNoeud`), sans son partage sur le web. Une règle posée sur
// la racine vaut pour chaque contenu de Tout le monde qui n'a pas la sienne, jamais sous une équipe ni dans Privé
// (`droits-d-acces.md` § Règles d'accès) : « Peut modifier » pour toute l'organisation y ouvre l'ajout et la modification,
// une équipe ou une personne y a son exception. Le panneau, ses règles et les sujets à ajouter se lisent à l'ouverture par
// `GET rules?path=guide&subjects`, puis à chaque relecture du rail, qui suit chaque geste (`surRelectureDuRail`) ; les
// gestes passent par les routes du panneau, qui redécident chaque droit. Sans lui, la racine, qu'aucune page ne montre, ne
// se réglait que par un assistant.
import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import type { NodeRulesView } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { RACINE } from "../arbre/depuis-l-arbre"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { Alert, Button, IconButton } from "../ds/react/primitives"
import type { SujetsDeRegle } from "../equipes/types"
import { MENU_DE_TOUT_LE_MONDE } from "./libelles"
import { surRelectureDuRail } from "./use-arbre-du-rail"

// Le panneau se charge à l'ouverture : chargé avec le rail, il entrait dans le JavaScript de chaque page du tableau de
// bord, au-delà de son budget (`performance-patterns.md § Bundle Size`), comme les dialogues de `MenuDeLEquipe`.
const PartageDuNoeud = lazy(() => import("../noeud/partage-du-noeud").then((module) => ({ default: module.PartageDuNoeud })))

type Racine = NodeRulesView & { subjects: NonNullable<NodeRulesView["subjects"]> }

type Lecture = { etat: "chargement" } | { etat: "erreur"; message: string } | { etat: "pret"; racine: Racine }

/** La racine, ses règles et les sujets à ajouter, lus à l'ouverture et relus après chaque geste (la relecture du rail). */
function useDroitsDeLaRacine() {
  const [lecture, setLecture] = useState<Lecture>({ etat: "chargement" })
  const lire = useCallback(async () => {
    const lu = await appelerPlateforme<NodeRulesView>({ methode: "GET", ressource: `rules?path=${RACINE}&subjects` })
    if (lu.erreur) return setLecture({ etat: "erreur", message: messageDErreur(lu.erreur) })
    const { subjects } = lu.data
    setLecture(subjects ? { etat: "pret", racine: { ...lu.data, subjects } } : { etat: "erreur", message: MENU_DE_TOUT_LE_MONDE.echec })
  }, [])
  useEffect(() => {
    void lire()
    return surRelectureDuRail(() => void lire())
  }, [lire])
  return { lecture, relire: () => void lire() }
}

/** Les sujets du champ « Ajouter » : les équipes, puis les personnes de l'organisation. */
function sujetsDe(subjects: Racine["subjects"]): SujetsDeRegle {
  return {
    equipes: subjects.teams.map((equipe) => ({ id: equipe.id, nom: equipe.name })),
    personnes: subjects.people.map((personne) => ({ id: personne.id, nom: personne.name })),
  }
}

/** L'attente : la lecture, ou le code du panneau, en cours ; la lecture en échec, avec « Réessayer ». */
function Attente({ erreur, relire }: { erreur: string | null; relire: () => void }) {
  if (erreur === null) {
    return (
      <p role="status" aria-busy="true">
        {MENU_DE_TOUT_LE_MONDE.chargement}
      </p>
    )
  }
  return (
    <Alert tone="fail" title={MENU_DE_TOUT_LE_MONDE.echec}>
      {erreur}{" "}
      <Button variant="secondary" size="sm" onClick={relire}>
        {MENU_DE_TOUT_LE_MONDE.reessayer}
      </Button>
    </Alert>
  )
}

function DroitsDeToutLeMonde({ onFermer }: { onFermer: () => void }) {
  const { lecture, relire } = useDroitsDeLaRacine()
  const attente = <Attente erreur={lecture.etat === "erreur" ? lecture.message : null} relire={relire} />
  return (
    <Dialog
      open
      onClose={onFermer}
      title={MENU_DE_TOUT_LE_MONDE.titre}
      description={MENU_DE_TOUT_LE_MONDE.explication}
      size="md"
      footer={
        <Button variant="secondary" onClick={onFermer}>
          {MENU_DE_TOUT_LE_MONDE.fermer}
        </Button>
      }
    >
      {lecture.etat === "pret" ? (
        <Suspense fallback={attente}>
          {/* Seul qui administre ouvre ce menu : il accorde l'accès complet (N6) ; « (vous) » n'y est pas dit. */}
          <PartageDuNoeud noeud={lecture.racine} sujets={sujetsDe(lecture.racine.subjects)} gestionAccordable moi={null} nomOrganisation={lecture.racine.subjects.organisation} surLeWeb={false} />
        </Suspense>
      ) : (
        attente
      )}
    </Dialog>
  )
}

/** `nom` : le titre de la section (« Tout le monde ») ; le rail ne le monte que pour qui administre l'organisation. */
export function MenuDeToutLeMonde({ nom }: { nom: string }) {
  const [ouvert, setOuvert] = useState(false)
  const items: MenuItem[] = [{ label: MENU_DE_TOUT_LE_MONDE.droits, icon: <AnimatedIcon as={ShieldCheck} size="xs" />, onSelect: () => setOuvert(true) }]
  const declencheur = (
    <IconButton label={MENU_DE_TOUT_LE_MONDE.actions(nom)} size="sm">
      <AnimatedIcon as={DotsThree} size="xs" />
    </IconButton>
  )
  return (
    <>
      <DropdownMenu trigger={declencheur} items={items} />
      {ouvert && <DroitsDeToutLeMonde onFermer={() => setOuvert(false)} />}
    </>
  )
}
