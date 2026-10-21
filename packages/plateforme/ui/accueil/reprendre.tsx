"use client"

// La carte « Reprendre » de l'accueil (1.4.13) : trois onglets, « Récents » (ouvert par défaut), « Les plus consultés » et
// « Fil » (le fil d'activité), et sur leur ligne, à droite, le filtre en pastilles « Moi », « Mes équipes » (par défaut),
// « Toute l'organisation », commun aux trois onglets ; vingt lignes, puis « Voir plus » qui en ajoute vingt. Une ligne dit
// le contenu et son espace (son équipe, Tout le monde ou Privé), jamais son chemin. La première page de Récents et le fil
// de Mes équipes viennent de la page de l'hôte ; le reste se lit par `GET /api/platform/home` et `home/activities`. Les
// services décident ce que la personne lit. Les quatre états : la lecture (`aria-busy`), l'échec (alerte et
// « Réessayer »), le vide (une phrase) et les lignes. Retours du 21/10 : sans titre, l'en-tête porte les onglets.
import { useLayoutEffect, useRef, useState } from "react"
import { HOME_SCOPES, type ActivityPage, type HomeContent, type HomeContentsPage, type HomeScope, type HomeSpace, type HomeTab } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import type { Resultat } from "../api/resultat"
import { natureDuGenre, SECTION_PERSO, TOUT_LE_MONDE } from "../arbre/depuis-l-arbre"
import { EmptyState } from "../ds/react/empty-state"
import { FeedItem } from "../ds/react/home"
import { Button } from "../ds/react/primitives"
import { SegmentedControl } from "../ds/react/segmented-control"
import { Skeleton } from "../ds/react/skeleton"
import { Tabs } from "../ds/react/tabs"
import { ilYA } from "../format/dates"
import { useHote } from "../hote/navigation"
import { GlypheDeNature } from "../noeud/glyphes"
import { ActivitesDeLAccueil } from "./fil-activite"
import { REPRENDRE } from "./libelles"

type Onglet = HomeTab | "fil"

const ONGLETS = [
  { value: "recent", label: REPRENDRE.recents },
  { value: "viewed", label: REPRENDRE.consultes },
  { value: "fil", label: REPRENDRE.fil },
] as const

const LIBELLES_DES_FILTRES: Record<HomeScope, string> = { me: REPRENDRE.moi, teams: REPRENDRE.equipes, org: REPRENDRE.organisation }

const FILTRES = HOME_SCOPES.map((portee) => ({ value: portee, label: LIBELLES_DES_FILTRES[portee] }))

/**
 * Ce que la carte montre pour un onglet de contenus et un filtre : les lignes lues, l'état de la lecture en cours, et le
 * geste qui l'a demandée (« Voir plus », « Réessayer »), dont le bouton reste monté pendant la lecture ; `null` pour un
 * onglet ou un filtre.
 */
type Liste = { items: HomeContent[]; hasMore: boolean; etat: "pret" | "chargement" | "erreur"; message: string; geste: "plus" | "reessayer" | null }

/** Le fil d'un filtre : sa lecture, `null` pendant qu'elle court. */
type Fil = { portee: HomeScope; lecture: Resultat<ActivityPage> | null }

const ongletLu = (valeur: string): Onglet => ONGLETS.find((onglet) => onglet.value === valeur)?.value ?? "recent"
const filtreLu = (valeur: string): HomeScope => HOME_SCOPES.find((portee) => portee === valeur) ?? "teams"

/** La liste de départ : la première page lue par l'hôte, ou son échec. */
function depart(premiere: Resultat<HomeContentsPage>): Liste {
  return premiere.error !== undefined
    ? { items: [], hasMore: false, etat: "erreur", message: premiere.error, geste: null }
    : { items: premiere.data.items, hasMore: premiere.data.hasMore, etat: "pret", message: "", geste: null }
}

type Depart = { premiere: Resultat<HomeContentsPage>; premierFil: Resultat<ActivityPage> }

