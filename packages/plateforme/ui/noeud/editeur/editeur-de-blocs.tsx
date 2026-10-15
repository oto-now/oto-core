"use client"

// L'éditeur de blocs d'une page (E05-S02 ; E05-S08, AC1 à AC7 ; E05-S09, partie c1), au niveau écriture :
// chaque bloc écrit se lit, et devient un champ quand on le touche (1.1.3, qui remplace le champ toujours monté de la
// fiche D21 B : un `<textarea>` par bloc figeait une page de trois cents blocs) ; son texte part par la file en opérations par
// bloc quand le focus le quitte, sur ⌘S ou après 1 200 ms sans frappe, et chaque geste de structure part
// tout de suite. Il porte la publication, les lignes d'état et le conflit au bloc (plus de bandeau du
// brouillon depuis E11-S02, AC-c3).
// Il reçoit des données et du `ReactNode` déjà rendu, jamais une fonction (AC22). Sans lui, pas d'édition.
//
// Porté d'oto-frontend (`components/editor/block-editor.tsx`). Repris : l'orchestration (modèle local,
// focus posé impérativement, clavier, différé), le corps de lecture du design
// system (`Reader`), « Bloc supprimé. » et « Annuler ». Retiré : l'écriture du corps entier (→
// opérations par bloc), la synchronisation par comparaison de corps (`memeCorps`).
//
// Son genre (E05-S04) va à la publication : un Contexte confirme sa publication vide et dit la recharge des
// conversations (AC11). Une procédure s'écrit comme une page (M59, fiche D104).
//
// E05-S10 : la publication part seule (AC-a6), dès le niveau écriture depuis E11-S02 (AC-c2) ; la poignée ouvre le menu du bloc (AC-a2)
// et se glisse-dépose (AC-a3, `glisser.ts`, le `useDragBlock` d'oto-frontend).
//
// E05-S11 : l'indication d'enregistrement est en haut à droite de la carte (AC-1) ; un bloc au repos lit ses
// liens dans la phrase, par le titre des pages citées (AC-26, `cibles`, `liens`) ; tout le texte d'un bloc
// sélectionné ouvre le menu de sa poignée, sans prendre le focus (AC-28).
//
// E11-S05 (AC-g1, AC-g2) : plus d'état vide ni de « Commencer à écrire » ; une page sans bloc a un Texte vide, créé
// sur le poste, dont le champ porte l'invite, et qui prend le focus à l'ouverture quand le titre est écrit.
// E10-S02 (lot b) : il tient les envois de fichiers et leurs dialogues (`envoi-de-fichier.ts`, `choix-au-depot.tsx`).
//
// E11-S17 (lot a) : ses rangées vivent dans la zone des blocs, où se tient la sélection de blocs entiers
// (`selection-de-blocs.ts`) : surlignés, annoncés dans une région vivante montée vide, la zone nommée par leur nombre
// quand elle a le focus ; le menu d'un bloc sélectionné parmi d'autres supprime et déplace le groupe.
//
// Il tient les plis des titres (`plis-de-l-editeur.ts`) : les rangées qu'un titre replié cache ne se montrent pas.
import { useMemo, useState, type ReactNode } from "react"
import type { BlockView, NodeKind } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { Reader } from "../../ds/react/reader"
import type { CiblesDesLiens } from "../en-ligne"
import { EDITEUR, SELECTION } from "../libelles"
import { Publication } from "../publication"
import { ContexteDesGestes, useGestesStables } from "./gestes"
import { useGlisser } from "./glisser"
import { AlerteDEdition, IndicationDEnregistrement, LigneDAnnonce } from "./lignes-d-etat"
import type { Rangee } from "./modele"
import { estLaPageVide } from "./page-vide"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { DialogueDesFichiers } from "./choix-au-depot"
import type { Depot } from "./envoi-de-fichier"
import type { Rectangle } from "./pointeur-de-la-selection"
import { usePlisDeLEditeur } from "./plis-de-l-editeur"
import { RangeeDeBloc } from "./rangee-de-bloc"
import { useSelectionDeBlocs } from "./selection-de-blocs"
import type { Conflit } from "./use-envois"
import { useEditeur } from "./use-editeur"

