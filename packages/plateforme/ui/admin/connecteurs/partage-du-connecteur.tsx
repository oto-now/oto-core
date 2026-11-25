"use client"

// « Partager » un connecteur (écran Connecteurs) : le panneau du partage d'une page, sur les règles d'un compte. Un champ
// pour ajouter une personne ou une équipe, l'accès par défaut de toute l'organisation, puis les sujets ajoutés, chacun
// avec son niveau en pastille, dans la langue des connecteurs (« Lire », « Lire et modifier », « Tout, avec accord »,
// et « Gestion » pour un administrateur, qui seul l'accorde), et « Retirer l'accès ». Le premier partage d'un connecteur
// personnel connecté chez le tiers (par autorisation) passe par une confirmation : l'autre agira par ce compte, au nom
// de son propriétaire. Ajouter ou changer part à `POST /api/platform/admin/account-rules` (`setAccountRuleSchema`), retirer à
// `DELETE admin/account-rules/<id>` ; `setAccountRule` décide le droit, la gestion du compte. Le panneau s'ouvre dans un
// dialogue, depuis « Partager » ou « Gérer les accès » du détail : les deux boutons et le dialogue partagent leur
// ouverture par `PorteeDuPartage`, posée autour du détail.
//
// Repris de `noeud/partage-du-noeud.tsx` : les sections en étiquettes (`SectionDuPartage`), les lignes, la pastille du
// niveau et son glyphe, les annonces dans une région montée vide, les mots (`PARTAGE`). Changé : l'échelle est celle des
// comptes, la gestion offerte au seul administrateur ; un compte n'hérite de rien, donc ni équipe propriétaire réglée à part
// ni niveau « hérité » ; pas de partage sur le web.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { ShareNetwork } from "@phosphor-icons/react/dist/csr/ShareNetwork"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { setAccountRuleSchema, type AccountLevelName, type AccountView } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"
import { replierLeFocusSur } from "../../components/focus"
import { Dialog } from "../../ds/react/dialog"
import { AnimatedIcon, Icon } from "../../ds/react/icon"
import { Avatar, Button } from "../../ds/react/primitives"
import type { SujetsDeRegle } from "../../equipes/types"
import { useRafraichir } from "../../hote/rafraichir"
import { ChampDAjoutDAcces, nomDuCandidat, type Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { PARTAGE } from "../../noeud/libelles"
import { EtiquetteDeLigne, SectionDuPartage } from "../../noeud/partage-visuel"
import { ANCRE_DE_L_ETAT } from "./etat-du-compte"
import { NIVEAUX_DU_COMPTE, type ActionsParClasse } from "./libelles-des-partages"
import type { PartagesDuCompte } from "./lignes-des-connecteurs"
import { candidatsDe, GLYPHES_DES_NIVEAUX as GLYPHES, LigneDeToutLOrganisation, LigneDuProprietaire, niveauLu, optionsDeNiveau, PastilleDeNiveau } from "./niveaux-du-partage"
import { PremierPartage, type Accord } from "./premier-partage"

/** L'intitulé de la liste des ajoutés : il reçoit le focus quand un accès retiré emporte sa ligne. */
const ANCRE = "partage-du-connecteur"

/** La valeur de « Retirer l'accès » dans le menu d'une ligne : aucun niveau ne s'écrit ainsi. */
const RETIRER = "retirer"

const REFUS: MessagesDuGeste = {
  forbidden: "Seule une personne qui gère ce connecteur peut le partager.",
  not_found: "Ce connecteur n'existe plus ou ne vous est plus visible. Rechargez la page.",
  invalid_arguments: "Ce partage n'a pas pu être enregistré. Rechargez la page, puis recommencez.",
}

const ContexteDuPartage = createContext<{ ouvert: boolean; poser: (ouvert: boolean) => void } | null>(null)

/** L'ouverture du panneau, partagée par les boutons qui l'ouvrent et le dialogue : posée autour du détail d'un compte. */
export function PorteeDuPartage({ ouvert: ouvertDAbord = false, children }: { ouvert?: boolean; children: ReactNode }) {
  const [ouvert, poser] = useState(ouvertDAbord)
  return <ContexteDuPartage.Provider value={{ ouvert, poser }}>{children}</ContexteDuPartage.Provider>
}

/** « Partager », « Gérer les accès » : un bouton qui ouvre le panneau de sa portée. */
export function OuvrirLePartage({ libelle, nomAccessible, variante = "secondary" }: { libelle: string; nomAccessible: string; variante?: "primary" | "secondary" }) {
  const partage = useContext(ContexteDuPartage)
  return (
    <Button type="button" variant={variante} size="sm" iconStart={<Icon as={ShareNetwork} size="xs" />} aria-label={nomAccessible} onClick={() => partage?.poser(true)}>
      {libelle}
    </Button>
  )
}

type Envoi = { methode: "POST" | "DELETE"; ressource: string; corps?: unknown }

/** L'envoi d'un geste : la réponse lue, l'annonce ou le refus posé, la page relue ; `true` s'il a abouti. */
type Envoyer = (envoi: Envoi, annonce: string) => Promise<boolean>

type Regle = PartagesDuCompte["rules"][number]

/** Le corps de `POST admin/account-rules`, validé par le schéma de l'API ; `null` : une valeur que le schéma refuse. */
function regleAPoser(compte: string, sujet: { kind: "team" | "user"; id: string } | { kind: "org" }, niveau: string): Envoi | null {
  const corps = setAccountRuleSchema.safeParse({ accountId: compte, subject: sujet, level: niveau })
  return corps.success ? { methode: "POST", ressource: "admin/account-rules", corps: corps.data } : null
}

const regleARetirer = (id: string): Envoi => ({ methode: "DELETE", ressource: `admin/account-rules/${encodeURIComponent(id)}` })

/** L'annonce d'un niveau posé : « Équipe Ventes : lire. » */
const annonceDuNiveau = (nom: string, niveau: AccountLevelName) => `${nom} : ${NIVEAUX_DU_COMPTE[niveau].toLowerCase()}.`

/** Le choix montré tout de suite ; la relecture ou un refus le ramènent au niveau servi. */
function useChoixServi(servi: AccountLevelName) {
  const [choisi, setChoisi] = useState<string>(servi)
  const [vu, setVu] = useState(servi)
  if (vu !== servi) {
    setVu(servi)
    setChoisi(servi)
  }
  return [choisi, setChoisi] as const
}

type LigneProps = { compte: string; regle: Regle; actions: ActionsParClasse | null; administre: boolean; moi: string; envoyer: Envoyer; enCours: boolean }

function LigneDAcces({ compte, regle, actions, administre, moi, envoyer, enCours }: LigneProps) {
  const [choisi, setChoisi] = useChoixServi(regle.level)
  const ligne = useRef<HTMLLIElement>(null)
  const nom = nomDuCandidat({ kind: regle.subject.kind, nom: regle.subject.name })

  async function changer(valeur: string) {
    const envoi = valeur === RETIRER ? regleARetirer(regle.id) : regleAPoser(compte, { kind: regle.subject.kind, id: regle.subject.id }, valeur)
    if (!envoi || enCours) return
    setChoisi(valeur)
    const niveau = niveauLu(valeur)
    const abouti = await envoyer(envoi, niveau ? annonceDuNiveau(nom, niveau) : `${nom} n'a plus accès à ce connecteur.`)
    if (!abouti) setChoisi(regle.level)
    // La ligne retirée part avec la relecture : le focus l'attend à l'intitulé de la liste.
    else if (valeur === RETIRER) replierLeFocusSur(ANCRE, ligne.current)
  }

  return (
    <li ref={ligne} className="oto-pop-row">
      {regle.subject.kind === "team" ? (
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
      <PastilleDeNiveau
        valeur={choisi}
        servi={regle.level}
        nom={PARTAGE.accesDe(nom)}
        options={[...optionsDeNiveau(regle.level, actions, administre), { value: RETIRER, label: "Retirer l'accès", icon: GLYPHES.none }]}
        disabled={enCours}
        onChange={(valeur) => void changer(valeur)}
      />
    </li>
  )
}

function ListeDesAcces({ regles, ...ligne }: Omit<LigneProps, "regle"> & { regles: readonly Regle[] }) {
  if (regles.length === 0) return <p className="oto-caption">Personne n&apos;a été ajouté à ce connecteur.</p>
  return (
    <ul aria-label={PARTAGE.ajoutes} className="flex flex-col">
      {regles.map((regle) => (
        <LigneDAcces key={regle.id} regle={regle} {...ligne} />
      ))}
    </ul>
  )
}

type OrganisationProps = {
  compte: string
  general: PartagesDuCompte["general"]
  actions: ActionsParClasse | null
  administre: boolean
  envoyer: Envoyer
  enCours: boolean
  /** Le premier partage d'un connecteur par autorisation : l'accord de son propriétaire d'abord. */
  accord: (nom: string, niveau: AccountLevelName) => Promise<boolean>
}

/** « Toute l'organisation » : son niveau sur ce compte ; « Aucun accès » retire sa règle. */
function LigneDeLOrganisation({ compte, general, actions, administre, envoyer, enCours, accord }: OrganisationProps) {
  const servi = general?.level ?? "none"
  const [choisi, setChoisi] = useChoixServi(servi)

  async function changer(valeur: string) {
    const niveau = niveauLu(valeur)
    if (!niveau || niveau === servi || enCours) return
    const envoi = niveau === "none" ? (general ? regleARetirer(general.id) : null) : regleAPoser(compte, { kind: "org" }, niveau)
    if (!envoi) return
    setChoisi(valeur)
    if (niveau !== "none" && !(await accord("toute l'organisation", niveau))) return setChoisi(servi)
    const annonce = niveau === "none" ? "Toute l'organisation n'a plus accès à ce connecteur." : annonceDuNiveau("Toute l'organisation", niveau)
    if (!(await envoyer(envoi, annonce))) setChoisi(servi)
  }

  return <LigneDeToutLOrganisation valeur={choisi} servi={servi} actions={actions} administre={administre} disabled={enCours} onChange={(valeur) => void changer(valeur)} />
}

/** Le nom du propriétaire d'un compte, en tête du panneau. */
function proprietaireDe(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return PARTAGE.equipe(owner.teamName ?? "inconnue")
  if (owner.kind === "org") return "Toute l'organisation"
  return owner.userName ?? "Une personne qui n'est plus membre"
}

/**
 * Ce que le moteur fait d'un partage : un compte personnel sert à l'autre quand il le nomme, un compte d'équipe ou
 * d'organisation sans le nommer ; un compte connecté par autorisation agit au nom de son propriétaire.
 */
function Pied({ personnel, parAutorisation, proprietaire }: { personnel: boolean; parAutorisation: boolean; proprietaire: string | null }) {
  // Le connecteur d'un autre, connecté par son autorisation : son assistant y agit au nom de ce propriétaire.
  if (parAutorisation && proprietaire) {
    return <p className="oto-caption">{`Chacun s'en sert en le nommant ; son assistant y agit par le compte de ${proprietaire}, en son nom. Son autorisation reste cachée.`}</p>
  }
  if (parAutorisation) {
    return <p className="oto-caption">Chacun s&apos;en sert en le nommant ; son assistant y agit par votre compte, en votre nom. Votre autorisation reste cachée.</p>
  }
  return (
    <p className="oto-caption">
      {personnel ? "L'assistant de la personne s'en servira quand elle le lui demandera en le nommant." : "L'assistant des membres s'en sert sans avoir à le nommer."} La clé reste cachée : personne ne peut la lire ni la copier.
    </p>
  )
}

type PartageDuConnecteurProps = {
  compte: Pick<AccountView, "id" | "label" | "owner">
  partages: PartagesDuCompte
  sujets: SujetsDeRegle
  /** Les actions du connecteur par classe, dites sous chaque niveau ; `null` : le catalogue ne le décrit plus. */
  actions: ActionsParClasse | null
  /** L'identifiant de qui regarde : sa ligne dit « vous ». */
  moi: string
  /** Qui regarde administre l'organisation : la gestion se propose. */
  administre: boolean
  /** Un connecteur personnel connecté chez le tiers : son premier partage demande l'accord de son propriétaire. */
  parAutorisation: boolean
}

/** Le dialogue et son panneau, montés à l'ouverture : fermé, rien n'en reste dans le document. */
function Panneau({ compte, partages, sujets, actions, moi, administre, parAutorisation, fermer }: PartageDuConnecteurProps & { fermer: () => void }) {
  const rafraichir = useRafraichir()
  const [annonce, setAnnonce] = useState("")
  const [erreur, setErreur] = useState("")
  const [enCours, setEnCours] = useState(false)
  const [question, setQuestion] = useState<Accord | null>(null)
  // La confirmation du premier partage engage l'autorisation de qui regarde : seulement sur son propre connecteur.
  const aMoi = compte.owner.kind === "user" && compte.owner.userId === moi
  const premier = parAutorisation && aMoi && partages.general === null && partages.rules.length === 0

  /** L'accord du propriétaire avant le premier partage d'un connecteur par autorisation ; ensuite, sans question. */
  const accord = (nom: string, niveau: AccountLevelName) =>
    premier
      ? new Promise<boolean>((resoudre) =>
          setQuestion({
            nom,
            niveau,
            repondre: (oui) => {
              setQuestion(null)
              resoudre(oui)
            },
          }),
        )
      : Promise.resolve(true)

  // Qui baisse ou retire sa propre règle de gestion perd le panneau et ses boutons à la relecture : le focus, s'il est
  // perdu une fois le panneau parti, va au titre de l'état du détail, qui reste.
  useEffect(() => () => queueMicrotask(() => replierLeFocusSur(ANCRE_DE_L_ETAT, null)), [])

  const envoyer: Envoyer = async (envoi, succes) => {
    setErreur("")
    setAnnonce("")
    setEnCours(true)
    const reponse = await appelerPlateforme(envoi)
    setEnCours(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, REFUS))
      return false
    }
    setAnnonce(succes)
    rafraichir()
    return true
  }

  /** Un sujet ajouté l'est en « Lire » : le niveau se monte ensuite sur sa ligne. */
  const ajouter = async (candidat: Candidat) => {
    const envoi = regleAPoser(compte.id, { kind: candidat.kind, id: candidat.id }, "read")
    if (envoi === null || !(await accord(nomDuCandidat(candidat), "read"))) return false
    return envoyer(envoi, annonceDuNiveau(nomDuCandidat(candidat), "read"))
  }

  return (
    <Dialog open onClose={fermer} title={`Partager « ${compte.label} »`} size="md">
      <div className="oto-share-panel">
        <ChampDAjoutDAcces candidats={candidatsDe(
            sujets,
            partages.rules.map(({ subject }) => subject),
            compte.owner.userId ? [`user:${compte.owner.userId}`] : [],
          )} ajouter={ajouter} enCours={enCours} />
        <SectionDuPartage id={`${ANCRE}-defaut`} icone={<ShieldCheck />} titre={PARTAGE.parDefaut}>
          <LigneDuProprietaire nom={proprietaireDe(compte.owner)} vous={compte.owner.kind === "user" && compte.owner.userId === moi} />
          <LigneDeLOrganisation compte={compte.id} general={partages.general} actions={actions} administre={administre} envoyer={envoyer} enCours={enCours} accord={accord} />
        </SectionDuPartage>
        <SectionDuPartage id={ANCRE} icone={<UserPlus />} titre={PARTAGE.ajoutes} compte={partages.rules.length}>
          <ListeDesAcces regles={partages.rules} compte={compte.id} actions={actions} administre={administre} moi={moi} envoyer={envoyer} enCours={enCours} />
        </SectionDuPartage>
        <div role="status" className="oto-caption">
          {annonce}
        </div>
        {erreur && (
          <p role="alert" className="oto-caption">
            {erreur}
          </p>
        )}
        <Pied personnel={compte.owner.kind === "user"} parAutorisation={parAutorisation} proprietaire={aMoi ? null : (compte.owner.userName ?? "son propriétaire")} />
      </div>
      {question && <PremierPartage libelle={compte.label} accord={question} />}
    </Dialog>
  )
}

/** Le dialogue du partage, ouvert par un `OuvrirLePartage` de la même `PorteeDuPartage`. */
export function PartageDuConnecteur(props: PartageDuConnecteurProps) {
  const partage = useContext(ContexteDuPartage)
  if (!partage?.ouvert) return null
  return <Panneau {...props} fermer={() => partage.poser(false)} />
}
