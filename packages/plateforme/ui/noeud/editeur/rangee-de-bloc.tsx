"use client"

// Une rangée de l'éditeur (E05-S02 ; E05-S08, AC1 à AC9 ; E05-S09, partie c1 ; E05-S10, AC-a2 à AC-a4, AC-a8) :
// la gouttière (« Ajouter un bloc après » et la poignée « Actions sur ce bloc »), puis le champ du bloc, monté quand
// le bloc est touché, lu sinon (1.1.3, qui remplace le champ toujours monté de la fiche D21 B). La poignée ouvre sous elle le menu du
// bloc (monter, descendre, style, dupliquer, supprimer), au clic comme au clavier (Entrée, Espace ; Échap le
// ferme et rend le focus), et se glisse-dépose ; aucune de ces actions ne vit hors du menu. Un titre écrit
// reste dans son élément de titre (AC7) ; un bloc qu'on n'écrit pas est rendu en lecture, déplaçable,
// duplicable et supprimable (HN-E05S08-5). La rangée reçoit des données ; ses gestes viennent du contexte de
// l'éditeur. Sans elle, pas d'édition.
//
// Porté d'oto-frontend (`components/editor/editable-block.tsx`, DS `BlockRow`) : la géométrie de la rangée
// et de sa gouttière (`BlockRow`, révélée au survol et au focus), le « + » puis la poignée en boutons-icônes
// fantômes, le nom de chaque geste par les premiers mots du bloc, le menu de la poignée (`DropdownMenu`, les
// formes en choix `radio`, « Monter » et « Descendre » avec leur raccourci, « Supprimer » destructif), la
// poignée qui se glisse (`use-drag-block.ts`), un bloc qu'on n'écrit pas lu mais déplaçable et supprimable.
// Changé : le menu s'ouvre sous la poignée (AC-a2), et porte « Dupliquer ». Retiré : `ReferencesDuBloc` (les
// références servies ; ici, les liens écrits dans le texte), le titre écrit hors de son élément.
//
// M59 (fiche D104) : une procédure s'écrit comme une page. Ni style « Appel de fonction » ni « Insérer un
// appel » ; un bloc `call` déjà écrit est un Texte (`texteDUnAppel`), qu'on réécrit ou supprime.
//
// E05-S11 : la rangée des liens sous le bloc (`LiensDuBloc`) part : au repos, le champ lit ses liens dans la
// phrase (AC-26) ; tout le texte du bloc sélectionné ouvre le menu de la poignée, sans prendre le focus (AC-28).
//
// E10-S06 : le « + » ouvre le choix du bloc à insérer (AC-a1, `choix-de-bloc.tsx`) ; « Style » gagne « Repli »
// (AC-a3) ; un tableau simple s'écrit dans sa grille, son menu ajoute, retire et aligne à la cellule courante, que la
// rangée tient (AC-b1, AC-b2) ; un repli s'écrit en deux champs (AC-b4) ; un séparateur, sans champ, n'a pas de style.
// La poignée précède le champ : d'un bloc dont le champ garde `Tab`, `Tab` sur la poignée sort du bloc (AC-a6).
//
// E10-S02 (lot b) : le « + » propose « Image » et « Fichier » quand le stockage est activé (AC-b1, AC-b2, AC-b7) ; un
// fichier lâché sur la rangée est un dépôt, jamais un déplacement (AC-b4) ; le bloc local d'un envoi n'a ni « + » ni
// poignée ; une image se décrit dans son bloc et choisit sa largeur au menu (AC-b3) ; un CSV joint s'y convertit (AC-b6).
//
// E11-S17 (lot a) : un bloc sélectionné est surligné ; Maj+clic, Ctrl+clic ou ⌘+clic sur la poignée prend des blocs (AC-a4).
//
// 1.1.3 : un diagramme s'écrit comme le code ; hors du focus, non vide, il se lit comme à la lecture, dessin puis
// « Voir le code » replié (1.1.4, `DiagrammeAuRepos`). La rangée est mémoïsée : une frappe ne rend que la sienne ;
// les entrées de ses menus se construisent au premier geste qui peut les ouvrir.
//
// Trois titres au menu « Style » ; le chevron de chaque titre replie sa section, dont les rangées restent montées sans
// se montrer.
import { memo, useId, useState, type DragEvent, type ReactNode } from "react"
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown"
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp"
import { Copy } from "@phosphor-icons/react/dist/csr/Copy"
import { DotsSixVertical } from "@phosphor-icons/react/dist/csr/DotsSixVertical"
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { Table } from "@phosphor-icons/react/dist/csr/Table"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import { EMBED_HEIGHTS, IMAGE_WIDTHS, simpleTableOf, type EmbedHeight } from "../../../schemas/blocks"
import { fileTypeOf } from "../../../schemas/files"
import { aDesFichiers } from "../../coque/import-de-fichier"
import { BlockRow } from "../../ds/react/block-row"
import { AnimatedIcon } from "../../ds/react/icon"
import { DropdownMenu, type MenuItem } from "../../ds/react/overlays"
import { Button, IconButton } from "../../ds/react/primitives"
import { hauteurDe } from "../cadre-integre"
import { texteLu } from "../en-ligne"
import { CHOIX_DE_BLOC, EDITEUR, FORMES, INTEGRATION, MENU_DU_BLOC, SELECTION } from "../libelles"
import { FICHIERS } from "../libelles-des-fichiers"
import { BoutonDuPli } from "../plis-lus"
import { baliseDuTitre, largeurDe, RenduDUnBloc } from "../rendu-des-blocs"
import type { Position } from "./blocs-de-page"
import { ChampDeBloc, type LiensDesBlocs } from "./champ-de-bloc"
import { itemsDuChoix } from "./choix-de-bloc"
import { sortirDuBlocAuClavier } from "./clavier"
import { ConflitDeBloc } from "./conflit-de-bloc"
import { enDepot, type Depot, type Genre } from "./envoi-de-fichier"
import { DepotEnCours, FichierEdite } from "./fichier-edite"
import { useGestes, type Gestes } from "./gestes"
import { casesCochees, debutDe, formeDe, FORMES_ECRITES, premiersMots, texteDe, type BlocEdite, type Forme, type Rangee } from "./modele"
import { RepliEdite } from "./repli-edite"
import { itemsDuTableau, TableauEdite } from "./tableau-edite"
import type { Conflit } from "./use-envois"

