"use client"

// « Ajouter un connecteur » (écran Connecteurs) : le bouton, ou l'état vide de l'écran et son mur de logos, puis la
// fenêtre, en deux temps. D'abord le catalogue (`CatalogueDeLAjout`) ; puis la fiche de l'outil choisi : son logo, son
// nom et sa façon de se connecter, sa clé à saisir (`FormulaireDAjout`) ou sa connexion chez le tiers
// (`ConnexionParConsentement`), et ce que l'assistant pourra y faire. Un logo du mur ouvre directement la fiche de son
// outil. Au plafond d'outils de l'offre, lu par un administrateur, la fiche d'un outil que l'organisation n'utilise pas
// encore le dit avant la saisie. L'îlot ne reçoit que des données et du contenu déjà rendu ; la recherche et l'outil
// choisi sont un état de la fenêtre, perdu à sa fermeture.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { User } from "@phosphor-icons/react/dist/csr/User"
import { limitReached } from "../../../schemas"
import { Dialog } from "../../ds/react/dialog"
import { Icon, type Glyphe } from "../../ds/react/icon"
import { Alert, Button } from "../../ds/react/primitives"
import type { SujetsDeRegle } from "../../equipes/types"
import { useHote } from "../../hote/navigation"
import { lienDeLimite } from "../../limites/limite-atteinte"
import { CatalogueDeLAjout, type GouvernanceDesOutils } from "./catalogue-de-l-ajout"
import { cleDeLOutil, nomLibre, type OutilAAjouter } from "./catalogue-des-connecteurs"
import { ConnexionChezLeTiers } from "./connexion-chez-le-tiers"
import { FormulaireDAjout } from "./formulaire-d-ajout"
import { PlaceDuPied } from "./pied-de-la-fiche"
import { adresseDeLaVue } from "./lignes-des-connecteurs"
import { plafondDesOutils } from "./refus-des-connecteurs"
import { TuileDeLOutil } from "./tuile-de-l-outil"

const TITRE = "Ajouter un connecteur"

/** Les logos du mur de l'état vide : au-delà, « Voir les N outils ». */
const LOGOS_DU_MUR = 8

/** La façon de se connecter, sous le nom de l'outil : son glyphe et sa phrase. */
function facon(outil: OutilAAjouter): { glyphe: Glyphe; texte: string } {
  if (outil.facon === "consentement") return { glyphe: User, texte: outil.acces?.libelle ?? `Avec votre compte ${outil.libelle}, sans clé` }
  if (outil.facon === "branchement") return { glyphe: User, texte: outil.acces?.libelle ?? `Avec votre compte ${outil.libelle}` }
  if (outil.facon === "sans_cle") return { glyphe: Key, texte: "Aucune clé à saisir" }
  return { glyphe: Key, texte: outil.acces?.libelle ?? `Avec une clé d'API ${outil.libelle}` }
}

/** Le plafond d'outils de l'offre, lu par un administrateur, pour un outil que l'organisation n'utilise pas encore. */
function PlafondDesOutils({ outil, gouvernance }: { outil: OutilAAjouter; gouvernance: GouvernanceDesOutils | undefined }) {
  const outils = gouvernance?.limites?.connectors
  if (outil.actif || !outils || !limitReached(outils)) return null
  const lien = gouvernance?.limites?.raiseUrl
  return (
    <Alert
      tone="review"
      title={plafondDesOutils(outils.max, outil.libelle, true)}
      actions={
        lien ? (
          <a href={lienDeLimite(lien, "connectors_max")} className="oto-btn anim-host" data-variant="secondary" data-size="sm">
            <span>Relever la limite</span>
          </a>
        ) : undefined
      }
    />
  )
}

type OutilChoisiProps = {
  outil: OutilAAjouter
  equipes: { id: string; name: string }[]
  mesNoms: string[]
  ici: string
  gouvernance: GouvernanceDesOutils | undefined
  sujets: SujetsDeRegle
  moi: string
  retour: () => void
  apresAjout: (compte: { id: string }) => void
}

