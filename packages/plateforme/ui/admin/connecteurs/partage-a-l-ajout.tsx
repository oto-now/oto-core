"use client"

// « Qui pourra s'en servir », dans la fiche d'ajout d'un outil à clé (écran Connecteurs) : le panneau « Partager » d'un
// connecteur, avant qu'il n'existe. Le propriétaire en tête (vous par défaut ; l'organisation ou une équipe pour qui peut
// les doter, d'après `accountOwnerChoices`), le champ d'ajout d'accès commun aux pages et aux connecteurs
// (`ChampDAjoutDAcces`), l'accès de toute l'organisation, puis les ajoutés avec leur niveau. Rien ne part d'ici : la fiche
// crée le connecteur, puis pose chaque règle par la route du partage (`POST admin/account-rules`). Sans ce panneau, on
// ne partageait qu'après l'ajout, dans le détail.
import { setAccountRuleSchema, type AccountLevelName } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Select } from "../../ds/react/select"
import type { SujetsDeRegle } from "../../equipes/types"
import { ChampDAjoutDAcces, nomDuCandidat, type Candidat } from "../../noeud/champ-d-ajout-d-acces"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { Avatar } from "../../ds/react/primitives"
import type { ActionsParClasse } from "./libelles-des-partages"
import { candidatsDe, GLYPHES_DES_NIVEAUX, LigneDeToutLOrganisation, LigneDuProprietaire, niveauLu, optionsDeNiveau, PastilleDeNiveau } from "./niveaux-du-partage"

/** Ce que la fiche posera après la création : le niveau de toute l'organisation, et chaque personne ou équipe ajoutée. */
export type PartageDeLAjout = { general: AccountLevelName | null; regles: { sujet: Candidat; niveau: AccountLevelName }[] }

export const SANS_PARTAGE: PartageDeLAjout = { general: null, regles: [] }

/** Un propriétaire que la personne peut choisir : `user`, `org`, ou `team:<id>`. */
export type ChoixDuProprietaire = { valeur: string; libelle: string }

const RETIRER = "retirer"


/** Les propriétaires que la personne peut choisir, soi d'abord : l'organisation, puis chacune des équipes qu'elle dote. */
export function proprietairesDe(admis: readonly ("user" | "org" | "team")[], equipes: readonly { id: string; name: string }[], nomDeMoi: string): ChoixDuProprietaire[] {
  return admis.flatMap((genre) =>
    genre === "user" ? [{ valeur: "user", libelle: nomDeMoi }] : genre === "org" ? [{ valeur: "org", libelle: "Toute l'organisation" }] : equipes.map((equipe) => ({ valeur: `team:${equipe.id}`, libelle: `Équipe ${equipe.name}` })),
  )
}

/** Le propriétaire choisi, tel que la création l'attend (`owner_kind`, `team_id`). */
export function proprietaireCree(valeur: string): { owner_kind: "user" | "org" | "team"; team_id?: string } {
  if (valeur.startsWith("team:")) return { owner_kind: "team", team_id: valeur.slice("team:".length) }
  return { owner_kind: valeur === "org" ? "org" : "user" }
}

/**
 * Pose le partage choisi sur le connecteur qui vient d'être créé, règle par règle (`POST admin/account-rules`, la route
 * du partage du détail) ; rend ce qui n'a pas été posé, avec sa raison.
 */
export async function poserLePartage(compte: string, partage: PartageDeLAjout): Promise<string[]> {
  const regles = [
    ...(partage.general ? [{ nom: "toute l'organisation", subject: { kind: "org" as const }, level: partage.general }] : []),
    ...partage.regles.map(({ sujet, niveau }) => ({ nom: nomDuCandidat(sujet), subject: { kind: sujet.kind, id: sujet.id }, level: niveau })),
  ]
  const echecs: string[] = []
  for (const { nom, subject, level } of regles) {
    const corps = setAccountRuleSchema.safeParse({ accountId: compte, subject, level })
    const reponse = corps.success ? await appelerPlateforme({ methode: "POST", ressource: "admin/account-rules", corps: corps.data }) : null
    if (!reponse || reponse.erreur) echecs.push(`Le partage avec ${nom} n'est pas posé : ${reponse?.erreur ? messageDErreur(reponse.erreur) : "valeur refusée"}`)
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
      <PastilleDeNiveau
        valeur={regle.niveau}
        servi={regle.niveau}
        nom={`Accès de ${nom}`}
        options={[...optionsDeNiveau(regle.niveau, actions, administre), { value: RETIRER, label: "Retirer l'accès", icon: GLYPHES_DES_NIVEAUX.none }]}
        disabled={false}
        onChange={changer}
      />
    </li>
  )
}