type RangeeDeBlocProps = {
  rangee: Rangee
  premiere: boolean
  derniere: boolean
  /** La rangée se glisse (E05-S10, AC-a3) : sa gouttière reste révélée. */
  tenue: boolean
  /** Le bloc est dans la sélection de blocs (E11-S17, lot a) : surligné, sa gouttière révélée (`editeur.css`). */
  selectionnee: boolean
  /** Tout le texte du bloc est sélectionné : le menu de la poignée est ouvert, le focus reste au champ (E05-S11, AC-28). */
  menuOuvert: boolean
  /** Le bloc touché : son champ de texte est monté, ceux des autres blocs ne le sont pas. */
  ouvert: boolean
  /** Un autre bloc est en conflit : ce champ est en lecture seule jusqu'à son règlement (HN-E05S08-3). */
  verrouillee: boolean
  erreur: string | null
  conflit: Conflit | null
  liens: LiensDesBlocs
  /** Un bloc `reference` rendu en place par la page serveur (vue, carte ou avis, E07-S03, AC16), montré en lecture. */
  rendu?: ReactNode
  /** L'invite du champ vide : celle du Texte d'une page vide (E11-S05, AC-g1) ; absente ailleurs. */
  invite?: string
  /** Le stockage est activé : le « + » propose « Image » et « Fichier » (E10-S02, AC-b7). */
  fichiers: boolean
  /** L'envoi en cours du bloc local d'un fichier (E10-S02, AC-b1, AC-b4). */
  depot?: Depot
  /** La rangée est dans la section d'un titre replié : elle ne se montre pas. */
  cachee: boolean
  /** Un titre : sa section est dépliée. */
  pliOuvert: boolean
  /** Un titre sans section : son chevron ne replie rien. */
  pliVide: boolean
}

type Menu = {
  cle: string
  bloc: BlocEdite
  forme: Forme | null
  premiere: boolean
  derniere: boolean
  /** Un tableau simple, que le menu convertit en tableau de données (E10-S01, AC-b7). */
  tableauSimple: boolean
  /** La cellule courante d'un tableau simple (E10-S06, AC-b2). */
  cellule: Position
}

