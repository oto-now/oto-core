// Fichiers joints à un nœud (E10-S02, ADR-016) : les types admis, les limites et les corps des routes `files`,
// partagés par le service (`server/files/service.ts`) et l'écran d'envoi. Le type d'un fichier vient de
// l'extension de son nom, jamais du type que déclare le client (`uploads-patterns.md § Validation`) : un `.csv`
// que Windows annonce `application/vnd.ms-excel` reste un CSV. Sans lui, service et écran tiendraient chacun
// leur liste de types et leurs limites.
import * as z from "zod/v4"
import { PLATFORM_API_PREFIX } from "./api"
import { fileExtension } from "./csv"
import { nodePathSchema } from "./nodes"

/** Les types admis, par extension, et le type servi de chacun (ADR-016 § 5). */
export const FILE_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip",
  // L'audio (décidé le 21/10) : admis pour tout fichier, joint ou en transit, servi en téléchargement, sans lecteur.
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
} as const

export type FileType = keyof typeof FILE_TYPES

/** Les images, que la page rend par `<img>` ; `svg` compris, jamais servi `inline` à la navigation. */
export const IMAGE_TYPES: readonly FileType[] = ["png", "jpeg", "jpg", "gif", "webp", "svg"]

/** Les fichiers texte : lus par le serveur (route HTML, `read {file}`), bornés à 4 Mo (HN-E10S02-9). */
export const TEXT_TYPES: readonly FileType[] = ["html", "md", "txt", "csv"]

/** 50 Mo par fichier (fiche D113). */
export const FILE_MAX_BYTES = 52_428_800

/** 4 Mo par fichier texte, sous la borne de 4,5 Mo qu'un hébergement serverless pose à une réponse (HN-E10S02-9). */
export const TEXT_FILE_MAX_BYTES = 4_194_304

/** 10 Go de fichiers par organisation, `pending` et `ready` comptés (fiche D113, HN-E10S02-1). */
export const ORG_QUOTA_BYTES = 10_737_418_240

function isFileType(value: string): value is FileType {
  return Object.hasOwn(FILE_TYPES, value)
}

/** Le type d'un fichier par l'extension de son nom (`Rapport.PDF` → `pdf`) ; `null` pour un type non admis. */
export function fileTypeOf(name: string): FileType | null {
  const extension = fileExtension(name)
  return isFileType(extension) ? extension : null
}

/** Un caractère de contrôle (C0 ou DEL) : il n'a rien à faire dans un nom affiché et rendu dans un en-tête. */
function hasControl(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 32 || code === 127) return true
  }
  return false
}

/**
 * Le nom d'origine d'un fichier : une métadonnée, jamais un chemin (`uploads-patterns.md § Nommage du chemin`). Exporté pour
 * `name` d'`upload.link` (lot f, `uploads.ts`), qui fixe le type d'un fichier déposé par lien comme celui d'un envoi.
 */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !hasControl(name), "File name: no control characters")

/**
 * La demande d'envoi (`POST files`, AC-a3) : le nœud par son chemin, comme toute route du paquet ; le nom, qui
 * fixe le type ; le type déclaré par le navigateur (`File.type`, vide pour un `.md` sous Windows), que le
 * service ne croit pas ; la taille en octets, que le service borne (`too_large`).
 */
