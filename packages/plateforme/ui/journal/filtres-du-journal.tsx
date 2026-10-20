// Les filtres du journal (E05-S05, AC4) : un formulaire GET vers l'adresse du journal, champs étiquetés ;
// l'équipe et la personne en listes, « Erreurs seulement » en case, la période gardée dans un champ caché
// (elle se choisit dans l'en-tête). Server Component : l'état reste dans l'adresse de l'hôte
// (`state-management.md § URL State`), et la page relit tout à l'envoi. Une liste dont la lecture a
// échoué le dit à sa place, avec « Réessayer ».
//
// Porté d'oto-frontend (`fenetre-du-suivi.tsx` : la période dans l'en-tête, au-dessus de ce qu'elle
// commande). Depuis E05-S09 (partie d1), les champs, la case et les boutons du design system porté.
import type { JournalFilters, MemberView, TeamView } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Checkbox } from "../ds/react/checkbox"
import { Field } from "../ds/react/forms"
import { Button } from "../ds/react/primitives"
import { Select } from "../ds/react/select"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { RETIRER_LES_FILTRES } from "./libelles"

const TITRE = "journal-filtres"

export type FiltresDuJournalProps = {
  filtres: JournalFilters
  equipes: Resultat<TeamView[]>
  personnes: Resultat<MemberView[]>
  /** L'adresse du journal sans paramètre : l'action du formulaire, et « Retirer les filtres ». */
  adresse: string
  /** L'adresse courante, pour « Réessayer ». */
  ici: string
  filtrePose: boolean
  Lien: LienDeLHote
}

type ChoixDuFiltreProps = {
  nom: "team" | "person"
  libelle: string
  tous: string
  options: Resultat<{ value: string; label: string }[]>
  valeur: string | undefined
  ici: string
  Lien: LienDeLHote
}

/** Une liste d'un filtre, « Tous … » en tête ; sa lecture en échec se dit à sa place, jamais une liste vide. */
function ChoixDuFiltre({ nom, libelle, tous, options, valeur, ici, Lien }: ChoixDuFiltreProps) {
  if (options.error !== undefined) return <ErreurDeLecture message={options.error} href={ici} Lien={Lien} />
  return (
    <Field id={`${TITRE}-${nom}`} label={libelle}>
      <Select name={nom} defaultValue={valeur ?? ""} options={[{ value: "", label: tous }, ...options.data]} />
    </Field>
  )
}

function optionsDe<T>(resultat: Resultat<T[]>, option: (element: T) => { value: string; label: string }) {
  return resultat.error === undefined ? { data: resultat.data.map(option) } : { error: resultat.error }
}

/**
 * Les paramètres de l'adresse de l'action, en champs cachés (l'onglet d'« Activité », 1.4.13) : un formulaire GET
 * remplace la requête de son action par ses champs, et l'onglet serait perdu.
 */
function ParametresDeLAction({ adresse }: { adresse: string }) {
  return [...new URL(adresse, "http://hote.invalid").searchParams].map(([nom, valeur]) => <input key={nom} type="hidden" name={nom} value={valeur} />)
}

export function FiltresDuJournal({ filtres, equipes, personnes, adresse, ici, filtrePose, Lien }: FiltresDuJournalProps) {
  return (
    <form method="get" action={adresse} aria-labelledby={TITRE} className="flex flex-col gap-2">
      <h2 id={TITRE} className="oto-label">
        Filtrer le journal
      </h2>
      <ParametresDeLAction adresse={adresse} />
      <input type="hidden" name="period" value={filtres.period} />
      <div className="flex flex-wrap items-end gap-3">
        <ChoixDuFiltre
          nom="team"
          libelle="Équipe"
          tous="Toutes les équipes"
          options={optionsDe(equipes, (equipe) => ({ value: equipe.id, label: equipe.name }))}
          valeur={filtres.team}
          ici={ici}
          Lien={Lien}
        />
        <ChoixDuFiltre
          nom="person"
          libelle="Personne"
          tous="Toutes les personnes"
          options={optionsDe(personnes, (membre) => ({ value: membre.userId, label: membre.name }))}
          valeur={filtres.person}
          ici={ici}
          Lien={Lien}
        />
        <Checkbox name="errors" value="1" defaultChecked={filtres.errors === "1"} label="Erreurs seulement" />
        <Button type="submit" variant="secondary">
          Filtrer
        </Button>
        {filtrePose && (
          <Lien href={adresse} className="oto-btn anim-host" data-variant="ghost" data-size="md">
            <span>{RETIRER_LES_FILTRES}</span>
          </Lien>
        )}
      </div>
    </form>
  )
}
