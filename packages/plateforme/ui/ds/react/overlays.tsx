"use client"

// Porté d'oto-frontend (src/design-system/components/react/overlays.jsx, `Anchor` et `DropdownMenu`) :
// une liste d'actions ancrée sur SON déclencheur (le déclencheur est l'ancre, jamais une enveloppe en
// `display: contents`, que rien ne mesure), montée dans un portail pour ne pas être découpée par son
// îlot, fermée par Échap et le clic extérieur, parcourue aux flèches ; tels quels, en TypeScript.
// Changé : le portail se monte dans la racine `.oto` du déclencheur, qui porte les jetons ; Échap et un
// choix rendent le focus au déclencheur ; le menu désigne sa ligne surlignée (`aria-activedescendant`),
// ses lignes sont hors de la tabulation ; l'écran peut l'ouvrir sans lui donner le focus (E05-S11, AC-28). Ajouté (#221) :
// une tête qui ne s'active pas (`head`, la personne du menu du compte), un titre de groupe qui porte une image (le logo de
// l'organisation), une ligne à interrupteur (`switch`, le mode sombre). Retiré :
// `Popover`, `Tooltip`, `Drawer` (la coque ne les emploie pas) ; `Dialog` et `CommandPalette` vivent à
// côté (`dialog.tsx`, `command-palette.tsx`) ; l'`Anchor` vit dans `anchor.tsx`, partagé avec `Popover` et `Tooltip`.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Anchor } from "./anchor"
import { useAnchor, useDismiss, useIsoLayoutEffect, useRovingFocus } from "./hooks"
import { cx } from "./outils"

/** Un élément du menu : une action, un choix (`radio`, `checked`, `switch`), un titre de groupe (son `icon` le précède) ou un filet. */
export type MenuItem = {
  label?: string
  icon?: ReactNode
  shortcut?: string
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
  checked?: boolean
  radio?: boolean
  /** Avec `checked` : un interrupteur en fin de ligne au lieu de la coche en tête (`menuitemcheckbox`). */
  switch?: boolean
  meta?: ReactNode
  /** L'item bascule sans fermer le menu. */
  keepOpen?: boolean
  separator?: boolean
  group?: string
}

/**
 * Monté hors de l'îlot, pour ne pas être découpé par son `overflow` : dans la racine `.oto` du
 * déclencheur, qui porte les jetons (oto-frontend pose `.oto` sur `<html>` et monte dans `body` ; ici
 * la racine est la `CoquilleOto` de l'hôte), sinon dans `body`.
 */
export const Portail = ({ children, conteneur }: { children: ReactNode; conteneur: Element | null }) =>
  typeof document === "undefined" ? null : createPortal(children, conteneur ?? document.body)

/** La racine `.oto` d'un élément, où ses flottants se montent. */
export const racineOto = (element: Element | null): Element | null => element?.closest(".oto") ?? null

const COCHE = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

type LigneProps = { id: string; item: MenuItem; surligne: boolean; surSurvol: () => void; choisir: () => void }

/**
 * Une ligne du menu : `menuitemradio` (coche en fin de ligne), `menuitemcheckbox` (coche en tête) ou
 * `menuitem`. Hors de la tabulation : le focus reste sur le menu, qui désigne la ligne surlignée.
 */
function LigneDeMenu({ id, item, surligne, surSurvol, choisir }: LigneProps) {
  const radio = item.radio === true
  const interrupteur = item.switch === true && item.checked !== undefined
  const coche = (radio || (item.checked !== undefined && !interrupteur)) && (
    <span className="oto-menu-check" aria-hidden="true">
      {item.checked && COCHE}
    </span>
  )
  const role = radio ? "menuitemradio" : item.checked !== undefined ? "menuitemcheckbox" : "menuitem"
  return (
    <button
      type="button"
      id={id}
      tabIndex={-1}
      role={role}
      className="oto-menu-item anim-host"
      data-highlighted={surligne ? "" : undefined}
      data-destructive={item.destructive ? "" : undefined}
      aria-disabled={item.disabled || undefined}
      aria-checked={radio ? item.checked === true : item.checked}
      onMouseEnter={surSurvol}
      onClick={choisir}
    >
      {!radio && coche}
      {item.icon}
      <span className="oto-menu-label">{item.label}</span>
      {item.meta != null && <span className="oto-pop-meta">{item.meta}</span>}
      {item.shortcut && <span className="oto-menu-shortcut">{item.shortcut}</span>}
      {radio && coche}
      {/* La piste de `Switch` (`choice.css`), décorative : l'état est `aria-checked` de la ligne. */}
      {interrupteur && <span className="oto-switch-track" aria-hidden="true" />}
    </button>
  )
}

type MenuDesItemsProps = { idDesLignes: string; items: MenuItem[]; parcourus: MenuItem[]; index: number; surSurvol: (rang: number) => void; choisir: (item: MenuItem) => void }

