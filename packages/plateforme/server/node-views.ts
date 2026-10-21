// Les vues des pages à l'écran (1.4.13 ; migration `20261020090000_platform_vues.sql`) : la page de l'hôte qui
// affiche un nœud l'enregistre ici, une ligne par page, par personne et par jour. L'accueil en tire « Les plus
// consultés » et la date de la dernière visite (`server/home-contents.ts`). Décidé par le service avant l'écriture : le
// nœud lu par `findNode`, que la personne lit (niveau 0 : introuvable, H68). Sans lui, une page lue à l'écran ne se
// compte nulle part. La base n'accepte la ligne que de la personne elle-même, sur une page qu'elle lit
// (`20261021150000`) ; le ménage de l'organisation passe par `sweep_node_views`, la personne ne lisant que ses lignes.
import { nodeViewSchema } from "../schemas"
import type { PlatformDb } from "./db"
import { inTransaction, invalidInput } from "./errors"
import type { Identity } from "./identity"
import { findNode, unknownNode } from "./nodes/lookup"

/**
 * Compte une vue de la page au chemin donné (un ancien chemin mène au nœud courant) pour la personne, au jour de
 * l'horloge de la base : une vue par ouverture, et non par relecture après un geste. Une vue de la même page qui suit la
 * précédente de moins d'une minute ne compte pas, mais avance `last_at` : une séance de travail ponctuée de relectures
 * reste une ouverture, et la suivante compte une minute après la dernière. Retire au passage les lignes de l'organisation
 * de plus de `NODE_VIEWS_KEPT_DAYS` jours, par `sweep_node_views` (le délai fixé en base). Lève comme `findNode` ; l'hôte
 * l'appelle sans que son échec ne casse la page.
 */
export async function recordNodeView(db: PlatformDb, identity: Identity, input: unknown): Promise<void> {
  const parsed = nodeViewSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const found = await findNode(db, identity, parsed.data.path)
  if (!found) throw unknownNode(parsed.data.path, identity.org.prefix)
  const org = identity.org.id
  await inTransaction(db, "node views: record", async (sql) => {
    await sql`
      insert into platform.node_views (org_id, node_id, user_id) values (${org}, ${found.node.id}, ${identity.user.id})
      on conflict (org_id, node_id, user_id, day) do update
        set views = case when node_views.last_at < now() - interval '1 minute' then least(node_views.views + 1, 1000000) else node_views.views end,
            last_at = now()`
    await sql`select platform.sweep_node_views(${org})`
  })
}
