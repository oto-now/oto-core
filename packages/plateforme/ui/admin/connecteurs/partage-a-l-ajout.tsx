"use client"

// « Qui pourra s'en servir », dans la fiche d'ajout d'un outil (écran Connecteurs) : le partage d'un connecteur, avant
// qu'il n'existe. Le champ d'ajout d'accès commun aux pages et aux connecteurs (`ChampDAjoutDAcces`), la ligne de la
// personne quand le connecteur reste le sien, celle de toute l'organisation une fois ouverte (« Ouvrir à toute
// l'organisation »), puis les ajoutés avec leur niveau. Le partage décide du propriétaire à la création
// (`proprietaireDuPartage`) : plus de choix du propriétaire à part. Rien ne part d'ici : la fiche crée le connecteur,
// puis pose chaque règle par la route du partage (`POST admin/account-rules`).
import { useEffect, useId, useRef, useState } from "react"
import { setAccountRuleSchema, type AccountLevelName } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Avatar } from "../../ds/react/primitives"
import type { SujetsDeRegle } from "../../equipes/types"
import { ChampDAjoutDAcces, nomDuCandidat, type Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import type { ProprietaireDuConnecteur } from "./catalogue-des-connecteurs"
import { REFUS_DE_L_OUVERTURE, type ActionsParClasse } from "./libelles-des-partages"
import { candidatsDe, LigneDeToutLOrganisation, LigneDuProprietaire, niveauLu, optionsDeNiveau, OuvrirAToutLOrganisation, PastilleDeNiveau, RETIRER_L_ACCES } from "./niveaux-du-partage"

/** Ce que la fiche posera après la création : le niveau de toute l'organisation, et chaque personne ou équipe ajoutée. */
export type PartageDeLAjout = { general: AccountLevelName | null; regles: { sujet: Candidat; niveau: AccountLevelName }[] }

export const SANS_PARTAGE: PartageDeLAjout = { general: null, regles: [] }

type Genre = "user" | "org" | "team"
type Equipe = { id: string; name: string }

/** Un propriétaire que la personne peut choisir : `user`, `org`, ou `team:<id>`. */
export type ChoixDuProprietaire = { valeur: string; libelle: string }

/** Les propriétaires que la personne peut choisir, soi d'abord : l'organisation, puis chacune des équipes qu'elle dote. */
export function proprietairesDe(admis: readonly Genre[], equipes: readonly Equipe[], nomDeMoi: string): ChoixDuProprietaire[] {
  return admis.flatMap((genre) =>
    genre === "user" ? [{ valeur: "user", libelle: nomDeMoi }] : genre === "org" ? [{ valeur: "org", libelle: "Toute l'organisation" }] : equipes.map((equipe) => ({ valeur: `team:${equipe.id}`, libelle: `Équipe ${equipe.name}` })),
  )
}

/** Le propriétaire choisi, tel que la création l'attend (`owner_kind`, `team_id`). */
export function proprietaireCree(valeur: string): { owner_kind: Genre; team_id?: string } {
  if (valeur.startsWith("team:")) return { owner_kind: "team", team_id: valeur.slice("team:".length) }
  return { owner_kind: valeur === "org" ? "org" : "user" }
}

/**
 * Le propriétaire que le partage décide à la création : toute l'organisation ouverte, pour qui peut doter l'organisation
 * (`org` admis, d'après `accountOwnerChoices`), en fait un connecteur d'organisation ; sinon une seule équipe ajoutée,
 * que la personne peut doter, un connecteur de cette équipe ; sinon le connecteur reste le sien, partagé comme choisi
 * (personnes, plusieurs équipes : le moteur n'admet qu'une équipe propriétaire). `null` : l'outil ne se porte pas par une
 * personne et le partage ne nomme ni l'organisation ni une seule équipe dotable.
 */
export function proprietaireDuPartage(partage: PartageDeLAjout, admis: readonly Genre[], equipes: readonly Equipe[]): ProprietaireDuConnecteur | null {
  if (partage.general !== null && admis.includes("org")) return { owner_kind: "org" }
  const partageesA = partage.regles.filter(({ sujet }) => sujet.kind === "team")
  const dotee = partageesA.length === 1 && admis.includes("team") ? equipes.find((equipe) => equipe.id === partageesA[0].sujet.id) : undefined
  if (dotee) return { owner_kind: "team", team_id: dotee.id, nom: dotee.name }
  return admis.includes("user") ? { owner_kind: "user" } : null
}

/**
 * Le partage de départ : aucun pour un outil qu'une personne peut porter ; sinon celui qui en fait un connecteur
 * d'organisation, à défaut de la première équipe que la personne dote (un outil sans formulaire, servi par la clé de l'hôte).
 */
export function partageDeDepart(admis: readonly Genre[], equipes: readonly Equipe[]): PartageDeLAjout {
  if (admis.includes("user")) return SANS_PARTAGE
  if (admis.includes("org")) return { general: "read", regles: [] }
  const [equipe] = admis.includes("team") ? equipes : []
  return equipe ? { general: null, regles: [{ sujet: { kind: "team", id: equipe.id, nom: equipe.name }, niveau: "read" }] } : SANS_PARTAGE
}

/** « Nadia », « les membres de Ventes », « Nadia et les membres de Ventes ». */
function quiDuPartage(partage: PartageDeLAjout): { qui: string; seul: boolean } {
  const noms = [
    ...(partage.general ? ["les membres de l'organisation"] : []),
    ...partage.regles.map(({ sujet }) => (sujet.kind === "team" ? `les membres de ${sujet.nom}` : (sujet.nom.split(" ")[0] ?? sujet.nom))),
  ]
  const qui = noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : (noms[0] ?? "")
  return { qui: qui.charAt(0).toUpperCase() + qui.slice(1), seul: noms.length === 1 && partage.regles[0]?.sujet.kind === "user" }
}

/** Ce que le partage engage, selon le propriétaire qu'il décide : un connecteur d'équipe ou d'organisation sert sans être nommé. */
export function legendeDuPartage(partage: PartageDeLAjout, proprietaire: ProprietaireDuConnecteur | null, parAutorisation = false): string {
  if (proprietaire?.owner_kind === "org") return "Les membres de l'organisation s'en serviront sans le nommer ; il reste si vous partez."
  if (proprietaire?.owner_kind === "team") return `Les membres de ${proprietaire.nom} s'en serviront sans le nommer ; il reste si vous partez.`
  if (partage.general === null && partage.regles.length === 0) return "Vous pourrez le partager plus tard."
  const { qui, seul } = quiDuPartage(partage)
  const nommant = `${qui} ${seul ? "s'en servira" : "s'en serviront"} en le nommant`
  return parAutorisation ? `${nommant} ; ${seul ? "son" : "leur"} assistant y agira en votre nom.` : `${nommant}.`
}

/** Ce qui reste en vigueur quand la règle du propriétaire n'est pas posée : son défaut (`accountOwnerDefault`). */
function defautDuProprietaire(proprietaire: ProprietaireDuConnecteur | null | undefined, subject: { kind: string; id?: string }): string {
  if (proprietaire?.owner_kind === "org" && subject.kind === "org") return " Les membres de l'organisation ont pour l'instant « Lire » ; réessayez dans le détail."
  if (proprietaire?.owner_kind === "team" && subject.kind === "team" && subject.id === proprietaire.team_id) {
    return ` Les membres de ${proprietaire.nom} ont pour l'instant « Tout, avec accord » ; réessayez dans le détail.`
  }
  return ""
}

/**
 * Pose le partage choisi sur le connecteur qui vient d'être créé, règle par règle (`POST admin/account-rules`, la route
 * du partage du détail) ; rend ce qui n'a pas été posé, avec sa raison. La règle de l'équipe ou de l'organisation qui
 * porte le connecteur part aussi : sans elle, leurs membres auraient le défaut du propriétaire, et non le niveau choisi ;
 * non posée, la suite dit ce défaut.
 */
export async function poserLePartage(compte: string, partage: PartageDeLAjout, proprietaire?: ProprietaireDuConnecteur | null): Promise<string[]> {
  const regles = [
    ...(partage.general ? [{ nom: "toute l'organisation", subject: { kind: "org" as const }, level: partage.general }] : []),
    ...partage.regles.map(({ sujet, niveau }) => ({ nom: nomDuCandidat(sujet), subject: { kind: sujet.kind, id: sujet.id }, level: niveau })),
  ]
  const echecs: string[] = []
  for (const { nom, subject, level } of regles) {
    const corps = setAccountRuleSchema.safeParse({ accountId: compte, subject, level })
    const reponse = corps.success ? await appelerPlateforme({ methode: "POST", ressource: "admin/account-rules", corps: corps.data }) : null
    if (!reponse || reponse.erreur) {
      echecs.push(`Le partage avec ${nom} n'est pas posé : ${reponse?.erreur ? messageDErreur(reponse.erreur) : "valeur refusée"}${defautDuProprietaire(proprietaire, subject)}`)
    }
  }
  return echecs
}

type LigneProps = { regle: PartageDeLAjout["regles"][number]; actions: ActionsParClasse | null; administre: boolean; moi: string; changer: (niveau: string) => void }

function Ajoute({ regle, actions, administre, moi, changer }: LigneProps) {
  const nom = nomDuCandidat(regle.sujet)
  return (
    <li className="oto-pop-row">
      <Avatar name={regle.sujet.nom} size="sm" aria-hidden="true" />
      <span className="oto-share-name">
        {nom}
        {regle.sujet.kind === "user" && regle.sujet.id === moi && <EtiquetteDeLigne accent>vous</EtiquetteDeLigne>}
      </span>
      <PastilleDeNiveau valeur={regle.niveau} servi={regle.niveau} nom={`Accès de ${nom}`} options={[...optionsDeNiveau(regle.niveau, actions, administre), RETIRER_L_ACCES]} disabled={false} onChange={changer} />
    </li>
  )
}

function Ajoutes({ partage, changer, retire, ...ligne }: Omit<LigneProps, "regle" | "changer"> & { partage: PartageDeLAjout; changer: (partage: PartageDeLAjout) => void; retire: () => void }) {
  if (partage.regles.length === 0) return null
  const poser = (rang: number, valeur: string) => {
    const niveau = niveauLu(valeur)
    if (niveau === "none") retire()
    const regles = niveau === "none" ? partage.regles.filter((_, autre) => autre !== rang) : partage.regles.map((regle, autre) => (autre === rang && niveau ? { ...regle, niveau } : regle))
    changer({ ...partage, regles })
  }
  return (
    <ul aria-label="Personnes et équipes ajoutées" className="flex flex-col">
      {partage.regles.map((regle, rang) => (
        <Ajoute key={`${regle.sujet.kind}:${regle.sujet.id}`} regle={regle} changer={(valeur) => poser(rang, valeur)} {...ligne} />
      ))}
    </ul>
  )
}

/** Une ligne retirée ou le lien parti emportent leur contrôle : le focus va au titre, au rendu qui suit. */
function useRepliSurLeTitre() {
  const titre = useRef<HTMLHeadingElement>(null)
  const [replis, setReplis] = useState(0)
  useEffect(() => {
    if (replis > 0) titre.current?.focus()
  }, [replis])
  return { titre, replier: () => setReplis((nombre) => nombre + 1) }
}

/**
 * La personne n'est jamais proposée sur le connecteur qu'elle ajoute ; une équipe ou une personne ajoutée non plus. Avec
 * `dotables`, une équipe que la personne ne peut pas doter se propose grisée, avec sa raison.
 */
const candidatsDeLAjout = (sujets: SujetsDeRegle, partage: PartageDeLAjout, moi: string, dotables: readonly { id: string }[] | undefined) =>
  candidatsDe(
    sujets,
    partage.regles.map(({ sujet }) => sujet),
    [`user:${moi}`],
  ).map((candidat) => (dotables && candidat.kind === "team" && !dotables.some((equipe) => equipe.id === candidat.id) ? { ...candidat, refus: REFUS_DE_L_OUVERTURE.equipe } : candidat))

type PartageALAjoutProps = {
  partage: PartageDeLAjout
  changer: (partage: PartageDeLAjout) => void
  /** Ce que le partage décide (`proprietaireDuPartage`) : la ligne de la personne ne se montre que pour le sien. */
  proprietaire: ProprietaireDuConnecteur | null
  nomDeMoi: string
  sujets: SujetsDeRegle
  actions: ActionsParClasse | null
  /** Qui regarde administre : la gestion se propose. */
  administre: boolean
  moi: string
  /** Pourquoi la personne ne peut pas ouvrir le connecteur à toute l'organisation ; absent : elle le peut. */
  refusDeLOrganisation?: string
  /** Les équipes que la personne peut doter : les autres se proposent grisées ; absent, aucune ne l'est (chez le tiers). */
  equipesDotables?: readonly { id: string }[]
  /** Un connecteur connecté chez le tiers : son partage engage l'autorisation de son propriétaire, pas une clé. */
  parAutorisation?: boolean
}

export function PartageALAjout({ partage, changer, proprietaire, nomDeMoi, sujets, actions, administre, moi, refusDeLOrganisation, equipesDotables, parAutorisation = false }: PartageALAjoutProps) {
  const id = useId()
  const { titre, replier } = useRepliSurLeTitre()
  const candidats = candidatsDeLAjout(sujets, partage, moi, equipesDotables)
  // Toute l'organisation se propose aussi dans le champ tant qu'elle n'a pas d'accès.
  const organisation = partage.general === null ? { refus: refusDeLOrganisation, ajouter: () => changer({ ...partage, general: "read" }) } : undefined
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 ref={titre} id={id} tabIndex={-1} className="oto-section-title">
        Qui pourra s&apos;en servir
      </h3>
      <div className="oto-share-panel">
        <ChampDAjoutDAcces
          candidats={candidats}
          organisation={organisation}
          ajouter={async ({ kind, id: sujet, nom }) => (changer({ ...partage, regles: [...partage.regles, { sujet: { kind, id: sujet, nom }, niveau: "read" }] }), true)}
          enCours={false}
        />
        {proprietaire?.owner_kind === "user" && <LigneDuProprietaire nom={nomDeMoi} vous />}
        {partage.general !== null && (
          <LigneDeToutLOrganisation
            valeur={partage.general}
            servi={partage.general}
            actions={actions}
            administre={administre}
            disabled={false}
            onChange={(valeur) => {
              const niveau = niveauLu(valeur)
              if (niveau === "none") replier()
              changer({ ...partage, general: niveau && niveau !== "none" ? niveau : null })
            }}
          />
        )}
        <Ajoutes partage={partage} changer={changer} retire={replier} actions={actions} administre={administre} moi={moi} />
        {partage.general === null && (
          <OuvrirAToutLOrganisation
            refus={refusDeLOrganisation}
            ouvrir={() => {
              replier()
              changer({ ...partage, general: "read" })
            }}
          />
        )}
      </div>
      <p className="oto-caption">{legendeDuPartage(partage, proprietaire, parAutorisation)}</p>
    </section>
  )
}