function MenuDesItems({ idDesLignes, items, parcourus, index, surSurvol, choisir }: MenuDesItemsProps) {
  return (
    <div className="oto-menu">
      {items.map((item, rang) => {
        if (item.separator) return <div key={`filet-${rang}`} className="oto-menu-sep" role="separator" />
        if (item.group) {
          return item.icon ? (
            <p key={`groupe-${rang}`} className="oto-menu-group-label" data-icon="">
              {item.icon}
              <span>{item.group}</span>
            </p>
          ) : (
            <p key={`groupe-${rang}`} className="oto-menu-group-label">
              {item.group}
            </p>
          )
        }
        const mien = parcourus.indexOf(item)
        return <LigneDeMenu key={`${rang}-${item.label}`} id={`${idDesLignes}-${mien}`} item={item} surligne={index === mien} surSurvol={() => surSurvol(mien)} choisir={() => choisir(item)} />
      })}
    </div>
  )
}

type DropdownMenuProps = {
  trigger: ReactNode
  items: MenuItem[]
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  className?: string
  /**
   * Ouvert par l'écran, le focus laissé où il est (E05-S11, AC-28 : tout le texte d'un bloc sélectionné) ; toute
   * fermeture (choix, Échap, clic dehors, déclencheur) appelle `surFermeture`, qui le repasse à `false`.
   */
  ouvertSansFocus?: boolean
  surFermeture?: () => void
  /** En tête du menu, au-dessus des lignes, ce qui ne s'active pas (la personne du menu du compte, #221). */
  head?: ReactNode
}

/** Un menu d'actions : choisir ferme, sauf un item `keepOpen` ; les filets et les titres ne se parcourent pas. */
export function DropdownMenu({ trigger, items, side = "bottom", align = "start", className, ouvertSansFocus = false, surFermeture, head }: DropdownMenuProps) {
  const [open, setOuvert] = useState(false)
  const ouvert = open || ouvertSansFocus
  const [conteneur, setConteneur] = useState<Element | null>(null)
  const idDesLignes = useId()
  const anchorRef = useRef<HTMLElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const placed = useAnchor(anchorRef, floatRef, { open: ouvert, side, align })
  const fermeture = useRef(surFermeture)
  useIsoLayoutEffect(() => {
    fermeture.current = surFermeture
  })
  const setOpen = useCallback((ouvrir: boolean) => {
    if (ouvrir) setConteneur(racineOto(anchorRef.current))
    setOuvert(ouvrir)
    if (!ouvrir) fermeture.current?.()
  }, [])
  const fermer = useCallback(() => setOpen(false), [setOpen])
  useDismiss(ouvert, fermer, [anchorRef, floatRef])
  // Ouvert par l'écran : monté, comme au clic, dans la racine `.oto` du déclencheur, qui porte les jetons.
  useIsoLayoutEffect(() => {
    if (ouvertSansFocus) setConteneur(racineOto(anchorRef.current))
  }, [ouvertSansFocus])

  const parcourus = items.filter((item) => !item.separator && !item.group)
  const choisir = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return
    item.onSelect?.()
    if (item.keepOpen) return
    setOpen(false)
    // Le menu part avec le focus : il revient au déclencheur (oto-frontend le laissait tomber sur la page).
    // Un dialogue ouvert par l'item le prend ensuite, et le rend à ce déclencheur en se fermant.
    anchorRef.current?.focus()
  }
  const { index, setIndex, onKeyDown } = useRovingFocus(parcourus.length, { open: ouvert, onSelect: (rang) => choisir(parcourus[rang]) })

  // Seul un menu ouvert par son déclencheur prend le focus.
  useEffect(() => {
    if (open) floatRef.current?.focus()
  }, [open])

  const ouvrirAuClavier = (evenement: { key: string; preventDefault: () => void }) => {
    if (evenement.key !== "ArrowDown" || ouvert) return
    evenement.preventDefault()
    setOpen(true)
  }
  // Échap rend le focus au déclencheur (le menu part avec lui) ; oto-frontend le laissait tomber sur la page.
  const surToucheDuMenu = (evenement: { key: string; preventDefault: () => void }) => {
    if (evenement.key === "Escape") anchorRef.current?.focus()
    onKeyDown(evenement)
  }

  return (
    <>
      <Anchor ref={anchorRef} onClick={() => setOpen(!ouvert)} onKeyDown={ouvrirAuClavier} aria-expanded={ouvert} aria-haspopup="menu">
        {trigger}
      </Anchor>
      {ouvert && (
        <Portail conteneur={conteneur}>
          <div
            ref={floatRef}
            role="menu"
            tabIndex={-1}
            className={cx("oto-pop", className)}
            data-side={placed.side}
            style={{ top: placed.top, left: placed.left, outline: "none" }}
            // Le menu garde le focus ; la ligne surlignée est celle que le lecteur d'écran annonce.
            aria-activedescendant={index >= 0 ? `${idDesLignes}-${index}` : undefined}
            onKeyDown={surToucheDuMenu}
          >
            {head != null && <div className="oto-menu-head">{head}</div>}
            <MenuDesItems idDesLignes={idDesLignes} items={items} parcourus={parcourus} index={index} surSurvol={setIndex} choisir={choisir} />
          </div>
        </Portail>
      )}
    </>
  )
}
