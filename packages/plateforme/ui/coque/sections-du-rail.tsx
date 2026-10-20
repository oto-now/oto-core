"use client"

// Porté d'oto-frontend (src/components/coque/rail-application.tsx, `SectionDuRail`) : une section par
// espace — son titre, son pli retenu par ce navigateur, son « + » —, puis son arbre, le Contexte en
// tête, chaque ligne avec son « ⋯ » et son « + » ; une seule création et un seul dialogue par geste
// pour toutes les lignes. Exporté seul pour une barre latérale d'ERP (ADR-008 point 7,
// AC-a8) : il navigue par le lien de l'hôte (`ContexteDeLHote`) et écrit par l'API du paquet.
// Changé : les sections sont celles de `sectionsDeLArbre` (P39) ; le « + » de Privé crée une page, un
// tableau ou une procédure, comme ailleurs (E05-S11, AC-34) ; le titre d'une section n'ouvre aucune page de
// section : il la plie, comme son chevron (E05-S13, AC-12). E05-S10 (partie b) : les
// branches ouvertes sont tenues ici, pour toutes les sections (AC-b2) ; une ligne se glisse-dépose sur une
// autre, ou « Déplacer » de son « ⋯ » (AC-b7). Retiré : sections de partages reçus, badges d'exécutions.
// E10-S01 : le « ⋯ » d'une ligne télécharge son contenu (`.md` ou `.csv` selon son genre), un Contexte compris, qui
// n'a que ce geste (AC-a5, AC-b6) ; un fichier lâché sur une ligne ouvre l'import sous elle (AC-a3, AC-b1).
import { useId, useMemo } from "react"
import type { NodeKind, TreeNode } from "../../schemas"
import { ARBRE_VIDE, PERSO, sectionsDeLArbre, titresParChemin } from "../arbre/depuis-l-arbre"
import type { SectionCle } from "../arbre/types"
import { Alert } from "../ds/react/primitives"
import { RailSection } from "../ds/react/rail"
import { RailTree, type RailTreeNode } from "../ds/react/rail-tree"
import { ARBRE_TRONQUE } from "../noeud/libelles"
import { LigneDuRail, versArbreDuRail } from "./arbre-du-rail"
import { useArbreAvecLesCreations, useMenuDeCreation, type CibleDeCreation, type MenuDeCreation } from "./creation-dans-le-rail"
import { GlisserDansLeRail, useDeplacementDansLeRail, type DeplacementDansLeRail } from "./deplacement-dans-le-rail"
import { aplatir } from "./freres"
import { useGestesDuRail, type GestesDuRail } from "./gestes-du-rail"
import { DeposerSurLeRail } from "./import-de-fichier"
import { MenuDeLEquipe } from "./menu-de-l-equipe"
import { useAdresseCourante } from "./noeud-ouvert"
import type { EquipeDuRail } from "./types"
import { DeplierAuClic, useDepliageDuRail, type DepliageDuRail } from "./use-depliage-du-rail"
import { useRailFolds, type RailFolds } from "./use-rail-folds"

/** Où se range ce qu'on crée à la racine d'une section : le haut de l'arbre, le dossier de l'équipe, l'espace de la personne. */
function racineDe(section: SectionCle, handle: string | null): string | null {
  if (section.cle !== PERSO) return section.cle
  return handle === null ? null : `${PERSO}/${handle}`
}

type SectionProps = {
  section: SectionCle
  handle: string | null
  prefixe: string
  plis: RailFolds
  creation: MenuDeCreation
  gestes: GestesDuRail
  depliage: DepliageDuRail
  deplacement: DeplacementDansLeRail
  /** Le genre de chaque nœud visible, par chemin : son téléchargement (E10-S01). */
  genres: ReadonlyMap<string, NodeKind>
  /** La personne administre l'organisation : le « ⋯ » d'une équipe propose aussi de la supprimer. */
  administre: boolean
}

function SectionDuRail({ section, handle, prefixe, plis, creation, gestes, depliage, deplacement, genres, administre }: SectionProps) {
  const chemin = useAdresseCourante(prefixe)
  const idDeLArbre = useId()
  const cleDuPli = section.cle || "org"
  const replie = plis.isFolded(cleDuPli)
  const racine = racineDe(section, handle)
  const alaRacine: CibleDeCreation | null = racine === null ? null : { nom: section.titre, parent: racine }
  const itemsDeLaRacine = alaRacine === null ? undefined : creation.itemsPour(alaRacine)
  const lignes = versArbreDuRail(section.noeuds, { prefixe, chemin, section: section.titre, depliage })

  // Chaque ligne crée sous elle, Contexte compris (fiche D110 a) ; le titre de la section, à la racine de l'espace.
  const addItems = (ligne: RailTreeNode) => creation.itemsPour({ nom: ligne.label, parent: ligne.id, sousUneProcedure: genres.get(ligne.id) === "procedure" })
  // Le « ⋯ » d'une ligne qui se déplace (AC-b8) : « Déplacer », « Monter », « Descendre » (AC-b7, AC-b9), puis
  // « Dupliquer », le téléchargement et « Supprimer » (AC-b10, AC-b11, E10-S01). Plus de « Renommer » : le titre
  // s'écrit dans la page (AC-a1). Un Contexte n'a que « Télécharger en .md » (HN-E10S01-24) ; une ligne sans genre
  // connu, aucun « ⋯ ».
  const moreItems = (ligne: RailTreeNode) => {
    const cible = { chemin: ligne.id, nom: ligne.label, genre: genres.get(ligne.id) }
    if (!deplacement.arbre.mobile(ligne.id)) return cible.genre === undefined ? undefined : gestes.exportPour(cible)
    return [...deplacement.itemsPour(cible), ...gestes.itemsPour(cible)]
  }

  return (
    <>
      <RailSection
        label={section.titre}
        expanded={!replie}
        onToggle={() => plis.toggle(cleDuPli)}
        controls={idDeLArbre}
        addItems={itemsDeLaRacine}
        // Une équipe a son « ⋯ » : ses personnes, et sa suppression pour qui administre ; ni Tout le monde ni Perso.
        end={section.cle !== "" && section.cle !== PERSO ? <MenuDeLEquipe slug={section.cle} nom={section.titre} administre={administre} prefixe={prefixe} /> : undefined}
      />
      {/* La liste porte le nom de sa section, comme le navigateur d'arbre qu'elle remplace. */}
      <RailTree as={LigneDuRail} id={idDeLArbre} hidden={replie} aria-label={section.titre} nodes={lignes} addItems={addItems} moreItems={moreItems} />
    </>
  )
}

