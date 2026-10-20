"use client"

// Le niveau d'un membre de l'équipe propriétaire sur un nœud (1.4.12, droits par personne), dans un menu : « Partager »
// d'une page le montre pour chaque membre sans accès propre à cette page, « Les personnes de … » pour chaque membre sur le
// dossier de l'équipe. Choisir un niveau pose la règle qui le nomme sur ce nœud (`POST rules`) ; revenir au niveau qu'il
// aurait sans elle (`inherited`) la retire (`DELETE rules/<id>`) : la règle la plus proche l'emporte (`droits-d-acces.md`),
// une page surcharge donc le niveau donné sur le dossier. Sans lui, régler un membre demandait de le chercher et de
// l'ajouter à la page, et son niveau hérité ne se voyait nulle part. Les niveaux se lisent à l'ouverture du panneau ou du
// dialogue (`GET rules?path=`, `useNiveauxDesMembres`), jamais à l'affichage de la page, qui ne paie pas ce calcul.
import { useCallback, useEffect, useState } from "react"
import { ACCESS_LEVEL_NAMES, setNodeRuleSchema, type AccessLevelName, type NodeRulesView } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Avatar, Button } from "../ds/react/primitives"
import { Select } from "../ds/react/select"
import { NIVEAUX_D_ACCES, PARTAGE } from "./libelles"

export type Membre = NonNullable<NodeRulesView["people"]>[number]

/** Un geste vers l'API : la requête, et l'annonce dite s'il aboutit ; `true` s'il a abouti. */
export type EnvoyerUnNiveau = (envoi: { methode: "POST" | "DELETE"; ressource: string; corps?: unknown }, annonce: string) => Promise<boolean>

type Lecture = { etat: "chargement" } | { etat: "erreur"; message: string } | { etat: "pret"; vue: NodeRulesView }

export type NiveauxDesMembres = ReturnType<typeof useNiveauxDesMembres>

/**
 * Le panneau d'un nœud et le niveau des membres de son équipe (`GET rules?path=`), lu au montage, quand `cle` change (la
 * composition d'une équipe, les règles servies d'une page), et après chaque niveau changé par `envoyer` ; `actif` faux : rien
 * n'est lu (qui ne gère pas la page ne règle aucun membre).
 */
export function useNiveauxDesMembres(chemin: string, cle: string, actif = true) {
  const [lecture, setLecture] = useState<Lecture>({ etat: "chargement" })
  const [annonce, setAnnonce] = useState("")
  const [erreur, setErreur] = useState("")
  const [enCours, setEnCours] = useState(false)
  const lire = useCallback(async () => {
    const lu = await appelerPlateforme<NodeRulesView>({ methode: "GET", ressource: `rules?path=${encodeURIComponent(chemin)}` })
    setLecture(lu.erreur ? { etat: "erreur", message: messageDErreur(lu.erreur) } : { etat: "pret", vue: lu.data })
  }, [chemin])
  useEffect(() => {
    if (actif) void lire()
  }, [lire, cle, actif])
  const envoyer: EnvoyerUnNiveau = async (envoi, succes) => {
    setErreur("")
    setAnnonce("")
    setEnCours(true)
    const reponse = await appelerPlateforme(envoi)
    setEnCours(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur))
      return false
    }
    setAnnonce(succes)
    await lire()
    return true
  }
  return { lecture, annonce, erreur, enCours, envoyer, relire: () => void lire() }
}

/** L'annonce d'un niveau changé, son refus, et une lecture en échec, dite avec « Réessayer ». */
export function EtatDesNiveaux({ niveaux }: { niveaux: NiveauxDesMembres }) {
  return (
    <>
      <p role="status" className="oto-caption">
        {niveaux.annonce}
      </p>
      {niveaux.erreur && (
        <p role="alert" className="oto-caption">
          {niveaux.erreur}
        </p>
      )}
      {niveaux.lecture.etat === "erreur" && (
        <p role="alert" className="oto-caption">
          {PARTAGE.niveauxIllisibles(niveaux.lecture.message)}{" "}
          <Button variant="secondary" size="sm" onClick={niveaux.relire}>
            {PARTAGE.reessayer}
          </Button>
        </p>
      )}
    </>
  )
}

