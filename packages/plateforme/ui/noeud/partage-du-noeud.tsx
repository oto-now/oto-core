"use client"

// « Partager » (E05-S10, partie b, AC-b5), le panneau qu'ouvre « Partager · <espace> » de l'en-tête d'un
// nœud, à la façon de Notion : un champ pour ajouter une personne ou une équipe, la liste de ceux qui ont
// un accès propre, chacun avec son niveau dans un menu (« Accès complet », « Peut modifier », « Peut
// lire », « Retirer »), puis l'accès général (toute l'organisation, ADR-014). Les niveaux et les services ne
// changent pas (E05-S03) : ajouter ou changer part à `POST /api/platform/rules` (`setNodeRuleSchema`),
// retirer à `DELETE rules/<id>` ; le service décide (N6 : l'accès complet ne s'accorde que par un
// administrateur). Le mot « règle » ne s'écrit plus à l'écran. Sans lui, « Partager » ouvrait le tableau
// des règles d'E05-S03.
//
// Repris de `equipes/regles-du-noeud.tsx` et `ajout-de-regle.tsx` : les requêtes, la relecture, le focus
// replié quand la relecture emporte le contrôle (`replierLeFocusSur`). Changé : un champ qui cherche au lieu
// d'une liste, un menu natif par ligne (un `DropdownMenu` monté hors du popover le refermerait au clic,
// HN-E05S10b-4), l'accès par défaut « Peut lire » (HN-E05S10b-5).
//
// Partie d : l'accès général se change (`AccesParDefaut`, AC-b13, ADR-014) et « Partager sur le web » suit, pour
// qui a l'accès complet (`PartageSurLeWeb`, AC-d1, ADR-013) ; leurs annonces et leurs refus passent par les
// régions de ce panneau.
//
// 1.4.13 : quatre sections titrées en étiquettes (accès par défaut, ajoutés, membres de l'équipe, sur le web), les niveaux
// en pastilles de couleur (`partage-visuel.tsx`), l'équipe propriétaire réglée sur sa propre ligne et non plus parmi les
// ajoutés.
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { Globe } from "@phosphor-icons/react/dist/csr/Globe"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { ACCESS_LEVEL_NAMES, setNodeRuleSchema, type AccessLevelName, type NodeRulesView } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur, type MessagesDuGeste } from "../api/messages"
import { replierLeFocusSur } from "../components/focus"
import { AnimatedIcon } from "../ds/react/icon"
import { InputAffix } from "../ds/react/input-affix"
import { Avatar } from "../ds/react/primitives"
import type { SelectOption } from "../ds/react/select"
import type { SujetsDeRegle } from "../equipes/types"
import { useRafraichir } from "../hote/rafraichir"
import { PartageSurLeWeb } from "../public/partage-sur-le-web"
import { AccesParDefaut } from "./acces-general"
import { NIVEAUX_D_ACCES, PARTAGE } from "./libelles"
import { EtatDesNiveaux, MembresDeLEquipe, useNiveauxDesMembres } from "./niveau-d-un-membre"
import { ChoixDuNiveau, EtiquetteDeLigne, NiveauLu, optionDuNiveau, SectionDuPartage } from "./partage-visuel"

/**
 * L'ancre du panneau : l'intitulé de la liste, qui reçoit le focus quand la relecture emporte le contrôle
 * qui l'avait (une ligne retirée, son propre accès complet perdu). Une valeur fixe : une page ne monte
 * qu'un panneau.
 */
const ANCRE = "partage-du-noeud"

/** La valeur de « Retirer » dans le menu d'une ligne : aucun niveau ne s'écrit ainsi. */
const RETIRER = "retirer"

/** Ce qu'on ajoute : une équipe ou une personne de l'organisation. */
type Candidat = { kind: "team" | "user"; id: string; nom: string }

type Regle = NodeRulesView["rules"][number]

type Envoi = { methode: "POST" | "DELETE"; ressource: string; corps?: unknown }

