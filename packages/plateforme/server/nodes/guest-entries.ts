// La vue invité d'une équipe : ce qu'une équipe a ouvert à une personne qui n'en est pas membre. Un partage est la seule
// source ; cette lecture en est la vue calculée, la même que les sections du rail des équipes dont la personne n'est pas
// membre (`sectionsDeLArbre`), sur l'identité de membre (`asMember`) : un administrateur y lit ce qu'un membre lirait.
// Servie par `context` (`context/blocks/guests.ts`), pour qu'un assistant sache ce qu'il peut lire ailleurs sans le
// chercher. Sans elle, ces contenus ne se trouvent que par une recherche que rien ne suggère.
import type { NodeKind } from "../../schemas"
import { ACCESS_LEVELS, nodeLevels } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"
import { parentPath } from "./lookup"
import { asMember } from "./tree"
import { comparePaths, kindOf } from "./view"

/** Un point d'entrée : un contenu publié lisible sans ancêtre lisible ; `under`, les contenus lisibles dessous. */
export type GuestEntry = { path: string; title: string; summary: string; kind: NodeKind; under: number }

/** Une équipe dont la personne n'est pas membre, et ce qu'elle lui a ouvert, par chemin. */
export type GuestTeam = { id: string; slug: string; name: string; entries: GuestEntry[] }

type TeamRow = { id: string; slug: string; name: string }
type NodeRow = { path: string; title: string; summary: string; kind: string }

/**
 * Les points d'entrée de chaque équipe, depuis ses contenus lisibles : le dossier de l'équipe n'est jamais une ligne
 * (comme dans le rail, ses contenus le sont) ; un contenu lisible sous un autre est compté sous le plus haut. Équipes par
 * nom (comparaison française), entrées par chemin ; une équipe sans entrée n'y est pas.
 */
export function guestTeamsOf(teams: readonly TeamRow[], readable: readonly NodeRow[]): GuestTeam[] {
  const paths = new Set(readable.map((row) => row.path))
  const entries = new Map<string, GuestEntry>()
  const under: string[] = []
  for (const row of [...readable].sort(comparePaths)) {
    const folder = row.path.split("/")[0]
    if (row.path === folder) continue
    let top: string | null = null
    for (let ancestor = parentPath(row.path); ancestor !== null && ancestor !== folder; ancestor = parentPath(ancestor)) {
      if (paths.has(ancestor)) top = ancestor
    }
    if (top === null) entries.set(row.path, { path: row.path, title: row.title, summary: row.summary, kind: kindOf(row.kind), under: 0 })
    else under.push(top)
  }
  for (const top of under) {
    const entry = entries.get(top)
    if (entry) entry.under += 1
  }
  return [...teams]
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((team) => ({ ...team, entries: [...entries.values()].filter((entry) => entry.path.startsWith(`${team.slug}/`)) }))
    .filter((team) => team.entries.length > 0)
}

/**
 * La vue invité de la personne : les équipes de l'organisation dont elle n'est pas membre, leurs contenus publiés hors
 * corbeille, et leurs niveaux en un lot, dans une transaction ; aucune lecture par équipe. Le filtre de lecture est ici
 * (`security-patterns.md § Droits dans le service`) : la base rend tous les contenus de ces équipes.
 */
export async function guestTeams(db: PlatformDb, identity: Identity): Promise<GuestTeam[]> {
  const mine = identity.teams.map((team) => team.id)
  const { teams, rows, levels } = await inTransaction(db, "nodes: guest entries", async (sql) => {
    const others = await sql<TeamRow[]>`
      select id, slug, name from platform.teams where org_id = ${identity.org.id} and not (id = any(${mine}::uuid[]))`
    if (others.length === 0) return { teams: others, rows: [], levels: new Map<string, number>() }
    const read = await sql<(NodeRow & { id: string })[]>`
      select id, path, title, summary, kind from platform.nodes
       where org_id = ${identity.org.id} and status = 'published' and deleted_at is null
         and split_part(path, '/', 1) = any(${others.map((team) => team.slug)}::text[])`
    // Un filtre de liste compare `nodeLevels` à 1 seulement.
    return { teams: others, rows: read, levels: await nodeLevels(db, asMember(identity), read.map((row) => row.id)) }
  })
  return guestTeamsOf(teams, rows.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read))
}
