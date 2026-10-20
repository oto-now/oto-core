// Les pages d'une équipe à la corbeille, quand l'équipe est supprimée (1.4.13) : celles dont elle est propriétaire
// et celles rangées sous son dossier, avec leurs sous-pages (une sous-page entre à la corbeille avec sa page). Elles ne
// bloquent pas la suppression : elles sont effacées dans sa transaction, avant l'équipe, en une instruction (la clé
// du parent est contrôlée à la fin de l'instruction ; blocs, versions, liens, alias, règles et liens publics partent
// en cascade), les lignes `files` de ces pages rendues pour que leurs objets partent après le `commit`, comme à la
// purge de la corbeille (`nodes/trash.ts`). Sans lui, une équipe dont les pages dorment à la corbeille ne se
// supprimait pas, et rien ne disait pourquoi.
import type { Identity } from "./identity"
import type { Tx } from "./sql"

type TeamRef = { id: string; slug: string }

/** Le nombre de pages de l'équipe à la corbeille, sous-pages comprises : ce que la confirmation annonce. */
export async function trashedNodesCount(sql: Tx, identity: Identity, team: TeamRef): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    with roots as (
      select path from platform.nodes
       where org_id = ${identity.org.id} and deleted_at is not null
         and (owner_team_id = ${team.id} or starts_with(path, ${`${team.slug}/`}))
    )
    select count(*)::int as count from platform.nodes n
     where n.org_id = ${identity.org.id} and n.deleted_at is not null
       and exists (select 1 from roots r where n.path = r.path or starts_with(n.path, r.path || '/'))`
  return row?.count ?? 0
}

/** Efface les pages de l'équipe à la corbeille, sous-pages comprises ; rend les identifiants de leurs fichiers. */
export async function eraseTrashedNodes(sql: Tx, identity: Identity, team: TeamRef): Promise<string[]> {
  const [erased] = await sql<{ files: string[] }[]>`
    with roots as (
      select path from platform.nodes
       where org_id = ${identity.org.id} and deleted_at is not null
         and (owner_team_id = ${team.id} or starts_with(path, ${`${team.slug}/`}))
    ), gone as (
      delete from platform.nodes n
       where n.org_id = ${identity.org.id} and n.deleted_at is not null
         and exists (select 1 from roots r where n.path = r.path or starts_with(n.path, r.path || '/'))
      returning n.id
    ), gone_files as (
      delete from platform.files f where f.org_id = ${identity.org.id} and f.node_id in (select gone.id from gone)
      returning f.id
    )
    select coalesce((select array_agg(gone_files.id::text) from gone_files), '{}') as files`
  return erased?.files ?? []
}