/**
 * Le style du bloc (AC-a2), en choix `radio` : la forme entière est cochée ; un bloc qu'on n'écrit pas le dit. Un
 * tableau simple a son propre menu, un séparateur n'a pas de style (E10-S06, AC-a3, AC-b2).
 */
function stylesDuMenu({ cle, bloc, forme, cellule }: Menu, gestes: Gestes): MenuItem[] {
  if (bloc.type === "divider" || bloc.type === "file") return []
  // La hauteur d'un cadre intégré et son adresse (1.4.3), comme la largeur d'une image.
  if (bloc.type === "embed") {
    const hauteur = hauteurDe(bloc.data.height)
    const choisir = (une: EmbedHeight) => gestes.modifierLeBloc(cle, { ...bloc, data: { ...bloc.data, height: une } })
    return [
      { group: INTEGRATION.hauteur },
      ...EMBED_HEIGHTS.map((une) => ({ label: INTEGRATION.hauteurs[une], radio: true, checked: une === hauteur, onSelect: () => choisir(une) })),
      { label: INTEGRATION.modifier, onSelect: () => gestes.ouvrirLIntegration(cle, true, typeof bloc.data.url === "string" ? bloc.data.url : "") },
    ]
  }
  // La largeur d'une image (E10-S02, AC-b3), en choix `radio`, comme le style.
  if (bloc.type === "image") {
    const largeur = largeurDe(bloc.data.width)
    const choisir = (une: (typeof IMAGE_WIDTHS)[number]) => gestes.modifierLeBloc(cle, { ...bloc, data: { ...bloc.data, width: une } })
    return [{ group: FICHIERS.largeur }, ...IMAGE_WIDTHS.map((une) => ({ label: FICHIERS.largeurs[une], radio: true, checked: une === largeur, onSelect: () => choisir(une) }))]
  }
  if (forme === "tableau") return itemsDuTableau(cle, bloc, cellule, gestes)
  if (!forme) return [{ group: EDITEUR.lectureSeule }]
  return [{ group: MENU_DU_BLOC.style }, ...FORMES_ECRITES.map((une) => ({ label: FORMES[une].libelle, radio: true, checked: une === forme, onSelect: () => gestes.changerDeForme(cle, une) }))]
}

/** Le menu de la poignée (E05-S10, AC-a2) : monter, descendre, le style, dupliquer, supprimer. */
function itemsDuMenu(menu: Menu, gestes: Gestes): MenuItem[] {
  const { cle } = menu
  const icone = (glyphe: typeof Plus) => <AnimatedIcon as={glyphe} size="xs" />
  return [
    { label: MENU_DU_BLOC.monter, icon: icone(ArrowUp), shortcut: "⌥↑", disabled: menu.premiere, onSelect: () => gestes.deplacer(cle, -1) },
    { label: MENU_DU_BLOC.descendre, icon: icone(ArrowDown), shortcut: "⌥↓", disabled: menu.derniere, onSelect: () => gestes.deplacer(cle, 1) },
    ...stylesDuMenu(menu, gestes),
    { separator: true },
    ...(menu.tableauSimple ? [{ label: MENU_DU_BLOC.convertir, icon: icone(Table), onSelect: () => gestes.convertirEnTableau(cle) }] : []),
    // Un CSV joint devient un tableau sous la page (E10-S02, AC-b6).
    ...(menu.bloc.type === "file" && fileTypeOf(typeof menu.bloc.data.name === "string" ? menu.bloc.data.name : "") === "csv"
      ? [{ label: FICHIERS.convertir, icon: icone(Table), onSelect: () => gestes.convertirLeCsv(cle) }]
      : []),
    { label: MENU_DU_BLOC.dupliquer, icon: icone(Copy), onSelect: () => gestes.dupliquer(cle) },
    { label: MENU_DU_BLOC.supprimer, icon: icone(Trash), destructive: true, onSelect: () => gestes.supprimer(cle) },
  ]
}