export const fileRequestSchema = z.strictObject({
  node: nodePathSchema,
  name: fileNameSchema,
  mime: z.string().max(255),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

/**
 * La demande d'un fichier en transit (`POST transit-files`) : celle d'un fichier joint, sans nœud. Un fichier en transit
 * passe entre une personne et un connecteur, n'est lisible que par elle (et par le moteur, qui court sous son identité)
 * et s'efface à son échéance.
 */
export const transitFileRequestSchema = fileRequestSchema.omit({ node: true })

/** L'identifiant d'un fichier dans l'adresse (`files/<id>`). */
export const fileIdSchema = z.uuid()

/** `GET files/<id>?disposition=inline` : « Voir » d'un PDF, d'un `txt` ou d'un `csv` (AC-a5) ; ignoré pour un autre type. */
export const fileReadQuerySchema = z.object({ disposition: z.literal("inline").optional() })

/** Les routes des fichiers d'une personne connectée : `<route>/<id>`, `…/html`, `…/markdown`. */
export const FILES_ROUTE = `${PLATFORM_API_PREFIX}files`

/**
 * Les routes des fichiers d'un lien public (E10-S02, AC-c5, ADR-016 § 7) : `/api/platform/public/<jeton>/files`,
 * auxquelles la page publique rapporte ses fichiers, comme `FILES_ROUTE` hors lien.
 */
export function publicFilesRoute(token: string): string {
  return `${PLATFORM_API_PREFIX}public/${token}/files`
}

/**
 * L'adresse de lecture d'un fichier joint, sur l'origine de la page (`GET files/<id>`, AC-a5) : celle que l'écran
 * donne à une image et à « Télécharger » (AC-b1, AC-b2), et que le markdown d'un bloc cite. `route` : celle d'un lien
 * public (`publicFilesRoute`), `FILES_ROUTE` sinon. Sans elle, écran et markdown écriraient chacun le chemin de la route.
 */
export function filePath(id: string, route: string = FILES_ROUTE): string {
  return `${route}/${id}`
}

/**
 * La taille d'un fichier servie à un assistant (AC-d1, AC-d2) : « 1,200 bytes », « 1 byte », en octets exacts pour que
 * `parseMarkdown` relise la taille que le rendu d'un bloc `file` écrit (aller-retour, ADR-011 § 5).
 */
export function fileSizeText(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} ${bytes === 1 ? "byte" : "bytes"}`
}

/**
 * `?view=<id>` sur l'adresse d'un contenu (AC-c1, AC-c2) : la visionneuse d'un fichier joint. Absent : l'écran du
 * nœud. Illisible (répété, pas une chaîne) : une chaîne vide, qu'un service dit introuvable comme un identifiant
 * inconnu, jamais l'écran du nœud à la place de la visionneuse demandée.
 */
export const fileViewParamSchema = z.string().optional().catch("")

/**
 * Un fichier vu (AC-c2) : son nom, sa taille, le chemin de son nœud ; un `.md`, ses blocs lus en mode tolérant
 * (E10-S01). Servi par le service à la page de l'hôte, qui le passe à la visionneuse.
 */
export type FileView =
  | { id: string; name: string; size: number; path: string; type: "html" }
  | { id: string; name: string; size: number; path: string; type: "md"; blocks: ViewedBlock[] }

/** Un bloc d'un `.md` vu, rendu en lecture seule comme un bloc de page (`rendu-des-blocs.tsx`). */
export type ViewedBlock = { type: string; text: string | null; data: Record<string, unknown> }

/** `GET files/<id>/markdown` (AC-c2) : le nom d'un `.md` et ses blocs, lus en mode tolérant. */
export type FileMarkdown = { name: string; blocks: ViewedBlock[] }

/** La réponse d'une demande d'envoi : la ligne `pending` et l'URL présignée où le navigateur envoie l'objet (5 minutes). */
export type FileUpload = { id: string; upload: { url: string; headers: Record<string, string> } }

/** Un fichier confirmé (`ready`), tel qu'un bloc le cite. */
export type FileReady = { id: string; name: string; size: number; mime: string }

/** La demande d'envoi d'un fichier en transit, et son échéance (ISO 8601), au-delà de laquelle il n'existe plus. */
export type TransitFileUpload = FileUpload & { expiresAt: string }

/** Un fichier en transit confirmé (`ready`), et son échéance. */
export type TransitFile = FileReady & { expiresAt: string }

/**
 * L'état du stockage (`GET files`, AC-a7, HN-E10S02-6) et les extensions qu'ouvrent au dépôt les lecteurs de l'hôte
 * (`registerReaders`, `lecture-des-fichiers.md` § Types de l'hôte), sans le point : l'éditeur les admet avec `FILE_TYPES`.
 */
export type FileStorageState = { enabled: boolean; hostTypes: string[] }

/** Le stockage sert-il encore l'objet d'un fichier lisible (`GET files/<id>?check`, AC-b8, HN-E10S02-43) ? */
export type FileAvailability = { available: boolean }
