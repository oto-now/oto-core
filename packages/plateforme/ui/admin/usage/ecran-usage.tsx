// « Usage des assistants » (E08-S09 : AC2 à AC8, AC15) : ce que les assistants ont servi sur la
// fenêtre, tiré du journal par le service (`usageSummary`) : chiffres clés, procédures servies, erreurs
// par fonction, conversations dont la demande n'a trouvé ni procédure ni appel. Server Component : la
// fenêtre est un îlot client qui change l'adresse, l'équipe un formulaire GET ; la navigation vient de l'hôte.
//
// Porté d'oto-frontend (`suivi-de-lentreprise.tsx`, `fenetre-du-suivi.tsx`, `adoption-des-membres.tsx`
// l. 77-148, `outils-du-suivi.tsx` l. 27-99, `panneau-du-suivi.tsx`), E05-S09 partie d2. Repris : l'en-tête
// et sa méta, la fenêtre de 7, 30 ou 90 jours dans ses actions (`SegmentedControl`), un îlot par sujet, les
// tables du design system, un tiret pour « absent », la troncature dite comme une limite (`Alert` d'examen) et
// non comme une panne, l'état vide qui propose d'élargir. Changé : les lentilles du suivi sont des écrans de
// l'hôte (Usage, Journal, Retours), reliés par le fil, au lieu d'onglets d'une seule carte. Retiré : onglets,
// durées, adoption par personne, TanStack Query. 1.4.13 : l'écran s'appelle « Statistiques » et gagne trois îlots, adoption,
// contenu, partage et connecteurs (`statistiques.tsx`).
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar"
import { JOURNAL_PERIODS, USAGE_MAX_LINES, type UsagePeriod, type UsageQuery, type UsageSummary } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { EmptyState } from "../../ds/react/empty-state"
import { Alert, Button } from "../../ds/react/primitives"
import { Select } from "../../ds/react/select"
import { dateEtHeureLisibles } from "../../format/dates"
import { nombreLisible, tauxLisible } from "../../format/nombres"
import { ABSENT, PERSONNE_RETIREE } from "../../journal/libelles"
import { EnTeteDAdministration } from "../en-tete"
import { FiltreSegmente } from "../filtre-segmente"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Chargement, Ilot } from "../ilot"
import { LienDeCellule, TableServeur } from "../../components/table-serveur"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { ENTREPRISE } from "../../coque/libelles"
import { ChiffresCles } from "./chiffres-cles"
import { Adoption, Contenu, ParEquipe, ParPersonne, PartageEtConnecteurs } from "./statistiques"

/** Ce que l'écran affiche : l'usage, et les équipes de la liste du filtre (`listTeams`). */
export type DonneesDUsage = { usage: UsageSummary; equipes: { id: string; name: string }[] }

export type EcranUsageProps = {
  resultat: Resultat<DonneesDUsage>
  /** Les paramètres de l'adresse, lus par `usageQuerySchema` : fenêtre active et « Réessayer ». */
  filtres: UsageQuery
  Lien: LienDeLAdministration
  hrefDuNoeud: (chemin: string) => string
  /** La conversation dans l'écran Journal de l'hôte (E05-S05). */
  hrefDeConversation: (code: string, periode: UsagePeriod) => string
  hrefDeFenetre: (periode: UsagePeriod) => string
  /** L'adresse du formulaire GET du filtre d'équipe. */
  actionDuFiltre: string
  /** Les paramètres que le formulaire du filtre garde en champs cachés (`tab` de la page « Activité »). */
  parametresCaches?: Readonly<Record<string, string>>
  /** Le fil de l'en-tête : les adresses que l'hôte donne au rail et le droit de la personne ; sans lui, pas de fil. */
  fil?: FilDeLEcran
}

const AUCUNE_PROCEDURE = "Aucune procédure servie sur cette période. Essayez une période plus large."
const AUCUN_APPEL = "Aucun appel de fonction sur cette période."
const TOUTES_TROUVEES = "Toutes les demandes de la période ont trouvé une procédure ou mené à un appel."
const EXPLICATION = "Ces demandes n'ont trouvé ni procédure ni appel : elles nourrissent le titre et le résumé des procédures."

/** AC8 : la borne que le service applique (`USAGE_MAX_LINES`, face `schemas/`). */
function troncature(depuis: string | null): string {
  const date = dateEtHeureLisibles(depuis) ?? "?"
  return `Calculé sur les ${nombreLisible(USAGE_MAX_LINES)} appels les plus récents : la période n'est couverte qu'à partir du ${date}. Les appels plus anciens ne sont pas comptés.`
}

type FiltreDEquipeProps = { equipes: DonneesDUsage["equipes"]; equipe: string | undefined; periode: UsagePeriod; action: string; caches: Readonly<Record<string, string>> }

/** Les champs cachés du formulaire : la page qui le monte les nomme. */
function ChampsCaches({ caches }: { caches: Readonly<Record<string, string>> }) {
  return Object.entries(caches).map(([nom, valeur]) => <input key={nom} type="hidden" name={nom} value={valeur} />)
}