type BlocEcritProps = {
  rangee: Rangee
  forme: Forme
  erreur: string | null
  verrouille: boolean
  liens: LiensDesBlocs
  menuOuvert: boolean
  /** Le bloc touché : son champ de texte est monté ; les autres se lisent (`champ-de-bloc.tsx`). */
  ouvert: boolean
  /** La cellule d'un tableau simple qui prend le focus : la rangée la tient pour son menu (E10-S06, AC-b2). */
  suivreLaCellule: (position: Position) => void
  invite?: string
  /** Le stockage est activé : « / » propose « Image » et « Fichier » (E10-S02, AC-b7). */
  joindre?: (quoi: Genre) => void
  /** « / » propose « Intégration » (1.4.3). */
  integrer?: () => void
  /** Un titre : sa section est dépliée. */
  pliOuvert: boolean
  /** Un titre sans section : son chevron ne replie rien. */
  pliVide: boolean
}

/** Les champs d'un tableau ou d'un repli (E10-S06), ou le champ de texte de toute autre forme écrite. */
function ChampsDuBloc({ rangee, forme, verrouille, liens, menuOuvert, ouvert, suivreLaCellule, decritPar, invite, joindre, integrer }: Omit<BlocEcritProps, "erreur"> & { decritPar?: string }) {
  const { cle, bloc } = rangee
  const mots = premiersMots(bloc)
  if (forme === "tableau") return <TableauEdite cle={cle} bloc={bloc} decritPar={decritPar} lectureSeule={verrouille} liens={liens} suivre={suivreLaCellule} />
  if (forme === "repli") return <RepliEdite cle={cle} bloc={bloc} mots={mots} decritPar={decritPar} lectureSeule={verrouille} liens={liens} />
  const texte = texteDe(bloc)
  return (
    <ChampDeBloc
      cle={cle}
      texte={texte}
      nom={`Modifier ${FORMES[forme].champ} — ${mots}`}
      decritPar={decritPar}
      // Un diagramme s'écrit sur le fond sombre et dans la chasse du code (`editeur.css`, `data-kind="code"`).
      genre={forme === "diagramme" ? "code" : bloc.type}
      debut={forme === "numerotee" ? debutDe(bloc) : null}
      cases={casesCochees(bloc)}
      lectureSeule={verrouille}
      // Le code, un diagramme et un appel inchangé se lisent tels quels, comme à l'écran de lecture (M59) : ni lien ni rendu au repos.
      liens={forme === "code" || forme === "diagramme" || bloc.type === "call" ? null : liens}
      menuOuvert={menuOuvert}
      ouvert={ouvert}
      invite={invite}
      joindre={joindre}
      integrer={integrer}
      // Hors du focus, un diagramme non vide se lit comme à la lecture ; pendant la frappe, rien ne se redessine. Sans
      // sa référence : l'ancre est déjà sur l'élément du bloc (`BlocEcrit`).
      diagrammeLu={
        forme === "diagramme" && texte.trim() !== "" ? (
          <RenduDUnBloc bloc={{ type: bloc.type, text: texte, data: bloc.data }} Lien="a" hrefDuChemin={(chemin) => `${liens.prefixe}${chemin}`} />
        ) : undefined
      }
    />
  )
}

/** Le champ d'un bloc écrit, dans son élément : un titre reste un titre, nommé par son texte (AC7). */
function BlocEcrit(props: BlocEcritProps) {
  const gestes = useGestes()
  const id = useId()
  const { rangee, erreur } = props
  const { cle, bloc } = rangee
  // Un titre garde au repos la balise de son niveau, comme à l'écran de lecture (E10-S04, AC-b3).
  const Titre = baliseDuTitre(bloc.data.level)
  const champ = <ChampsDuBloc {...props} decritPar={erreur ? id : undefined} />
  return (
    <>
      {bloc.type === "heading" ? (
        <Titre id={bloc.ref} aria-label={texteLu(texteDe(bloc))} className="oto-titre-repliable">
          {/* Le chevron du titre, avant son champ, comme à la lecture (`plis-lus.tsx`). */}
          <BoutonDuPli ouvert={props.pliOuvert} nom={premiersMots(bloc)} basculer={() => gestes.basculerLePli(cle)} vide={props.pliVide} />
          {champ}
        </Titre>
      ) : (
        <div id={bloc.ref}>{champ}</div>
      )}
      {erreur && (
        <div className="flex flex-wrap items-center gap-2">
          <p id={id} role="alert" className="oto-field-error">
            {erreur}
          </p>
          <Button variant="ghost" size="sm" onClick={() => gestes.annulerLesModifications(cle)}>
            {EDITEUR.annulerLesModifications}
          </Button>
        </div>
      )}
    </>
  )
}