type EditeurDeBlocsProps = {
  /** Les blocs servis : ceux du brouillon s'il existe, sinon ceux de la version publiée. */
  blocs: BlockView[]
  /** La révision publiée servie par la lecture du nœud. */
  revisionServie: number
  prefixeDesPages: string
  /** Les blocs `reference` rendus en place par la page serveur, par `id` de bloc (E07-S03, AC16) ; sans rendu, `ReferenceEnLien`. */
  referencesRendues?: Readonly<Record<string, ReactNode>>
  /** Le genre du nœud (E05-S04) ; absent, une page. */
  genre?: NodeKind
  /** Les cibles des pages que citent les blocs, lues dans l'arbre visible (E05-S11, AC-26, AC-27). */
  cibles?: CiblesDesLiens
  /** Les champs de `read` sur le nœud (ses liens sortants), lus par l'hôte après la page. */
  liens?: Promise<Resultat<Record<string, unknown>>>
  /** Une page vide dont le titre est écrit : son Texte prend le focus à l'ouverture (AC-g2). */
  focusALOuverture?: boolean
}

type RangeesProps = {
  modele: Rangee[]
  /** La rangée qu'on glisse (E05-S10, AC-a3). */
  tenue: string | null
  /** La rangée dont tout le texte est sélectionné : le menu de sa poignée est ouvert (E05-S11, AC-28). */
  menuOuvert: string | null
  erreurs: Readonly<Record<string, string>>
  conflit: Conflit | null
  liens: LiensDesBlocs
  referencesRendues?: Readonly<Record<string, ReactNode>>
  /** Le stockage est activé (E10-S02, AC-b7). */
  fichiers: boolean
  /** Les envois en cours, par rangée locale (E10-S02, AC-b1). */
  depots: Readonly<Record<string, Depot>>
  /** Les blocs sélectionnés (E11-S17, lot a). */
  selection: ReadonlySet<string>
  /** Le bloc touché, dont le champ est monté (1.1.3). */
  ouvert: string | null
  /** Les rangées cachées sous un titre replié, par rang ; les titres repliés, par clé. */
  cachees: readonly boolean[]
  replies: ReadonlySet<string>
}

/** Les rangées, une par bloc, rendues par leur clé de rendu, jamais par leur rang ; le Texte d'une page vide porte l'invite. */
function Rangees({ modele, tenue, menuOuvert, erreurs, conflit, liens, referencesRendues, fichiers, depots, selection, ouvert, cachees, replies }: RangeesProps) {
  const invite = estLaPageVide(modele) ? EDITEUR.invite : undefined
  return modele.map((rangee, rang) => (
    <RangeeDeBloc
      key={rangee.cle}
      rangee={rangee}
      premiere={rang === 0}
      derniere={rang === modele.length - 1}
      tenue={tenue === rangee.cle}
      selectionnee={selection.has(rangee.cle)}
      menuOuvert={menuOuvert === rangee.cle}
      ouvert={ouvert === rangee.cle}
      cachee={cachees[rang]}
      pliOuvert={!replies.has(rangee.cle)}
      // Un conflit ouvert : les autres champs sont en lecture seule jusqu'à son règlement (HN-E05S08-3).
      verrouillee={conflit !== null && conflit.cle !== rangee.cle}
      erreur={erreurs[rangee.cle] ?? null}
      conflit={conflit?.cle === rangee.cle ? conflit : null}
      liens={liens}
      rendu={rangee.bloc.id === undefined ? undefined : referencesRendues?.[rangee.bloc.id]}
      invite={invite}
      fichiers={fichiers}
      depot={depots[rangee.cle]}
    />
  ))
}

/** Le rectangle tiré depuis la marge (AC-a5), posé dans la zone des blocs ; décoratif, la région vivante dit la sélection. */
function RectangleDeSelection({ rectangle }: { rectangle: Rectangle | null }) {
  if (!rectangle) return null
  const { gauche, haut, largeur, hauteur } = rectangle
  return <div aria-hidden="true" className="oto-rectangle-de-selection" style={{ left: gauche, top: haut, width: largeur, height: hauteur }} />
}

