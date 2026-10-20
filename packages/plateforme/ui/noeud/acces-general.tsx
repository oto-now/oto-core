"use client"

// « Accès par défaut » du panneau « Partager » (E05-S10, AC-b13 ; ADR-014 ; 1.4.13) : deux lignes indépendantes, l'équipe
// propriétaire et toute l'organisation, chacune à son niveau. L'équipe : sa règle sur ce nœud (`POST rules`, sujet
// l'équipe), retirée quand on revient au niveau qu'elle aurait sans elle (`DELETE rules/<id>`), son niveau lu avec les
// membres (`team` de `GET rules?path=`). L'organisation : son niveau réel, règle d'un dossier au-dessus comprise (`organisation`
// de la même lecture) ; `POST /api/platform/nodes/access` pose sa règle sur le nœud (« Aucun accès » compris, qui ferme une
// page qu'un dossier ouvre), et revenir au niveau hérité la retire.
// L'équipe suit l'organisation : sa liste ne propose rien sous le niveau de l'organisation, et le service monte sa règle
// quand l'organisation monte au-dessus. Le service décide (la gestion du nœud, l'administrateur pour l'accès complet,
// jamais Privé). Sans lui, le niveau de l'équipe était figé et l'équipe et l'organisation ne se réglaient pas ensemble.
import type { ReactNode } from "react"
import { ACCESS_LEVEL_NAMES, generalAccessSchema, setNodeRuleSchema, type AccessLevelName, type NodeRulesView } from "../../schemas"
import type { MessagesDuGeste } from "../api/messages"
import type { SelectOption } from "../ds/react/select"
import { GlypheDePortee, type PorteeDEspace } from "./glyphes"
import { ACCES_GENERAL, NIVEAUX_D_ACCES, PARTAGE, REFUS_DE_L_ACCES_GENERAL } from "./libelles"
import { ChoixDuNiveau, EtiquetteDeLigne, NiveauLu, optionDuNiveau } from "./partage-visuel"

type Envoi = { methode: "POST" | "DELETE"; ressource: string; corps?: unknown }

/** Le geste d'un choix : la route, le corps validé par le schéma de l'API, l'annonce, les refus propres ; `true` s'il a abouti. */
type EnvoyerLAcces = (envoi: Envoi, annonce: string, refus?: MessagesDuGeste) => Promise<boolean>

/** L'accès par défaut de l'équipe, lu avec les membres ; `undefined` pendant la lecture. */
export type EquipeParDefaut = NodeRulesView["team"] | undefined

/** L'accès réel de toute l'organisation, lu avec les membres ; `undefined` pendant la lecture ou en échec. */
type OrganisationParDefaut = NodeRulesView["organisation"] | undefined

const rang = (niveau: AccessLevelName) => ACCESS_LEVEL_NAMES.indexOf(niveau)

/** Les niveaux d'une liste, du plus haut au plus bas : à partir de `plancher`, l'accès complet à l'administrateur (D4) ou déjà là. */
function niveauxDepuis(plancher: AccessLevelName, gestionAccordable: boolean, courant: AccessLevelName): SelectOption[] {
  return ACCESS_LEVEL_NAMES.filter((niveau) => rang(niveau) >= rang(plancher) && (niveau !== "manage" || gestionAccordable || courant === "manage"))
    .reverse()
    .map(optionDuNiveau)
}

const niveauLu = (valeur: string): AccessLevelName | null => ACCESS_LEVEL_NAMES.find((niveau) => niveau === valeur) ?? null

function Ligne({ portee, nom, etiquette, children }: { portee: PorteeDEspace; nom: string; etiquette?: ReactNode; children: ReactNode }) {
  return (
    <div className="oto-pop-row">
      <span className="oto-avatar" data-size="sm" aria-hidden="true">
        <GlypheDePortee portee={portee} />
      </span>
      <span className="oto-share-name">
        {nom}
        {etiquette}
      </span>
      {children}
    </div>
  )
}

type AccesParDefautProps = {
  noeud: NodeRulesView
  equipe: EquipeParDefaut
  organisation: OrganisationParDefaut
  nomOrganisation: string
  gere: boolean
  gestionAccordable: boolean
  envoyer: EnvoyerLAcces
  enCours: boolean
}

/** Le plancher de l'organisation : dans Tout le monde chacun lit déjà (H66 (3)) ; ailleurs, personne. */
const plancherDe = (noeud: NodeRulesView): AccessLevelName => (noeud.owner.kind === "org" ? "read" : "none")

/** Le niveau réel de toute l'organisation ; avant sa lecture, sa règle sur le nœud, sinon le plancher. */
function niveauDeLOrganisation(noeud: NodeRulesView, organisation: OrganisationParDefaut): AccessLevelName {
  return organisation?.level ?? noeud.general?.level ?? plancherDe(noeud)
}

/**
 * Le corps de `POST nodes/access` : revenir au niveau hérité retire la règle du nœud ; tout autre niveau la pose, « Aucun
 * accès » compris ; `null` quand rien ne change ou que le schéma refuse.
 */
function corpsDeLOrganisation(noeud: NodeRulesView, niveau: AccessLevelName, herite: AccessLevelName): unknown {
  if (niveau === herite && !noeud.general) return null
  const corps = generalAccessSchema.safeParse(niveau === herite ? { path: noeud.path, access: "restricted" } : { path: noeud.path, access: "organisation", level: niveau })
  return corps.success ? corps.data : null
}

