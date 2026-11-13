"use client"

// La liste de l'écran Connecteurs : les filtres en pastilles avec leur compte, la recherche, puis le tableau du design
// system, une ligne par compte que la personne voit. L'îlot ne reçoit que des données : les lignes, leurs textes et leurs
// adresses sont calculés par l'écran (`lignes-des-connecteurs.ts`), le filtre et la recherche vivent dans l'adresse de
// l'hôte (`useHote().naviguer`), le détail s'ouvre par un lien. L'état se lit par son mot, le point ne fait que
// l'accompagner. Sur le modèle de `journal/tableau-des-conversations.tsx` et d'`equipes/outils-des-personnes.tsx`.
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { AnimatedIcon } from "../../ds/react/icon"
import { ListTools } from "../../ds/react/list-tools"
import { Avatar } from "../../ds/react/primitives"
import { Table, type Column } from "../../ds/react/table"
import { useHote } from "../../hote/navigation"
import { FiltreSegmente, type ChoixDuFiltre } from "../filtre-segmente"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import type { LigneDeConnecteur } from "./lignes-des-connecteurs"

const RECHERCHER = "Rechercher un connecteur"

function Connecteur({ ligne }: { ligne: LigneDeConnecteur }) {
  const { Lien } = useHote()
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={ligne.outil} size="sm" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <Lien href={ligne.ouverture} className={`font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ink ${ligne.desactive ? "text-mute" : "text-ink"}`}>
          {ligne.libelle}
        </Lien>
        <span className="oto-caption">{ligne.outil}</span>
      </span>
    </span>
  )
}

function Acces({ ligne }: { ligne: LigneDeConnecteur }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{ligne.acces}</span>
      <span className="oto-caption">{ligne.niveau}</span>
    </span>
  )
}

/** Le mot de l'état, toujours écrit ; le point, décoratif, le souligne. */
function Etat({ ligne }: { ligne: LigneDeConnecteur }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-2">
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
    return <ConnexionParConsentement ressource={ligne.geste.ressource} connecteur={ligne.geste.connecteur} libelle={ligne.geste.libelle} nomAccessible={`${ligne.geste.libelle} ${ligne.libelle}`} retour={retour} />
  }
  return (
    <Lien href={ligne.ouverture} className="oto-btn anim-host" data-variant="secondary" data-size="sm">
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
  /** L'adresse de la recherche, sans `q` ; `null` : la liste est assez courte pour s'en passer. */
  recherche: Recherche | null
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
}

export function ListeDesConnecteurs({ lignes, filtres, filtre, q, recherche, ici }: ListeDesConnecteursProps) {
  const { naviguer } = useHote()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <FiltreSegmente libelle="Filtrer les connecteurs" choix={filtres} valeur={filtre} />
        {recherche && (
          <ListTools
            key={q}
            className="min-w-0 flex-1"
            label={RECHERCHER}
            placeholder={RECHERCHER}
            defaultValue={q}
            icon={<AnimatedIcon as={MagnifyingGlass} anim="magnify" size="xs" />}
            onSearch={(valeur) => naviguer(adresseDeRecherche(recherche, valeur))}
          />
        )}
      </div>
      <Table<LigneDeConnecteur>
        caption="Connecteurs"
        columns={colonnes(ici)}
        rows={lignes}
        empty={q ? `Aucun connecteur ne correspond à « ${q} ».` : "Aucun connecteur dans cette vue."}
      />
    </div>
  )
}
