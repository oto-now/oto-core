// « Activité » (1.4.13) : une page, un en-tête, deux onglets portés par l'adresse (`?tab=`) — « Statistiques », pour qui
// administre l'organisation (l'onglet n'est pas proposé aux autres), puis « Journal », pour tous. La page de l'hôte ne
// lit que l'onglet ouvert et lui passe ses données ; l'en-tête prend la méta et les réglages de cet onglet (la fenêtre,
// l'équipe des statistiques ; la période du journal). Server Component : les onglets (`Onglets`) et les réglages sont
// des îlots client qui reçoivent des données et des adresses. Sans elle, les statistiques et le journal étaient deux
// entrées du menu pour une même question : que font les assistants dans l'organisation.
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar"
import { Icon } from "../ds/react/icon"
import { Island } from "../ds/react/island"
import { ScreenHeader } from "../ds/react/screen-header"
import { Onglets } from "../equipes/onglets"
import { CorpsDeLUsage, metaDeLUsage, ReglagesDeLUsage, type EcranUsageProps } from "../admin/usage/ecran-usage"
import { ContenuDuJournal, metaDuJournal, PeriodeDeLEcranDuJournal, TiroirDuJournal, type EcranDuJournalProps } from "./ecran-du-journal"
import { ACTIVITE } from "./libelles"

/** Les onglets d'« Activité », par leur valeur dans l'adresse. */
export type OngletDActivite = "statistics" | "journal"

export type EcranDActiviteProps =
  | {
      onglet: "statistics"
      /** Les données de l'onglet Statistiques : celles de l'écran d'usage, sans son fil. */
      statistiques: Omit<EcranUsageProps, "fil">
      hrefDOnglet: (onglet: OngletDActivite) => string
    }
  | {
      onglet: "journal"
      journal: EcranDuJournalProps
      /** L'onglet Statistiques est proposé : la personne administre l'organisation. */
      statistiquesPermises: boolean
      hrefDOnglet: (onglet: OngletDActivite) => string
    }

function ongletsDe(props: EcranDActiviteProps) {
  const statistiques = props.onglet === "statistics" || props.statistiquesPermises
  return [
    ...(statistiques ? [{ cle: "statistics", libelle: ACTIVITE.statistiques, href: props.hrefDOnglet("statistics") }] : []),
    { cle: "journal", libelle: ACTIVITE.journal, href: props.hrefDOnglet("journal") },
  ]
}

/** La méta et les réglages de l'en-tête, ceux de l'onglet ouvert. */
function enTeteDe(props: EcranDActiviteProps) {
  if (props.onglet === "statistics") {
    const { statistiques } = props
    const donnees = statistiques.resultat.data
    return { meta: metaDeLUsage(statistiques.resultat), actions: donnees && <ReglagesDeLUsage donnees={donnees} {...statistiques} /> }
  }
  return { meta: metaDuJournal(props.journal), actions: <PeriodeDeLEcranDuJournal {...props.journal} /> }
}

export function EcranDActivite(props: EcranDActiviteProps) {
  const { meta, actions } = enTeteDe(props)
  return (
    <>
      <ScreenHeader title={ACTIVITE.titre} icon={<Icon as={ChartBar} size="sm" />} meta={meta} actions={actions} />
      <Island aria-label={ACTIVITE.titre} overflow="visible">
        <Onglets label={ACTIVITE.onglets} titre={ACTIVITE.titre} onglets={ongletsDe(props)} courant={props.onglet}>
          {props.onglet === "statistics" ? (
            <div className="flex flex-col gap-4">
              <CorpsDeLUsage {...props.statistiques} />
            </div>
          ) : (
            <ContenuDuJournal {...props.journal} />
          )}
        </Onglets>
      </Island>
      {props.onglet === "journal" && <TiroirDuJournal {...props.journal} />}
    </>
  )
}
