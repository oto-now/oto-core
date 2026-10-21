// L'origine d'un fichier, telle qu'elle se lit (fichiers et stockage, § Origine d'un fichier ; étape 4 du chantier
// « fichier », décidée par Alexis le 21/10) : ce qui l'a produit, la fonction, l'auteur et la date, la conversation à son
// seul auteur, et pour une copie le fichier d'où elle vient. Servie par `read {file}` et par la visionneuse ; lue sous
// la RLS, l'appelant ayant déjà lu le fichier. Sans elle, l'origine écrite en base ne se lirait nulle part.
import type { FileOriginView } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"

type OriginRow = {
  origin_kind: FileOriginView["kind"]
  origin_function: string | null
  origin_ctx: string | null
  origin_by: string | null
  by_name: string | null
  origin_at: string | null
  copied_from: string | null
  created_at: string
}

/** La vue d'une ligne : nulle pour un fichier d'avant l'étape 4 (« origine inconnue »). */
export function originView(row: OriginRow, identity: Identity): FileOriginView | null {
  if (row.origin_at === null) return null
  return {
    kind: row.origin_kind,
    ...(row.origin_function ? { function: row.origin_function } : {}),
    by: row.origin_by ? { id: row.origin_by, name: row.by_name } : null,
    at: new Date(row.origin_at).toISOString(),
    // La conversation, à son seul auteur : un autre lecteur de la page voit la fonction, la date et l'auteur.
    ...(row.origin_ctx && row.origin_by === identity.user.id ? { ctx: row.origin_ctx } : {}),
    ...(row.copied_from ? { copied_from: row.copied_from, copied_at: new Date(row.created_at).toISOString() } : {}),
  }
}

/** L'origine du fichier `fileId` que l'appelant vient de lire ; nulle s'il n'en a pas. */
export async function fileOrigin(db: PlatformDb, identity: Identity, fileId: string): Promise<FileOriginView | null> {
  const [row] = await inTransaction(db, "files: origin", (sql) => sql<OriginRow[]>`
    select f.origin_kind, f.origin_function, f.origin_ctx, f.origin_by, m.name as by_name, f.copied_from,
           to_json(f.origin_at) #>> '{}' as origin_at, to_json(f.created_at) #>> '{}' as created_at
      from platform.files f
      left join platform.members m on m.org_id = f.org_id and m.user_id = f.origin_by
     where f.org_id = ${identity.org.id} and f.id = ${fileId}`)
  return row ? originView(row, identity) : null
}
