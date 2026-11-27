"use client"

// La liste de l'écran Connecteurs : les filtres en pastilles avec leur compte, la recherche, puis le tableau du design
// system, une ligne par compte que la personne voit : la tuile de son outil, son nom et sa description, à qui il est,
// son état en un mot de la couleur de l'état, et un geste au plus. L'îlot ne reçoit que des données : les lignes, leurs
// textes et leurs adresses sont calculés par l'écran (`lignes-des-connecteurs.ts`), le filtre et la recherche vivent
// dans l'adresse de l'hôte (`useHote().naviguer`), le détail s'ouvre par un lien, et toute la ligne le suit au clic
// (`suivreLeLienDeLaLigne`) ; le lien du nom reste la seule cible du clavier et des lecteurs d'écran. L'état se lit par
// son mot, le point et la couleur ne font que l'accompagner. Sur le modèle de `journal/tableau-des-conversations.tsx`.
import { useId, type MouseEvent } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { AnimatedIcon } from "../../ds/react/icon"
import { ListTools } from "../../ds/react/list-tools"
import { ObjectLink } from "../../ds/react/object-link"
import { Table, type Column } from "../../ds/react/table"
import { LIEN } from "../../components/classes"
import { useHote } from "../../hote/navigation"
import { LogoDOrganisation } from "../../marque/logo-d-organisation"
import { FiltreSegmente, type ChoixDuFiltre } from "../filtre-segmente"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import type { LigneDeConnecteur } from "./lignes-des-connecteurs"

const RECHERCHER = "Rechercher un connecteur"

/**
 * La rangée d'objet du DS (`ObjectLink` à tuile) : la tuile, le nom et sa phrase forment le lien. Son nom accessible reste
 * le nom du connecteur, la phrase le décrit (`aria-describedby`) : un lien nommé de toute sa rangée se lirait mal dans la
 * liste des liens.
 */
function Connecteur({ ligne }: { ligne: LigneDeConnecteur }) {
  const { Lien } = useHote()
  const phrase = useId()
  // L'outil sous un nom qui le redit déjà ne s'écrit pas deux fois, sauf suivi de la façon du compte, qui distingue deux connecteurs d'un même outil.
  const meta = (ligne.description ?? (ligne.outil !== ligne.libelle || ligne.facon ? ligne.outil : null)) ? [ligne.description ?? ligne.outil, ligne.facon].filter(Boolean).join(" · ") : null
  return (
    <ObjectLink
      as={Lien}
      href={ligne.ouverture}
      data-ouvre-la-ligne=""
      aria-label={ligne.libelle}
      aria-describedby={meta ? phrase : undefined}
      className="focus-visible:ring-2 focus-visible:ring-ink"
      lead={<LogoDOrganisation nom={ligne.outil} logo={ligne.logo} taille={40} tuile />}
      name={<span className={ligne.desactive ? "text-mute" : "text-ink"}>{ligne.libelle}</span>}
      meta={meta ? <span id={phrase}>{meta}</span> : undefined}
    />
  )
}

function Acces({ ligne }: { ligne: LigneDeConnecteur }) {
  return (
    // Sur un téléphone, une ligne : « Privé · Non partagé ».
    <span className="flex min-w-0 flex-col max-md:flex-row max-md:flex-wrap max-md:items-baseline max-md:gap-x-1.5">
      <span className={`font-medium ${ligne.desactive ? "text-mute" : ""}`}>{ligne.acces}</span>
      <span aria-hidden="true" className="oto-caption hidden max-md:inline">·</span>
      <span className="oto-caption">{ligne.niveau}</span>
    </span>
  )
}

/** Le mot de l'état, toujours écrit, à la couleur de l'état ; le point, décoratif, le souligne. */
function Etat({ ligne }: { ligne: LigneDeConnecteur }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`oto-etat flex items-center gap-2 font-medium${ligne.desactive ? " text-mute" : ""}`} data-state={ligne.etat.point}>
        <span className="oto-dot" data-state={ligne.etat.point} aria-hidden="true" />
        {ligne.etat.mot}
      </span>
      {ligne.etat.precision && <span className="oto-caption">{ligne.etat.precision}</span>}
    </span>
  )
}

function Geste({ ligne, retour }: { ligne: LigneDeConnecteur; retour: string }) {
  const { Lien } = useHote()
  if (!ligne.geste) return null
  if (ligne.geste.genre === "connexion") {
    return (
      <ConnexionParConsentement
        ressource={ligne.geste.ressource}
        connecteur={ligne.geste.connecteur}
        acces={ligne.geste.acces}
        libelle={ligne.geste.libelle}
        nomAccessible={`${ligne.geste.libelle} ${ligne.libelle}`}
        retour={retour}
      />
    )
  }
  return (
    <Lien href={ligne.ouverture} className="oto-btn anim-host" data-variant="secondary">
      <span>
        {ligne.geste.libelle}
        <span className="oto-sr-only">{` de ${ligne.libelle}`}</span>
      </span>
    </Lien>
  )
}

