// Le lecteur de tableur `xlsx` du paquet (`lecture-des-fichiers.md` § Ce que rend chaque format) : une partie par
// feuille, en CSV, nommée par la feuille (« (hidden) » pour une feuille cachée), le titre des propriétés du document,
// un résumé des feuilles et de leurs dimensions. Il ne lit dans le fil de la requête que les premiers octets (un ZIP, ou
// un conteneur OLE : fichier chiffré ou ancien `.xls`) ; tout le reste court dans un worker (`worker/run.ts`), que
// l'échéance termine. Sans lui, un tableur joint ne se lirait que par son nom.
import { FILE_TYPES } from "../../../schemas/files"
import { notZip } from "./archive"
import { ReaderStatusError, type Reader, type ReaderDocument, type ReaderInput, type ReaderStatus } from "./types"
import { ReaderWorker, WORKER_LIMITS } from "./worker/run"
import type { BookOutline } from "./xlsx/book"

/**
 * Lit un xlsx : le plan par le worker, puis chaque partie par le même worker ; `source` remplace le script du worker
 * dans un test.
 */
export async function readXlsx(input: ReaderInput, source?: string): Promise<ReaderDocument | ReaderStatus> {
  const refused = notZip(input.bytes, "xlsx")
  if (refused) return refused.reader
  const worker = new ReaderWorker({ format: "xlsx", name: input.name, bytes: input.bytes, limits: WORKER_LIMITS }, input.signal, source)
  try {
    const outline = (await worker.ask({ op: "outline" })) as BookOutline
    return { ...outline, text: async (part) => String(await worker.ask({ op: "text", part })) }
  } catch (error) {
    worker.end()
    if (error instanceof ReaderStatusError) return error.reader
    throw error
  }
}

export const XLSX_READER: Reader = {
  types: [{ extension: "xlsx", mime: FILE_TYPES.xlsx }],
  read: (input) => readXlsx(input),
}