/** Les lignes des onglets de contenus et le fil, lus page par page ; leurs premières lectures viennent de l'hôte. */
function useCarte({ premiere, premierFil }: Depart) {
  const [cle, setCle] = useState<{ onglet: Onglet; portee: HomeScope }>({ onglet: "recent", portee: "teams" })
  const [liste, setListe] = useState<Liste>(() => depart(premiere))
  const [fil, setFil] = useState<Fil>({ portee: "teams", lecture: premierFil })
  // La ligne qui prend le focus après « Voir plus » ou « Réessayer » : la première ajoutée, le bouton pouvant partir.
  const focusVers = useRef<number | null>(null)
  // Le numéro de la dernière lecture demandée : la réponse d'une lecture dépassée (un autre filtre choisi entre-temps) se tait.
  const derniere = useRef(0)

  async function lire(onglet: HomeTab, portee: HomeScope, deja: HomeContent[], geste: Liste["geste"]) {
    derniere.current += 1
    const numero = derniere.current
    setListe({ items: deja, hasMore: false, etat: "chargement", message: "", geste })
    const parametres = new URLSearchParams({ tab: onglet, scope: portee, offset: String(deja.length) })
    const lu = await appelerPlateforme<HomeContentsPage>({ methode: "GET", ressource: `home?${parametres}` })
    if (numero !== derniere.current) return
    if (lu.erreur) {
      setListe({ items: deja, hasMore: false, etat: "erreur", message: messageDErreur(lu.erreur), geste })
      return
    }
    if (geste !== null && lu.data.items.length > 0) focusVers.current = deja.length
    setListe({ items: [...deja, ...lu.data.items], hasMore: lu.data.hasMore, etat: "pret", message: "", geste: null })
  }

  async function lireLeFil(portee: HomeScope) {
    derniere.current += 1
    const numero = derniere.current
    setFil({ portee, lecture: null })
    const lu = await appelerPlateforme<ActivityPage>({ methode: "GET", ressource: `home/activities?${new URLSearchParams({ scope: portee })}` })
    if (numero !== derniere.current) return
    setFil({ portee, lecture: lu.erreur ? { error: messageDErreur(lu.erreur) } : { data: lu.data } })
  }

  function choisir(onglet: Onglet, portee: HomeScope) {
    setCle({ onglet, portee })
    if (onglet !== "fil") void lire(onglet, portee, [], null)
    else if (portee !== fil.portee || fil.lecture === null) void lireLeFil(portee)
  }

  /** Le geste du bouton : « Réessayer » après un échec, « Voir plus » sinon ; rien pendant une lecture (le bouton reste là). */
  function agir() {
    const onglet = cle.onglet
    if (onglet === "fil" || liste.etat === "chargement") return
    void lire(onglet, cle.portee, liste.items, liste.etat === "erreur" ? "reessayer" : "plus")
  }

  return { cle, liste, fil, choisir, agir, focusVers }
}

const ESPACES: Record<Exclude<HomeSpace["kind"], "team">, string> = { org: TOUT_LE_MONDE, user: SECTION_PERSO }

/** L'espace d'un contenu, en mots : le nom de son équipe, Tout le monde ou Privé. */
const espaceDe = (espace: HomeSpace): string => (espace.kind === "team" ? espace.name : ESPACES[espace.kind])

/** Une ligne : le genre, le titre (coupé par des points de suspension), puis son espace et, sur Les plus consultés, ses consultations, et quand. */
function LigneDeContenu({ contenu, prefixeDesPages }: { contenu: HomeContent; prefixeDesPages: string }) {
  const { Lien } = useHote()
  const vues = contenu.views ? REPRENDRE.consultations(contenu.views.screen + contenu.views.assistant) : null
  const meta = [espaceDe(contenu.space), vues].filter(Boolean).join(" · ")
  return (
    <FeedItem
      as={Lien}
      href={`${prefixeDesPages}${contenu.path}`}
      className="oto-reprendre-ligne"
      title={contenu.title}
      lead={
        <span aria-hidden="true">
          <GlypheDeNature nature={natureDuGenre(contenu.kind)} />
        </span>
      }
      name={contenu.title}
      what={meta}
      // L'écart se calcule au rendu : quelques secondes entre le serveur et le navigateur peuvent changer le mot.
      when={<span suppressHydrationWarning>{ilYA(contenu.at)}</span>}
    />
  )
}

/** Le bouton de la liste : « Réessayer » après un échec, « Voir plus » quand d'autres suivent ; monté pendant la lecture qu'il a demandée. */
function libelleDuBouton(liste: Liste): string | null {
  if (liste.etat === "erreur" || (liste.etat === "chargement" && liste.geste === "reessayer")) return REPRENDRE.reessayer
  if ((liste.etat === "pret" && liste.hasMore) || (liste.etat === "chargement" && liste.geste === "plus")) return REPRENDRE.voirPlus
  return null
}

