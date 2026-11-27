"use client"

// Le filtre d'une colonne (E07-S03, AC6 ; H95), le second bouton de l'en-tête : « Filtrer sur <colonne> »,
// qui ouvre un panneau ; le filtre est soumis, jamais appliqué à la frappe ; « Retirer » n'apparaît que s'il
// y a un filtre à retirer, à l'autre bout de la ligne ; le bouton reste visible et enfoncé tant qu'un filtre
// est posé. Les champs dépendent du type (« Contient » ; « Égal à » parmi les options, ou Oui / Non ; « Au
// moins » et « Au plus ») et, pour toute colonne, « Vide » ou « Rempli ». Reçoit des données, jamais une
// fonction : l'envoi lit ses champs comme le ferait un formulaire GET, les traduit dans la grammaire de
// l'adresse et navigue par l'hôte (`useHote`) ; sans JavaScript, le formulaire part vers `adresse`, que la
// page réécrit. Sans lui, aucune colonne ne se filtre à l'écran.
//
// Porté d'oto-frontend (`src/components/noeud/filtre-de-colonne.tsx`) : le `Popover` du design system,
// l'`IconButton` et son `aria-pressed`, l'intitulé du panneau, « Filtrer » et « Retirer » aux deux bouts.
// Changé : les champs par type (H95) au lieu du seul « Contient… », étiquetés ; le focus entre dans le
// panneau à l'ouverture et revient au bouton à Échap et après un envoi. Retiré : l'état du brouillon, que
// les champs non contrôlés tiennent.
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel"
import { GRID_SEARCH_MAX, type TableColumn, type TableHeader } from "../../schemas"
import { Field, Input } from "../ds/react/forms"
import { AnimatedIcon } from "../ds/react/icon"
import { Popover, PopoverBody } from "../ds/react/popover"
import { Button, IconButton } from "../ds/react/primitives"
import { Radio, RadioGroup } from "../ds/react/radio"
import { Select } from "../ds/react/select"
import { useHote } from "../hote/navigation"
import {
  adresseDuTableau,
  CHAMP_DE_L_OPERATION,
  champsGardes,
  operationsDe,
  parametresDuFormulaire,
  reglagesDepuisLAdresse,
  sansFiltres,
  type Clause,
  type Operation,
  type OperationSaisie,
  type Reglages,
} from "./adresse"
import { GRILLE, libelleDeColonne, OPERATIONS_LUES, TEXTES_DE_CELLULE } from "./libelles"

export type FiltreDeColonneProps = {
  colonne: TableColumn
  /** L'en-tête du tableau : les champs envoyés se lisent contre lui, comme la page lit l'adresse. */
  entete: TableHeader
  reglages: Reglages
  /** L'adresse du tableau sans paramètre : l'action du formulaire, et la base de l'adresse suivante. */
  adresse: string
}

const valeurPosee = (posees: readonly Clause[], operation: Operation) => posees.find((clause) => clause.operation === operation)?.valeur ?? ""

/** Le champ d'une opération, étiqueté, au type de la colonne ; sa valeur est celle de la clause posée. */
function ChampDOperation({ operation, colonne, posees }: { operation: OperationSaisie; colonne: TableColumn; posees: readonly Clause[] }) {
  const defaut = valeurPosee(posees, operation)
  if (operation === "eq") {
    const options = colonne.type === "bool" ? [{ value: "true", label: TEXTES_DE_CELLULE.oui }, { value: "false", label: TEXTES_DE_CELLULE.non }] : (colonne.options ?? []).map((option) => ({ value: option, label: option }))
    return (
      <Field label={OPERATIONS_LUES.eq}>
        <Select name={CHAMP_DE_L_OPERATION.eq} size="sm" defaultValue={defaut} options={[{ value: "", label: GRILLE.peuImporte }, ...options]} />
      </Field>
    )
  }
  const type = operation === "contains" ? "text" : colonne.type === "number" ? "number" : colonne.type === "date" ? "date" : "datetime-local"
  return (
    <Field label={OPERATIONS_LUES[operation]}>
      <Input name={CHAMP_DE_L_OPERATION[operation]} type={type} size="sm" step={type === "number" ? "any" : undefined} defaultValue={defaut} maxLength={type === "text" ? GRID_SEARCH_MAX : undefined} />
    </Field>
  )
}

