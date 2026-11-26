"use client"

// « Qui peut s'en servir » d'un connecteur, dans son détail, pour qui le gère (écran Connecteurs) : le champ « Ajouter une
// personne ou une équipe » et la liste, comme à l'ajout (`partage-a-l-ajout.tsx`, mêmes pièces : `ChampDAjoutDAcces`,
// `niveaux-du-partage.tsx`). Le propriétaire en tête, toute l'organisation une fois ouverte (« Ouvrir à toute
// l'organisation »), puis les sujets ajoutés, chacun avec son niveau en pastille, dans la langue des connecteurs (« Lire »,
// « Lire et modifier », « Tout, avec accord », et « Gestion » pour un administrateur, qui seul l'accorde), et « Retirer
// l'accès ». Le premier partage d'un connecteur personnel connecté chez le tiers (par autorisation) passe par une
// confirmation : l'autre agira par ce compte, au nom de son propriétaire. Ajouter ou changer part à
// `POST /api/platform/admin/account-rules` (`setAccountRuleSchema`), retirer à `DELETE admin/account-rules/<id>` ;
// `setAccountRule` décide le droit, la gestion du compte.
//
// Repris de `noeud/partage-du-noeud.tsx` : les lignes, la pastille du niveau et son glyphe, les annonces dans une région
// montée vide, les mots (`PARTAGE`). Changé : l'échelle est celle des comptes, la gestion offerte au seul administrateur ;
// un compte n'hérite de rien, donc ni équipe propriétaire réglée à part ni niveau « hérité » ; pas de partage sur le web.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree"
import { setAccountRuleSchema, type AccountLevelName, type AccountView } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"
import { replierLeFocusSur } from "../../components/focus"
import { AnimatedIcon } from "../../ds/react/icon"
import { Avatar } from "../../ds/react/primitives"
import type { SujetsDeRegle } from "../../equipes/types"
import { useRafraichir } from "../../hote/rafraichir"
import { ChampDAjoutDAcces, nomDuCandidat, type Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { PARTAGE } from "../../noeud/libelles"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { ANCRE_DE_L_ETAT, ANCRE_DU_PARTAGE } from "./etat-du-compte"
import { NIVEAUX_DU_COMPTE, type ActionsParClasse } from "./libelles-des-partages"
import type { PartagesDuCompte } from "./lignes-des-connecteurs"
import { candidatsDe, LigneDeToutLOrganisation, LigneDuProprietaire, niveauLu, optionsDeNiveau, OuvrirAToutLOrganisation, PastilleDeNiveau, RETIRER_L_ACCES } from "./niveaux-du-partage"
import { PremierPartage, type Accord } from "./premier-partage"

const REFUS: MessagesDuGeste = {
  forbidden: "Seule une personne qui gère ce connecteur peut le partager.",
  not_found: "Ce connecteur n'existe plus ou ne vous est plus visible. Rechargez la page.",
  invalid_arguments: "Ce partage n'a pas pu être enregistré. Rechargez la page, puis recommencez.",
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
    const retirer = niveauLu(valeur) === "none"
    const envoi = retirer ? regleARetirer(regle.id) : regleAPoser(compte, { kind: regle.subject.kind, id: regle.subject.id }, valeur)
    if (!envoi || enCours) return
    setChoisi(valeur)
    const niveau = niveauLu(valeur)
    const abouti = await envoyer(envoi, niveau && !retirer ? annonceDuNiveau(nom, niveau) : `${nom} n'a plus accès à ce connecteur.`)
    if (!abouti) setChoisi(regle.level)
    // La ligne retirée part avec la relecture : le focus l'attend au titre de la section.
    else if (retirer) replierLeFocusSur(ANCRE_DU_PARTAGE, ligne.current)
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
        options={[...optionsDeNiveau(regle.level, actions, administre), RETIRER_L_ACCES]}
        disabled={enCours}
        onChange={(valeur) => void changer(valeur)}
      />
    </li>
  )
}

function ListeDesAcces({ regles, ...ligne }: Omit<LigneProps, "regle"> & { regles: readonly Regle[] }) {
  if (regles.length === 0) return null
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
  general: NonNullable<PartagesDuCompte["general"]>
  actions: ActionsParClasse | null
  administre: boolean
  envoyer: Envoyer
  enCours: boolean
}