function colonnes(retour: string): Column<LigneDeConnecteur>[] {
  return [
    { key: "connecteur", header: "Connecteur", primary: true, render: (ligne) => <Connecteur ligne={ligne} /> },
    { key: "acces", header: "Accès", render: (ligne) => <Acces ligne={ligne} /> },
    { key: "etat", header: "État", render: (ligne) => <Etat ligne={ligne} /> },
    { key: "geste", header: <span className="oto-sr-only">Geste</span>, align: "end", render: (ligne) => <Geste ligne={ligne} retour={retour} /> },
  ]
}

/**
 * Un clic sur une ligne, hors de ses contrôles, suit le lien du nom (`data-ouvre-la-ligne`) : la ligne entière ouvre le
 * détail à la souris et au doigt, sans devenir une seconde cible du clavier (le lien l'est déjà). Un clic modifié (nouvel
 * onglet) ou qui sélectionne du texte n'ouvre rien : le lien du nom reste là pour lui.
 */
function suivreLeLienDeLaLigne(evenement: MouseEvent<HTMLElement>, naviguer: (adresse: string) => void) {
  if (!(evenement.target instanceof Element) || evenement.defaultPrevented) return
  if (evenement.button !== 0 || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey || evenement.altKey) return
  if (evenement.target.closest("a, button, input, select, textarea, [role='button']")) return
  if (window.getSelection()?.toString()) return
  const lien = evenement.target.closest("tbody tr")?.querySelector("a[data-ouvre-la-ligne]")
  const adresse = lien?.getAttribute("href")
  if (adresse) naviguer(adresse)
}

/** L'adresse de la recherche : les paramètres de la vue, puis `q` quand il n'est pas vide. */
function adresseDeRecherche({ chemin, parametres }: Recherche, q: string): string {
  const requete = new URLSearchParams(parametres.filter(([cle]) => cle !== "q"))
  if (q) requete.set("q", q)
  const texte = requete.toString()
  return texte ? `${chemin}?${texte}` : chemin
}

type Recherche = { chemin: string; parametres: [string, string][] }

type ListeDesConnecteursProps = {
  lignes: LigneDeConnecteur[]
  /** Les trois filtres, leur libellé avec leur compte, et leur adresse. */
  filtres: ChoixDuFiltre[]
  filtre: string
  q: string
  /** L'adresse de la recherche, sans `q`. */
  recherche: Recherche
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
}

export function ListeDesConnecteurs({ lignes, filtres, filtre, q, recherche, ici }: ListeDesConnecteursProps) {
  const { naviguer } = useHote()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltreSegmente libelle="Filtrer les connecteurs" choix={filtres} valeur={filtre} />
        <ListTools
          key={q}
          className="w-full sm:w-64"
          label={RECHERCHER}
          placeholder="Rechercher"
          defaultValue={q}
          icon={<AnimatedIcon as={MagnifyingGlass} anim="magnify" size="xs" />}
          onSearch={(valeur) => naviguer(adresseDeRecherche(recherche, valeur))}
        />
      </div>
      {/* `data-compacte` : en-têtes en casse normale, cartes sans étiquettes sur un téléphone ; `data-ligne-ouvrante` : la
          main sur toute la ligne (variantes opt-in de `table.css`). Le clic se délègue à l'enveloppe : le lien du nom reste
          la cible du clavier, la ligne n'en est pas une. */}
      <Table<LigneDeConnecteur>
        data-compacte=""
        data-ligne-ouvrante=""
        onClick={(evenement) => suivreLeLienDeLaLigne(evenement, naviguer)}
        caption="Connecteurs"
        columns={colonnes(ici)}
        rows={lignes}
        empty={q ? <RechercheSansReponse q={q} effacer={adresseDeRecherche(recherche, "")} /> : "Aucun connecteur dans cette vue."}
      />
    </div>
  )
}

/** Une recherche sans réponse : la phrase, où chercher, et le geste qui rend la liste. */
function RechercheSansReponse({ q, effacer }: { q: string; effacer: string }) {
  const { Lien } = useHote()
  return (
    <span className="flex flex-col items-center gap-1 py-4 text-center">
      <span className="font-semibold text-ink">{`Aucun connecteur ne correspond à « ${q} ».`}</span>
      <span className="oto-caption">
        Cherchez par nom, outil ou description.{" "}
        <Lien href={effacer} className={LIEN}>
          Effacer la recherche
        </Lien>
      </span>
    </span>
  )
}
