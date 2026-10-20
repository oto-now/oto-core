// Les blocs ajoutés à « Statistiques » (1.4.13) : adoption, contenu, partage et connecteurs, calculés par le service
// (`usageStatistics`) sur la fenêtre et le filtre de l'écran. Des tables du design system et des tuiles `Stat`, comme les
// îlots d'usage voisins ; un tiret pour « absent », une phrase pour le vide. Sans eux, l'administrateur ne voyait ni qui
// adopte les assistants, ni ce qu'ils écrivent et lisent, ni ce qui se partage. Avec eux, la courbe hebdomadaire et les
// tableaux triables par équipe et par personne (`courbe-hebdomadaire.tsx`, `tableaux-d-activite.tsx`).
import type { UsageStatistics, UsageWeek } from "../../../schemas"
import { LienDeCellule, TableServeur } from "../../components/table-serveur"
import { EmptyState } from "../../ds/react/empty-state"
import { Grid } from "../../ds/react/grid"
import { Badge } from "../../ds/react/primitives"
import { Stat } from "../../ds/react/stat"
import { dateCourte } from "../../format/dates"
import { nombreLisible, tauxLisible } from "../../format/nombres"
import { ABSENT } from "../../journal/libelles"
import { Ilot } from "../ilot"
import type { LienDeLAdministration } from "../types"
import { CourbeHebdomadaire } from "./courbe-hebdomadaire"
import { TableauDesEquipesActives, TableauDesPersonnes } from "./tableaux-d-activite"

const AUCUNE_CONVERSATION = "Aucune conversation sur cette période."
const AUCUN_CONTENU = "Aucun contenu créé ni publié sur cette période."
const AUCUNE_LECTURE ="Les assistants n'ont lu aucun contenu sur cette période."
const AUCUN_CONNECTEUR = "Aucun connecteur activé ni appelé sur cette période."
const AUCUNE_EQUIPE = "Aucune équipe dans l'organisation."
const PERSONNE = "Aucun membre à montrer."
/** Un client MCP qui ne dit pas son nom. */
const ASSISTANT_INCONNU = "Non renseigné"

/** « Semaine du 12/10/2026 » : le lundi de la semaine, lu à midi pour rester ce jour-là à Paris. */
const semaine = (week: UsageWeek) => `Semaine du ${dateCourte(`${week}T12:00:00.000Z`) ?? week}`

