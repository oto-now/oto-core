"use client"

// « Ajouter un connecteur » (écran Connecteurs) : le bouton, ou l'état vide de l'écran et son mur de logos, puis la
// fenêtre, en deux temps. D'abord le catalogue (`CatalogueDeLAjout`) ; puis la fiche de l'outil choisi : son logo, son
// nom et sa façon de se connecter, choisie en cartes radio pour un outil qui se connecte de plusieurs façons, sa clé à
// saisir (`FormulaireDAjout`) ou sa connexion chez le tiers (`ConnexionParConsentement`), et ce que l'assistant pourra
// y faire. Un logo du mur ouvre directement la fiche de son
// outil. Au plafond d'outils de l'offre, lu par un administrateur, la fiche d'un outil que l'organisation n'utilise pas
// encore le dit avant la saisie. L'îlot ne reçoit que des données et du contenu déjà rendu ; la recherche et l'outil
// choisi sont un état de la fenêtre, perdu à sa fermeture.
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ArrowsSplit } from "@phosphor-icons/react/dist/csr/ArrowsSplit"
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { User } from "@phosphor-icons/react/dist/csr/User"
import { Dialog } from "../../ds/react/dialog"
import { Icon, type Glyphe } from "../../ds/react/icon"
import { Alert, Button } from "../../ds/react/primitives"
import { Radio, RadioGroup } from "../../ds/react/radio"
import type { SujetsDeRegle } from "../../equipes/types"
import { useHote } from "../../hote/navigation"
import { DeblocageDeLOutil } from "./blocage-de-l-outil"
import { ANCRE_DU_CATALOGUE, CatalogueDeLAjout, type GouvernanceDesOutils } from "./catalogue-de-l-ajout"
import type { CompteExistant, FaconDeLOutil, Nommage, OutilAAjouter } from "./catalogue-des-connecteurs"
import { ConnexionChezLeTiers } from "./connexion-chez-le-tiers"
import { FormulaireDAjout } from "./formulaire-d-ajout"
import { PlaceDuPied } from "./pied-de-la-fiche"
import { adresseDeLaVue } from "./lignes-des-connecteurs"
import { TuileDeLOutil } from "./tuile-de-l-outil"

const TITRE = "Ajouter un connecteur"

/** Les logos du mur de l'état vide : au-delà, « Voir les N outils ». */
const LOGOS_DU_MUR = 8

const NOMBRES: Readonly<Record<number, string>> = { 2: "Deux", 3: "Trois" }

/** « Deux façons de se connecter », « Trois façons de se connecter », au-delà « 4 façons de se connecter ». */
const nombreDeFacons = (nombre: number) => `${NOMBRES[nombre] ?? nombre} façons de se connecter`

/** Le glyphe d'une façon : la personne chez le tiers, la clé sinon. */
const glypheDe = (facon: OutilAAjouter["facon"]): Glyphe => (facon === "consentement" || facon === "branchement" ? User : Key)

/** La façon de se connecter, sous le nom de l'outil : son glyphe et sa phrase ; plusieurs ouvertes, leur nombre. */
function facon(outil: OutilAAjouter): { glyphe: Glyphe; texte: string } {
  const facons = outil.facons ?? []
  if (facons.length > 1) return { glyphe: ArrowsSplit, texte: nombreDeFacons(facons.length) }
  if (facons[0]) return { glyphe: glypheDe(facons[0].facon), texte: facons[0].phrase }
  if (outil.facon === "consentement") return { glyphe: User, texte: `Avec votre compte ${outil.libelle}, sans clé` }
  if (outil.facon === "branchement") return { glyphe: User, texte: `Avec votre compte ${outil.libelle}` }
  if (outil.facon === "sans_cle") return { glyphe: Key, texte: "Aucune clé à saisir" }
  return { glyphe: Key, texte: `Avec une clé d'API ${outil.libelle}` }
}

type ChoixDeLaFaconProps = { facons: FaconDeLOutil[]; choisie: string; choisir: (acces: string) => void; enEnvoi: boolean }

/**
 * Le choix de la façon, en cartes radio : une par façon ouverte, soi d'abord ; deux côte à côte à partir de `sm`, trois
 * ou plus l'une sous l'autre, empilées sur un téléphone.
 */
function ChoixDeLaFacon({ facons, choisie, choisir, enEnvoi }: ChoixDeLaFaconProps) {
  const nom = useId()
  const deux = facons.length === 2
  return (
    // Fermé pendant l'envoi : une création ou un départ chez le tiers en cours ne change pas de façon en chemin.
    <RadioGroup legend={<span className="text-base font-bold text-ink">Choisissez votre façon</span>} variant="cards" orientation={deux ? "horizontal" : "vertical"} disabled={enEnvoi}>
      {facons.map((une) => (
        <Radio
          key={une.acces.nom}
          name={nom}
          value={une.acces.nom}
          checked={une.acces.nom === choisie}
          onChange={() => {
            if (!enEnvoi) choisir(une.acces.nom)
          }}
          className={deux ? "w-full sm:w-auto sm:flex-1" : undefined}
          label={
            <span className="flex min-h-6 items-center gap-2">
              <Icon as={glypheDe(une.facon)} size="sm" />
              {une.phrase}
            </span>
          }
        />
      ))}
    </RadioGroup>
  )
}

/**
 * Un outil payé par la clé de l'application, qu'aucun administrateur n'a encore adopté : rien ne s'ajoute avant. Un
 * administrateur l'adopte ici ; un membre lit à qui demander. Aucun plafond d'outils : leur nombre n'est plus limité.
 */