/** Le geste qui donne `niveau` au membre sur le nœud : retirer sa règle s'il retrouve ainsi son niveau hérité, la poser sinon. */
export function envoiDuNiveau(chemin: string, membre: Membre, niveau: AccessLevelName): { methode: "POST" | "DELETE"; ressource: string; corps?: unknown } | null {
  if (niveau === membre.inherited && membre.ruleId !== null) return { methode: "DELETE", ressource: `rules/${membre.ruleId}` }
  const corps = setNodeRuleSchema.safeParse({ path: chemin, subject: { kind: "user", id: membre.userId }, level: niveau })
  return corps.success ? { methode: "POST", ressource: "rules", corps: corps.data } : null
}

type NiveauDUnMembreProps = {
  chemin: string
  membre: Membre
  /** L'accès complet ne s'accorde que par un administrateur (N6) ; le niveau du membre reste toujours proposé. */
  gestionAccordable: boolean
  envoyer: EnvoyerUnNiveau
  enCours: boolean
}

export function NiveauDUnMembre({ chemin, membre, gestionAccordable, envoyer, enCours }: NiveauDUnMembreProps) {
  // Le choix se montre tout de suite ; la relecture ou un refus le ramènent au niveau servi.
  const [choisi, setChoisi] = useState<AccessLevelName>(membre.level)
  const [servi, setServi] = useState(membre.level)
  if (servi !== membre.level) {
    setServi(membre.level)
    setChoisi(membre.level)
  }
  const proposes = ACCESS_LEVEL_NAMES.filter((niveau) => niveau === membre.level || niveau !== "manage" || gestionAccordable).reverse()

  async function changer(valeur: string) {
    const niveau = ACCESS_LEVEL_NAMES.find((un) => un === valeur)
    const envoi = niveau ? envoiDuNiveau(chemin, membre, niveau) : null
    if (!niveau || !envoi) return
    setChoisi(niveau)
    if (!(await envoyer(envoi, PARTAGE.change(membre.name, NIVEAUX_D_ACCES[niveau])))) setChoisi(membre.level)
  }

  return (
    <Select
      size="sm"
      className="oto-share-level"
      aria-label={PARTAGE.accesDe(membre.name)}
      value={choisi}
      options={proposes.map((niveau) => ({ value: niveau, label: NIVEAUX_D_ACCES[niveau] }))}
      onChange={(evenement) => void changer(evenement.target.value)}
      disabled={enCours}
    />
  )
}

type MembresDeLEquipeProps = Omit<NiveauDUnMembreProps, "membre"> & {
  /** Les membres sans accès propre à ce nœud : ceux qui en ont un sont dans la liste des accès, « Retirer » les rétablit. */
  membres: readonly Membre[]
  equipe: string
  /** Qui gère le nœud règle chaque membre ; les autres lisent son niveau. */
  gere: boolean
  moi: string | null
}

/** « Membres de l'équipe … » dans « Partager » : chacun, son niveau hérité, et le menu qui le surcharge sur ce contenu. */
export function MembresDeLEquipe({ membres, equipe, gere, moi, ...niveau }: MembresDeLEquipeProps) {
  if (membres.length === 0) return null
  return (
    <>
      <p className="oto-pop-label">{PARTAGE.membresDe(equipe)}</p>
      <ul aria-label={PARTAGE.membresDe(equipe)} className="flex flex-col">
        {membres.map((membre) => (
          <li key={membre.userId} className="oto-pop-row">
            <Avatar name={membre.name} size="sm" aria-hidden="true" />
            <span>
              {membre.name}
              {membre.userId === moi && <span className="oto-caption">{` (${PARTAGE.vous})`}</span>}
              {membre.lead && <span className="oto-caption">{` · ${PARTAGE.responsable}`}</span>}
            </span>
            {gere ? <NiveauDUnMembre membre={membre} {...niveau} /> : <span className="oto-pop-meta">{NIVEAUX_D_ACCES[membre.level]}</span>}
          </li>
        ))}
      </ul>
    </>
  )
}