function Ajoutes({ partage, changer, ...ligne }: Omit<LigneProps, "regle" | "changer"> & { partage: PartageDeLAjout; changer: (partage: PartageDeLAjout) => void }) {
  if (partage.regles.length === 0) return null
  const poser = (rang: number, valeur: string) => {
    const niveau = niveauLu(valeur)
    const regles = valeur === RETIRER ? partage.regles.filter((_, autre) => autre !== rang) : partage.regles.map((regle, autre) => (autre === rang && niveau ? { ...regle, niveau } : regle))
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

type PartageALAjoutProps = {
  partage: PartageDeLAjout
  changer: (partage: PartageDeLAjout) => void
  /** Les propriétaires possibles, et celui choisi ; un seul : il s'écrit, sans choix. */
  proprietaires: ChoixDuProprietaire[]
  proprietaire: string
  choisirProprietaire: (valeur: string) => void
  sujets: SujetsDeRegle
  actions: ActionsParClasse | null
  /** Qui regarde administre : la gestion se propose. */
  administre: boolean
  moi: string
  /** Un connecteur connecté chez le tiers : son partage engage l'autorisation de son propriétaire, pas une clé. */
  parAutorisation?: boolean
}

const optionsDuProprietaire = (proprietaires: readonly ChoixDuProprietaire[]) => proprietaires.map(({ valeur, libelle }) => ({ value: valeur, label: libelle }))

/** Ce que le partage engage, selon le propriétaire : un connecteur d'équipe ou d'organisation sert sans être nommé. */
function legende(partage: PartageDeLAjout, proprietaire: string, parAutorisation: boolean): string {
  const cache = parAutorisation ? "votre autorisation reste cachée, et leur assistant y agit en votre nom" : "la clé reste cachée"
  if (proprietaire !== "user") return `Les membres concernés s'en servent sans avoir à le nommer ; ${cache}.`
  return partage.regles.length > 0 || partage.general ? `Ils s'en serviront en le nommant ; ${cache}.` : "Vous pourrez le partager plus tard."
}

export function PartageALAjout({ partage, changer, proprietaires, proprietaire, choisirProprietaire, sujets, actions, administre, moi, parAutorisation = false }: PartageALAjoutProps) {
  const choisi = proprietaires.find((un) => un.valeur === proprietaire) ?? proprietaires[0]
  // Le propriétaire n'est jamais proposé sur son propre connecteur : la personne, ou l'équipe qui le porte.
  const candidats = candidatsDe(
    sujets,
    partage.regles.map(({ sujet }) => sujet),
    [proprietaire === "user" ? `user:${moi}` : proprietaire],
  )
  const choix =
    proprietaires.length > 1 ? (
      <Select size="sm" aria-label="Propriétaire" value={proprietaire} options={optionsDuProprietaire(proprietaires)} onChange={(evenement) => choisirProprietaire(evenement.target.value)} />
    ) : undefined
  return (
    <section aria-labelledby="qui-pourra-s-en-servir" className="flex flex-col gap-3">
      <h3 id="qui-pourra-s-en-servir" className="text-base font-bold text-ink">
        Qui pourra s&apos;en servir
      </h3>
      <div className="oto-share-panel">
        <ChampDAjoutDAcces candidats={candidats} ajouter={async (sujet) => (changer({ ...partage, regles: [...partage.regles, { sujet, niveau: "read" }] }), true)} enCours={false} />
        <LigneDuProprietaire nom={choisi?.libelle ?? "Vous"} vous={proprietaire === "user"} choix={choix} />
        <LigneDeToutLOrganisation
          valeur={partage.general ?? "none"}
          servi={partage.general ?? "none"}
          actions={actions}
          administre={administre}
          disabled={false}
          onChange={(valeur) => {
            const niveau = niveauLu(valeur)
            changer({ ...partage, general: niveau && niveau !== "none" ? niveau : null })
          }}
        />
        <Ajoutes partage={partage} changer={changer} actions={actions} administre={administre} moi={moi} />
      </div>
      <p className="oto-caption">{legende(partage, proprietaire, parAutorisation)}</p>
    </section>
  )
}
