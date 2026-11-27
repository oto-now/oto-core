"use client"

// La droite de la rangée d'en-tête d'un contenu (refonte #218, maquette validée, décision de JB du 27/11 sur l'historique) :
// Commentaires, Liens, Historique des versions, puis « Partager » et « ⋯ » (« Plus d'actions »). Le menu « ⋯ » porte,
// chacun seulement si son droit l'offre : « Télécharger en .md » ou « en .csv » (un contenu publié), « Transformer en
// procédure » ou « en page » (qui écrit une page ou une procédure, depuis PR #176), et pour qui écrit un tableau
// « Importer un fichier… » et « Réglages du tableau… », qui ouvrent leur dialogue. Un menu vide n'est pas rendu. L'issue
// d'un geste se dit sous la rangée (`order-last`, pleine largeur). Sous 640 px, « Liens » et « Historique des versions »
// passent de la rangée en tête du menu (maquette « Mobile »), pour que la rangée tienne sur une ligne. Reçoit les liens
// et le partage déjà rendus par le serveur. Sans lui, les gestes rares d'un contenu resteraient en boutons visibles, au même poids que « Partager ».
import { cloneElement, createContext, isValidElement, useContext, useMemo, useRef, useState, type ComponentProps, type ReactElement, type ReactNode, type Ref } from "react"
import { ArrowsLeftRight } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple"
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix"
import { LinkSimple } from "@phosphor-icons/react/dist/csr/LinkSimple"
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple"
import type { TableHeader } from "../../schemas"
import { messageDErreur } from "../api/messages"
import { telechargerLExport } from "../api/telecharger"
import { ImportDeFichier } from "../coque/import-de-fichier"
import { EXPORTS, IMPORT } from "../coque/libelles"
import { useBreakpoint } from "../ds/react/hooks"
import { Icon } from "../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { Popover } from "../ds/react/popover"
import { IconButton } from "../ds/react/primitives"
import { Tooltip } from "../ds/react/tooltip"
import { useRafraichir } from "../hote/rafraichir"
import { ReglagesDuTableau } from "../tableau/options-du-tableau"
import { BoutonDesCommentaires } from "./commentaires/bouton-des-commentaires"
import { useTransformation } from "./genre-du-noeud"
import { useHistorique } from "./historique-du-noeud"
import { ACTIONS } from "./libelles"

/** « Transformer » : le genre montré, ce qui bloque, et les blocs où un refus ancre « Aller au bloc ». */
export type GenreModifiable = { genre: "page" | "procedure"; titre: string; sousUneProcedure: boolean; blocs: readonly { id: string; ref: string }[] }

/** Ce qu'écrit qui écrit un tableau : son en-tête publié, et un changement d'en-tête en attente qui bloque ses réglages. */
export type TableauModifiable = { chemin: string; titre: string; entete: TableHeader; enAttente: boolean }

export type ActionsDuNoeudProps = {
  chemin: string
  /** Un contenu publié se télécharge, et a un historique : son format, nul jamais publié. */
  telechargement: "md" | "csv" | null
  genre: GenreModifiable | null
  tableau: TableauModifiable | null
  /** Le bouton « Liens » et son popover, rendus par le serveur. */
  liens?: ReactNode
  /** « Partager » et son popover, rendus par le serveur ; absent, l'en-tête n'a pas d'accès. */
  partage?: ReactNode
}

const glyphe = (as: Parameters<typeof Icon>[0]["as"]) => <Icon as={as} size="xs" />

/** Le téléchargement depuis le menu : le fichier que compose le service, un refus dit sous la rangée. */
function useTelechargement(chemin: string, format: "md" | "csv" | null) {
  const [refus, setRefus] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  if (format === null) return { entree: null, refus }
  const entree: MenuItem = {
    label: format === "csv" ? EXPORTS.csv : EXPORTS.markdown,
    icon: glyphe(DownloadSimple),
    disabled: enCours,
    onSelect: () => {
      setEnCours(true)
      setRefus(null)
      void telechargerLExport(chemin, format)
        .then((issue) => setRefus(issue.erreur ? messageDErreur(issue.erreur, EXPORTS.refus) : null))
        .finally(() => setEnCours(false))
    },
  }
  return { entree, refus }
}

type EntreesDuMenu = {
  /** Sous 640 px seulement, Liens et Historique, passés de la rangée dans le menu (maquette « Mobile »). */
  liens: (() => void) | null
  historique: (() => void) | null
  telecharger: MenuItem | null
  transformer: MenuItem | null
  importer: (() => void) | null
  regler: (() => void) | null
}

/** Les entrées du menu, dans l'ordre de la maquette, seulement celles que le droit offre. */
function entreesDuMenu(entrees: EntreesDuMenu): MenuItem[] {
  const { liens, historique, telecharger, transformer, importer, regler } = entrees
  return [
    ...(liens ? [{ label: ACTIONS.liens, icon: glyphe(LinkSimple), onSelect: liens }] : []),
    ...(historique ? [{ label: ACTIONS.historique, icon: glyphe(ClockCounterClockwise), onSelect: historique }] : []),
    ...(telecharger ? [telecharger] : []),
    ...(transformer ? [{ ...transformer, icon: glyphe(ArrowsLeftRight) }] : []),
    ...(importer ? [{ label: IMPORT.entree, icon: glyphe(UploadSimple), onSelect: importer }] : []),
    ...(regler ? [{ label: ACTIONS.reglagesDuTableau, icon: glyphe(GearSix), onSelect: regler }] : []),
  ]
}