function Semaines({ lignes }: { lignes: UsageStatistics["adoption"]["weeks"] }) {
  return (
    <TableServeur legende="Activité par semaine" colonnes={[{ entete: "Semaine" }, { entete: "Personnes actives", numerique: true }, { entete: "Conversations", numerique: true }]}>
      {lignes.map((ligne) => (
        <tr key={ligne.week}>
          <td data-primary="">{semaine(ligne.week)}</td>
          <td data-numeric="">{nombreLisible(ligne.people)}</td>
          <td data-numeric="">{nombreLisible(ligne.conversations)}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

function ParAssistant({ assistants }: { assistants: UsageStatistics["adoption"]["assistants"] }) {
  const total = assistants.reduce((somme, assistant) => somme + assistant.conversations, 0)
  return (
    <TableServeur legende="Conversations par assistant" colonnes={[{ entete: "Assistant" }, { entete: "Conversations", numerique: true }, { entete: "Part", numerique: true }]}>
      {assistants.map((assistant) => (
        <tr key={assistant.name ?? ""}>
          <td data-primary="">{assistant.name ?? ASSISTANT_INCONNU}</td>
          <td data-numeric="">{nombreLisible(assistant.conversations)}</td>
          <td data-numeric="">{tauxLisible(assistant.conversations, total) ?? ABSENT}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

/** « Jamais connectés : Léa Roux, Marc Petit et 3 autres. » */
function jamaisConnectes({ count, names }: UsageStatistics["adoption"]["neverSignedIn"]): string | null {
  if (count === 0) return null
  const autres = count - names.length
  return `Jamais connectés : ${names.join(", ")}${autres > 0 ? ` et ${nombreLisible(autres)} ${autres > 1 ? "autres" : "autre"}` : ""}.`
}

export function Adoption({ adoption }: { adoption: UsageStatistics["adoption"] }) {
  const vide = adoption.assistants.length === 0
  const absents = jamaisConnectes(adoption.neverSignedIn)
  return (
    <Ilot id="statistiques-adoption" titre="Adoption">
      <div className="flex flex-col gap-4">
        <Grid cols={2}>
          <Stat value={nombreLisible(adoption.pendingInvitations)} label="Invitations en attente" />
          <Stat value={nombreLisible(adoption.neverSignedIn.count)} label="Membres jamais connectés" />
        </Grid>
        {absents && <p className="oto-caption">{absents}</p>}
        {vide ? (
          <EmptyState title={AUCUNE_CONVERSATION} compact />
        ) : (
          <>
            <CourbeHebdomadaire semaines={adoption.weeks} />
            <Semaines lignes={adoption.weeks} />
            <ParAssistant assistants={adoption.assistants} />
          </>
        )}
      </div>
    </Ilot>
  )
}

function SemainesDeContenu({ lignes }: { lignes: UsageStatistics["content"]["weeks"] }) {
  if (lignes.every((ligne) => ligne.created === 0 && ligne.published === 0)) return <EmptyState title={AUCUN_CONTENU} compact />
  return (
    <TableServeur legende="Contenus par semaine" colonnes={[{ entete: "Semaine" }, { entete: "Créés", numerique: true }, { entete: "Publications", numerique: true }]}>
      {lignes.map((ligne) => (
        <tr key={ligne.week}>
          <td data-primary="">{semaine(ligne.week)}</td>
          <td data-numeric="">{nombreLisible(ligne.created)}</td>
          <td data-numeric="">{nombreLisible(ligne.published)}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

type LesPlusLusProps = { lus: UsageStatistics["content"]["mostRead"]; Lien: LienDeLAdministration; hrefDuNoeud: (chemin: string) => string }

function LesPlusLus({ lus, Lien, hrefDuNoeud }: LesPlusLusProps) {
  if (lus.length === 0) return <EmptyState title={AUCUNE_LECTURE} compact />
  return (
    <TableServeur legende="Contenus les plus lus par les assistants" colonnes={[{ entete: "Contenu" }, { entete: "Lectures", numerique: true }, { entete: "Conversations", numerique: true }]}>
      {lus.map((lu) => (
        <tr key={lu.path}>
          <td data-primary="">
            <span className="flex flex-col items-start">
              <LienDeCellule Lien={Lien} href={hrefDuNoeud(lu.path)}>
                {lu.title}
              </LienDeCellule>
              <span className="oto-caption">{lu.path}</span>
            </span>
          </td>
          <td data-numeric="">{nombreLisible(lu.reads)}</td>
          <td data-numeric="">{nombreLisible(lu.conversations)}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

export function Contenu({ contenu, ...lus }: { contenu: UsageStatistics["content"] } & Omit<LesPlusLusProps, "lus">) {
  const { assistant, human } = contenu.written
  const ecrits = assistant + human
  return (
    <Ilot id="statistiques-contenu" titre="Contenu">
      <div className="flex flex-col gap-4">
        <Grid cols={3}>
          <Stat value={nombreLisible(ecrits)} label="Blocs écrits" />
          <Stat value={tauxLisible(assistant, ecrits) ?? ABSENT} label="Écrits par un assistant" />
          <Stat value={tauxLisible(human, ecrits) ?? ABSENT} label="Écrits à la main" />
        </Grid>
        <SemainesDeContenu lignes={contenu.weeks} />
        <LesPlusLus lus={contenu.mostRead} {...lus} />
      </div>
    </Ilot>
  )
}

function Connecteurs({ connecteurs }: { connecteurs: UsageStatistics["sharing"]["connectors"] }) {
  if (connecteurs.length === 0) return <EmptyState title={AUCUN_CONNECTEUR} compact />
  return (
    <TableServeur legende="Appels par connecteur" colonnes={[{ entete: "Connecteur" }, { entete: "État" }, { entete: "Appels", numerique: true }, { entete: "Erreurs", numerique: true }]}>
      {connecteurs.map((connecteur) => (
        <tr key={connecteur.name}>
          <td data-primary="">
            <span className="flex flex-col items-start">
              <span>{connecteur.label ?? connecteur.name}</span>
              <span className="oto-caption oto-mono">{connecteur.name}</span>
            </span>
          </td>
          <td>{connecteur.active ? <Badge tone="ok">Activé</Badge> : <Badge tone="idle">Sans activation</Badge>}</td>
          <td data-numeric="">{nombreLisible(connecteur.calls)}</td>
          <td data-numeric="">{nombreLisible(connecteur.errors)}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

export function PartageEtConnecteurs({ partage }: { partage: UsageStatistics["sharing"] }) {
  return (
    <Ilot id="statistiques-partage" titre="Partage et connecteurs">
      <div className="flex flex-col gap-4">
        <Grid cols={2}>
          <Stat value={nombreLisible(partage.publicLinks.active)} label="Liens publics actifs" />
          <Stat value={nombreLisible(partage.publicLinks.created)} label="Liens publics créés sur la période" />
        </Grid>
        <Connecteurs connecteurs={partage.connectors} />
      </div>
    </Ilot>
  )
}

/** « Par équipe » : chaque équipe, ou celle du filtre, triable ; sa procédure la plus servie mène à sa page. */
export function ParEquipe({ equipes, hrefDuNoeud }: { equipes: UsageStatistics["teams"]; hrefDuNoeud: (chemin: string) => string }) {
  const lignes = equipes.map((equipe) => ({ ...equipe, hrefDeLaProcedure: equipe.topProcedure ? hrefDuNoeud(equipe.topProcedure.path) : null }))
  return (
    <Ilot id="statistiques-equipes" titre="Par équipe">
      {lignes.length === 0 ? <EmptyState title={AUCUNE_EQUIPE} compact /> : <TableauDesEquipesActives lignes={lignes} />}
    </Ilot>
  )
}

/** « Par personne » : chaque membre, ou ceux de l'équipe du filtre, triable. */
export function ParPersonne({ personnes }: { personnes: UsageStatistics["people"] }) {
  return (
    <Ilot id="statistiques-personnes" titre="Par personne">
      {personnes.length === 0 ? <EmptyState title={PERSONNE} compact /> : <TableauDesPersonnes lignes={personnes} />}
    </Ilot>
  )
}