type ContenusProps = { liste: Liste; onglet: HomeTab; prefixeDesPages: string; agir: () => void; focusVers: { current: number | null } }

/** Le corps d'un onglet de contenus : les lignes, ou le vide, puis le bouton ; le focus va à la première ligne ajoutée. */
function Contenus({ liste, onglet, prefixeDesPages, agir, focusVers }: ContenusProps) {
  const conteneur = useRef<HTMLDivElement>(null)
  // Après chaque rendu : une page ajoutée par un geste donne le focus à sa première ligne, puis l'oublie.
  useLayoutEffect(() => {
    const rang = focusVers.current
    if (rang === null) return
    focusVers.current = null
    conteneur.current?.querySelectorAll<HTMLElement>(".oto-feed-item")[rang]?.focus()
  })
  const libelle = libelleDuBouton(liste)
  const enCours = liste.etat === "chargement"
  return (
    <div ref={conteneur} className="oto-reprendre-liste" aria-busy={enCours}>
      {liste.etat === "pret" && liste.items.length === 0 ? (
        <EmptyState title={onglet === "recent" ? REPRENDRE.rienRecent : REPRENDRE.rienConsulte}>{REPRENDRE.rienTexte}</EmptyState>
      ) : (
        liste.items.map((contenu) => <LigneDeContenu key={contenu.path} contenu={contenu} prefixeDesPages={prefixeDesPages} />)
      )}
      {libelle !== null && (
        <div className="flex">
          {/* Jamais \`disabled\` pendant la lecture : un bouton désactivé perd le focus ; le geste se garde dans \`agir\`. */}
          <Button variant="secondary" size="sm" aria-busy={enCours} onClick={agir}>
            {libelle}
          </Button>
        </div>
      )}
    </div>
  )
}

/** L'onglet « Fil » : le fil du filtre, ou sa lecture en cours. */
function OngletDuFil({ fil, ...adresses }: { fil: Fil } & Pick<ReprendreProps, "moi" | "hrefDuJournal" | "modeleDeConversation" | "prefixeDesPages">) {
  if (fil.lecture === null) {
    return (
      <div aria-busy="true">
        <Skeleton shape="row" />
      </div>
    )
  }
  return <ActivitesDeLAccueil activites={fil.lecture} {...adresses} />
}

type ReprendreProps = Depart & {
  /** L'identifiant de la personne : ses activités se disent « Vous ». */
  moi: string
  /** L'adresse du journal : « Tout le journal ». */
  hrefDuJournal: string
  /** L'adresse d'une conversation au journal, la marque à la place du code (`MARQUE_DE_CONVERSATION`). */
  modeleDeConversation: string
  /** Le préfixe des pages de l'arbre (« /n/ ») : un contenu s'ouvre à ce préfixe suivi de son chemin. */
  prefixeDesPages: string
}

export function Reprendre({ premiere, premierFil, moi, hrefDuJournal, modeleDeConversation, prefixeDesPages }: ReprendreProps) {
  const { cle, liste, fil, choisir, agir, focusVers } = useCarte({ premiere, premierFil })
  const filtres = <SegmentedControl options={FILTRES} value={cle.portee} onChange={(valeur) => choisir(cle.onglet, filtreLu(valeur))} label={REPRENDRE.filtres} />
  return (
    <div className="oto-reprendre">
      <Tabs tabs={ONGLETS} value={cle.onglet} onChange={(valeur) => choisir(ongletLu(valeur), cle.portee)} label={REPRENDRE.onglets} aside={filtres}>
        {cle.onglet === "fil" ? (
          <OngletDuFil fil={fil} moi={moi} hrefDuJournal={hrefDuJournal} modeleDeConversation={modeleDeConversation} prefixeDesPages={prefixeDesPages} />
        ) : (
          <Contenus liste={liste} onglet={cle.onglet} prefixeDesPages={prefixeDesPages} agir={agir} focusVers={focusVers} />
        )}
      </Tabs>
      {/* Montées vides, remplies ensuite : une région n'annonce que ce qui change après son montage. */}
      <p role="status" className="oto-caption oto-reprendre-annonce">
        {(cle.onglet === "fil" ? fil.lecture === null : liste.etat === "chargement") ? REPRENDRE.chargement : ""}
      </p>
      <p role="alert" className="oto-caption oto-reprendre-annonce">
        {cle.onglet !== "fil" && liste.etat === "erreur" ? liste.message : ""}
      </p>
    </div>
  )
}
