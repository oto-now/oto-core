// La liste des procédures (E05-S04, AC9) : un tableau des procédures que la personne lit
// (`listProcedures`, E03-S06 : droits décidés par le service, tri par chemin), filtrées par l'équipe
// propriétaire en formulaire GET (`?team=`), leur état en toutes lettres, et les quatre états.
// Server Component : la navigation vient de l'hôte (`Lien`, `hrefDuChemin`, `hrefDeLaListe`). Sans lui,
// une procédure ne se retrouve que par l'arbre.
//
// Porté d'oto-frontend (`routes/procedures.lazy.tsx`, `agents/parc-agents.tsx`, `agents/liste-agents.tsx`).
// Repris : la liste filtrée par équipe portée par l'adresse, deux états vides qui n'appellent pas le même
// geste, les lignes fantômes du chargement. Retiré : le parc d'agents, les exécutions, les compteurs,
// le tri, les états d'agent, « Charger plus », TanStack Router et Query.
import type { ProceduresSearch, ProcedureSummary } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { PERSO, SECTION_PERSO } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Choix, optionsDe } from "../components/choix"
import { LIEN } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { Button } from "../ds/react/primitives"
import { LienDeCellule, TableServeur } from "../components/table-serveur"
import { etatDeLaProcedure, LISTE } from "./libelles"

type Equipe = { id: string; name: string }

type ListeDesProceduresProps = {
  resultat: Resultat<ProcedureSummary[]>
  /** Les équipes de l'organisation (`listTeams`) : les choix du filtre. */
  equipes: Resultat<Equipe[]>
  /** `?team=`, lu par `proceduresSearchSchema`. */
  filtre: ProceduresSearch
  Lien: LienDeLHote
  hrefDuChemin: (chemin: string) => string
  /** L'adresse de la liste pour ce filtre ; sans équipe, la liste entière. */
  hrefDeLaListe: (filtre: ProceduresSearch) => string
}

const COLONNES = [{ entete: "Titre" }, { entete: "Chemin" }, { entete: "Équipe" }, { entete: "État" }]

type FiltreProps = { equipes: Resultat<Equipe[]>; equipe: string | undefined; action: string; ici: string; Lien: LienDeLHote }

/** Le filtre d'équipe, sans JavaScript ; sa lecture en échec se dit à sa place, jamais une liste vide (`Choix`). */
function FiltreDEquipe({ equipes, equipe, action, ici, Lien }: FiltreProps) {
  return (
    <form method="get" action={action} aria-label="Filtrer par équipe" className="flex flex-wrap items-end gap-3">
      <Choix
        // Revenue sans rechargement à la liste entière (« Retirer le filtre »), la liste se remet à l'adresse.
        key={equipe ?? ""}
        id="procedures-equipe"
        nom="team"
        libelle={LISTE.equipe}
        tous={LISTE.toutes}
        options={optionsDe(equipes, (une) => ({ id: une.id, nom: une.name }))}
        valeur={equipe}
        ici={ici}
        Lien={Lien}
      />
      <Button type="submit" variant="secondary">
        {LISTE.filtrer}
      </Button>
    </form>
  )
}

type TableauProps = { procedures: ProcedureSummary[]; Lien: LienDeLHote; hrefDuChemin: (chemin: string) => string }

function Tableau({ procedures, Lien, hrefDuChemin }: TableauProps) {
  return (
    // La légende dit le titre de l'écran, que son `h1` porte déjà à l'œil.
    <TableServeur legende={LISTE.titre} colonnes={COLONNES}>
      {procedures.map((procedure) => (
        <tr key={procedure.path}>
          <td data-primary="">
            <LienDeCellule Lien={Lien} href={hrefDuChemin(procedure.path)}>
              {procedure.title}
            </LienDeCellule>
          </td>
          <td>{procedure.path}</td>
          <td>{procedure.ownerTeam?.name ?? (procedure.path.startsWith(`${PERSO}/`) ? SECTION_PERSO : LISTE.organisation)}</td>
          <td>{etatDeLaProcedure(procedure)}</td>
        </tr>
      ))}
    </TableServeur>
  )
}

type ProceduresProps = Omit<ListeDesProceduresProps, "resultat" | "equipes"> & { procedures: ProcedureSummary[] }

/** La liste filtrée par l'équipe propriétaire effective (H52), ou l'un de ses deux états vides. */
function Procedures({ procedures, filtre, Lien, hrefDuChemin, hrefDeLaListe }: ProceduresProps) {
  const listees = filtre.team === undefined ? procedures : procedures.filter((procedure) => procedure.ownerTeam?.id === filtre.team)
  if (listees.length > 0) return <Tableau procedures={listees} Lien={Lien} hrefDuChemin={hrefDuChemin} />
  if (filtre.team === undefined) return <p className="text-sm text-ink">{LISTE.aucune}</p>
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink">{LISTE.aucunePourLEquipe}</p>
      <Lien href={hrefDeLaListe({})} className={`text-sm ${LIEN}`}>
        {LISTE.retirerLeFiltre}
      </Lien>
    </div>
  )
}

export function ListeDesProcedures({ resultat, equipes, ...props }: ListeDesProceduresProps) {
  const ici = props.hrefDeLaListe(props.filtre)
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{LISTE.titre}</h1>
      <FiltreDEquipe equipes={equipes} equipe={props.filtre.team} action={props.hrefDeLaListe({})} ici={ici} Lien={props.Lien} />
      {resultat.error !== undefined ? <ErreurDeLecture message={resultat.error} href={ici} Lien={props.Lien} /> : <Procedures procedures={resultat.data} {...props} />}
    </section>
  )
}

/** Le chargement de la liste, rendu par le `loading.tsx` de l'hôte : le titre et cinq lignes. */
export function ListeDesProceduresChargement() {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">{LISTE.chargement}</span>
      {["w-1/3", "w-full", "w-full", "w-5/6", "w-2/3"].map((largeur, rang) => (
        <div key={`${largeur}-${rang}`} aria-hidden="true" className={`h-6 rounded-md bg-skeleton ${largeur}`} />
      ))}
    </div>
  )
}