/** Un fichier lâché sur la rangée (E10-S02, AC-b4) : un dépôt, que le glisser d'un bloc (`useGlisser`, au pointeur) ne voit pas. */
function useDepotSurLaRangee(cle: string, verrouillee: boolean) {
  const gestes = useGestes()
  return {
    onDragOver: (evenement: DragEvent<HTMLDivElement>) => {
      if (!verrouillee && aDesFichiers(evenement)) evenement.preventDefault()
    },
    onDrop: (evenement: DragEvent<HTMLDivElement>) => {
      const fichier = evenement.dataTransfer.files[0]
      if (!fichier || verrouillee) return
      evenement.preventDefault()
      gestes.deposerUnFichierDansLaPage(cle, fichier)
    },
  }
}

/**
 * Une rangée : rendue à nouveau quand ses propres données changent, jamais pour la frappe dans une autre (ses gestes
 * et ses liens sont les mêmes d'un rendu de l'éditeur à l'autre). Sans quoi chaque touche rendait toute la page.
 */
export const RangeeDeBloc = memo(function RangeeDeBloc(props: RangeeDeBlocProps) {
  const { rangee, premiere, derniere, tenue, menuOuvert, verrouillee, erreur, conflit, liens, rendu, invite } = props
  const gestes = useGestes()
  const depot = useDepotSurLaRangee(rangee.cle, verrouillee)
  // La cellule courante d'un tableau simple, où son menu ajoute et retire (E10-S06, AC-b2).
  const [cellule, setCellule] = useState<Position>({ ligne: 0, colonne: 0 })
  // Les entrées des menus (« + » et poignée) ne se construisent qu'une fois un menu demandé : au clic ou à ↓ dans la
  // rangée, dans le même geste que son ouverture, ou quand la sélection de tout le texte ouvre celui de la poignée.
  const [menusDemandes, setMenusDemandes] = useState(false)
  const demanderLesMenus = () => setMenusDemandes(true)
  const etatDeLaSelection = useId()
  const { cle, bloc } = rangee
  // Le bloc local d'un envoi : ni « + » ni poignée, seulement « Annuler » (E10-S02, AC-b4).
  if (enDepot(bloc)) {
    return <BlockRow data-cle={cle}>{props.depot && <DepotEnCours cle={cle} depot={props.depot} />}</BlockRow>
  }
  const forme = formeDe(bloc)
  const mots = premiersMots(bloc)
  // Un tableau sans colonne ne se convertit pas (le schéma d'un tableau de données en veut une) : pas d'entrée.
  const tableauSimple = bloc.type === "simple_table" && simpleTableOf(bloc.data).columns.length > 0
  const menu: Menu = { cle, bloc, forme, premiere, derniere, tableauSimple, cellule }
  const joindre = props.fichiers ? (quoi: Genre) => gestes.choisirUnFichier(cle, quoi) : undefined
  const integrer = () => gestes.ouvrirLIntegration(cle)
  const contenu = conflit ? (
    <ConflitDeBloc conflit={conflit} />
  ) : bloc.type === "image" || bloc.type === "file" ? (
    <FichierEdite rangee={rangee} erreur={erreur} lectureSeule={verrouillee} prefixe={liens.prefixe} />
  ) : forme ? (
    <BlocEcrit
      rangee={rangee}
      forme={forme}
      erreur={erreur}
      verrouille={verrouillee}
      liens={liens}
      menuOuvert={menuOuvert}
      ouvert={props.ouvert}
      suivreLaCellule={setCellule}
      invite={invite}
      joindre={joindre}
      integrer={integrer}
      pliOuvert={props.pliOuvert}
      pliVide={props.pliVide}
    />
  ) : (
    <RenduDUnBloc bloc={bloc} Lien="a" hrefDuChemin={(chemin) => `${liens.prefixe}${chemin}`} cibles={liens.cibles} rendu={rendu} />
  )
  const poignee = (
    <IconButton
      label={`Actions sur ce bloc — ${mots}`}
      variant="ghost"
      size="sm"
      data-geste="poignee"
      // Un bloc sélectionné le dit aux lecteurs d'écran, par la description de sa poignée (E11-S17, AC-a9).
      aria-describedby={props.selectionnee ? etatDeLaSelection : undefined}
      onPointerDown={(evenement) => gestes.poignee.appui(cle, evenement)}
      onPointerMove={gestes.poignee.mouvement}
      onPointerUp={gestes.poignee.lacher}
      onPointerCancel={gestes.poignee.annuler}
      // Le clic qui finit un glissé est avalé ; un autre, avec Maj, Ctrl ou ⌘, prend des blocs sans ouvrir le menu (E11-S17, AC-a4).
      onClickCapture={(evenement) => {
        gestes.poignee.clicCapture(evenement)
        if (!evenement.isPropagationStopped()) gestes.cliquerLaPoignee(cle, evenement)
      }}
      // Composé avec l'ouverture du menu au clavier (`Anchor` chaîne les gestionnaires) : seul `Tab` est pris ici.
      onKeyDown={(evenement) => sortirDuBlocAuClavier(evenement, forme)}
    >
      <AnimatedIcon as={DotsSixVertical} size="xs" />
      {props.selectionnee && (
        <span id={etatDeLaSelection} hidden>
          {SELECTION.selectionne}
        </span>
      )}
    </IconButton>
  )
  // Le « + » ouvre le choix du bloc à insérer (E10-S06, AC-a1) ; Échap le ferme et lui rend le focus. Approché, il lit
  // l'état du stockage, pour proposer « Image » et « Fichier » à l'ouverture (E10-S02, HN-E10S02-6).
  const plus = (
    <IconButton label={CHOIX_DE_BLOC.ajouter(mots)} variant="ghost" size="sm" data-geste="inserer" onPointerEnter={gestes.connaitreLesFichiers} onFocus={gestes.connaitreLesFichiers}>
      <AnimatedIcon as={Plus} size="xs" />
    </IconButton>
  )
  return (
    <BlockRow
      data-cle={cle}
      // Dans la section d'un titre replié : la rangée reste montée, son état gardé, sans se montrer (`editeur.css`).
      hidden={props.cachee}
      {...depot}
      // La rangée qu'on glisse garde sa gouttière révélée : une présence, puis la teinte du design system (`blocks.css`).
      state={tenue ? "moving" : undefined}
      data-selectionnee={props.selectionnee ? "" : undefined}
      // Un bouton cliqué ne prend pas le focus sous Safari et Firefox macOS : l'appui dit que la rangée reste (M30).
      onPointerDown={() => gestes.appuyerDansLaRangee(cle)}
      onBlur={(evenement) => gestes.quitterLaRangee(cle, evenement)}
      // Un clic ou ↓ dans la rangée, avant l'ouverture qu'il porte peut-être : les menus ont leurs entrées quand ils s'ouvrent.
      onClickCapture={demanderLesMenus}
      onKeyDownCapture={(evenement) => evenement.key === "ArrowDown" && demanderLesMenus()}
      insert={<DropdownMenu side="bottom" align="start" className="oto-menu-du-plus" trigger={plus} items={menusDemandes ? itemsDuChoix((choix) => gestes.inserer(cle, choix), joindre, integrer) : []} />}
      // Le bloc en conflit se règle dans son panneau : sa poignée n'ouvre pas de menu.
      handle={
        conflit ? (
          poignee
        ) : (
          // Sa hauteur suit ses entrées, bornée à la fenêtre (E11-S15, AC-b5, `editeur.css`) : sans barre de défilement.
          <DropdownMenu
            side="bottom"
            align="start"
            className="oto-menu-de-poignee"
            trigger={poignee}
            items={menusDemandes || menuOuvert ? itemsDuMenu(menu, gestes) : []}
            ouvertSansFocus={menuOuvert}
            surFermeture={gestes.fermerLeMenu}
          />
        )
      }
    >
      {contenu}
    </BlockRow>
  )
})