/** « Toute l'organisation », ouverte : son niveau sur ce compte ; « Retirer l'accès » retire sa règle. */
function LigneDeLOrganisation({ compte, general, actions, administre, envoyer, enCours }: OrganisationProps) {
  const servi = general.level
  const [choisi, setChoisi] = useChoixServi(servi)
  const ligne = useRef<HTMLDivElement>(null)

  async function changer(valeur: string) {
    const niveau = niveauLu(valeur)
    if (!niveau || niveau === servi || enCours) return
    const envoi = niveau === "none" ? regleARetirer(general.id) : regleAPoser(compte, { kind: "org" }, niveau)
    if (!envoi) return
    setChoisi(valeur)
    const annonce = niveau === "none" ? "Toute l'organisation n'a plus accès à ce connecteur." : annonceDuNiveau("Toute l'organisation", niveau)
    if (!(await envoyer(envoi, annonce))) setChoisi(servi)
    else if (niveau === "none") replierLeFocusSur(ANCRE_DU_PARTAGE, ligne.current)
  }

  return (
    <div ref={ligne} className="contents">
      <LigneDeToutLOrganisation valeur={choisi} servi={servi} actions={actions} administre={administre} disabled={enCours} onChange={(valeur) => void changer(valeur)} />
    </div>
  )
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
function Pied({ owner, parAutorisation, proprietaire }: { owner: AccountView["owner"]; parAutorisation: boolean; proprietaire: string | null }) {
  // Le connecteur d'un autre, connecté par son autorisation : son assistant y agit au nom de ce propriétaire.
  if (parAutorisation && proprietaire) {
    return <p className="oto-caption">{`Chacun s'en sert en le nommant ; son assistant y agit par le compte de ${proprietaire}, en son nom. Son autorisation reste cachée.`}</p>
  }
  if (parAutorisation) {
    return <p className="oto-caption">Chacun s&apos;en sert en le nommant ; son assistant y agit par votre compte, en votre nom. Votre autorisation reste cachée.</p>
  }
  if (owner.kind === "user") return <p className="oto-caption">Les personnes ajoutées s&apos;en serviront en le nommant ; la clé reste cachée.</p>
  const membres = owner.kind === "team" ? `Les membres de ${owner.teamName ?? "l'équipe"}` : "Les membres de l'organisation"
  return <p className="oto-caption">{`${membres} s'en servent sans le nommer ; la clé reste cachée.`}</p>
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
  /** Un partage choisi avant la connexion n'a pas pu se poser : le champ attend la personne à l'ouverture du détail. */
  partagerDAbord?: boolean
}

/**
 * Qui le champ propose : ni un sujet déjà ajouté, ni la personne d'un compte personnel sur son propre compte, ni qui
 * regarde (il gère déjà le connecteur qu'il partage).
 */
const candidatsDuCompte = (sujets: SujetsDeRegle, partages: PartagesDuCompte, owner: AccountView["owner"], moi: string) =>
  candidatsDe(
    sujets,
    partages.rules.map(({ subject }) => subject),
    [`user:${moi}`, ...(owner.userId ? [`user:${owner.userId}`] : [])],
  )

/** L'accord du propriétaire avant le premier partage d'un connecteur par autorisation ; ensuite, sans question. */
function useAccord(premier: boolean) {
  const [question, setQuestion] = useState<Accord | null>(null)
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
  return { question, accord }
}

export function PartageDuConnecteur({ compte, partages, sujets, actions, moi, administre, parAutorisation, partagerDAbord = false }: PartageDuConnecteurProps) {
  const rafraichir = useRafraichir()
  const [annonce, setAnnonce] = useState("")
  const [erreur, setErreur] = useState("")
  const [enCours, setEnCours] = useState(false)
  const champ = useRef<HTMLInputElement>(null)
  const lien = useRef<HTMLDivElement>(null)
  // La confirmation du premier partage engage l'autorisation de qui regarde : seulement sur son propre connecteur.
  const aMoi = compte.owner.kind === "user" && compte.owner.userId === moi
  const { question, accord } = useAccord(parAutorisation && aMoi && partages.general === null && partages.rules.length === 0)

  // Le tiroir, un `<dialog>` modal, pose le focus à son ouverture, après ce rendu : il va au champ marqué `autofocus`.
  useLayoutEffect(() => {
    if (partagerDAbord) champ.current?.setAttribute("autofocus", "")
  }, [partagerDAbord])

  // Qui baisse ou retire sa propre règle de gestion perd le panneau à la relecture : le focus, s'il est perdu une fois le
  // panneau parti, va au titre de l'état du détail, qui reste.
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

  /** « Ouvrir à toute l'organisation » : sa règle en « Lire » ; le lien part avec la relecture, le focus va au titre. */
  const ouvrirLOrganisation = async () => {
    const envoi = regleAPoser(compte.id, { kind: "org" }, "read")
    if (envoi === null || enCours || !(await accord("toute l'organisation", "read"))) return
    if (await envoyer(envoi, annonceDuNiveau("Toute l'organisation", "read"))) replierLeFocusSur(ANCRE_DU_PARTAGE, lien.current)
  }

  return (
    <div className="oto-share-panel">
      <ChampDAjoutDAcces ref={champ} candidats={candidatsDuCompte(sujets, partages, compte.owner, moi)} ajouter={ajouter} enCours={enCours} />
      <LigneDuProprietaire nom={proprietaireDe(compte.owner)} vous={aMoi} groupe={compte.owner.kind !== "user"} />
      {partages.general && <LigneDeLOrganisation compte={compte.id} general={partages.general} actions={actions} administre={administre} envoyer={envoyer} enCours={enCours} />}
      <ListeDesAcces regles={partages.rules} compte={compte.id} actions={actions} administre={administre} moi={moi} envoyer={envoyer} enCours={enCours} />
      {/* Un connecteur de l'organisation est déjà à toute l'organisation : rien à ouvrir. */}
      {!partages.general && compte.owner.kind !== "org" && (
        <div ref={lien} className="contents">
          <OuvrirAToutLOrganisation ouvrir={() => void ouvrirLOrganisation()} disabled={enCours} />
        </div>
      )}
      <div role="status" className="oto-caption">
        {annonce}
      </div>
      {erreur && (
        <p role="alert" className="oto-caption">
          {erreur}
        </p>
      )}
      <Pied owner={compte.owner} parAutorisation={parAutorisation} proprietaire={aMoi ? null : (compte.owner.userName ?? "son propriétaire")} />
      {question && <PremierPartage libelle={compte.label} accord={question} />}
    </div>
  )
}
