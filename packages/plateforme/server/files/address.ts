// L'adresse d'un fichier, `/f/<id>` (fichiers et stockage, § Adresse unique et lecture d'un fichier en transit) : la
// lecture par redirection et la disponibilité d'un fichier, joint ou en transit, décidées selon son état. Joint, le droit
// de lecture de son nœud (`readableFile`) ; en transit, son auteur seul, avant l'échéance (`readyTransitFile`) ; pour tout
// autre, le même `not_found`. Sans elle, un fichier aurait une adresse par état, et un lien changerait quand on le garde.
import { fileReadQuerySchema, type FileAvailability } from "../../schemas"
import type { PlatformDb } from "../db"
import { invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { fileOrigin } from "./origin"
import { onStorage, readableFile, readResponse, requireStore } from "./service"
import { objectKey } from "./store"
import { readyTransitFile } from "./transit"

/** Un fichier lu à son adresse : son identifiant, son nom, et s'il est en transit. */
type AddressedFile = { id: string; name: string; transit: boolean }

/** Le fichier `fileId` selon son état : joint et lisible, sinon en transit et à l'appelant ; `not_found` pour tout autre. */
async function addressedFile(db: PlatformDb, identity: Identity, fileId: unknown): Promise<AddressedFile> {
  try {
    const file = await readableFile(db, identity, fileId)
    return { id: file.id, name: file.name, transit: false }
  } catch (error) {
    if (!(error instanceof PlatformError) || error.code !== "not_found") throw error
  }
  const file = await readyTransitFile(db, identity, fileId)
  return { id: file.id, name: file.name, transit: true }
}

/**
 * La lecture d'un fichier (AC-a5) : l'URL présignée de 60 s où l'adresse redirige. Un fichier joint suit la table de
 * `readResponse` (« Voir » d'un PDF, d'un `txt` ou d'un `csv` sur `?disposition=inline`) ; un fichier en transit se
 * télécharge, hors images matricielles (décision du 19/10).
 */
export async function fileReadUrl(db: PlatformDb, identity: Identity, fileId: unknown, query: Record<string, string>): Promise<string> {
  const parsed = fileReadQuerySchema.safeParse(query)
  if (!parsed.success) throw invalidInput(parsed.error)
  const store = requireStore()
  const file = await addressedFile(db, identity, fileId)
  const inline = parsed.data.disposition === "inline" && !file.transit
  return onStorage("read url", () => store.readUrl(objectKey(identity.org.id, file.id), readResponse(file, inline)))
}

/**
 * La disponibilité d'un fichier (AC-b8, HN-E10S02-43) : le même droit que la lecture, et la même réponse `not_found` pour
 * ce qui n'est pas lisible ; puis l'objet lu par `HEAD`. Aucun octet ne sort du bucket, aucune redirection : la carte d'un
 * fichier lit la réponse sans suivre le stockage. Avec l'origine du fichier, que la carte dit à côté de sa taille.
 */
export async function fileAvailability(db: PlatformDb, identity: Identity, fileId: unknown): Promise<FileAvailability> {
  const store = requireStore()
  const file = await addressedFile(db, identity, fileId)
  const head = await onStorage("head", () => store.head(objectKey(identity.org.id, file.id)))
  return { available: head !== null, origin: await fileOrigin(db, identity, file.id) }
}
