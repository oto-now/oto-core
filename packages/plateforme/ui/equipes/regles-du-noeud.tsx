// Le panneau des règles d'un nœud (E05-S03, AC16, AC17) : son propriétaire effectif, la règle qui
// s'applique sans règle posée, le niveau de qui regarde, ses règles. Server Component, réutilisé par
// la page de nœud d'E05-S02 ; la pose d'une règle est un îlot client, son retrait un geste confirmé.
// Il reçoit la donnée lue : l'hôte qui le monte dit lui-même l'échec de la lecture, avec « Réessayer ».
//
// Porté d'oto-frontend (`components/noeud/acces-du-noeud.tsx`, `AccessPanel` du DS). Repris : « qui
// peut modifier / lire », devenu le tableau des règles par niveau ; « vous pouvez modifier / lecture
// seule », devenu « Votre niveau ». Retiré : le lien de lecture public (hors organisation, H72), le
// périmètre de projet (ADR-003), le popover, les avatars. Depuis E05-S09 (partie d1), le tableau et
// les faits sur les classes du design system porté.
import { ACCESS_LEVEL_NAMES, type NodeRulesView } from "../../schemas"
import { ActionPlateforme } from "../components/action-plateforme"
import { AjoutDeRegle } from "./ajout-de-regle"
import { NIVEAUX, proprietaire, REGLE_PAR_DEFAUT } from "./libelles"
import { TableauFixe } from "./tableau-fixe"
import { TitreDuPanneau } from "./titre-du-panneau"
import type { SujetsDeRegle } from "./types"

const NOEUD_INTROUVABLE = "Ce nœud n'existe pas ou ne vous est pas partagé."

/**
 * L'ancre du panneau, qui reçoit le focus quand une règle part (la dernière comprise), ou le
 * formulaire : son titre, ou l'alerte qui le remplace quand la règle posée ou retirée ôte aussi la
 * lecture. Une valeur fixe : l'alerte ne connaît pas le chemin, et une page ne monte qu'un panneau (M13a).
 */
const ANCRE_DU_PANNEAU = "regles-du-noeud"
const TITRE_DES_REGLES = "regles-du-noeud-liste"

type ReglesDuNoeudProps = {
  /** `null` : chemin inconnu, invisible ou mal formé — une seule phrase pour les trois (H68). */
  noeud: NodeRulesView | null
  sujets: SujetsDeRegle
  /** La gestion ne s'accorde que par un administrateur (N6) : sans lui, ce niveau n'est pas proposé. */
  gestionAccordable: boolean
}

function lignesDesRegles(noeud: NodeRulesView) {
  const gere = noeud.viewerLevel === 3
  return noeud.rules.map((regle) => {
    const equipe = regle.subject.kind === "team"
    const sujet = `${equipe ? "équipe" : "personne"} ${regle.subject.name}`
    const deSujet = equipe ? `de l'équipe ${regle.subject.name}` : `de ${regle.subject.name}`
    const retrait = (
      <ActionPlateforme
        libelle="Retirer"
        nomAccessible={`Retirer (${sujet})`}
        requete={{ methode: "DELETE", ressource: `rules/${regle.id}` }}
        confirmation={{ question: `Retirer la règle ${deSujet} sur ${noeud.path} ?`, libelleConfirmer: "Retirer la règle" }}
        ancre={ANCRE_DU_PANNEAU}
        taille="sm"
      />
    )
    return { cle: regle.id, cellules: gere ? [sujet, NIVEAUX[regle.level], retrait] : [sujet, NIVEAUX[regle.level]] }
  })
}

function Regles({ noeud }: { noeud: NodeRulesView }) {
  if (noeud.rules.length === 0) return <p>Aucune règle sur ce nœud : la règle par défaut s&apos;applique.</p>
  return (
    <>
      <p id={TITRE_DES_REGLES} className="oto-label">{`Règles de ${noeud.path}`}</p>
      <TableauFixe nommePar={TITRE_DES_REGLES} entetes={noeud.viewerLevel === 3 ? ["Sujet", "Niveau", "Action"] : ["Sujet", "Niveau"]} lignes={lignesDesRegles(noeud)} />
    </>
  )
}

export function ReglesDuNoeud({ noeud, sujets, gestionAccordable }: ReglesDuNoeudProps) {
  if (noeud === null) {
    return (
      <p id={ANCRE_DU_PANNEAU} tabIndex={-1} role="alert">
        {NOEUD_INTROUVABLE}
      </p>
    )
  }
  const niveaux = gestionAccordable ? ACCESS_LEVEL_NAMES : ACCESS_LEVEL_NAMES.filter((niveau) => niveau !== "manage")
  return (
    <section className="flex flex-col gap-3">
      <TitreDuPanneau id={ANCRE_DU_PANNEAU}>{`Accès à ${noeud.title}`}</TitreDuPanneau>
      <p className="oto-caption">{noeud.path}</p>
      <p>{`Propriétaire : ${proprietaire(noeud.owner)}`}</p>
      <p>{REGLE_PAR_DEFAUT[noeud.owner.kind]}</p>
      <p>{`Votre niveau : ${NIVEAUX[ACCESS_LEVEL_NAMES[noeud.viewerLevel]]}`}</p>
      <Regles noeud={noeud} />
      {noeud.viewerLevel === 3 && <AjoutDeRegle chemin={noeud.path} sujets={sujets} niveaux={niveaux} ancre={ANCRE_DU_PANNEAU} />}
    </section>
  )
}
