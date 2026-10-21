// Fixtures de l'écran de nœud (E05-S02) : blocs et nœud tels que `loadNode` les sert (E03-S03, AC35),
// et l'API simulée de `POST /api/platform/nodes` (réponse d'E03-S03, AC37 : `touched[].blocks`,
// `draft_stamp`), partagées par les tests de l'écran, de l'éditeur et de l'en-tête. Sans elles, trois
// fichiers réécrivaient la même page et la même API. Et le montage de l'éditeur sous sa file d'écriture
// (`monterLEditeur`), que neuf fichiers recopiaient.
import { createElement, type ComponentProps, type ReactNode } from "react"
import { render } from "@testing-library/react"
import { vi } from "vitest"
import type { BlockView, NodeView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../packages/plateforme/ui/noeud/editeur/file-d-operations"

export const ID = {
  titre: "a1000000-0000-4000-8000-000000000001",
  objet: "b2000000-0000-4000-8000-000000000002",
  code: "c3000000-0000-4000-8000-000000000003",
  liste: "d4000000-0000-4000-8000-000000000004",
} as const

/** Un bloc servi, en révision 3 : sa référence est les 8 premiers caractères de son `id` (E01-S06). */
export function bloc(id: string, type: BlockView["type"], text: string | null, data: Record<string, unknown> = {}): BlockView {
  return { id, ref: id.slice(0, 8), type, text, data, key: null, position: 1, revision: 3, provenance: {} }
}

/** Le même bloc portant une clé, qui devient sa référence. */
export function avecCle(servi: BlockView, key: string): BlockView {
  return { ...servi, key, ref: key }
}

/** `ventes/modele_relance` : un titre, le paragraphe B (révision 3), un bloc de code, une liste. */
export const PAGE: BlockView[] = [
  { ...avecCle(bloc(ID.titre, "heading", "Objet", { level: 1 }), "objet"), revision: 1 },
  bloc(ID.objet, "paragraph", "Objet de la relance"),
  bloc(ID.code, "code", "select 1", { language: "sql" }),
  bloc(ID.liste, "list", null, { items: ["Lire le devis", "Écrire le brouillon"] }),
]

const TROIS_JOURS = 3 * 86_400_000

export function vueDuNoeud(surcharge: Partial<NodeView> = {}): NodeView {
  return {
    id: "noeud-modele-relance",
    path: "ventes/modele_relance",
    title: "Modèle de relance",
    summary: "Relancer un devis resté sans réponse.",
    kind: "page",
    status: "published",
    revision: 4,
    updatedAt: new Date(Date.now() - TROIS_JOURS - 60_000).toISOString(),
    updatedByName: "Claire Morel",
    owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" },
    level: 1,
    parent: { path: "ventes", title: "Ventes" },
    children: [],
    childrenTotal: 0,
    blocks: PAGE,
    outline: [],
    draft: null,
    meta: {},
    ...surcharge,
  }
}

type Op = { op: string; block?: string; after_block?: string; revision?: number; input?: Record<string, unknown> }

export type CorpsEnvoye = { path: string; base_revision: number; draft_stamp?: string; ops?: Op[]; title?: string; summary?: string; publish?: boolean }

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/**
 * `fetch` simulé pour `POST /api/platform/nodes` : chaque corps envoyé est gardé ; une écriture rend
 * les blocs écrits (`id`, référence, révision + 1 au remplacement, 1 à l'insertion) et un tampon neuf ;
 * une publication rend la révision suivante, sans tampon. `refuser` et `couper` visent l'appel suivant ;
 * `retenir` le laisse en vol jusqu'à ce qu'on le relâche.
 */
export function simulerLAPI() {
  const envoyes: CorpsEnvoye[] = []
  const suites: ({ statut: number; code: string; details?: Record<string, unknown> } | "reseau" | Promise<void>)[] = []
  const revisions = new Map<string, number>(PAGE.map((un) => [un.id, un.revision]))
  let compteur = 0
  const fetchMock = vi.fn<typeof fetch>(async (_adresse, init) => {
    // Le corps que la file envoie : la forme de `writeNodeBodySchema`, lue ici sans la revalider.
    const corps = JSON.parse(String(init?.body)) as CorpsEnvoye
    envoyes.push(corps)
    const suite = suites.shift()
    if (suite instanceof Promise) await suite
    else if (suite === "reseau") throw new TypeError("fetch failed")
    else if (suite) return reponse(suite.statut, { error: { code: suite.code, message: "refused", ...(suite.details ? { details: suite.details } : {}) } })
    compteur += 1
    const tampon = `2026-09-24T10:00:${String(compteur).padStart(2, "0")}.000000+00:00`
    if (corps.publish) return reponse(200, { data: { path: corps.path, revision: corps.base_revision + 1, status: "published", has_draft: false, touched: [], draft_stamp: null } })
    const touched = (corps.ops ?? []).map((op) => {
      if (op.op === "insert_after") {
        const id = `e${String(compteur).padStart(7, "0")}-0000-4000-8000-00000000000${compteur % 10}`
        revisions.set(id, 1)
        return { op: op.op, blocks: [{ id, ref: id.slice(0, 8), revision: 1 }] }
      }
      if (op.op === "delete_block" || !op.block) return { op: op.op, blocks: [] }
      if (op.op === "replace_block") revisions.set(op.block, (op.revision ?? revisions.get(op.block) ?? 1) + 1)
      return { op: op.op, blocks: [{ id: op.block, ref: op.block.slice(0, 8), revision: revisions.get(op.block) ?? 1 }] }
    })
    return reponse(200, { data: { path: corps.path, revision: corps.base_revision, status: "published", has_draft: true, touched, draft_stamp: tampon } })
  })
  vi.stubGlobal("fetch", fetchMock)
  return {
    envoyes,
    fetchMock,
    // `details` : les précisions que rend l'API (`details.reason`, E11-S02 AC-g1 : `header_refused`).
    refuser: (code: string, statut: number, details?: Record<string, unknown>) => suites.push({ statut, code, ...(details ? { details } : {}) }),
    couper: () => suites.push("reseau"),
    retenir: () => {
      let relacher = () => {}
      suites.push(new Promise<void>((resolve) => (relacher = resolve)))
      return () => relacher()
    },
  }
}

type ProprietesDeLEditeur = ComponentProps<typeof EditeurDeBlocs>

export type MontageDeLEditeur = {
  /** Ce qui précède l'éditeur sous la même file : l'en-tête modifiable. */
  avant?: ReactNode
  /** Ce qui suit l'éditeur ; par défaut « Ailleurs », un bouton hors de l'éditeur : le focus qui y va quitte le champ et sa rangée, comme en suivant un lien. `null` : rien ne suit. */
  apres?: ReactNode
  cibles?: ProprietesDeLEditeur["cibles"]
  liens?: ProprietesDeLEditeur["liens"]
  /** La révision publiée et servie, 4 par défaut. */
  revision?: number
  tampon?: string | null
}

/** L'éditeur de `ventes/modele_relance` sous sa file d'écriture, tel que l'écran le monte. */
export function lEditeur(blocs: BlockView[] = PAGE, montage: MontageDeLEditeur = {}, rafraichir: () => void = () => {}) {
  const { avant = null, apres = createElement("button", { type: "button" }, "Ailleurs"), cibles, liens, revision = 4, tampon = null } = montage
  return createElement(
    ContexteDeRafraichissement.Provider,
    { value: rafraichir },
    createElement(
      FileDOperations,
      // Les enfants passent en troisième argument de `createElement`, que le type des propriétés (`children` requis) ne voit pas.
      { chemin: "ventes/modele_relance", revisionPubliee: revision, tampon } as ComponentProps<typeof FileDOperations>,
      avant,
      createElement(EditeurDeBlocs, { blocs, revisionServie: revision, prefixeDesPages: "/n/", cibles, liens }),
    ),
    apres,
  )
}

/**
 * `lEditeur` rendu : `rafraichir` espionne la relecture de la page ; `relire` rerend avec les blocs relus (et une autre
 * révision ou un autre tampon) ; `demonter` le retire, comme une navigation du client.
 */
export function monterLEditeur(blocs: BlockView[] = PAGE, montage: MontageDeLEditeur = {}) {
  const rafraichir = vi.fn()
  const rendu = render(lEditeur(blocs, montage, rafraichir))
  return {
    rafraichir,
    relire: (relus: BlockView[], autre: MontageDeLEditeur = {}) => rendu.rerender(lEditeur(relus, { ...montage, ...autre }, rafraichir)),
    demonter: rendu.unmount,
  }
}
