"use client"

// « Partager » un connecteur (écran Connecteurs) : le panneau du partage d'une page, sur les règles d'un compte. Un champ
// pour ajouter une personne ou une équipe, l'accès par défaut de toute l'organisation, puis les sujets ajoutés, chacun
// avec son niveau en pastille (« Lecture seule », « Lecture et écriture », « Toutes les actions ») et « Retirer
// l'accès ». Ajouter ou changer part à `POST /api/platform/admin/account-rules` (`setAccountRuleSchema`), retirer à
// `DELETE admin/account-rules/<id>` ; `setAccountRule` décide le droit, la gestion du compte. Le panneau s'ouvre dans un
// dialogue, depuis « Partager » ou « Gérer les accès » du détail : les deux boutons et le dialogue partagent leur
// ouverture par `PorteeDuPartage`, posée autour du détail.
//
// Repris de `noeud/partage-du-noeud.tsx` : les sections en étiquettes (`SectionDuPartage`), les lignes, la pastille du
// niveau, les annonces dans une région montée vide, les mots (`PARTAGE`). Changé : l'échelle est celle des comptes, sans
// la gestion, que seul un administrateur accorde ; un compte n'hérite de rien, donc ni équipe propriétaire réglée à part
// ni niveau « hérité » ; pas de partage sur le web.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck"
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { ACCOUNT_LEVEL_NAMES, setAccountRuleSchema, type AccountLevelName, type AccountView } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"
import { replierLeFocusSur } from "../../components/focus"
import { Dialog } from "../../ds/react/dialog"
import { AnimatedIcon } from "../../ds/react/icon"
import { Avatar, Button } from "../../ds/react/primitives"
import { Select, type SelectOption } from "../../ds/react/select"
import type { SujetsDeRegle } from "../../equipes/types"
import { useRafraichir } from "../../hote/rafraichir"
import { ChampDAjoutDAcces, nomDuCandidat, type Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { PARTAGE } from "../../noeud/libelles"
import { EtiquetteDeLigne, SectionDuPartage } from "../../noeud/partage-visuel"
import { ANCRE_DE_L_ETAT } from "./etat-du-compte"
import { detailDuNiveau, NIVEAUX_DU_COMPTE, NIVEAUX_PARTAGES, TON_DU_NIVEAU, type ActionsParClasse } from "./libelles-des-partages"
import type { PartagesDuCompte } from "./lignes-des-connecteurs"

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
export function PorteeDuPartage({ children }: { children: ReactNode }) {
  const [ouvert, poser] = useState(false)
  return <ContexteDuPartage.Provider value={{ ouvert, poser }}>{children}</ContexteDuPartage.Provider>
}

/** « Partager », « Gérer les accès » : un bouton qui ouvre le panneau de sa portée. */
export function OuvrirLePartage({ libelle, nomAccessible, variante = "secondary" }: { libelle: string; nomAccessible: string; variante?: "primary" | "secondary" }) {
  const partage = useContext(ContexteDuPartage)
  return (
    <Button type="button" variant={variante} size="sm" aria-label={nomAccessible} onClick={() => partage?.poser(true)}>
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

const niveauLu = (valeur: string) => ACCOUNT_LEVEL_NAMES.find((candidat) => candidat === valeur)

/** L'annonce d'un niveau posé : « Équipe Ventes : lecture seule. » */
const annonceDuNiveau = (nom: string, niveau: AccountLevelName) => `${nom} : ${NIVEAUX_DU_COMPTE[niveau].toLowerCase()}.`

/** Les niveaux qu'une ligne propose : ceux qu'on partage, et toujours celui de la ligne (la gestion, posée par un administrateur). */
function optionsDeNiveau(courant: AccountLevelName, actions: ActionsParClasse | null): SelectOption[] {
  const partages: SelectOption[] = NIVEAUX_PARTAGES.map((niveau) => ({ value: niveau, label: NIVEAUX_DU_COMPTE[niveau], description: detailDuNiveau(niveau, actions) }))
  const horsEchelle = partages.some((option) => option.value === courant) || courant === "none" ? [] : [{ value: courant, label: NIVEAUX_DU_COMPTE[courant] }]
  return [...horsEchelle, ...partages]
}

type PastilleProps = { valeur: string; servi: AccountLevelName; options: SelectOption[]; nom: string; disabled: boolean; onChange: (valeur: string) => void }

/** Le niveau d'une ligne, en pastille de sa couleur, qui ouvre la liste des niveaux. */
function PastilleDeNiveau({ valeur, servi, options, nom, disabled, onChange }: PastilleProps) {
  return (
    <span className="oto-share-level" data-niveau={TON_DU_NIVEAU[niveauLu(valeur) ?? servi]}>
      <Select size="sm" value={valeur} options={options} aria-label={nom} disabled={disabled} onChange={(evenement) => onChange(evenement.target.value)} />
    </span>
  )
}

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

type LigneProps = { compte: string; regle: Regle; actions: ActionsParClasse | null; moi: string; envoyer: Envoyer; enCours: boolean }

function LigneDAcces({ compte, regle, actions, moi, envoyer, enCours }: LigneProps) {
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
        options={[...optionsDeNiveau(regle.level, actions), { value: RETIRER, label: "Retirer l'accès" }]}
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

type OrganisationProps = { compte: string; general: PartagesDuCompte["general"]; actions: ActionsParClasse | null; envoyer: Envoyer; enCours: boolean }

/** « Toute l'organisation » : son niveau sur ce compte ; « Aucun accès » retire sa règle. */
function LigneDeLOrganisation({ compte, general, actions, envoyer, enCours }: OrganisationProps) {
  const servi = general?.level ?? "none"
  const [choisi, setChoisi] = useChoixServi(servi)

  async function changer(valeur: string) {
    const niveau = niveauLu(valeur)
    if (!niveau || niveau === servi || enCours) return
    const envoi = niveau === "none" ? (general ? regleARetirer(general.id) : null) : regleAPoser(compte, { kind: "org" }, niveau)
    if (!envoi) return
    setChoisi(valeur)
    const annonce = niveau === "none" ? "Toute l'organisation n'a plus accès à ce connecteur." : annonceDuNiveau("Toute l'organisation", niveau)
    if (!(await envoyer(envoi, annonce))) setChoisi(servi)
  }

  return (
    <div className="oto-pop-row">
      <span className="oto-avatar" data-size="sm" aria-hidden="true">
        <AnimatedIcon as={UsersThree} size="xs" />
      </span>
      <span className="oto-share-name">Toute l&apos;organisation</span>
      <PastilleDeNiveau
        valeur={choisi}
        servi={servi}
        nom="Accès de toute l'organisation"
        options={[...optionsDeNiveau(servi, actions), { value: "none", label: NIVEAUX_DU_COMPTE.none }]}
        disabled={enCours}
        onChange={(valeur) => void changer(valeur)}
      />
    </div>
  )
}

/** Les équipes puis les personnes qui n'ont pas de règle sur le compte ; jamais la personne d'un compte personnel, qui le gère avant toute règle. */
function candidatsDe(sujets: SujetsDeRegle, regles: readonly Regle[], proprietaire: string | undefined): Candidat[] {
  const deja = new Set(regles.map((regle) => `${regle.subject.kind}:${regle.subject.id}`))
  const tous: Candidat[] = [...sujets.equipes.map((equipe) => ({ kind: "team" as const, ...equipe })), ...sujets.personnes.map((personne) => ({ kind: "user" as const, ...personne }))]
  return tous.filter((candidat) => !deja.has(`${candidat.kind}:${candidat.id}`) && !(candidat.kind === "user" && candidat.id === proprietaire))
}

/** Ce que le moteur fait d'un partage : un compte personnel sert à l'autre quand il le nomme, un compte d'équipe ou d'organisation sans le nommer. */
function Pied({ personnel }: { personnel: boolean }) {
  return (
    <p className="oto-caption">
      {personnel ? "L'assistant de la personne s'en servira quand elle le lui demandera en le nommant." : "L'assistant des membres s'en sert sans avoir à le nommer."} La clé reste cachée : personne ne peut la lire ni la copier.
    </p>
  )
}

export type PartageDuConnecteurProps = {
  compte: Pick<AccountView, "id" | "label" | "owner">
  partages: PartagesDuCompte
  sujets: SujetsDeRegle
  /** Les actions du connecteur par classe, dites sous chaque niveau ; `null` : le catalogue ne le décrit plus. */
  actions: ActionsParClasse | null
  /** L'identifiant de qui regarde : sa ligne dit « vous ». */
  moi: string
}

/** Le dialogue et son panneau, montés à l'ouverture : fermé, rien n'en reste dans le document. */
function Panneau({ compte, partages, sujets, actions, moi, fermer }: PartageDuConnecteurProps & { fermer: () => void }) {
  const rafraichir = useRafraichir()
  const [annonce, setAnnonce] = useState("")
  const [erreur, setErreur] = useState("")
  const [enCours, setEnCours] = useState(false)

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

  /** Un sujet ajouté l'est en « Lecture seule » : le niveau se monte ensuite sur sa ligne. */
  const ajouter = async (candidat: Candidat) => {
    const envoi = regleAPoser(compte.id, { kind: candidat.kind, id: candidat.id }, "read")
    return envoi !== null && (await envoyer(envoi, annonceDuNiveau(nomDuCandidat(candidat), "read")))
  }

  return (
    <Dialog open onClose={fermer} title={`Partager « ${compte.label} »`} size="md">
      <div className="oto-share-panel">
        <ChampDAjoutDAcces candidats={candidatsDe(sujets, partages.rules, compte.owner.userId)} ajouter={ajouter} enCours={enCours} />
        <SectionDuPartage id={`${ANCRE}-defaut`} icone={<ShieldCheck />} titre={PARTAGE.parDefaut}>
          <LigneDeLOrganisation compte={compte.id} general={partages.general} actions={actions} envoyer={envoyer} enCours={enCours} />
        </SectionDuPartage>
        <SectionDuPartage id={ANCRE} icone={<UserPlus />} titre={PARTAGE.ajoutes} compte={partages.rules.length}>
          <ListeDesAcces regles={partages.rules} compte={compte.id} actions={actions} moi={moi} envoyer={envoyer} enCours={enCours} />
        </SectionDuPartage>
        <div role="status" className="oto-caption">
          {annonce}
        </div>
        {erreur && (
          <p role="alert" className="oto-caption">
            {erreur}
          </p>
        )}
        <Pied personnel={compte.owner.kind === "user"} />
      </div>
    </Dialog>
  )
}

/** Le dialogue du partage, ouvert par un `OuvrirLePartage` de la même `PorteeDuPartage`. */
export function PartageDuConnecteur(props: PartageDuConnecteurProps) {
  const partage = useContext(ContexteDuPartage)
  if (!partage?.ouvert) return null
  return <Panneau {...props} fermer={() => partage.poser(false)} />
}
