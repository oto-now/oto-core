// Les deux formes markdown d'un fichier joint (E10-S02, AC-d1) relues par `parseMarkdown` : l'image
// `![<alt>](<origine>/f/<id>)` et le fichier `[<nom> (<taille>, <type>)](<origine>/f/<id>)`, que `renderBlock` écrit
// (`schemas/blocks-render.ts`). Le chemin de l'adresse fait la forme, quelle que soit l'origine, absente comprise
// (aller-retour, ADR-011 § 5). L'ancienne adresse, `/api/platform/files/<id>`, se lit aussi, tant que sa redirection vit
// (fichiers et stockage, § Adresse unique) : un assistant qui recopie un ancien lien écrit un bloc juste. Fichier à part de `markdown-parse.ts` pour la borne de 300 lignes.
//
// Le nom, la taille et le type lus ici ne font pas foi : `writeNode` les reprend de la ligne `files` (AC-d3). Une
// étiquette qui n'a pas la forme du rendu (« [le rapport](…) » écrit à la main) donne donc un bloc aux métadonnées
// provisoires, que l'écriture remplace. Chaque lecture est linéaire (`security-patterns.md § Validation des inputs`) :
// expressions ancrées dont chaque caractère n'a qu'une lecture, et recherche de la dernière `](` à la main.
import { FILE_ADDRESS, FILE_MAX_BYTES, FILE_TYPES, FILES_ROUTE, type BlockInput, type FileType } from "../../schemas"
import { chars } from "../../schemas/blocks"

/** L'adresse d'un fichier : une origine `http(s)` facultative, `/f` ou l'ancienne route, un uuid (casse indifférente). */
const FILE_URL = new RegExp(`^(?:https?://[^\\s/?#()]+)?(?:${FILE_ADDRESS}|${FILES_ROUTE})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`)

/** « 1,200 bytes, pdf » : la taille exacte et le type d'une étiquette rendue (`fileSizeText`). */
const SIZE_AND_TYPE = /^(\d{1,3}(?:,\d{3})*) bytes?, (.+)$/

/** Nom et type d'un fichier : 255 caractères au plus (`files_name_check`, bloc `file`). */
const NAME_MAX = 255

/** Le type d'une étiquette qui n'a pas la forme du rendu : celui d'octets quelconques, remplacé à l'écriture. */
const UNKNOWN_MIME = "application/octet-stream"

/** L'identifiant, en minuscules comme la base le relit, du fichier qu'une adresse lit ; `null` pour toute autre adresse. */
export function fileIdOfUrl(url: string): string | null {
  const match = FILE_URL.exec(url)
  return match ? match[1].toLowerCase() : null
}

const within = (text: string) => chars(text) >= 1 && chars(text) <= NAME_MAX

const isFileType = (type: string): type is FileType => Object.hasOwn(FILE_TYPES, type)

/** Nom, taille et type d'une étiquette rendue ; `null` pour une autre étiquette. */
function renderedLabel(label: string): { name: string; size: number; mime: string } | null {
  const open = label.lastIndexOf(" (")
  if (open < 1 || !label.endsWith(")")) return null
  const match = SIZE_AND_TYPE.exec(label.slice(open + 2, -1))
  if (!match) return null
  const name = label.slice(0, open)
  const size = Number(match[1].replaceAll(",", ""))
  const type = match[2]
  const mime: string = isFileType(type) ? FILE_TYPES[type] : type
  return within(name) && within(mime) && size >= 1 && size <= FILE_MAX_BYTES ? { name, size, mime } : null
}

/**
 * Un bloc `file` seul sur sa ligne (AC-d1) : `[<étiquette>](<adresse de lecture>)`, la dernière `](` de la ligne
 * ouvrant l'adresse, que la route et l'uuid ferment ; `null` pour toute autre ligne, lien ordinaire compris.
 */
export function fileLinkAt(line: string): BlockInput | null {
  const text = line.trim()
  if (!text.startsWith("[") || !text.endsWith(")")) return null
  const bracket = text.lastIndexOf("](")
  if (bracket < 1) return null
  const fileId = fileIdOfUrl(text.slice(bracket + 2, -1))
  if (!fileId) return null
  const label = text.slice(1, bracket)
  const read = renderedLabel(label)
  if (read) return { type: "file", text: null, data: { file_id: fileId, ...read } }
  const name = Array.from(label.trim()).slice(0, NAME_MAX).join("")
  return { type: "file", text: null, data: { file_id: fileId, name: name === "" ? fileId : name, size: 1, mime: UNKNOWN_MIME } }
}
