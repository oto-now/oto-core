// Les mentions d'un commentaire (parcours 5.4) : qui lit le nœud, donc qui peut y être mentionné. La lecture des
// `@Prénom Nom` et de `@assistant` d'un texte vit dans `schemas/comments.ts`, que l'écran lit aussi ; ce module la
// réexporte pour le service. Un nom qui ne désigne aucun lecteur de la page reste du texte, sans erreur : une mention ne
// révèle jamais une page à qui ne la lit pas. Sans ce module, le service ne saurait pas qui un commentaire peut mentionner.
import { nodeReaders } from "../access"
import type { PlatformDb } from "../db"
import { memberDirectory } from "../directory"
import type { Identity } from "../identity"

export { addressesAssistant, readMentions } from "../../schemas"

/** Un membre qui lit le nœud, sous son nom d'annuaire. */
export type Reader = { id: string; name: string }

/** Les membres de l'organisation qui lisent le nœud (`nodeReaders`, `access.ts`), par nom comme l'annuaire. */
export async function readersOf(db: PlatformDb, identity: Identity, nodeId: string): Promise<Reader[]> {
  const [reading, directory] = await Promise.all([nodeReaders(db, identity, nodeId), memberDirectory(db, identity.org.id)])
  return directory.filter((person) => reading.has(person.userId)).map((person) => ({ id: person.userId, name: person.name }))
}
