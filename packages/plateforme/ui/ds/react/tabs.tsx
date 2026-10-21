"use client"

// Porté d'oto-frontend (src/design-system/components/react/navigation.jsx, `Tabs` et `TabsBase`) : ils
// CHANGENT LA VUE, un état local de l'écran. Motif ARIA complet : `tablist` / `tab` / `tabpanel`, un seul
// onglet dans la tabulation, les flèches, Début et Fin, activation automatique (le contenu est déjà là).
// Tel quel, en TypeScript. Retiré : la variante `card` (`CardTabs`) et ses comptes, `disabled`, icônes et
// badges, qu'aucun écran ne demande ; les panneaux cachés : seul celui de l'onglet choisi est rendu.
// Changé : les identifiants se bâtissent sur le rang de l'onglet, non sur sa valeur, qui peut contenir une
// espace ; `aria-controls` n'est posé que sur l'onglet choisi.
// Voisins : `Onglets` (`equipes/onglets.tsx`) quand l'onglet est dans l'adresse, `SegmentedControl` pour
// un filtre. 1.4.13 : `aside`, ce qui partage la ligne des onglets (les filtres de l'accueil), après eux dans l'ordre de
// tabulation et avant le panneau ; la ligne passe à la ligne quand la place manque.
import { useId, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react"
import { useControllable } from "./hooks"

export type Tab = { value: string; label: ReactNode }

type TabsProps = Omit<ComponentProps<"div">, "onChange" | "defaultValue" | "children"> & {
  tabs: readonly Tab[]
  value?: string
  defaultValue?: string
  onChange?: (valeur: string) => void
  /** Nomme la barre : un `tablist` anonyme n'apporte rien. */
  label: string
  /** Ce qui se pose sur la ligne des onglets, à droite (des filtres) ; sans lui, la barre seule. */
  aside?: ReactNode
  /** Le contenu de l'onglet choisi. */
  children: ReactNode
}

type BoutonsProps = {
  tabs: readonly Tab[]
  active: string
  base: string
  boutons: { current: (HTMLButtonElement | null)[] }
  choisir: (valeur: string) => void
}

function BoutonsDOnglets({ tabs, active, base, boutons, choisir }: BoutonsProps) {
  return tabs.map((tab, rang) => {
    const choisi = tab.value === active
    return (
      <button
        key={tab.value}
        ref={(bouton) => {
          boutons.current[rang] = bouton
        }}
        type="button"
        role="tab"
        id={`${base}-tab-${rang}`}
        className="oto-tab anim-host"
        aria-selected={choisi}
        aria-controls={choisi ? `${base}-panel` : undefined}
        tabIndex={choisi ? 0 : -1}
        onClick={() => choisir(tab.value)}
      >
        {tab.label}
      </button>
    )
  })
}

/** La barre des onglets, seule ou sur sa ligne partagée. */
function BarreDOnglets({ label, surTouche, children }: { label: string; surTouche: (evenement: KeyboardEvent<HTMLDivElement>) => void; children: ReactNode }) {
  return (
    <div className="oto-tabs" role="tablist" aria-label={label} onKeyDown={surTouche}>
      {children}
    </div>
  )
}

export function Tabs({ tabs, value, defaultValue, onChange, label, aside, className, children, ...rest }: TabsProps) {
  const [active, setActive] = useControllable(value, defaultValue ?? tabs[0]?.value ?? "", onChange)
  const boutons = useRef<(HTMLButtonElement | null)[]>([])
  const base = useId()
  const rangActif = tabs.findIndex((tab) => tab.value === active)

  const surTouche = (evenement: KeyboardEvent<HTMLDivElement>) => {
    const aller = (vers: number) => {
      const rang = (vers + tabs.length) % tabs.length
      setActive(tabs[rang].value)
      boutons.current[rang]?.focus()
    }
    const gestes: Record<string, () => void> = {
      ArrowRight: () => aller(rangActif + 1),
      ArrowLeft: () => aller(rangActif - 1),
      Home: () => aller(0),
      End: () => aller(tabs.length - 1),
    }
    const geste = gestes[evenement.key]
    if (!geste) return
    evenement.preventDefault()
    geste()
  }

  return (
    <div {...rest} className={className}>
      {aside === undefined ? (
        <BarreDOnglets label={label} surTouche={surTouche}>
          <BoutonsDOnglets tabs={tabs} active={active} base={base} boutons={boutons} choisir={setActive} />
        </BarreDOnglets>
      ) : (
        <div className="oto-tabs-row">
          <BarreDOnglets label={label} surTouche={surTouche}>
            <BoutonsDOnglets tabs={tabs} active={active} base={base} boutons={boutons} choisir={setActive} />
          </BarreDOnglets>
          <div className="oto-tabs-aside">{aside}</div>
        </div>
      )}
      {/* `tabIndex={0}` : le panneau s'ouvre sur du texte, il doit être atteignable au clavier (motif APG). */}
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${rangActif}`} className="oto-tabpanel" tabIndex={0}>
        {children}
      </div>
    </div>
  )
}