/** Le geste qui donne `niveau` à l'équipe : retirer sa règle si elle retrouve ainsi le niveau hérité, la poser sinon. */
function envoiDeLEquipe(chemin: string, equipe: NonNullable<NodeRulesView["team"]>, niveau: AccessLevelName): Envoi | null {
  if (niveau === equipe.inherited && equipe.ruleId !== null) return { methode: "DELETE", ressource: `rules/${equipe.ruleId}` }
  const corps = setNodeRuleSchema.safeParse({ path: chemin, subject: { kind: "team", id: equipe.teamId }, level: niveau })
  return corps.success ? { methode: "POST", ressource: "rules", corps: corps.data } : null
}

function LigneDeLEquipe({ noeud, equipe, organisation, gere, gestionAccordable, envoyer, enCours }: Omit<AccesParDefautProps, "nomOrganisation">) {
  const nom = noeud.owner.teamName ?? ""
  if (equipe === undefined || equipe === null) {
    return (
      <Ligne portee="equipe" nom={PARTAGE.equipe(nom)}>
        <span aria-busy={equipe === undefined} className="oto-pop-meta">
          {equipe === undefined ? ACCES_GENERAL.lecture : ""}
        </span>
      </Ligne>
    )
  }
  const etiquette = equipe.ruleId === null ? <EtiquetteDeLigne>{ACCES_GENERAL.herite}</EtiquetteDeLigne> : undefined
  async function changer(valeur: string) {
    const niveau = niveauLu(valeur)
    const envoi = niveau && equipe ? envoiDeLEquipe(noeud.path, equipe, niveau) : null
    if (niveau && envoi) await envoyer(envoi, PARTAGE.change(PARTAGE.equipe(nom), NIVEAUX_D_ACCES[niveau]))
  }
  return (
    <>
      <Ligne portee="equipe" nom={PARTAGE.equipe(nom)} etiquette={etiquette}>
        {gere ? (
          <ChoixDuNiveau
            valeur={equipe.level}
            servi={equipe.level}
            aria-label={ACCES_GENERAL.niveauEquipe(nom)}
            options={niveauxDepuis(niveauDeLOrganisation(noeud, organisation), gestionAccordable, equipe.level)}
            disabled={enCours}
            onChange={(evenement) => void changer(evenement.target.value)}
          />
        ) : (
          <NiveauLu niveau={equipe.level} />
        )}
      </Ligne>
      {gere && <p className="oto-caption">{ACCES_GENERAL.responsableGarde}</p>}
    </>
  )
}

function LigneDeLOrganisation({ noeud, organisation, nomOrganisation, gere, gestionAccordable, envoyer, enCours }: Omit<AccesParDefautProps, "equipe">) {
  const niveau = niveauDeLOrganisation(noeud, organisation)
  const plancher = plancherDe(noeud)
  const herite = organisation?.inherited ?? plancher
  // « hérité » : aucune règle sur le nœud, un dossier au-dessus ouvre ce contenu à toute l'organisation.
  const etiquette = !noeud.general && niveau !== plancher ? <EtiquetteDeLigne>{ACCES_GENERAL.herite}</EtiquetteDeLigne> : undefined
  async function changer(valeur: string) {
    const voulu = niveauLu(valeur)
    const corps = voulu ? corpsDeLOrganisation(noeud, voulu, herite) : null
    if (!voulu || corps === null) return
    const annonce = voulu === "none" ? ACCES_GENERAL.restreint : ACCES_GENERAL.ouvert(NIVEAUX_D_ACCES[voulu])
    await envoyer({ methode: "POST", ressource: "nodes/access", corps }, annonce, REFUS_DE_L_ACCES_GENERAL)
  }
  return (
    <>
      <Ligne portee="all" nom={ACCES_GENERAL.toute(nomOrganisation)} etiquette={etiquette}>
        {gere ? (
          <ChoixDuNiveau
            valeur={niveau}
            servi={niveau}
            aria-label={ACCES_GENERAL.niveau}
            options={niveauxDepuis(plancher, gestionAccordable, niveau)}
            disabled={enCours}
            onChange={(evenement) => void changer(evenement.target.value)}
          />
        ) : (
          <NiveauLu niveau={niveau} />
        )}
      </Ligne>
      {noeud.owner.kind === "org" && <p className="oto-caption">{ACCES_GENERAL.toutLeMondeLit}</p>}
    </>
  )
}

/** Les deux lignes de l'accès par défaut ; dans Privé, la seule phrase de l'espace (le service refuse d'ouvrir, ADR-014 § 2). */
export function AccesParDefaut(props: AccesParDefautProps) {
  const { noeud, gere } = props
  if (noeud.owner.kind === "user") {
    return (
      <>
        <Ligne portee="private" nom={PARTAGE.ajoutesSeulement}>
          {null}
        </Ligne>
        {noeud.owner.userName && <p className="oto-caption">{PARTAGE.detailPerso(noeud.owner.userName)}</p>}
        {gere && <p className="oto-caption">{ACCES_GENERAL.prive}</p>}
      </>
    )
  }
  return (
    <>
      {noeud.owner.kind === "team" && <LigneDeLEquipe {...props} />}
      <LigneDeLOrganisation {...props} />
    </>
  )
}