/** « Vide » ou « Rempli », pour toute colonne (AC6) : trois choix, « Peu importe » d'abord. */
function Presence({ posees }: { posees: readonly Clause[] }) {
  const posee = posees.find((clause) => clause.operation === "empty" || clause.operation === "not_empty")?.operation ?? ""
  const choix: [string, string][] = [
    ["", GRILLE.peuImporte],
    ["empty", OPERATIONS_LUES.empty],
    ["not_empty", OPERATIONS_LUES.not_empty],
  ]
  return (
    <RadioGroup legend={GRILLE.presence} orientation="horizontal">
      {choix.map(([valeur, texte]) => (
        <Radio key={valeur} name="presence" value={valeur} defaultChecked={posee === valeur} label={texte} />
      ))}
    </RadioGroup>
  )
}

/** Les champs du panneau : les opérations saisies du type (AC6), puis la présence, que toute colonne prend. */
function ChampsDuFiltre({ colonne, posees }: { colonne: TableColumn; posees: readonly Clause[] }) {
  const saisies = operationsDe(colonne).filter((operation): operation is OperationSaisie => operation !== "empty" && operation !== "not_empty")
  return (
    <>
      {saisies.map((operation) => (
        <ChampDOperation key={operation} operation={operation} colonne={colonne} posees={posees} />
      ))}
      <Presence posees={posees} />
    </>
  )
}

/** Les réglages gardés (la recherche, le tri, les filtres des autres colonnes) et la colonne, en champs cachés. */
function ChampsCaches({ reglages, colonne }: { reglages: Reglages; colonne: string }) {
  return (
    <>
      {champsGardes(reglages, { colonne }).map(([nom, valeur], rang) => (
        // Un champ caché n'a pas d'identité : son rang dans la liste des réglages gardés.
        <input key={`${nom}-${rang}`} type="hidden" name={nom} value={valeur} />
      ))}
      <input type="hidden" name="column" value={colonne} />
    </>
  )
}

export function FiltreDeColonne({ colonne, entete, reglages, adresse }: FiltreDeColonneProps) {
  const { naviguer } = useHote()
  const [open, setOuvert] = useState(false)
  const declencheur = useRef<HTMLButtonElement>(null)
  const panneau = useRef<HTMLFormElement>(null)
  const posees = reglages.clauses.filter((clause) => clause.colonne === colonne.name)
  const titre = GRILLE.filtrerSur(libelleDeColonne(colonne))

  // Monté dans la racine `.oto`, le panneau est loin du bouton dans l'ordre de tabulation : le focus y entre, sur son premier champ.
  useEffect(() => {
    if (open) panneau.current?.querySelector<HTMLElement>("input:not([type='hidden']), [role='combobox']")?.focus()
  }, [open])

  const aller = (suivante: string) => {
    setOuvert(false)
    declencheur.current?.focus()
    naviguer(suivante)
  }

  const appliquer = (evenement: FormEvent<HTMLFormElement>) => {
    evenement.preventDefault()
    const lus = reglagesDepuisLAdresse(parametresDuFormulaire(new FormData(evenement.currentTarget)), entete)
    aller(adresseDuTableau(adresse, lus))
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOuvert}
      align="end"
      // Un dialogue sans nom n'existe pas pour un lecteur d'écran : le panneau porte celui de son bouton.
      aria-label={titre}
      trigger={
        // `aria-pressed` dit l'état du filtre, pas l'ouverture du panneau : un filtre posé se lit sans rien ouvrir.
        <IconButton ref={declencheur} size="sm" label={titre} pressed={posees.length > 0}>
          <AnimatedIcon as={Funnel} anim="sift" size="xs" />
        </IconButton>
      }
    >
      <PopoverBody>
        <form
          ref={panneau}
          method="get"
          action={adresse}
          aria-label={titre}
          onSubmit={appliquer}
          // Échap ferme le panneau (le design system) ; le focus revient d'abord au bouton qui l'a ouvert.
          onKeyDown={(evenement) => {
            if (evenement.key === "Escape") declencheur.current?.focus()
          }}
          className="flex flex-col gap-3"
        >
          <ChampsCaches reglages={reglages} colonne={colonne.name} />
          <p className="oto-pop-label">{titre}</p>
          <ChampsDuFiltre colonne={colonne} posees={posees} />
          {/* « Retirer » à l'autre bout : les deux gestes vont en sens inverse. */}
          <div className="flex items-center justify-between gap-2">
            <Button type="submit" size="sm">
              {GRILLE.filtrer}
            </Button>
            {posees.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => aller(adresseDuTableau(adresse, sansFiltres(reglages, colonne.name)))}>
                {GRILLE.retirer}
                <span className="oto-sr-only">{GRILLE.leFiltreDe(libelleDeColonne(colonne))}</span>
              </Button>
            )}
          </div>
        </form>
      </PopoverBody>
    </Popover>
  )
}
