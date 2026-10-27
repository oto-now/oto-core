// Les lignes d'une partie du texte servi, dites en français (E05-S13, retours 1 et 8, AC-4, AC-14, AC-15 ;
// HN-E05S13-12, -13, -14) : les morceaux que `parties-du-contexte.ts` relit (listes sous leur légende, phrases fixes,
// avis de budget), chaque chemin ou titre un lien vers son contenu ; une ligne non reconnue, telle
// que servie, en police mono. Monté dans la carte d'une partie par la vue « Contexte », sous l'éditeur
// d'un Contexte écrivable, et sous les blocs de l'encart « Contexte · Tout le monde » d'Organisation. Server
// Component. Remplace `ListesDIndex` (M71), qui ne rendait que les listes d'index, en anglais. Sans lui, la personne
// lit le texte anglais brut que reçoit son assistant. E11-S15 (AC-a1) : « Rangés sous ce contexte » et « Pages
// citées » dans l'encart repliable (`LinkedContent`) de l'écran d'un Contexte, ouvert, sur toute la largeur.
import type { ReactNode } from "react"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { TreeStructure } from "@phosphor-icons/react/dist/ssr/TreeStructure"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { AnimatedIcon } from "../ds/react/icon"
import { LinkedContent } from "../ds/react/linked-content"
import { dateLisible } from "../format/dates"
import { LIGNES_SERVIES, nomDuBloc, type EquipesNommees } from "./libelles"
import type { Legende, LigneServie, MorceauServi } from "./parties-du-contexte"

type Navigation = { prefixeDesPages: string; Lien: LienDeLHote }

export type ListesServiesProps = Navigation & {
  morceaux: readonly MorceauServi[]
  /** L'ancre de la partie : préfixe des `id` des légendes. */
  ancre: string
  /** Les équipes : le nom d'une partie omise nommée par l'avis de budget. */
  equipes?: EquipesNommees
}

/** Une date servie (`AAAA-MM-JJ`), lisible ; illisible, telle que servie. */
function date(servie: string): string {
  return dateLisible(servie) ?? servie
}

function legende(une: Legende): string {
  if (une.genre === "nouveautes") return LIGNES_SERVIES.depuis(date(une.depuis))
  return LIGNES_SERVIES[une.genre]
}

/** Le lien d'un contenu servi, par son titre (son chemin sans titre), puis sa précision. */
function VersLeContenu({ chemin, texte, precision, prefixeDesPages, Lien }: Navigation & { chemin: string; texte: string; precision: string }) {
  return (
    <>
      <Lien href={`${prefixeDesPages}${chemin}`} className={LIEN}>
        {texte || chemin}
      </Lien>
      {precision !== "" && ` — ${precision}`}
    </>
  )
}

function Ligne({ ligne, ...navigation }: Navigation & { ligne: LigneServie }): ReactNode {
  switch (ligne.genre) {
    case "connecteur":
      return LIGNES_SERVIES.connecteur(ligne.nom, date(ligne.date))
    case "version":
      return <VersLeContenu chemin={ligne.chemin} texte={ligne.titre} precision={LIGNES_SERVIES.version(ligne.nature, ligne.revision, date(ligne.date))} {...navigation} />
    case "recent":
      return <VersLeContenu chemin={ligne.chemin} texte={ligne.titre} precision={LIGNES_SERVIES.recent(ligne.nature, date(ligne.date))} {...navigation} />
    case "index":
      return <VersLeContenu chemin={ligne.chemin} texte={ligne.titre} precision={ligne.resume} {...navigation} />
  }
}

/**
 * Les listes d'index d'un Contexte (E11-S15, AC-a1) dans l'encart repliable des encarts « Sous-pages » et « Cite »
 * de l'écran d'un Contexte (`LinkedContent`), même glyphe, ouvert à l'arrivée : la vue est faite pour les lire.
 */
const GLYPHES_DES_INDEX = { children: TreeStructure, linked: ArrowSquareOut } as const

function Liste({ morceau, id, ...navigation }: Navigation & { morceau: Extract<MorceauServi, { genre: "liste" }>; id: string }) {
  const lignes = morceau.lignes.length > 0 && (
    <ul aria-labelledby={morceau.legende ? id : undefined} className="flex flex-col gap-1.5">
      {morceau.lignes.map((ligne, rang) => (
        // Une ligne servie n'a pas d'identité propre (deux nouveautés peuvent viser le même contenu) : son rang.
        <li key={rang}>
          <Ligne ligne={ligne} {...navigation} />
        </li>
      ))}
    </ul>
  )
  if (!morceau.legende) return lignes
  const { genre } = morceau.legende
  if (genre === "children" || genre === "linked") {
    return (
      <LinkedContent open icon={<AnimatedIcon as={GLYPHES_DES_INDEX[genre]} size="xs" />} title={<span id={id}>{legende(morceau.legende)}</span>}>
        {lignes}
      </LinkedContent>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p id={id} className="font-medium text-ink">
        {legende(morceau.legende)}
      </p>
      {lignes}
    </div>
  )
}

/** Du texte tel que servi : une ligne non reconnue, jamais perdue. */
function Brut({ texte }: { texte: string }) {
  return <pre className="oto-code whitespace-pre-wrap break-words p-3">{texte}</pre>
}

const PHRASES = {
  suite: LIGNES_SERVIES.suite,
  "non-charge": LIGNES_SERVIES.nonCharge,
} as const

function Morceau({ morceau, id, equipes = [], ...navigation }: Navigation & { morceau: MorceauServi; id: string; equipes?: EquipesNommees }): ReactNode {
  switch (morceau.genre) {
    case "liste":
      return <Liste morceau={morceau} id={id} {...navigation} />
    case "phrase":
      return <p className="text-mute">{PHRASES[morceau.phrase]}</p>
    case "budget": {
      const noms = morceau.noms.map(({ nom, coupe }) => (coupe ? LIGNES_SERVIES.coupe(nomDuBloc({ name: nom }, equipes)) : nomDuBloc({ name: nom }, equipes)))
      const liste = [...noms, ...(morceau.autres > 0 ? [LIGNES_SERVIES.autres(morceau.autres)] : [])].join(", ")
      return <p className="text-ink">{LIGNES_SERVIES.budget(liste)}</p>
    }
    case "brut":
      return <Brut texte={morceau.texte} />
  }
}

export function ListesServies({ morceaux, ancre, ...props }: ListesServiesProps) {
  if (morceaux.length === 0) return null
  return (
    <div className="flex flex-col gap-3 text-sm text-ink">
      {morceaux.map((morceau, rang) => (
        // Les morceaux suivent l'ordre servi, que rien ne réordonne : leur rang.
        <Morceau key={rang} morceau={morceau} id={`${ancre}-liste-${rang}`} {...props} />
      ))}
    </div>
  )
}
