// Les contenus dont des fils de commentaires attendent un assistant, pour la personne qui les écrit : ce que `context`
// nomme dans les contenus récents (« 2 comments for the assistant »). `@assistant` ne désigne aucun assistant précis : le
// fil revient au prochain assistant d'une personne qui peut modifier la page, donc à celles qui l'écrivent seules (niveau
// 2, décidé ici par `nodeDecisions`, `security-patterns.md § Droits dans le service`) ; qui ne fait que lire n'y voit rien.
// Même règle d'attente que `waitingAssistant` (`threads.ts`), en SQL : un fil ouvert, dont aucun commentaire écrit par
// un assistant ne suit le dernier commentaire adressé à l'assistant. Sans ce module, un fil adressé à l'assistant attend
// que quelqu'un relise la page par hasard.
import { ACCESS_LEVELS, nodeDecisions } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"

/** Contenus lus au plus, les plus récemment adressés à l'assistant, avant le filtre du niveau. */
const WAITING_ROWS = 200

/** Un contenu que l'appelant écrit et dont `threads` fils attendent un assistant ; `at` : la dernière demande (ISO). */
export type WaitingPage = { id: string; path: string; kind: string; title: string; threads: number; at: string }

type WaitingRow = { id: string; path: string; kind: string; title: string; threads: number; at: Date }

/**
 * Les contenus de l'organisation, hors corbeille, que l'appelant écrit et dont un fil au moins attend un assistant, la
 * demande la plus récente d'abord. Une lecture, puis les niveaux exacts en un lot (`nodeLevels` n'est exact qu'à la lecture).
 */
export async function pagesWaitingAssistant(db: PlatformDb, identity: Identity): Promise<WaitingPage[]> {
  const rows = await inTransaction(db, "comments: waiting for an assistant", (sql) => sql<WaitingRow[]>`
    with asked as (
      select distinct on (c.thread_id) c.thread_id, c.created_at, c.id
        from platform.comments c
       where c.org_id = ${identity.org.id} and c.to_assistant
       order by c.thread_id, c.created_at desc, c.id desc
    )
    select n.id, n.path, n.kind, n.title, count(*)::int as threads, max(asked.created_at) as at
      from asked
      join platform.comment_threads t on t.id = asked.thread_id and t.status = 'open'
      join platform.nodes n on n.id = t.node_id and n.org_id = t.org_id and n.deleted_at is null
     where not exists (
             select 1 from platform.comments a
              where a.thread_id = asked.thread_id and a.via_assistant and (a.created_at, a.id) > (asked.created_at, asked.id))
     group by n.id, n.path, n.kind, n.title
     order by max(asked.created_at) desc, n.path
     limit ${WAITING_ROWS}`)
  if (rows.length === 0) return []
  const decisions = await nodeDecisions(db, identity, rows.map((row) => row.id))
  return rows.flatMap((row) => ((decisions.get(row.id)?.level ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.write ? [{ ...row, at: row.at.toISOString() }] : []))
}
