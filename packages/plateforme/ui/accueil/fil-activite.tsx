"use client"

// Le fil d'activité de l'accueil (E05-S09, partie b ; E05-S12, lot B, AC-12 à AC-16) : ce qui est arrivé aux
// contenus sur la semaine, dans la portée du journal (H74, décidée par le service), par journée, de la plus
// récente à la plus ancienne ; une activité par ligne. Server Component. Porté d'oto-frontend
// (`accueil/fil-activite.tsx` et l'onglet « Activités » d'`agents-et-activites.tsx`). Repris : une journée,
// un titre ; la ligne entière est le lien, jamais un mot de la phrase ; l'avatar de la personne, son nom écrit
// à côté ; l'état vide sans action. Changé : les journées se nomment ici (« Aujourd'hui », « Hier », puis la
// date, au fuseau de Paris) ; la phrase est écrite par l'écran depuis le verbe classé par le service, au lieu
// d'une prose du serveur, sur une ligne au lieu de deux (retour 3 d'E05-S12) ; une ligne ouvre le contenu, ou
// la conversation d'une procédure lancée, et un contenu que la personne ne lit pas n'ouvre rien. Retiré : le
// marqueur « vous en étiez ici » (aucun service ne sait quand la personne est passée) et les filtres par type.
//
// 1.4.13 : l'onglet « Fil » de la carte « Reprendre » ; dans une ligne qui ouvre un contenu, le contenu cité se montre
// comme un lien (`oto-feed-cible`) : la ligne entière restait le lien, sans que rien ne dise qu'on pouvait y aller. Le fil
// se filtre (Moi, Mes équipes, Toute l'organisation) : il se rend dans le navigateur, le lien de l'hôte lu dans son
// contexte (`useHote`) ; une procédure lancée ouvre la procédure, le contenu que la ligne cite, et un petit lien à l'icône
// de journal, en fin de rangée, sa conversation (deux liens côte à côte, jamais l'un dans l'autre).
import { Fragment } from "react"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight"
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook"
import type { Activity, ActivityPage } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { EmptyState } from "../ds/react/empty-state"
import { FeedItem } from "../ds/react/home"
import { AnimatedIcon } from "../ds/react/icon"
import { Avatar } from "../ds/react/primitives"
import { dateCourte, dateLisible, heureCourte } from "../format/dates"
import { useHote } from "../hote/navigation"
import { PERSONNE_RETIREE } from "../journal/libelles"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { ACTIVITES, NATURES_DES_ACTIVITES, VERBES_DES_ACTIVITES } from "./libelles"
import { MARQUE_DE_CONVERSATION } from "./types"

const HEURE_MS = 3_600_000

export type ActivitesDeLAccueilProps = {
  activites: Resultat<ActivityPage>
  /** L'identifiant de la personne : ses activités se disent « Vous ». */
  moi: string
  /** L'adresse du journal. */
  hrefDuJournal: string
  /**
   * L'adresse d'une conversation au journal, la marque `MARQUE_DE_CONVERSATION` à la place de son code : l'écran serveur la
   * tire de la fonction de l'hôte (`hrefDeConversation`), qui ne traverse pas la frontière client.
   */
  modeleDeConversation: string
  /** Le préfixe des pages de l'arbre (« /n/ ») : un contenu s'ouvre à ce préfixe suivi de son chemin. */
  prefixeDesPages: string
}

type FilProps = Omit<ActivitesDeLAccueilProps, "hrefDuJournal">

/** Le jour de Paris d'un instant, « 26/09/2026 » : la clé qui range une activité dans sa journée. */
const jourDe = (instant: number) => dateCourte(new Date(instant).toISOString())

/** La veille à Paris : le jour de la première heure passée qui n'est plus aujourd'hui, changement d'heure compris. */
function veilleDe(maintenant: number, aujourdhui: string | undefined): string | undefined {
  for (let heures = 1; heures <= 48; heures += 1) {
    const jour = jourDe(maintenant - heures * HEURE_MS)
    if (jour !== aujourdhui) return jour
  }
  return undefined
}

type Journee = { titre: string; activites: Activity[] }

/** Les activités, déjà rangées de la plus récente à la plus ancienne par le service, regroupées par journée. */
function parJournee(activites: readonly Activity[], maintenant: number): Journee[] {
  const aujourdhui = jourDe(maintenant)
  const hier = veilleDe(maintenant, aujourdhui)
  const titreDe = (iso: string) => {
    const jour = dateCourte(iso)
    if (jour === aujourdhui) return ACTIVITES.aujourdhui
    if (jour === hier) return ACTIVITES.hier
    return dateLisible(iso) ?? ""
  }
  const journees: Journee[] = []
  for (const activite of activites) {
    const titre = titreDe(activite.at)
    const derniere = journees.at(-1)
    if (derniere?.titre === titre) derniere.activites.push(activite)
    else journees.push({ titre, activites: [activite] })
  }
  return journees
}

