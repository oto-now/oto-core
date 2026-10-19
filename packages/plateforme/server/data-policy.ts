// La politique de l'hôte sur les données servies aux assistants (`pseudonymisation.md` § Les quatre primitives) : le
// contenu des fichiers joints est servi (défaut, le comportement d'avant) ou seulement leurs métadonnées (nom, taille,
// type). L'hôte l'enregistre une fois, comme ses capacités (`registerOrgLimits`), pour toutes ses organisations ou par
// une fonction de l'organisation. Sans ce module, un hôte dont les fichiers portent des données de personnes ne pourrait
// pas les tenir hors de la conversation.
import { PlatformError } from "./errors"

/** `served` : `read {file}` rend le texte du fichier ; `metadata` : refusé, le nom, la taille et le type restent visibles. */
export type FileContentsPolicy = "served" | "metadata"

export type DataPolicy = {
  /** Pour toutes les organisations, ou par organisation ; absente : `served`. */
  fileContents?: FileContentsPolicy | ((org: { id: string; slug: string }) => FileContentsPolicy | Promise<FileContentsPolicy>)
}

const FILE_CONTENTS: readonly FileContentsPolicy[] = ["served", "metadata"]

let policy: DataPolicy | null = null

/**
 * Enregistre la politique de l'hôte, en tête de chaque route qui monte une porte du paquet ; `null` la retire. Une
 * politique mal formée lève au chargement, avant de servir un fichier qu'elle aurait retenu.
 */
export function registerDataPolicy(next: DataPolicy | null): void {
  const given = next?.fileContents
  if (given !== undefined && typeof given !== "function" && !FILE_CONTENTS.includes(given)) {
    throw new TypeError(`registerDataPolicy: fileContents must be "served", "metadata" or a function of the organisation.`)
  }
  policy = next
}

/**
 * Ce que la politique dit du contenu des fichiers de l'organisation. Une fonction de l'hôte qui lève ou rend une autre
 * valeur : un refus, jamais un fichier servi par défaut.
 */
export async function fileContentsFor(org: { id: string; slug: string }): Promise<FileContentsPolicy> {
  const given = policy?.fileContents ?? "served"
  if (typeof given !== "function") return given
  let returned: unknown
  try {
    returned = await given({ id: org.id, slug: org.slug })
  } catch {
    console.error(`[platform] data policy: the host's fileContents function failed for ${org.slug}`)
    throw new PlatformError("internal", "Internal error.")
  }
  if (returned === "served" || returned === "metadata") return returned
  console.error(`[platform] data policy: the host's fileContents function returned an invalid value for ${org.slug}`)
  throw new PlatformError("internal", "Internal error.")
}