type ListeProps = Omit<SectionProps, "section" | "plis" | "creation" | "gestes" | "depliage" | "deplacement" | "genres"> & {
  sections: SectionCle[]
  arbre: TreeNode[]
  equipes: EquipeDuRail[]
  /** Un nœud créé, montré avant la relecture de l'arbre (AC-c2). */
  montrer: (noeud: TreeNode) => void
}

function ListeDesSections({ sections, arbre, equipes, handle, prefixe, montrer, administre }: ListeProps) {
  const chemin = useAdresseCourante(prefixe)
  const plis = useRailFolds()
  // Les chemins visibles, qu'une création n'essaie pas (AC-b3) ; relus avec l'arbre seulement.
  const pris = useMemo(() => new Set(titresParChemin(arbre).keys()), [arbre])
  const creation = useMenuDeCreation(prefixe, pris, montrer)
  const depliage = useDepliageDuRail(chemin, prefixe)
  const deplacement = useDeplacementDansLeRail({ arbre, equipes, handle, prefixe, ouverts: depliage.ouverts })
  const gestes = useGestesDuRail({ prefixe, sousContenus: deplacement.arbre.sousContenus, precedente: deplacement.arbre.precedente })
  const genres = useMemo(() => new Map(aplatir(arbre).map((noeud) => [noeud.path, noeud.kind])), [arbre])
  const titres = useMemo(() => titresParChemin(arbre), [arbre])
  const deposer = (chemin: string, fichier: File) => creation.deposer({ nom: titres.get(chemin) ?? chemin, parent: chemin }, fichier)
  return (
    <DeplierAuClic.Provider value={depliage.deplier}>
      <DeposerSurLeRail.Provider value={deposer}>
        <GlisserDansLeRail.Provider value={deplacement.glisser}>
          {sections.map((section) => (
            <SectionDuRail
              key={section.cle || "org"}
              section={section}
              handle={handle}
              prefixe={prefixe}
              plis={plis}
              creation={creation}
              gestes={gestes}
              depliage={depliage}
              deplacement={deplacement}
              genres={genres}
              administre={administre}
            />
          ))}
        </GlisserDansLeRail.Provider>
      </DeposerSurLeRail.Provider>
      {creation.retour}
      {gestes.retour}
      {deplacement.retour}
    </DeplierAuClic.Provider>
  )
}

export type SectionsDuRailProps = {
  /** L'arbre visible (`visibleTree`), les équipes (`listTeams`) et le `handle` de la personne (son profil). */
  arbre: TreeNode[]
  equipes: EquipeDuRail[]
  handle: string | null
  /** Le préfixe des pages de l'hôte (« /n/ ») : l'adresse d'un nœud est ce préfixe suivi de son chemin. */
  prefixe: string
  /** L'arbre coupé à 5 000 nœuds (`visibleTree`), dit sous les sections. */
  tronque?: boolean
  /** `isOrgAdmin` de l'identité : le « ⋯ » d'une équipe propose de la supprimer ; absent, non. */
  administre?: boolean
}

/** Les sections de l'arbre : Tout le monde, une par équipe, Perso ; chacune ouverte par son Contexte. */
export function SectionsDuRail({ arbre: servi, equipes, handle, prefixe, tronque = false, administre = false }: SectionsDuRailProps) {
  const { montre: arbre, ajouter } = useArbreAvecLesCreations(servi)
  const sections = sectionsDeLArbre(arbre, equipes, handle)
  // Un rail muet se lit comme un chargement sans fin (`first-team.tsx` d'oto-frontend) : une ligne le dit,
  // dans la classe des titres, qui lit les jetons du rail et s'efface quand il se réduit.
  if (sections.length === 0) return <p className="oto-rail-group">{ARBRE_VIDE}</p>
  return (
    <>
      <ListeDesSections sections={sections} arbre={arbre} equipes={equipes} handle={handle} prefixe={prefixe} montrer={ajouter} administre={administre} />
      {tronque && <Alert tone="review">{ARBRE_TRONQUE}</Alert>}
    </>
  )
}