/** Le filtre d'équipe, sans JavaScript (AC2) ; la fenêtre suit en champ caché. */
function FiltreDEquipe({ equipes, equipe, periode, action, caches }: FiltreDEquipeProps) {
  const choisie = equipes.some((candidate) => candidate.id === equipe) ? equipe : ""
  return (
    <form method="get" action={action} aria-label="Filtrer par équipe" className="flex items-center gap-2">
      <ChampsCaches caches={caches} />
      <input type="hidden" name="period" value={periode} />
      <label htmlFor="usage-equipe" className="oto-sr-only">
        Équipe
      </label>
      <Select key={choisie} id="usage-equipe" name="team" defaultValue={choisie} size="sm">
        <option value="">Toutes les équipes</option>
        {equipes.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm">
        Filtrer
      </Button>
    </form>
  )
}

type ProceduresProps = { procedures: UsageSummary["procedures"]; Lien: LienDeLAdministration; hrefDuNoeud: (chemin: string) => string }

function Procedures({ procedures, Lien, hrefDuNoeud }: ProceduresProps) {
  return (
    <Ilot id="usage-procedures" titre="Procédures les plus servies" flush={procedures.length > 0}>
      {procedures.length === 0 ? (
        <EmptyState title={AUCUNE_PROCEDURE} compact />
      ) : (
        <TableServeur
          legende="Procédures les plus servies"
          colonnes={[{ entete: "Procédure" }, { entete: "Servie", numerique: true }, { entete: "Conversations", numerique: true }, { entete: "Personnes", numerique: true }, { entete: "Dernière fois" }]}
        >
          {procedures.map((procedure) => (
            <tr key={procedure.path}>
              <td data-primary="">
                <span className="flex flex-col items-start">
                  <LienDeCellule Lien={Lien} href={hrefDuNoeud(procedure.path)}>
                    {procedure.title}
                  </LienDeCellule>
                  <span className="oto-caption">{procedure.path}</span>
                </span>
              </td>
              <td data-numeric="">{nombreLisible(procedure.served)}</td>
              <td data-numeric="">{nombreLisible(procedure.conversations)}</td>
              <td data-numeric="">{nombreLisible(procedure.people)}</td>
              <td>{dateEtHeureLisibles(procedure.lastServedAt) ?? ABSENT}</td>
            </tr>
          ))}
        </TableServeur>
      )}
    </Ilot>
  )
}

function DerniereErreur({ erreur }: { erreur: UsageSummary["functions"][number]["lastError"] }) {
  if (!erreur) return ABSENT
  return (
    <span className="flex flex-col">
      <span className="block max-w-md whitespace-normal">{erreur.message || ABSENT}</span>
      <span className="oto-caption">{dateEtHeureLisibles(erreur.at) ?? ABSENT}</span>
    </span>
  )
}

function Fonctions({ fonctions }: { fonctions: UsageSummary["functions"] }) {
  return (
    <Ilot id="usage-fonctions" titre="Erreurs par fonction" flush={fonctions.length > 0}>
      {fonctions.length === 0 ? (
        <EmptyState title={AUCUN_APPEL} compact />
      ) : (
        <TableServeur
          legende="Erreurs par fonction"
          colonnes={[{ entete: "Fonction" }, { entete: "Appels", numerique: true }, { entete: "Erreurs", numerique: true }, { entete: "Taux", numerique: true }, { entete: "Dernière erreur" }]}
        >
          {fonctions.map((fonction) => (
            <tr key={fonction.name}>
              <td data-primary="">
                <span className="oto-mono">{fonction.name}</span>
              </td>
              <td data-numeric="">{nombreLisible(fonction.calls)}</td>
              <td data-numeric="">{nombreLisible(fonction.errors)}</td>
              <td data-numeric="">{tauxLisible(fonction.errors, fonction.calls) ?? ABSENT}</td>
              <td>
                <DerniereErreur erreur={fonction.lastError} />
              </td>
            </tr>
          ))}
        </TableServeur>
      )}
    </Ilot>
  )
}

type SansProcedureProps = {
  sansProcedure: UsageSummary["unmatched"]
  periode: UsagePeriod
  Lien: LienDeLAdministration
  hrefDeConversation: EcranUsageProps["hrefDeConversation"]
}

function SansProcedure({ sansProcedure, periode, Lien, hrefDeConversation }: SansProcedureProps) {
  const { count, items } = sansProcedure
  const compte = count === 0 ? undefined : `${nombreLisible(count)} ${count > 1 ? "conversations" : "conversation"} sans procédure trouvée`
  return (
    <Ilot id="usage-sans-procedure" titre="Conversations sans procédure" compte={compte}>
      {count === 0 ? (
        <EmptyState title={TOUTES_TROUVEES} compact />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="oto-caption">{EXPLICATION}</p>
          <TableServeur legende="Conversations sans procédure" colonnes={[{ entete: "Quand" }, { entete: "Personne" }, { entete: "Demande" }, { entete: "Host" }]}>
            {items.map((item) => (
              <tr key={item.ctx}>
                <td>{dateEtHeureLisibles(item.at) ?? ABSENT}</td>
                <td>{item.person ?? PERSONNE_RETIREE}</td>
                <td data-primary="">
                  <LienDeCellule Lien={Lien} href={hrefDeConversation(item.ctx, periode)}>
                    <span className="block max-w-md whitespace-normal text-start">{item.phrase}</span>
                    <span className="oto-sr-only">{` (conversation ${item.ctx})`}</span>
                  </LienDeCellule>
                </td>
                <td>{item.host ?? ABSENT}</td>
              </tr>
            ))}
          </TableServeur>
        </div>
      )}
    </Ilot>
  )
}

type UsageProps = Pick<EcranUsageProps, "Lien" | "hrefDuNoeud" | "hrefDeConversation"> & { donnees: DonneesDUsage }

function Usage({ donnees, ...props }: UsageProps) {
  const { usage } = donnees
  const { Lien } = props
  return (
    <>
      {/* Une limite du calcul, pas une panne : une information d'examen (AC8), jamais une alerte d'erreur. */}
      {usage.truncated && <Alert tone="review" title={troncature(usage.coveredFrom)} />}
      <ChiffresCles totaux={usage.totals} />
      <Adoption adoption={usage.statistics.adoption} />
      <ParEquipe equipes={usage.statistics.teams} hrefDuNoeud={props.hrefDuNoeud} />
      <ParPersonne personnes={usage.statistics.people} />
      <Contenu contenu={usage.statistics.content} Lien={Lien} hrefDuNoeud={props.hrefDuNoeud} />
      <Procedures procedures={usage.procedures} Lien={Lien} hrefDuNoeud={props.hrefDuNoeud} />
      <Fonctions fonctions={usage.functions} />
      <SansProcedure sansProcedure={usage.unmatched} periode={usage.periode} Lien={Lien} hrefDeConversation={props.hrefDeConversation} />
      <PartageEtConnecteurs partage={usage.statistics.sharing} />
    </>
  )
}

export type ReglagesDeLUsageProps = Pick<EcranUsageProps, "filtres" | "hrefDeFenetre" | "actionDuFiltre" | "parametresCaches"> & { donnees: DonneesDUsage }

/** La fenêtre et l'équipe, dans les actions de l'en-tête : elles règlent l'écran entier, ou l'onglet Statistiques. */
export function ReglagesDeLUsage({ donnees, filtres, hrefDeFenetre, actionDuFiltre, parametresCaches = {} }: ReglagesDeLUsageProps) {
  const fenetres = JOURNAL_PERIODS.map((jours) => ({ valeur: String(jours), libelle: `${jours} jours`, adresse: hrefDeFenetre(jours) }))
  return (
    <>
      <FiltreDEquipe equipes={donnees.equipes} equipe={donnees.usage.team?.id} periode={filtres.period} action={actionDuFiltre} caches={parametresCaches} />
      <FiltreSegmente libelle="La période observée" choix={fenetres} valeur={String(filtres.period)} />
    </>
  )
}

/** « Sur les 30 derniers jours · équipe Ventes » : la méta de l'en-tête ; rien sans données. */
export function metaDeLUsage(resultat: EcranUsageProps["resultat"]): string | undefined {
  const usage = resultat.data?.usage
  return usage && `Sur les ${usage.periode} derniers jours${usage.team ? ` · équipe ${usage.team.name}` : ""}`
}

/**
 * Les îlots de l'usage, ou l'échec de leur lecture, dit une fois avec « Réessayer » : le corps de l'écran, et de l'onglet
 * Statistiques d'« Activité ».
 */
export function CorpsDeLUsage({ resultat, ...props }: Omit<EcranUsageProps, "fil" | "actionDuFiltre" | "parametresCaches">) {
  // Une seule lecture nourrit les îlots : son échec, ou la réserve d'un non-administrateur (AC1), se dit une fois.
  if (resultat.error !== undefined) return <ErreurDeLecture message={resultat.error} href={props.hrefDeFenetre(props.filtres.period)} Lien={props.Lien} />
  return <Usage donnees={resultat.data} Lien={props.Lien} hrefDuNoeud={props.hrefDuNoeud} hrefDeConversation={props.hrefDeConversation} />
}

export function EcranUsage({ resultat, fil, ...props }: EcranUsageProps) {
  const donnees = resultat.data
  return (
    <>
      <EnTeteDAdministration
        courant="usage"
        fil={fil}
        titre={ENTREPRISE.usage}
        glyphe={ChartBar}
        meta={metaDeLUsage(resultat)}
        actions={donnees && <ReglagesDeLUsage donnees={donnees} {...props} />}
      />
      <CorpsDeLUsage resultat={resultat} {...props} />
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC15). */
export function EcranUsageChargement() {
  return <Chargement texte="Chargement des statistiques…" />
}