function AAdopter({ outil, gouvernance }: { outil: OutilAAjouter; gouvernance: GouvernanceDesOutils | undefined }) {
  if (!outil.aAdopter) return null
  return (
    <Alert
      tone="review"
      title={`${outil.libelle} est payé par la clé de l'application : un administrateur l'adopte avant tout ajout.`}
      actions={gouvernance ? <DeblocageDeLOutil connecteur={outil.connecteur} outil={outil.libelle} adopter ancre={ANCRE_DU_CATALOGUE} /> : undefined}
    >
      {gouvernance ? undefined : "Demandez à un administrateur de l'adopter."}
    </Alert>
  )
}

type OutilChoisiProps = {
  outil: OutilAAjouter
  equipes: { id: string; name: string }[]
  nommage: Nommage
  ici: string
  gouvernance: GouvernanceDesOutils | undefined
  sujets: SujetsDeRegle
  moi: string
  retour: () => void
  apresAjout: (compte: { id: string }) => void
}

/**
 * Le second temps, la fiche : le retour au catalogue, l'en-tête de l'outil (son titre prend le focus), le choix de la
 * façon pour un outil qui se connecte de plusieurs façons, puis la connexion de la façon choisie.
 */
function OutilChoisi({ outil: lOutil, equipes, nommage, ici, gouvernance, sujets, moi, retour, apresAjout }: OutilChoisiProps) {
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titre.current?.focus()
  }, [])
  const [choisie, setChoisie] = useState(lOutil.facons?.[0]?.acces.nom)
  const [enEnvoi, setEnEnvoi] = useState(false)
  const retenue = lOutil.facons?.find((une) => une.acces.nom === choisie)
  // La façon choisie remplace l'accès, la façon, les propriétaires et le formulaire de l'outil.
  const outil: OutilAAjouter = retenue ? { ...lOutil, ...retenue } : lOutil
  const { glyphe, texte } = facon(lOutil)
  const bloque = outil.aAdopter
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
      <AAdopter outil={outil} gouvernance={gouvernance} />
      {!bloque && retenue && lOutil.facons && lOutil.facons.length > 1 && <ChoixDeLaFacon facons={lOutil.facons} choisie={retenue.acces.nom} choisir={setChoisie} enEnvoi={enEnvoi} />}
      {/* Une instance par façon : une clé saisie, un essai ou un partage choisis pour une façon ne partent jamais par une autre. */}
      <Fragment key={outil.acces?.nom}>
        {/* À adopter, rien ne s'ajoute, quelle que soit la façon : ce que l'outil ferait, et « Annuler ». */}
        {chezLeTiers && !bloque ? (
          <ConnexionChezLeTiers outil={outil} ici={ici} sujets={sujets} moi={moi} administre={gouvernance !== undefined} annuler={retour} signalerLEnvoi={setEnEnvoi} />
        ) : (
          <FormulaireDAjout
            outil={outil}
            equipes={equipes}
            nomPropose={outil.libelle}
            nommage={nommage}
            bloque={bloque}
            sujets={sujets}
            moi={moi}
            administre={gouvernance !== undefined}
            annuler={retour}
            apresAjout={apresAjout}
            signalerLEnvoi={setEnEnvoi}
          />
        )}
      </Fragment>
    </div>
  )
}

/** Les logos de l'état vide : un par outil ouvert, les premiers du catalogue ; chacun ouvre la fiche de son outil. */
function Mur({ outils, ouvrir }: { outils: OutilAAjouter[]; ouvrir: (cle: string | null) => void }) {
  const uns = outils.filter((outil) => outil.bloquePar === null)
  if (uns.length === 0) return null
  const tous = outils.length
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-4">
      <ul aria-label="Quelques outils" className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
        {uns.slice(0, LOGOS_DU_MUR).map((outil) => (
          <li key={outil.connecteur}>
            <button
              type="button"
              className="flex w-full flex-col items-center gap-2 rounded-lg bg-island px-1.5 pb-2.5 pt-3.5 text-xs font-medium text-ink ring-1 ring-inset ring-hair hover:ring-island-bd focus-visible:ring-2 focus-visible:ring-ink"
              onClick={() => ouvrir(outil.connecteur)}
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
  /** Les connecteurs que la personne voit, par propriétaire : le nom proposé n'en reprend aucun, et compte ceux de l'outil. */
  comptes: CompteExistant[]
  /** Le nom de l'organisation, pour le nom proposé d'un connecteur d'organisation ; `null` : non lu. */
  organisation: string | null
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

export function AjoutDUnConnecteur({ outils, equipes, comptes, organisation, ici, moi, gouvernance, sujets, vide }: AjoutDUnConnecteurProps) {
  const { naviguer } = useHote()
  // Le prénom, le premier mot du nom dans l'annuaire : « Pennylane de Nadia ».
  const prenom = sujets.personnes.find((personne) => personne.id === moi)?.nom.split(" ")[0] ?? null
  const nommage: Nommage = { comptes, prenom, organisation }
  const [ouvert, setOuvert] = useState(false)
  const [choisi, setChoisi] = useState<string | null>(null)
  const [revenu, setRevenu] = useState(false)
  const outil = outils.find((candidat) => candidat.connecteur === choisi && candidat.bloquePar === null)
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
            <OutilChoisi key={outil.connecteur} outil={outil} equipes={equipes} nommage={nommage} ici={ici} gouvernance={gouvernance} sujets={sujets} moi={moi} retour={retour} apresAjout={ouvrirLeDetail} />
          ) : (
            <CatalogueDeLAjout outils={outils} choisir={setChoisi} auRetour={revenu} moi={moi} gouvernance={gouvernance} />
          )}
        </Dialog>
      )}
    </>
  )
}
