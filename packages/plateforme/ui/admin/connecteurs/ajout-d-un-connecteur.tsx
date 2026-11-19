"use client"

// « Ajouter un connecteur » (écran Connecteurs) : le bouton et sa fenêtre, en deux temps. D'abord le catalogue : une
// recherche, puis une carte par outil que la personne peut ajouter (`catalogue-des-connecteurs.ts`), un outil fermé par
// un administrateur dit sans geste. Puis l'outil choisi : sa clé à saisir (`FormulaireDAjout`), ou sa connexion chez le
// tiers (`ConnexionParConsentement`). Une carte ne dit jamais comment l'outil se connecte, sauf celle d'un connecteur
// à plusieurs accès, une par accès, qui porte le libellé de son accès sous le nom de l'outil. L'îlot ne reçoit que des
// données ; la recherche et l'outil choisi sont un état de la fenêtre, perdu à sa fermeture.
import { useEffect, useRef, useState } from "react"
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { Dialog } from "../../ds/react/dialog"
import { Icon } from "../../ds/react/icon"
import { InputAffix } from "../../ds/react/input-affix"
import { Button } from "../../ds/react/primitives"
import { useHote } from "../../hote/navigation"
import { cleDeLOutil, nomLibre, outilsCherches, type OutilAAjouter } from "./catalogue-des-connecteurs"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { FormulaireDAjout } from "./formulaire-d-ajout"
import { adresseDeLaVue } from "./lignes-des-connecteurs"
import { TuileDeLOutil } from "./tuile-de-l-outil"

const TITRE = "Ajouter un connecteur"
const RECHERCHER = "Rechercher un outil"
const CARTE = "flex w-full items-center gap-3 rounded-lg p-4 text-left ring-1 ring-inset ring-hair"

function Carte({ outil, choisir }: { outil: OutilAAjouter; choisir: (cle: string) => void }) {
  if (outil.ferme) {
    return (
      <li className={`${CARTE} text-mute`}>
        <TuileDeLOutil nom={outil.libelle} />
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{outil.acces ? `${outil.libelle} — ${outil.acces.libelle}` : outil.libelle}</span>
          <span className="oto-caption">Fermé par un administrateur</span>
        </span>
      </li>
    )
  }
  return (
    <li>
      <button type="button" className={`${CARTE} cursor-pointer font-semibold text-ink hover:bg-desk focus-visible:ring-2 focus-visible:ring-ink`} onClick={() => choisir(cleDeLOutil(outil))}>
        <TuileDeLOutil nom={outil.libelle} />
        {outil.acces ? (
          <span className="flex min-w-0 flex-col">
            <span>{outil.libelle}</span>
            <span className="oto-caption">{outil.acces.libelle}</span>
          </span>
        ) : (
          outil.libelle
        )}
      </button>
    </li>
  )
}

/** Le premier temps : la recherche, puis les cartes. `auRetour` : le focus va à son titre. */
function Catalogue({ outils, choisir, auRetour }: { outils: OutilAAjouter[]; choisir: (cle: string) => void; auRetour: boolean }) {
  const [q, setQ] = useState("")
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (auRetour) titre.current?.focus()
  }, [auRetour])
  const trouves = outilsCherches(outils, q)
  return (
    <div className="flex flex-col gap-4">
      <h3 ref={titre} tabIndex={-1} className="oto-sr-only">
        Choisir un outil
      </h3>
      {outils.length > 0 && (
        <InputAffix
          type="search"
          aria-label={RECHERCHER}
          placeholder={RECHERCHER}
          start={<Icon as={MagnifyingGlass} size="sm" />}
          value={q}
          onChange={(evenement) => setQ(evenement.target.value)}
        />
      )}
      {outils.length === 0 && <p>Aucun outil à ajouter pour l&apos;instant. Un administrateur peut ajouter un connecteur et le partager avec vous.</p>}
      {/* Montée d'emblée : une recherche sans réponse s'y annonce. */}
      <p role="status">{outils.length > 0 && trouves.length === 0 ? "Aucun outil ne correspond." : ""}</p>
      {trouves.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trouves.map((outil) => (
            <Carte key={cleDeLOutil(outil)} outil={outil} choisir={choisir} />
          ))}
        </ul>
      )}
      <hr className="oto-separator" data-orientation="horizontal" />
      <p className="oto-caption">Ces connecteurs servent votre assistant à travers Oto, dans toutes vos conversations. Ils n&apos;apparaissent pas dans les réglages de votre assistant.</p>
    </div>
  )
}