/**
 * Ce qui est arrivé : le verbe, la nature quand elle est sue, puis le titre d'un contenu lu, sinon son chemin tel
 * que le journal le montre ; des lignes à revoir parmi les lignes supprimées, à la fin (E11-S02, AC-h3).
 */
function phraseDe({ verb, kind, title, path, inReview }: Activity, vous: boolean): { debut: string; cible: string; fin: string } {
  const nature = kind === null ? "" : `${NATURES_DES_ACTIVITES[kind]} `
  const fin = inReview ? ACTIVITES.dontARevoir(inReview) : ""
  return { debut: `${VERBES_DES_ACTIVITES[verb][vous ? "vous" : "il"]} ${nature}`, cible: title ?? path, fin }
}

/** Où mène la ligne : le contenu cité, une procédure lancée comprise, quand la personne le lit ; sinon nulle part. */
function adresseDe(activite: Activity, prefixeDesPages: string): string | null {
  return activite.title === null ? null : `${prefixeDesPages}${activite.path}`
}

/** L'heure, précédée du nombre de gestes regroupés (AC-14) : « ×3 » à l'œil, « 3 fois » au lecteur d'écran. */
function Quand({ activite }: { activite: Activity }) {
  return (
    <>
      {activite.count > 1 && (
        <>
          <span aria-hidden="true">{ACTIVITES.fois(activite.count)}</span>
          <span className="oto-sr-only">{ACTIVITES.foisLu(activite.count)}</span>{" "}
        </>
      )}
      {heureCourte(activite.at)}
    </>
  )
}

function LigneDuFil({ activite, moi, prefixeDesPages, modeleDeConversation }: Omit<FilProps, "activites"> & { activite: Activity }) {
  const { Lien } = useHote()
  const vous = activite.userId !== null && activite.userId === moi
  const auteur = vous ? ACTIVITES.vous : (activite.userName ?? PERSONNE_RETIREE)
  const href = adresseDe(activite, prefixeDesPages)
  const lien = href === null ? {} : { as: Lien, href }
  const { debut, cible, fin } = phraseDe(activite, vous)
  const phrase = `${debut}${cible}${fin}`
  const ligne = (
    <FeedItem
      {...lien}
      // L'avatar se tait : le nom est écrit à côté, un lecteur d'écran le dirait deux fois.
      lead={
        <span aria-hidden="true">
          <Avatar name={activite.userName ?? auteur} size="sm" self={vous} />
        </span>
      }
      name={auteur}
      // La phrase se coupe par des points de suspension sur une ligne : son texte entier au survol.
      what={
        <span title={phrase}>
          {debut}
          <span className={href === null ? undefined : "oto-feed-cible"}>{cible}</span>
          {fin}
        </span>
      }
      when={<Quand activite={activite} />}
    />
  )
  // Une procédure lancée : sa conversation au journal, par un second lien, à côté de la ligne.
  if (activite.verb !== "ran" || activite.ctx === null) return ligne
  return (
    <div className="oto-fil-rangee">
      {ligne}
      <Lien
        href={modeleDeConversation.replace(MARQUE_DE_CONVERSATION, encodeURIComponent(activite.ctx))}
        className="oto-icon-btn anim-host"
        data-variant="ghost"
        data-size="sm"
        data-icon-only=""
        aria-label={ACTIVITES.voirLaConversation(activite.title ?? activite.path)}
        title={ACTIVITES.conversation}
      >
        <AnimatedIcon as={Notebook} size="xs" />
      </Lien>
    </div>
  )
}

function FilDActivite({ activites, ...ligne }: FilProps) {
  if (activites.error !== undefined) return <ErreurDeLecture message={activites.error} />
  const { activities } = activites.data
  // Pas d'action : « rien ne s'est passé » n'a pas de geste réparateur.
  if (activities.length === 0) return <EmptyState title={ACTIVITES.rien}>{ACTIVITES.rienTexte}</EmptyState>
  return parJournee(activities, Date.now()).map((journee) => (
    // La première activité d'une journée la désigne : l'identifiant d'une ligne de journal est unique.
    <Fragment key={journee.activites[0].id}>
      <h3 className="oto-num-caption">{journee.titre}</h3>
      {journee.activites.map((activite) => (
        <LigneDuFil key={activite.id} activite={activite} {...ligne} />
      ))}
    </Fragment>
  ))
}

/**
 * L'onglet « Activités » de l'îlot principal (E05-S11, AC-12) : la sortie vers le journal, au bout, comme le
 * « tout voir » d'oto-frontend dans son onglet, puis le fil ; la barre d'onglets tient lieu d'en-tête.
 */
export function ActivitesDeLAccueil({ hrefDuJournal, ...fil }: ActivitesDeLAccueilProps) {
  const { Lien } = useHote()
  return (
    <>
      <div className="flex">
        <Lien href={hrefDuJournal} className="oto-list-more">
          {ACTIVITES.toutLeJournal}
          <AnimatedIcon as={ArrowRight} anim="nudge" size="xs" />
        </Lien>
      </div>
      <FilDActivite {...fil} />
    </>
  )
}
