"use client"

// La fiche d'un outil connecté chez le tiers (consentement, compte rattaché), dans « Ajouter un connecteur » : ce que
// l'assistant pourra faire, « Qui pourra s'en servir » (le connecteur est à vous ; on le partage dès maintenant), puis
// le bouton qui part chez le tiers, dans le pied de la fenêtre. Un partage choisi passe par la confirmation du premier
// partage (l'autre agira par votre compte, en votre nom), puis est gardé dans l'onglet et posé au retour
// (`partage-au-retour.tsx`). Module à part : la fenêtre d'ajout dépassait sa taille.
import { useState } from "react"
import type { SujetsDeRegle } from "../../equipes/types"
import { nomDuCandidat } from "../../noeud/champ-d-ajout-d-acces"
import type { OutilAAjouter } from "./catalogue-des-connecteurs"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { FonctionsDuConnecteur } from "./fonctions-du-connecteur"
import { actionsParClasse, nomDe } from "./libelles-des-partages"
import { PartageALAjout, SANS_PARTAGE, type PartageDeLAjout } from "./partage-a-l-ajout"
import { garderLePartage, oublierLePartage, stockageDisponible } from "./partage-au-retour"
import { PiedDeLaFiche } from "./pied-de-la-fiche"
import { PremierPartage, type Accord } from "./premier-partage"


/** À qui le partage choisi s'adresse, en un nom : « Nadia Roux », « Nadia Roux et 2 autres ». */
function destinataires(partage: PartageDeLAjout): string {
  const noms = [...(partage.general ? ["toute l'organisation"] : []), ...partage.regles.map(({ sujet }) => nomDuCandidat(sujet))]
  return noms.length > 1 ? `${noms[0]} et ${noms.length - 1} ${noms.length > 2 ? "autres" : "autre"}` : (noms[0] ?? "")
}

type ConnexionChezLeTiersProps = { outil: OutilAAjouter; ici: string; sujets: SujetsDeRegle; moi: string; administre: boolean }

export function ConnexionChezLeTiers({ outil, ici, sujets, moi, administre }: ConnexionChezLeTiersProps) {
  const [partage, setPartage] = useState<PartageDeLAjout>(SANS_PARTAGE)
  const [question, setQuestion] = useState<Accord | null>(null)
  const partageChoisi = partage.general !== null || partage.regles.length > 0

  /** Avant de partir : l'accord du premier partage, puis le partage gardé pour le retour ; sans partage, on part. */
  async function avantDePartir(): Promise<boolean> {
    if (!partageChoisi) return true
    // Un seul niveau se nomme ; des niveaux différents se disent « aux niveaux choisis ».
    const niveaux = new Set([...partage.regles.map(({ niveau }) => niveau), ...(partage.general ? [partage.general] : [])])
    const niveau = niveaux.size === 1 ? [...niveaux][0] : null
    const oui = await new Promise<boolean>((resoudre) =>
      setQuestion({
        nom: destinataires(partage),
        niveau,
        repondre: (reponse) => {
          setQuestion(null)
          resoudre(reponse)
        },
      }),
    )
    // Un onglet qui ne garde rien laisse partir quand même : le retour dira de le partager.
    if (oui) garderLePartage({ connecteur: outil.connecteur, outil: outil.libelle, partage, avant: outil.mesComptes })
    return oui
  }

  return (
    <>
      <PartageALAjout
        partage={partage}
        changer={setPartage}
        proprietaires={[{ valeur: "user", libelle: nomDe(sujets, moi) }]}
        proprietaire="user"
        choisirProprietaire={() => undefined}
        sujets={sujets}
        actions={outil.fonctions.length > 0 ? actionsParClasse(outil.fonctions) : null}
        administre={administre}
        moi={moi}
        parAutorisation
      />
      {partageChoisi && !stockageDisponible() && <p className="oto-caption">Ce navigateur ne gardera pas ce partage pendant la connexion : vous le poserez au retour, dans le détail.</p>}
      <FonctionsDuConnecteur titre="Ce que votre assistant pourra faire" fonctions={outil.fonctions} />
      <p className="oto-caption min-w-0">{`Vous autorisez chez ${outil.libelle}, puis vous revenez ici. Le connecteur reste à vous, à votre nom.`}</p>
      <PiedDeLaFiche>
        <ConnexionParConsentement
          ressource={outil.facon === "branchement" ? "hosted-link" : "connector-consent"}
          connecteur={outil.connecteur}
          acces={outil.acces?.nom}
          libelle={outil.facon === "branchement" ? `Relier mon compte ${outil.libelle}` : `Connecter mon compte ${outil.libelle}`}
          retour={ici}
          avantDePartir={avantDePartir}
          apresUnEchec={oublierLePartage}
          variante="primary"
        />
      </PiedDeLaFiche>
      {question && <PremierPartage libelle={outil.libelle} accord={question} />}
    </>
  )
}
