"use client"

// « Ajouter un connecteur » (écran Connecteurs) : le bouton et sa fenêtre, en deux temps. D'abord le catalogue : les
// outils que la personne peut ajouter (`catalogue-des-connecteurs.ts`), cherchés par leur nom, un outil fermé par un
// administrateur dit sans geste. Puis l'outil choisi : sa clé à saisir (`FormulaireDAjout`), ou sa connexion chez le
// tiers (`ConnexionParConsentement`). Une carte ne dit jamais comment l'outil se connecte. L'îlot ne reçoit que des
// données ; la recherche et l'outil choisi sont un état de la fenêtre, perdu à sa fermeture.
import { useEffect, useRef, useState } from "react"
import { Dialog } from "../../ds/react/dialog"
import { Input } from "../../ds/react/forms"
import { Avatar, Button } from "../../ds/react/primitives"
import { useHote } from "../../hote/navigation"
import { nomLibre, outilsCherches, type OutilAAjouter } from "./catalogue-des-connecteurs"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { FormulaireDAjout } from "./formulaire-d-ajout"
import { adresseDeLaVue, SEUIL_DE_RECHERCHE } from "./lignes-des-connecteurs"

const TITRE = "Ajouter un connecteur"
const RECHERCHER = "Rechercher un outil"

function Carte({ outil, choisir }: { outil: OutilAAjouter; choisir: (connecteur: string) => void }) {
  if (outil.ferme) {
    return (
      <li className="flex items-center gap-3 px-3 py-2 text-mute">
        <Avatar name={outil.libelle} size="sm" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span>{outil.libelle}</span>
          <span className="oto-caption">Fermé par un administrateur</span>
        </span>
      </li>
    )
  }
  return (
    <li>
      <Button type="button" variant="secondary" block onClick={() => choisir(outil.connecteur)}>
        <Avatar name={outil.libelle} size="sm" aria-hidden="true" />
        {outil.libelle}
      </Button>
    </li>
  )
}

/** Le premier temps : la recherche au-delà de quelques outils, puis les cartes. `auRetour` : le focus va à son titre. */
function Catalogue({ outils, choisir, auRetour }: { outils: OutilAAjouter[]; choisir: (connecteur: string) => void; auRetour: boolean }) {
  const [q, setQ] = useState("")
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (auRetour) titre.current?.focus()
  }, [auRetour])
  const trouves = outilsCherches(outils, q)
  return (
    <div className="flex flex-col gap-3">
      <h3 ref={titre} tabIndex={-1} className="oto-label">
        Choisir un outil
      </h3>
      {outils.length > SEUIL_DE_RECHERCHE && <Input type="search" aria-label={RECHERCHER} placeholder={RECHERCHER} value={q} onChange={(evenement) => setQ(evenement.target.value)} />}
      {outils.length === 0 && <p>Aucun outil à ajouter pour l&apos;instant. Un administrateur peut ajouter un connecteur et le partager avec vous.</p>}
      {/* Montée d'emblée : une recherche sans réponse s'y annonce. */}
      <p role="status">{outils.length > 0 && trouves.length === 0 ? "Aucun outil ne correspond." : ""}</p>
      {trouves.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {trouves.map((outil) => (
            <Carte key={outil.connecteur} outil={outil} choisir={choisir} />
          ))}
        </ul>
      )}
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

/** Le second temps : l'outil choisi, son titre (qui prend le focus) et sa façon de se connecter. */
function OutilChoisi({ outil, equipes, mesNoms, ici, retour, apresAjout }: OutilChoisiProps) {
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titre.current?.focus()
  }, [])
  const chezLeTiers = outil.facon === "consentement" || outil.facon === "branchement"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={retour}>
          Tous les outils
        </Button>
      </div>
      <h3 ref={titre} tabIndex={-1} className="flex items-center gap-2 font-medium text-ink">
        <Avatar name={outil.libelle} size="sm" aria-hidden="true" />
        {outil.libelle}
      </h3>
      {chezLeTiers ? (
        <>
          <p className="text-sm text-ink">{`Aucune clé à saisir : vous vous connectez chez ${outil.libelle}, puis vous revenez ici.`}</p>
          <div>
            <ConnexionParConsentement
              ressource={outil.facon === "branchement" ? "hosted-link" : "connector-consent"}
              connecteur={outil.connecteur}
              libelle={outil.facon === "branchement" ? `Relier mon compte ${outil.libelle}` : `Connecter mon compte ${outil.libelle}`}
              retour={ici}
            />
          </div>
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
  /** Les équipes de l'organisation, pour qui administre. */
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
  const outil = outils.find((candidat) => candidat.connecteur === choisi)
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
        <Dialog open onClose={fermer} title={TITRE} size="md">
          {outil ? (
            // Une instance par outil : la saisie d'un outil ne passe jamais à un autre.
            <OutilChoisi key={outil.connecteur} outil={outil} equipes={equipes} mesNoms={mesNoms} ici={ici} retour={retour} apresAjout={ouvrirLeDetail} />
          ) : (
            <Catalogue outils={outils} choisir={setChoisi} auRetour={revenu} />
          )}
        </Dialog>
      )}
    </>
  )
}