type OutilChoisiProps = {
  outil: OutilAAjouter
  equipes: { id: string; name: string }[]
  mesNoms: string[]
  ici: string
  retour: () => void
  apresAjout: (compte: { id: string }) => void
}

/** Le second temps : le retour au catalogue, l'outil choisi (son titre prend le focus) et sa façon de se connecter. */
function OutilChoisi({ outil, equipes, mesNoms, ici, retour, apresAjout }: OutilChoisiProps) {
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titre.current?.focus()
  }, [])
  const chezLeTiers = outil.facon === "consentement" || outil.facon === "branchement"
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" variant="ghost" size="sm" iconStart={<Icon as={CaretLeft} size="xs" />} onClick={retour}>
          Tous les outils
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <TuileDeLOutil nom={outil.libelle} taille="lg" />
        <h3 ref={titre} tabIndex={-1} className="text-lg font-semibold text-ink">
          {outil.libelle}
        </h3>
      </div>
      {outil.acces && <p className="oto-caption">{outil.acces.libelle}</p>}
      {chezLeTiers ? (
        <>
          <p className="text-sm text-ink">{`Aucune clé à saisir : vous vous connectez chez ${outil.libelle}, puis vous revenez ici.`}</p>
          <div>
            <ConnexionParConsentement
              ressource={outil.facon === "branchement" ? "hosted-link" : "connector-consent"}
              connecteur={outil.connecteur}
              acces={outil.acces?.nom}
              libelle={outil.facon === "branchement" ? `Relier mon compte ${outil.libelle}` : `Connecter mon compte ${outil.libelle}`}
              retour={ici}
            />
          </div>
          <hr className="oto-separator" data-orientation="horizontal" />
          <p className="oto-caption">Privé : vous seul pourrez l&apos;utiliser. Vous le partagerez ensuite si vous voulez.</p>
        </>
      ) : (
        <FormulaireDAjout outil={outil} equipes={equipes} nomPropose={nomLibre(outil.libelle, mesNoms)} annuler={retour} apresAjout={apresAjout} />
      )}
    </div>
  )
}

type AjoutDUnConnecteurProps = {
  /** Les outils que la personne peut ajouter (`outilsAAjouter`). */
  outils: OutilAAjouter[]
  /** Les équipes pour lesquelles la personne peut ajouter un connecteur. */
  equipes: { id: string; name: string }[]
  /** Les noms des connecteurs personnels de la personne : le nom proposé n'en reprend aucun. */
  mesNoms: string[]
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
}

export function AjoutDUnConnecteur({ outils, equipes, mesNoms, ici }: AjoutDUnConnecteurProps) {
  const { naviguer } = useHote()
  const [ouvert, setOuvert] = useState(false)
  const [choisi, setChoisi] = useState<string | null>(null)
  const [revenu, setRevenu] = useState(false)
  const outil = outils.find((candidat) => cleDeLOutil(candidat) === choisi)
  const fermer = () => {
    setOuvert(false)
    setChoisi(null)
    setRevenu(false)
  }
  // Un compte créé : la fenêtre se ferme, la liste le montre et son détail s'ouvre.
  const ouvrirLeDetail = (compte: { id: string }) => {
    fermer()
    naviguer(adresseDeLaVue(ici, { filtre: "all", q: "", compte: compte.id }))
  }
  const retour = () => {
    setChoisi(null)
    setRevenu(true)
  }
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOuvert(true)}>
        {TITRE}
      </Button>
      {/* Montée à l'ouverture : fermée, ni le formulaire ni sa saisie ne restent dans le document. */}
      {ouvert && (
        <Dialog open onClose={fermer} title={TITRE} size="lg">
          {outil ? (
            // Une instance par outil : la saisie d'un outil ne passe jamais à un autre.
            <OutilChoisi key={cleDeLOutil(outil)} outil={outil} equipes={equipes} mesNoms={mesNoms} ici={ici} retour={retour} apresAjout={ouvrirLeDetail} />
          ) : (
            <Catalogue outils={outils} choisir={setChoisi} auRetour={revenu} />
          )}
        </Dialog>
      )}
    </>
  )
}
