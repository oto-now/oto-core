"use client"

// La liste de choix du paquet (E05-S11 lot f, retour 8, AC-19 à AC-21 ; HN-E05S11-14) : un déclencheur au bord
// entièrement arrondi, celui de « Partager · Tout le monde » (`oto-scope`), qui ouvre un popover de choix, motif
// APG « select-only combobox » : le focus reste sur le déclencheur, qui désigne l'option surlignée
// (`aria-activedescendant`) ; flèches, Début, Fin, frappe de l'initiale, Entrée et Espace choisissent, Échap
// referme et garde le focus. Porté d'oto-frontend (`selects.jsx`, `Combobox`) sans son champ de recherche : aucune
// liste du paquet ne passe vingt options (hors périmètre). Changé : le popover se monte dans la couche du
// déclencheur (le panneau `.oto-pop` ou le `<dialog>` qui le contient, sinon la racine `.oto`) : monté plus haut,
// un choix dans « Partager » refermait le panneau (HN-E05S10b-4), et un `<dialog>` modal rend le reste inerte.
// La valeur part avec le formulaire par une entrée cachée (`name`) ; `ref` (celle de `register`) vise l'enveloppe,
// où React Hook Form trouve cette entrée : une valeur qu'il y écrit (`reset`, `setValue`) se montre.
import { Children, forwardRef, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react"
import { useAnchor, useDismiss, useIsoLayoutEffect } from "./hooks"
import { cx } from "./outils"
import { ListeDesChoix } from "./select-liste"
import { Portail, racineOto } from "./overlays"

/**
 * Un choix. `description` : une ligne fine sous le libellé, qui dit ce que le choix permet (les niveaux d'accès, 1.4.13) ;
 * `icon` : son glyphe, devant. Le nom du choix reste son libellé (`aria-labelledby`), la description le décrit
 * (`aria-describedby`), et la liste s'élargit pour la tenir.
 */
export type SelectOption = { value: string; label: string; disabled?: boolean; group?: string; description?: string; icon?: ReactNode }

/** Ce que reçoivent `onChange` et `onBlur` : l'entrée cachée, sa valeur posée ; la forme d'évènement que lit `register`. */
export type SelectEvent = { target: HTMLInputElement; type: "change" | "blur" }

type SelectProps = {
  id?: string
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (evenement: SelectEvent) => void
  onBlur?: (evenement: SelectEvent) => void
  size?: "sm" | "md" | "lg"
  /** Les choix ; sinon des `<option>` (et `<optgroup>`) en enfants, lus comme une liste native. */
  options?: SelectOption[]
  children?: ReactNode
  /** Le texte du déclencheur tant que la valeur ne nomme aucun choix. */
  placeholder?: string
  disabled?: boolean
  required?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

type ProprietesDOption = { value?: string | number; disabled?: boolean; children?: ReactNode; label?: string }

const texteDe = (enfants: ReactNode): string =>
  Children.toArray(enfants)
    .map((enfant) => (typeof enfant === "string" || typeof enfant === "number" ? String(enfant) : ""))
    .join("")

/** Des `<option>` et `<optgroup>` en enfants, lus comme les lit une liste native. */
function optionsDesEnfants(enfants: ReactNode, group?: string): SelectOption[] {
  return Children.toArray(enfants).flatMap((enfant): SelectOption[] => {
    if (!isValidElement(enfant)) return []
    // Un enfant de la liste est un `<option>` ou un `<optgroup>`, dont les props sont celles du DOM.
    const { props } = enfant as ReactElement<ProprietesDOption>
    if (enfant.type === "optgroup") return optionsDesEnfants(props.children, props.label)
    if (enfant.type !== "option") return []
    const label = texteDe(props.children)
    return [{ value: props.value === undefined ? label : String(props.value), label, disabled: props.disabled, group }]
  })
}

const sansAccent = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/** La première option choisissable dont le libellé commence par la frappe, cherchée à partir de `depuis`, en boucle. */
function optionFrappee(options: readonly SelectOption[], frappe: string, depuis: number): number {
  const cherche = sansAccent(frappe)
  for (let pas = 0; pas < options.length; pas += 1) {
    const rang = (depuis + pas) % options.length
    if (!options[rang].disabled && sansAccent(options[rang].label).startsWith(cherche)) return rang
  }
  return -1
}

/** Le rang choisissable suivant dans le sens `sens`, sans boucler (APG) ; `courant` s'il n'y en a pas. */
function rangVoisin(options: readonly SelectOption[], courant: number, sens: 1 | -1): number {
  for (let rang = courant + sens; rang >= 0 && rang < options.length; rang += sens) if (!options[rang].disabled) return rang
  return courant
}

const premierChoisissable = (options: readonly SelectOption[]) => options.findIndex((option) => !option.disabled)
const dernierChoisissable = (options: readonly SelectOption[]) => options.findLastIndex((option) => !option.disabled)

/**
 * Suit les écritures de la valeur de l'entrée cachée (React Hook Form l'écrit directement, sans évènement) : le
 * descripteur en place (celui du suivi de React, sinon celui du prototype) est enveloppé, jamais remplacé.
 */
function suivreLesEcritures(entree: HTMLInputElement, surEcriture: (valeur: string) => void) {
  const enPlace = Object.getOwnPropertyDescriptor(entree, "value") ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  if (!enPlace?.get || !enPlace.set) return
  const { get, set } = enPlace
  Object.defineProperty(entree, "value", {
    configurable: true,
    get() {
      return get.call(this)
    },
    set(valeur: unknown) {
      set.call(this, valeur)
      surEcriture(String(valeur ?? ""))
    },
  })
}

const CHEVRON = (
  <svg className="oto-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/** La couche où le popover se monte : le panneau ou le dialogue qui contient le déclencheur, sinon la racine `.oto`. */
const coucheDe = (element: Element | null): Element | null => element?.closest(".oto-pop, dialog") ?? racineOto(element)

/** Ce que l'ouverture lit du déclencheur : où monter la liste, son nom, sa largeur. */
type Ouverture = { couche: Element | null; nom: string | undefined; largeur: number | undefined }

const imprimable = (evenement: KeyboardEvent) => evenement.key.length === 1 && !evenement.ctrlKey && !evenement.metaKey && !evenement.altKey

/**
 * L'entrée cachée, valeur du formulaire : une écriture de React Hook Form (`reset`, `setValue`) s'y montre
 * (`surEcriture`), et le focus qu'il lui demande (première erreur) va au déclencheur.
 */
function useEntreeSuivie(valeur: string, surEcriture: (valeur: string) => void, declencheur: RefObject<HTMLButtonElement | null>) {
  const entree = useRef<HTMLInputElement | null>(null)
  const courante = useRef(valeur)
  useIsoLayoutEffect(() => {
    courante.current = valeur
  })
  const suivre = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && entree.current !== element) {
        suivreLesEcritures(element, (ecrite) => {
          if (ecrite !== courante.current) surEcriture(ecrite)
        })
        element.focus = () => declencheur.current?.focus()
      }
      entree.current = element
    },
    [surEcriture, declencheur],
  )
  return { entree, suivre }
}

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(props, ref) {
  const { id, name, value, defaultValue, onChange, onBlur, size = "md", options: donnees, children, placeholder, disabled, required, className } = props
  const options = donnees ?? optionsDesEnfants(children)
  const [interne, setInterne] = useState(defaultValue ?? options.find((option) => !option.disabled)?.value ?? "")
  // Comme une liste native : une valeur qui ne nomme aucun choix (adresse périmée, choix retiré par une relecture)
  // montre et envoie le premier choix disponible.
  const valeur = value ?? (options.some((option) => option.value === interne) ? interne : (options[premierChoisissable(options)]?.value ?? ""))
  const [ouverture, setOuverture] = useState<Ouverture | null>(null)
  const ouvert = ouverture !== null
  const [index, setIndex] = useState(-1)
  const listId = useId()
  const declencheur = useRef<HTMLButtonElement>(null)
  const flottant = useRef<HTMLDivElement>(null)
  const frappe = useRef({ texte: "", jusqua: 0 })
  const placed = useAnchor(declencheur, flottant, { open: ouvert, side: "bottom", align: "start" })

  const { entree, suivre } = useEntreeSuivie(valeur, setInterne, declencheur)

  const choisie = options.find((option) => option.value === valeur)
  const fermer = useCallback(() => {
    setOuverture(null)
    // Une frappe commencée avant la fermeture ne se prolonge pas dans la suivante.
    frappe.current = { texte: "", jusqua: 0 }
  }, [])
  useDismiss(ouvert, fermer, [declencheur, flottant])

  useEffect(() => {
    if (ouvert && index >= 0) document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: "nearest" })
  }, [ouvert, index, listId])

  function ouvrir(rang: number) {
    const element = declencheur.current
    setOuverture({ couche: coucheDe(element), nom: props["aria-label"] ?? element?.labels?.[0]?.textContent ?? undefined, largeur: element?.offsetWidth })
    setIndex(rang)
  }

  function choisir(rang: number) {
    const option = options[rang]
    const element = entree.current
    if (!option || option.disabled || !element) return
    fermer()
    if (option.value === valeur) return
    element.value = option.value
    onChange?.({ target: element, type: "change" })
  }

  function frapper(touche: string): number {
    const maintenant = Date.now()
    const suite = maintenant < frappe.current.jusqua ? frappe.current.texte + touche : touche
    frappe.current = { texte: suite, jusqua: maintenant + 500 }
    const depuis = Math.max(0, ouvert ? index : options.findIndex((option) => option.value === valeur))
    // La même initiale répétée passe au choix suivant qui la porte, comme dans une liste native.
    const cherche = [...suite].every((lettre) => lettre === suite[0]) ? suite[0] : suite
    return optionFrappee(options, cherche, cherche.length === 1 ? depuis + 1 : depuis)
  }

  function surToucheFermee(evenement: KeyboardEvent<HTMLButtonElement>) {
    const actuel = options.findIndex((option) => option.value === valeur)
    const depart = actuel >= 0 ? actuel : premierChoisissable(options)
    const gestes: Record<string, () => void> = {
      ArrowDown: () => ouvrir(depart),
      ArrowUp: () => ouvrir(depart),
      Enter: () => ouvrir(depart),
      " ": () => ouvrir(depart),
      Home: () => ouvrir(premierChoisissable(options)),
      End: () => ouvrir(dernierChoisissable(options)),
    }
    const geste = gestes[evenement.key]
    if (geste) {
      evenement.preventDefault()
      geste()
      return
    }
    if (!imprimable(evenement)) return
    const rang = frapper(evenement.key)
    if (rang >= 0) ouvrir(rang)
  }

  function surToucheOuverte(evenement: KeyboardEvent<HTMLButtonElement>) {
    if (evenement.key === "Escape") {
      // Échap referme la liste seule : ni le panneau ni le dialogue qui la contiennent (leur écoute est sur `document`).
      evenement.preventDefault()
      evenement.stopPropagation()
      evenement.nativeEvent.stopImmediatePropagation()
      fermer()
      return
    }
    if (evenement.key === "Tab") {
      fermer()
      return
    }
    const gestes: Record<string, () => void> = {
      ArrowDown: () => setIndex(rangVoisin(options, index, 1)),
      ArrowUp: () => (evenement.altKey ? choisir(index) : setIndex(rangVoisin(options, index, -1))),
      Home: () => setIndex(premierChoisissable(options)),
      End: () => setIndex(dernierChoisissable(options)),
      Enter: () => choisir(index),
      " ": () => choisir(index),
    }
    const geste = gestes[evenement.key]
    if (geste) {
      evenement.preventDefault()
      geste()
      return
    }
    if (!imprimable(evenement)) return
    const rang = frapper(evenement.key)
    if (rang >= 0) setIndex(rang)
  }

  return (
    <div ref={ref} className={cx("oto-select", className)}>
      <button
        ref={declencheur}
        type="button"
        id={id}
        role="combobox"
        // La valeur se lit sur le déclencheur comme sur une liste native ; un bouton sans `name` n'envoie rien.
        value={valeur}
        className="oto-scope oto-select-trigger"
        data-size={size}
        disabled={disabled}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? listId : undefined}
        aria-activedescendant={ouvert && index >= 0 ? `${listId}-${index}` : undefined}
        onClick={() => (ouvert ? fermer() : ouvrir(Math.max(0, options.findIndex((option) => option.value === valeur))))}
        onKeyDown={(evenement) => (ouvert ? surToucheOuverte(evenement) : surToucheFermee(evenement))}
        // Espace agit à l'appui : son relâchement ne doit pas cliquer le déclencheur une seconde fois.
        onKeyUp={(evenement) => evenement.key === " " && evenement.preventDefault()}
        onBlur={() => {
          fermer()
          if (entree.current) onBlur?.({ target: entree.current, type: "blur" })
        }}
      >
        <span className="oto-select-value" data-placeholder={choisie ? undefined : ""}>
          {choisie?.label ?? placeholder ?? ""}
        </span>
        {CHEVRON}
      </button>
      <input ref={suivre} type="hidden" name={name} value={valeur} disabled={disabled} />
      {ouverture && (
        <Portail conteneur={ouverture.couche}>
          <div
            ref={flottant}
            className="oto-pop oto-select-pop"
            data-side={placed.side}
            style={{ top: placed.top, left: placed.left, minInlineSize: ouverture.largeur }}
            // Un appui dans la liste garde le focus au déclencheur, qui la commande.
            onMouseDown={(evenement) => evenement.preventDefault()}
          >
            <ListeDesChoix id={listId} nom={ouverture.nom} options={options} valeur={valeur} index={index} surSurvol={setIndex} choisir={choisir} />
          </div>
        </Portail>
      )}
    </div>
  )
})