/** Sous 640 px, ce que la rangée sait du bouton « Liens » pour l'ouvrir depuis « ⋯ » : son déclencheur, s'il est rendu. */
type LiensDansLeMenu = { poser: (declencheur: HTMLElement | null) => void; rendreLeFocus: () => void; etroit: boolean }

const ContexteDesLiens = createContext<LiensDansLeMenu | null>(null)

/**
 * Le popover « Liens » de l'en-tête (`liens-de-l-en-tete.tsx`, qui le rend côté serveur) : son déclencheur se fait
 * connaître de la rangée, dont « ⋯ » l'ouvre sous 640 px, le bouton restant l'ancre du popover. Refermé là, le focus
 * revient à « ⋯ », le bouton invisible ne pouvant le prendre.
 */
export function PopoverDesLiens({ trigger, ...props }: ComponentProps<typeof Popover>) {
  const liens = useContext(ContexteDesLiens)
  const declencheur = isValidElement(trigger) && liens ? cloneElement(trigger as ReactElement<{ ref?: Ref<HTMLElement> }>, { ref: liens.poser }) : trigger
  const refermer = (ouvert: boolean) => {
    if (ouvert || !liens?.etroit) return
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) liens.rendreLeFocus()
    })
  }
  return <Popover {...props} trigger={declencheur} onOpenChange={refermer} />
}

function BoutonDHistorique() {
  const historique = useHistorique()
  if (!historique) return null
  return (
    <Tooltip content={ACTIONS.historique} side="bottom">
      <IconButton label={ACTIONS.historique} size="sm" className="oto-node-action oto-node-history" onClick={() => historique.ouvrir("page")}>
        {glyphe(ClockCounterClockwise)}
      </IconButton>
    </Tooltip>
  )
}

function ActionsAvecTransformation(props: ActionsDuNoeudProps & { genre: GenreModifiable }) {
  const { entree, issue } = useTransformation(props.genre)
  return <Rangee {...props} transformer={entree} issue={issue} />
}

type RangeeProps = ActionsDuNoeudProps & { transformer: MenuItem | null; issue: ReactNode }

/** Sous 640 px, Liens et Historique dans « ⋯ » : le déclencheur des liens que la rangée connaît, et le bouton « ⋯ ». */
function useEntreesEtroites(telechargement: "md" | "csv" | null) {
  const etroit = useBreakpoint("sm")
  const historique = useHistorique()
  const [declencheur, poser] = useState<HTMLElement | null>(null)
  const plus = useRef<HTMLButtonElement>(null)
  const contexte = useMemo(() => ({ poser, rendreLeFocus: () => plus.current?.focus(), etroit }), [etroit])
  return {
    contexte,
    plus,
    liens: etroit && declencheur ? () => declencheur.click() : null,
    historique: etroit && historique && telechargement !== null ? () => historique.ouvrir("page") : null,
  }
}

function Rangee({ chemin, telechargement, tableau, liens, partage, transformer, issue }: RangeeProps) {
  const { entree: telecharger, refus } = useTelechargement(chemin, telechargement)
  const [dialogue, setDialogue] = useState<"import" | "reglages" | null>(null)
  const rafraichir = useRafraichir()
  const etroites = useEntreesEtroites(telechargement)
  const items = entreesDuMenu({
    liens: etroites.liens,
    historique: etroites.historique,
    telecharger,
    transformer,
    importer: tableau ? () => setDialogue("import") : null,
    regler: tableau ? () => setDialogue("reglages") : null,
  })
  return (
    <>
      <BoutonDesCommentaires />
      <ContexteDesLiens.Provider value={etroites.contexte}>{liens}</ContexteDesLiens.Provider>
      {telechargement !== null && <BoutonDHistorique />}
      {partage}
      {items.length > 0 && (
        <DropdownMenu
          align="end"
          className="oto-node-more"
          items={items}
          trigger={
            <IconButton ref={etroites.plus} label={ACTIONS.plusDActions} size="sm" className="oto-node-action">
              {glyphe(DotsThree)}
            </IconButton>
          }
        />
      )}
      {issue}
      {refus && (
        <p role="alert" className="oto-field-error order-last basis-full">
          {refus}
        </p>
      )}
      {tableau && dialogue === "import" && (
        <ImportDeFichier
          cible={{ genre: "tableau", chemin: tableau.chemin, nom: tableau.titre, entete: tableau.entete }}
          fermer={() => setDialogue(null)}
          termine={() => {
            setDialogue(null)
            rafraichir()
          }}
        />
      )}
      {tableau && <ReglagesDuTableau entete={tableau.entete} enAttente={tableau.enAttente} open={dialogue === "reglages"} onClose={() => setDialogue(null)} />}
    </>
  )
}

export function ActionsDuNoeud(props: ActionsDuNoeudProps) {
  // « Transformer » lit la file d'opérations de la page, qui n'est montée que pour qui écrit : son hook vit dans sa branche.
  return props.genre ? <ActionsAvecTransformation {...props} genre={props.genre} /> : <Rangee {...props} transformer={null} issue={null} />
}
