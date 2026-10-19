// `read {path, file}` (E10-S02, AC-d2 ; fiche D119) : le texte d'un fichier texte joint au nœud de `path`, servi seul
// dans une clôture de son type, précédé de son nom et de sa taille, coupé par le curseur de `read` au-delà de 45 000
// caractères. Le droit est celui de la lecture du nœud, relu par `readFileText` (AC-a8), qui refuse avant de lire
// l'objet un fichier inconnu, `pending` ou d'un autre nœud. Le texte n'a pas de référence de bloc : `write` ne le relit
// jamais comme un bloc. Sans lui, un assistant ne lirait d'un fichier joint que son nom (ADR-009). L'hôte qui retient le
// contenu des fichiers (`registerDataPolicy`, `fileContents: "metadata"`) le fait refuser avant toute lecture. Fichier à
// part de `read.ts` (borne de 300 lignes).
import type { ReadNodeInput } from "../../schemas"
import { fenceFor } from "../../schemas/blocks-render"
import { fileSizeText, fileTypeOf, type FileType } from "../../schemas/files"
import { fileContentsFor } from "../data-policy"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import { readFileText } from "../files/service"
import type { Identity } from "../identity"
import type { ToolOutput } from "../tool-output"
import type { NodeRow } from "./lookup"
import { paginate } from "./read-pages"
import { ownerOf, teamOf } from "./view"

/** Le mot de tête de la clôture d'un fichier texte (AC-d2). */
const FENCE_INFO: Partial<Record<FileType, string>> = { html: "html", md: "markdown", csv: "csv", txt: "text" }

/** Le texte d'un fichier joint au nœud lu (AC-d2), en une ou plusieurs parties (`paginate`). */
export async function readNodeFile(db: PlatformDb, identity: Identity, request: { input: ReadNodeInput; file: string; node: NodeRow; prefix: string }): Promise<ToolOutput> {
  const { input, node } = request
  // La politique de l'hôte (`registerDataPolicy`) : refusé avant toute lecture du fichier, son nom reste dans la page.
  if ((await fileContentsFor(identity.org)) === "metadata") {
    throw new PlatformError(
      "forbidden",
      `The contents of files are not served to assistants at ${identity.org.name}: only their name, size and type, shown in ${node.path}. Ask the user to open the file.`,
      { reason: "file_contents_withheld" },
    )
  }
  const file = await readFileText(db, identity, request.file, { id: node.id, path: node.path })
  const type = fileTypeOf(file.name)
  const fence = fenceFor(file.text)
  const body = `${fence}${(type && FENCE_INFO[type]) ?? "text"}\n${file.text}\n${fence}`
  const data = { path: node.path, file: { id: file.id, name: file.name, size: file.size, type } }
  return paginate({
    input,
    node,
    prefix: request.prefix,
    header: `${file.name} (${fileSizeText(file.size)})`,
    served: { body, footer: [], blocks: [] },
    data,
    nextActions: [],
    teamId: teamOf(await ownerOf(db, node.id)),
  })
}