/** Le second temps, la fiche : le retour au catalogue, l'en-tête de l'outil (son titre prend le focus), puis sa connexion. */
function OutilChoisi({ outil, equipes, mesNoms, ici, gouvernance, sujets, moi, retour, apresAjout }: OutilChoisiProps) {
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titre.current?.focus()
  }, [])
  const { glyphe, texte } = facon(outil)
  const bloque = !outil.actif && limitReached(gouvernance?.limites?.connectors)
  const chezLeTiers = outil.facon === "consentement" || outil.facon === "branchement"
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" variant="ghost" size="sm" iconStart={<Icon as={CaretLeft} size="xs" />} onClick={retour}>
          Tous les outils
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <TuileDeLOutil nom={outil.libelle} logo={outil.logo} taille="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 ref={titre} tabIndex={-1} className="text-xl font-bold text-ink">
            {outil.libelle}
          </h3>
          <span className="oto-caption flex items-center gap-1.5">
            <Icon as={glyphe} size="xs" />
            {texte}
          </span>
        </div>
      </div>
      <PlafondDesOutils outil={outil} gouvernance={gouvernance} />
      {chezLeTiers ? (
        !bloque && <ConnexionChezLeTiers outil={outil} ici={ici} sujets={sujets} moi={moi} administre={gouvernance !== undefined} />
      ) : (
        <FormulaireDAjout
          outil={outil}
          equipes={equipes}
          nomPropose={nomLibre(outil.libelle, mesNoms, outil.miens.length + 1)}
          bloque={bloque}
          sujets={sujets}
          moi={moi}
          administre={gouvernance !== undefined}
          annuler={retour}
          apresAjout={apresAjout}
        />
      )}
    </div>
  )
}

/** Les logos de l'état vide : un par outil ouvert, les premiers du catalogue ; chacun ouvre la fiche de son outil. */
function Mur({ outils, ouvrir }: { outils: OutilAAjouter[]; ouvrir: (cle: string | null) => void }) {
  const ouverts = outils.filter((outil) => outil.bloquePar === null)
  const uns = ouverts.filter((outil, rang) => ouverts.findIndex((autre) => autre.connecteur === outil.connecteur) === rang)
  if (uns.length === 0) return null
  const tous = new Set(outils.map((outil) => outil.connecteur)).size
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-4">
      <ul aria-label="Quelques outils" className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
        {uns.slice(0, LOGOS_DU_MUR).map((outil) => (
          <li key={outil.connecteur}>
            <button
              type="button"
              className="flex w-full flex-col items-center gap-2 rounded-lg bg-island px-1.5 pb-2.5 pt-3.5 text-xs font-medium text-ink ring-1 ring-inset ring-hair hover:ring-island-bd focus-visible:ring-2 focus-visible:ring-ink"
              onClick={() => ouvrir(cleDeLOutil(outil))}
            >
              <TuileDeLOutil nom={outil.libelle} logo={outil.logo} />
              <span className="w-full truncate text-center">{outil.libelle}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="link" size="sm" onClick={() => ouvrir(null)}>
        {tous > 1 ? `Voir les ${tous} outils` : "Voir l'outil"}
      </Button>
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
  /** L'identifiant de qui regarde : « Bloqué par vous ». */
  moi: string
  /** Pour un administrateur : bloquer et débloquer les outils, le plafond d'outils de l'offre. */
  gouvernance?: GouvernanceDesOutils
  /** À qui partager dès l'ajout : les équipes et les personnes de l'organisation. */
  sujets: SujetsDeRegle
  /** L'état vide de l'écran, déjà rendu : le bouton et le mur de logos viennent avec lui ; absent, le bouton seul. */
  vide?: ReactNode
}

export function AjoutDUnConnecteur({ outils, equipes, mesNoms, ici, moi, gouvernance, sujets, vide }: AjoutDUnConnecteurProps) {
  const { naviguer } = useHote()
  const [ouvert, setOuvert] = useState(false)
  const [choisi, setChoisi] = useState<string | null>(null)
  const [revenu, setRevenu] = useState(false)
  const outil = outils.find((candidat) => cleDeLOutil(candidat) === choisi && candidat.bloquePar === null)
  const ouvrir = (cle: string | null) => {
    setChoisi(cle)
    setOuvert(true)
  }
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
  const bouton = (
    <Button type="button" variant="primary" onClick={() => ouvrir(null)}>
      {TITRE}
    </Button>
  )
  return (
    <>
      {vide ? (
        <div className="grid items-center gap-8 p-2 md:grid-cols-2 md:p-6">
          <div className="flex flex-col items-start gap-5">
            {vide}
            {bouton}
          </div>
          <Mur outils={outils} ouvrir={ouvrir} />
        </div>
      ) : (
        bouton
      )}
      {/* Montée à l'ouverture : fermée, ni le formulaire ni sa saisie ne restent dans le document. */}
      {ouvert && (
        <Dialog open onClose={fermer} title={TITRE} size="lg" footer={outil ? <PlaceDuPied /> : undefined}>
          {outil ? (
            // Une instance par outil : la saisie d'un outil ne passe jamais à un autre.
            <OutilChoisi key={cleDeLOutil(outil)} outil={outil} equipes={equipes} mesNoms={mesNoms} ici={ici} gouvernance={gouvernance} sujets={sujets} moi={moi} retour={retour} apresAjout={ouvrirLeDetail} />
          ) : (
            <CatalogueDeLAjout outils={outils} choisir={setChoisi} auRetour={revenu} moi={moi} gouvernance={gouvernance} />
          )}
        </Dialog>
      )}
    </>
  )
}
