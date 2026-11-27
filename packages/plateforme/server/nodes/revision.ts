// La révision d'un nœud, seule (retour RET-008) : ce que l'écran d'une page ouverte relit toutes les 30 secondes pour
// savoir si elle a changé ailleurs (un assistant, une autre personne), sans relire ses blocs, son en-tête ni sa famille,
// comme le ferait `loadNode`. Les droits sont ceux de `findNode` : un nœud que l'appelant ne voit pas est inconnu.
import { nodeHeadQuerySchema, type NodeRevision } from "../../schemas/search"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { findNode } from "./lookup"

export async function nodeRevision(db: PlatformDb, identity: Identity, input: unknown): Promise<NodeRevision> {
  const parsed = nodeHeadQuerySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { path } = parsed.data
  const found = await inTransaction(db, "nodes: revision", () => findNode(db, identity, path))
  if (!found) throw new PlatformError("not_found", `Unknown path ${path}.`)
  return { path: found.node.path, revision: found.node.revision }
}