/**
 * L'envoi d'un geste : la réponse lue, l'annonce ou le refus posé (dit par `refus`, les phrases propres au
 * geste, avant la table commune), la page relue ; `true` s'il a abouti.
 */
type Envoyer = (envoi: Envoi, annonce: string, refus?: MessagesDuGeste) => Promise<boolean>

/** Sans accent ni capitale : « équipe » se trouve en tapant « equipe ». */
const normaliser = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/**
 * Le focus d'un contrôle que la relecture peut emporter (`accessibility-patterns.md § Après une action`) : à
 * son départ après un succès, il va à l'ancre ; un départ sans succès ne le déplace pas.
 */
function useRepliApresSucces<T extends HTMLElement>() {
  const geste = useRef<T>(null)
  const apresUnSucces = useRef(false)
  useLayoutEffect(() => {
    const element = geste.current
    // L'objet de la ref, stable, et non sa valeur : le départ lit le succès tel qu'il est à ce moment.
    const succes = apresUnSucces
    return () => {
      if (!succes.current) return
      replierLeFocusSur(ANCRE, element)
      // L'ancre peut naître dans le même rendu que ce départ : le focus l'y rejoint ensuite (M13a).
      queueMicrotask(() => replierLeFocusSur(ANCRE, null))
    }
  }, [])
  return { geste, apresUnSucces }
}