export function EditeurDeBlocs(props: EditeurDeBlocsProps) {
  const { blocs, revisionServie, referencesRendues, genre = "page" } = props
  const plis = usePlisDeLEditeur()
  const editeur = useEditeur({ blocs, revisionServie, focusALOuverture: props.focusALOuverture, reveler: plis.reveler })
  const { envois } = editeur
  const [menuOuvert, setMenuOuvert] = useState<string | null>(null)
  const fermerLeMenu = () => setMenuOuvert(null)
  const selection = useSelectionDeBlocs({ modele: editeur.modele, actions: editeur.actions, fermerLeMenu })
  const glisser = useGlisser({ racine: editeur.racine, glisser: selection.glisser, deposer: selection.deposer, groupe: selection.groupe, revenir: selection.revenir })
  // Le même objet d'un rendu à l'autre : une rangée qui le reçoit n'est rendue à nouveau que pour son propre bloc.
  const { prefixeDesPages, cibles, liens: lecture } = props
  const liens = useMemo<LiensDesBlocs>(() => ({ prefixe: prefixeDesPages, cibles, lecture }), [prefixeDesPages, cibles, lecture])
  // Tout le texte d'un bloc sélectionné ouvre le menu de sa poignée ; une autre sélection le referme (AC-28). Des blocs
  // sélectionnés n'en ouvrent aucun : un glissé qui passe sur tout un texte prend des blocs (E11-S17, AC-a1).
  const selectionner = (cle: string, totale: boolean) => {
    if (selection.cles.length === 0) setMenuOuvert((ouvert) => (totale ? cle : ouvert === cle ? null : ouvert))
  }
  const gestes = useGestesStables({
    ...editeur.actions,
    poignee: glisser.poignee,
    selectionner,
    fermerLeMenu,
    toutSelectionnerLesBlocs: selection.toutSelectionner,
    cliquerLaPoignee: selection.cliquerLaPoignee,
    supprimer: selection.supprimer,
    deplacer: selection.deplacer,
    ouvrirLeChamp: editeur.ouvrirLeChamp,
    activerLeChamp: editeur.activerLeChamp,
    basculerLePli: (cle) => {
      const rangee = editeur.modele.find((une) => une.cle === cle)
      if (rangee) plis.changer([rangee], plis.replies.has(cle))
    },
  })
  return (
    <ContexteDesGestes.Provider value={gestes}>
      {/* `blocs` : le corps d'écriture garde sa pleine largeur (`blocks.css`), hors de la colonne centrée du lecteur (`content.css`). */}
      <Reader ref={editeur.racine} data-reading="blocs">
        <IndicationDEnregistrement />
        <div className="mb-3.5 flex flex-col gap-2">
          <Publication genre={genre} blocs={editeur.blocs} />
          <AlerteDEdition alerte={envois.alerte} />
        </div>
        {/* La zone des blocs : elle tient la sélection, et prend le focus quand toute la page est sélectionnée (AC-a2). */}
        <div
          ref={selection.zone}
          role="group"
          tabIndex={-1}
          aria-label={selection.annonce || SELECTION.zone}
          className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          {...selection.proprietes}
        >
          <Rangees
            modele={editeur.modele}
            tenue={glisser.enCours}
            menuOuvert={menuOuvert}
            erreurs={editeur.erreurs}
            conflit={envois.conflit}
            liens={liens}
            referencesRendues={referencesRendues}
            fichiers={editeur.fichiers.stockage.actif}
            depots={editeur.fichiers.depots}
            selection={selection.ensemble}
            ouvert={editeur.ouvert}
            cachees={plis.cachees(editeur.modele)}
            replies={plis.replies}
          />
          <RectangleDeSelection rectangle={selection.rectangle} />
          <p role="status" className="oto-sr-only">
            {selection.annonce}
          </p>
        </div>
        <LigneDAnnonce annonce={envois.annonce} />
        <DialogueDesFichiers dialogue={editeur.fichiers.dialogue} chemin={envois.chemin} />
      </Reader>
    </ContexteDesGestes.Provider>
  )
}