/** Les suggestions du champ : l'équipe ou la personne, et ce qu'elle est. */
function Suggestions({ id, trouves, rang, choisir }: { id: string; trouves: Candidat[]; rang: number; choisir: (candidat: Candidat) => void }) {
  return (
    <div id={id} role="listbox" aria-label={PARTAGE.suggestions} className="oto-share-suggestions">
      {trouves.map((candidat, index) => (
        <button
          key={`${candidat.kind}:${candidat.id}`}
          id={`${id}-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={index === rang}
          data-highlighted={index === rang ? "" : undefined}
          className="oto-menu-item"
          // Le focus reste dans le champ : le choix se fait au clic, sans le lui retirer.
          onMouseDown={(evenement) => evenement.preventDefault()}
          onClick={() => choisir(candidat)}
        >
          {candidat.kind === "team" ? <AnimatedIcon as={UsersThree} size="xs" /> : <Avatar name={candidat.nom} size="sm" aria-hidden="true" />}
          <span>{candidat.kind === "team" ? PARTAGE.equipe(candidat.nom) : candidat.nom}</span>
        </button>
      ))}
    </div>
  )
}

/** « Ajouter une personne ou une équipe » : la saisie cherche parmi celles qui n'ont pas d'accès propre. */
function AjoutDAcces({ chemin, candidats, envoyer, enCours }: { chemin: string; candidats: Candidat[]; envoyer: Envoyer; enCours: boolean }) {
  const id = useId()
  const [saisie, setSaisie] = useState("")
  const [rang, setRang] = useState(-1)
  const { geste, apresUnSucces } = useRepliApresSucces<HTMLInputElement>()
  const cherche = normaliser(saisie.trim())
  const trouves = cherche ? candidats.filter((candidat) => normaliser(candidat.nom).includes(cherche)).slice(0, 8) : []

  async function choisir(candidat: Candidat) {
    const corps = setNodeRuleSchema.safeParse({ path: chemin, subject: { kind: candidat.kind, id: candidat.id }, level: "read" })
    if (!corps.success || enCours) return
    apresUnSucces.current = false
    const nom = candidat.kind === "team" ? PARTAGE.equipe(candidat.nom) : candidat.nom
    if (!(await envoyer({ methode: "POST", ressource: "rules", corps: corps.data }, PARTAGE.ajoute(nom)))) return
    apresUnSucces.current = true
    setSaisie("")
    setRang(-1)
  }

  function clavier(evenement: KeyboardEvent<HTMLInputElement>) {
    const gestes: Record<string, () => void> = {
      ArrowDown: () => setRang((courant) => (trouves.length === 0 ? -1 : (courant + 1) % trouves.length)),
      ArrowUp: () => setRang((courant) => (trouves.length === 0 ? -1 : (courant - 1 + trouves.length) % trouves.length)),
      Enter: () => {
        const choisi = trouves[rang] ?? (trouves.length === 1 ? trouves[0] : undefined)
        if (choisi) void choisir(choisi)
      },
      // Une saisie en cours s'efface d'abord ; le panneau ne se referme qu'au second Échap (`AccessPanel`).
      Escape: () => {
        setSaisie("")
        setRang(-1)
      },
    }
    const touche = gestes[evenement.key]
    if (!touche || (evenement.key === "Escape" && saisie === "")) return
    evenement.preventDefault()
    touche()
  }

  const ouverte = cherche !== ""
  return (
    <div className="flex flex-col gap-1">
      <InputAffix
        ref={geste}
        type="text"
        role="combobox"
        aria-label={PARTAGE.ajouter}
        placeholder={PARTAGE.ajouter}
        aria-autocomplete="list"
        aria-expanded={ouverte}
        aria-controls={ouverte ? `${id}-liste` : undefined}
        aria-activedescendant={rang >= 0 && trouves[rang] ? `${id}-liste-${rang}` : undefined}
        aria-busy={enCours}
        value={saisie}
        onChange={(evenement: ChangeEvent<HTMLInputElement>) => {
          setSaisie(evenement.target.value)
          setRang(-1)
        }}
        onKeyDown={clavier}
        start={<AnimatedIcon as={MagnifyingGlass} anim="magnify" size="xs" />}
      />
      {ouverte && (trouves.length > 0 ? <Suggestions id={`${id}-liste`} trouves={trouves} rang={rang} choisir={(candidat) => void choisir(candidat)} /> : <p className="oto-caption">{PARTAGE.rienTrouve}</p>)}
    </div>
  )
}

/** Les niveaux du menu d'une ligne : ceux que la personne peut accorder, et toujours celui de la ligne. */
function optionsDeNiveau(niveaux: readonly AccessLevelName[], courant: AccessLevelName): SelectOption[] {
  const proposes = ACCESS_LEVEL_NAMES.filter((niveau) => niveau === courant || niveaux.includes(niveau)).reverse()
  return [...proposes.map(optionDuNiveau), { value: RETIRER, label: PARTAGE.retirer }]
}

type LigneProps = { chemin: string; regle: Regle; gere: boolean; niveaux: readonly AccessLevelName[]; moi: string | null; envoyer: Envoyer; enCours: boolean }

/** Le geste d'un choix du menu d'une ligne : retirer, ou poser le niveau choisi ; `null` pour une valeur inconnue. */
function envoiDuChoix(chemin: string, regle: Regle, valeur: string): { envoi: Envoi; niveau: AccessLevelName | null } | null {
  if (valeur === RETIRER) return { envoi: { methode: "DELETE", ressource: `rules/${regle.id}` }, niveau: null }
  const corps = setNodeRuleSchema.safeParse({ path: chemin, subject: { kind: regle.subject.kind, id: regle.subject.id }, level: valeur })
  return corps.success ? { envoi: { methode: "POST", ressource: "rules", corps: corps.data }, niveau: corps.data.level } : null
}

/** Une ligne : l'équipe ou la personne, puis son niveau, dans un menu pour qui gère, en texte sinon. */
function LigneDAcces({ chemin, regle, gere, niveaux, moi, envoyer, enCours }: LigneProps) {
  const { geste, apresUnSucces } = useRepliApresSucces<HTMLDivElement>()
  // Le choix se montre tout de suite ; la relecture ou un refus le ramènent au niveau servi.
  const [choisi, setChoisi] = useState<string>(regle.level)
  const [servi, setServi] = useState(regle.level)
  if (servi !== regle.level) {
    setServi(regle.level)
    setChoisi(regle.level)
  }
  const equipe = regle.subject.kind === "team"
  const nom = equipe ? PARTAGE.equipe(regle.subject.name) : regle.subject.name

  async function changer(valeur: string) {
    const choix = envoiDuChoix(chemin, regle, valeur)
    if (!choix) return
    setChoisi(valeur)
    apresUnSucces.current = false
    const annonce = choix.niveau === null ? PARTAGE.retire(nom) : PARTAGE.change(nom, NIVEAUX_D_ACCES[choix.niveau])
    if (await envoyer(choix.envoi, annonce)) {
      apresUnSucces.current = true
      return
    }
    setChoisi(regle.level)
  }

  return (
    <li className="oto-pop-row">
      {equipe ? (
        <span className="oto-avatar" data-size="sm" aria-hidden="true">
          <AnimatedIcon as={UsersThree} size="xs" />
        </span>
      ) : (
        <Avatar name={regle.subject.name} size="sm" aria-hidden="true" />
      )}
      <span className="oto-share-name">
        {nom}
        {regle.subject.kind === "user" && regle.subject.id === moi && <EtiquetteDeLigne accent>{PARTAGE.vous}</EtiquetteDeLigne>}
      </span>
      {gere ? (
        <ChoixDuNiveau ref={geste} valeur={choisi} servi={regle.level} aria-label={PARTAGE.accesDe(nom)} options={optionsDeNiveau(niveaux, regle.level)} onChange={(evenement) => void changer(evenement.target.value)} disabled={enCours} />
      ) : (
        <NiveauLu niveau={regle.level} />
      )}
    </li>
  )
}

type ListeProps = Omit<LigneProps, "regle"> & { regles: readonly Regle[] }

function ListeDesAcces({ regles, ...ligne }: ListeProps) {
  if (regles.length === 0) return <p className="oto-caption">{PARTAGE.personneAjoutee}</p>
  return (
    <ul aria-label={PARTAGE.ajoutes} className="flex flex-col">
      {regles.map((regle) => (
        <LigneDAcces key={regle.id} regle={regle} {...ligne} />
      ))}
    </ul>
  )
}

/** Les équipes puis les personnes qui n'ont pas encore d'accès propre. */
function candidatsDe(sujets: SujetsDeRegle, regles: readonly Regle[]): Candidat[] {
  const deja = new Set(regles.map((regle) => `${regle.subject.kind}:${regle.subject.id}`))
  const tous: Candidat[] = [...sujets.equipes.map((equipe) => ({ kind: "team" as const, ...equipe })), ...sujets.personnes.map((personne) => ({ kind: "user" as const, ...personne }))]
  return tous.filter((candidat) => !deja.has(`${candidat.kind}:${candidat.id}`))
}

export type PartageDuNoeudProps = {
  noeud: NodeRulesView
  sujets: SujetsDeRegle
  /** L'accès complet ne s'accorde que par un administrateur (N6) : sans lui, il n'est pas proposé. */
  gestionAccordable: boolean
  /** L'identifiant de qui regarde : sa ligne dit « (vous) ». */
  moi: string | null
  nomOrganisation: string
}

export function PartageDuNoeud({ noeud, sujets, gestionAccordable, moi, nomOrganisation }: PartageDuNoeudProps) {
  const rafraichir = useRafraichir()
  const [annonce, setAnnonce] = useState("")
  const [erreur, setErreur] = useState("")
  const [enCours, setEnCours] = useState(false)
  const gere = noeud.viewerLevel === 3
  // Les membres et le niveau de l'équipe, lus à l'ouverture du panneau et relus quand les règles servies, accès de
  // l'organisation compris, changent (1.4.12, 1.4.13) ; pour qui lit aussi : la ligne de l'équipe montre son niveau.
  const cle = [...noeud.rules.map((regle) => `${regle.id}:${regle.level}`), `org:${noeud.general?.level ?? ""}`].join(",")
  const lusDesMembres = useNiveauxDesMembres(noeud.path, cle)
  const vue = lusDesMembres.lecture.etat === "pret" ? lusDesMembres.lecture.vue : null
  const membres = (vue?.people ?? []).filter((membre) => membre.ruleId === null)
  // La règle de l'équipe propriétaire se règle sur sa ligne de l'accès par défaut, pas parmi les ajoutés.
  const ajoutes = noeud.rules.filter((regle) => !(regle.subject.kind === "team" && regle.subject.id === noeud.owner.teamId))
  // « Aucun accès » (1.4.12) : la personne ou l'équipe ne voit plus ce contenu ni ce qu'il range, à l'écran comme par le MCP ;
  // l'accès complet reste réservé à l'administrateur (N6).
  const niveaux = gestionAccordable ? ACCESS_LEVEL_NAMES : ACCESS_LEVEL_NAMES.filter((niveau) => niveau !== "manage")

  const envoyer: Envoyer = async ({ methode, ressource, corps }, succes, refus) => {
    setErreur("")
    setAnnonce("")
    setEnCours(true)
    const reponse = await appelerPlateforme({ methode, ressource, corps })
    setEnCours(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, refus))
      return false
    }
    setAnnonce(succes)
    rafraichir()
    return true
  }

  return (
    <div className="oto-share-panel">
      {gere && <AjoutDAcces chemin={noeud.path} candidats={candidatsDe(sujets, noeud.rules)} envoyer={envoyer} enCours={enCours} />}
      <SectionDuPartage id={`${ANCRE}-defaut`} icone={<ShieldCheck />} titre={PARTAGE.parDefaut}>
        <AccesParDefaut
          noeud={noeud}
          equipe={vue ? (vue.team ?? null) : lusDesMembres.lecture.etat === "erreur" ? null : undefined}
          organisation={vue?.organisation ?? undefined}
          nomOrganisation={nomOrganisation}
          gere={gere}
          gestionAccordable={gestionAccordable}
          envoyer={envoyer}
          enCours={enCours}
        />
      </SectionDuPartage>
      <SectionDuPartage id={ANCRE} icone={<UserPlus />} titre={PARTAGE.ajoutes} compte={ajoutes.length}>
        <ListeDesAcces regles={ajoutes} chemin={noeud.path} gere={gere} niveaux={niveaux} moi={moi} envoyer={envoyer} enCours={enCours} />
      </SectionDuPartage>
      {membres.length > 0 && (
        <SectionDuPartage id={`${ANCRE}-membres`} icone={<UsersThree />} titre={PARTAGE.membresDe(noeud.owner.teamName ?? "")} compte={membres.length}>
          <MembresDeLEquipe
            membres={membres}
            equipe={noeud.owner.teamName ?? ""}
            chemin={noeud.path}
            gere={gere}
            moi={moi}
            niveauDeLEquipe={vue?.team?.level}
            gestionAccordable={gestionAccordable}
            envoyer={envoyer}
            enCours={enCours}
          />
        </SectionDuPartage>
      )}
      {lusDesMembres.lecture.etat === "erreur" && <EtatDesNiveaux niveaux={lusDesMembres} />}
      {/* Partie d (ADR-013) : réservé à l'accès complet, comme le service le décide (AC-d1). */}
      {gere && (
        <SectionDuPartage id={`${ANCRE}-web`} icone={<Globe />} titre={PARTAGE.surLeWeb}>
          <PartageSurLeWeb chemin={noeud.path} annoncer={setAnnonce} signaler={setErreur} />
        </SectionDuPartage>
      )}
      <p className="oto-share-foot">
        {PARTAGE.votreAccesLibelle}
        <NiveauLu niveau={ACCESS_LEVEL_NAMES[noeud.viewerLevel]} />
      </p>
      {!gere && <p className="oto-caption">{PARTAGE.reserve}</p>}
      <div role="status" className="oto-caption">
        {annonce}
      </div>
      {erreur && (
        <p role="alert" className="oto-caption">
          {erreur}
        </p>
      )}
    </div>
  )
}
