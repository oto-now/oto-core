// Un ZIP lu entrée par entrée (`lecture-des-fichiers.md` § Bornes) : son répertoire central, puis chaque entrée
// demandée décompressée par `fflate` en petits morceaux, les octets réellement produits comptés au fil de la
// décompression contre la borne d'un passage (64 Mo). La taille qu'une entrée déclare ne sert qu'à refuser tôt : une
// archive qui ment sur elle est arrêtée au premier morceau qui passe la borne, pas après l'avoir gonflée en mémoire.
// Un fichier Office chiffré est un conteneur OLE, pas un ZIP. Sans lui, une bombe de 400 Ko monterait à des centaines
// de mégaoctets avant tout contrôle (incident d'oto 1).
import { Inflate } from "fflate"
import { ReaderStatusError } from "./status"

/** Les octets décompressés qu'un passage peut encore produire, décomptés au fil de la décompression. */
export type InflateBudget = { left: number; readonly total: number }

/** Une entrée du répertoire central. */
type ZipEntry = { name: string; flags: number; method: number; compressedSize: number; declaredSize: number; offset: number }

/**
 * Octets compressés poussés à la fois : DEFLATE gonfle 1 032 fois au plus, un morceau produit donc au plus 4 Mo
 * avant que le compte ne le voie.
 */
const INPUT_CHUNK = 4_096

/** Morceau d'une entrée stockée sans compression, rendue telle quelle. */
const STORED_CHUNK = 65_536

/** Entrées lues du répertoire central au plus : celles d'un ZIP sans extension ZIP64. */
const ENTRIES_MAX = 65_535

const SIGNATURE = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 } as const
const END_RECORD = 22
const COMMENT_MAX = 65_535

/** L'en-tête d'un conteneur OLE (CFB) : un fichier Office chiffré, ou un ancien `.xls`. */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** `EncryptedPackage` en UTF-16LE : le flux qu'un fichier Office chiffré range dans son conteneur OLE. */
const ENCRYPTED_PACKAGE = new TextEncoder().encode("EncryptedPackage").reduce<number[]>((bytes, byte) => [...bytes, byte, 0], [])

const damaged = (why: string) => new ReaderStatusError({ status: "unsupported", detail: `the file is damaged: ${why}` })

/** Le dépassement de la borne de décompression. */
export function tooLarge(budget: InflateBudget): ReaderStatusError {
  return new ReaderStatusError({ status: "too_large", detail: `it unzips to more than ${Math.round(budget.total / 1_048_576)} MB` })
}

function startsWith(bytes: Uint8Array, magic: readonly number[], at = 0): boolean {
  return magic.every((byte, index) => bytes[at + index] === byte)
}

function contains(bytes: Uint8Array, needle: readonly number[]): boolean {
  const first = needle[0]
  for (let at = bytes.indexOf(first); at >= 0 && at <= bytes.length - needle.length; at = bytes.indexOf(first, at + 1)) {
    if (startsWith(bytes, needle, at)) return true
  }
  return false
}

/**
 * Le statut d'un fichier qui n'est pas un ZIP, lu à ses premiers octets : un conteneur OLE qui range un paquet chiffré
 * est `encrypted`, un autre (un ancien `.xls` renommé) et tout le reste `unsupported` ; `null` pour un ZIP.
 */
export function notZip(bytes: Uint8Array, format: string): ReaderStatusError | null {
  if (startsWith(bytes, CFB_MAGIC)) {
    return contains(bytes, ENCRYPTED_PACKAGE)
      ? new ReaderStatusError({ status: "encrypted", detail: "it is protected by a password; ask for a copy without one" })
      : new ReaderStatusError({ status: "unsupported", detail: `it is an old binary Office file, not ${format}; save it as ${format}` })
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return null
  return new ReaderStatusError({ status: "unsupported", detail: `it is not a ZIP archive, so not a valid ${format} file` })
}

/** Le nom d'une partie, comparé sans casse (une partie OPC se nomme sans casse) et sans barre de tête. */
export const partKey = (name: string) => name.replace(/^\/+/u, "").toLowerCase()

export class ZipArchive {
  private readonly view: DataView
  private readonly entries = new Map<string, ZipEntry>()

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.readDirectory()
  }

  /** L'entrée nommée existe-t-elle (sans casse) ? */
  has(name: string): boolean {
    return this.entries.has(partKey(name))
  }

  /** La taille qu'une entrée déclare, `0` si elle manque : une indication, jamais une borne. */
  declaredSize(name: string): number {
    return this.entries.get(partKey(name))?.declaredSize ?? 0
  }

  /**
   * Les octets d'une entrée, passés à `sink` morceau par morceau, chacun compté contre `budget` avant d'être passé ;
   * `sink` rend `false` pour arrêter. Au-delà de la borne, `too_large` ; une entrée chiffrée, `encrypted`.
   */
  stream(name: string, budget: InflateBudget, sink: (chunk: Uint8Array) => boolean): void {
    const entry = this.entries.get(partKey(name))
    if (!entry) throw damaged(`${name} is missing`)
    if (entry.flags & 1) throw new ReaderStatusError({ status: "encrypted", detail: "its parts are encrypted" })
    if (entry.declaredSize > budget.left) throw tooLarge(budget)
    const data = this.entryData(entry)
    let stopped = false
    const take = (chunk: Uint8Array): void => {
      if (stopped || chunk.length === 0) return
      budget.left -= chunk.length
      if (budget.left < 0) throw tooLarge(budget)
      if (!sink(chunk)) stopped = true
    }
    if (entry.method === 0) {
      for (let at = 0; at < data.length && !stopped; at += STORED_CHUNK) take(data.subarray(at, at + STORED_CHUNK))
      return
    }
    if (entry.method !== 8) throw new ReaderStatusError({ status: "unsupported", detail: `${entry.name} uses compression method ${entry.method}` })
    const inflate = new Inflate((chunk) => take(chunk))
    try {
      for (let at = 0; at < data.length && !stopped; at += INPUT_CHUNK) inflate.push(data.subarray(at, at + INPUT_CHUNK), at + INPUT_CHUNK >= data.length)
    } catch (error) {
      if (error instanceof ReaderStatusError) throw error
      throw damaged(`${entry.name} does not inflate (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  /** Les octets d'une entrée entière, sous la même borne. */
  read(name: string, budget: InflateBudget): Uint8Array {
    const chunks: Uint8Array[] = []
    this.stream(name, budget, (chunk) => chunks.push(chunk) > 0)
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }

  /** Les octets compressés d'une entrée, après son en-tête local, contrôlés contre la taille du fichier. */
  private entryData(entry: ZipEntry): Uint8Array {
    const at = entry.offset
    if (at + 30 > this.bytes.length || this.view.getUint32(at, true) !== SIGNATURE.local) throw damaged(`no local header for ${entry.name}`)
    const start = at + 30 + this.view.getUint16(at + 26, true) + this.view.getUint16(at + 28, true)
    if (start + entry.compressedSize > this.bytes.length) throw damaged(`${entry.name} runs past the end of the file`)
    return this.bytes.subarray(start, start + entry.compressedSize)
  }

  /** La fin du répertoire central, cherchée depuis la fin du fichier, derrière un commentaire éventuel. */
  private endRecord(): number {
    const last = this.bytes.length - END_RECORD
    for (let at = last; at >= 0 && at >= last - COMMENT_MAX; at--) {
      if (this.view.getUint32(at, true) === SIGNATURE.end) return at
    }
    throw damaged("no end of central directory")
  }

  private readDirectory(): void {
    const end = this.endRecord()
    const count = this.view.getUint16(end + 10, true)
    const offset = this.view.getUint32(end + 16, true)
    if (count === 0xffff || offset === 0xffffffff) throw new ReaderStatusError({ status: "unsupported", detail: "ZIP64 archives are not read" })
    const names = new TextDecoder("utf-8")
    let at = offset
    for (let index = 0; index < Math.min(count, ENTRIES_MAX); index++) {
      if (at + 46 > end || this.view.getUint32(at, true) !== SIGNATURE.central) throw damaged("the central directory is cut")
      const nameLength = this.view.getUint16(at + 28, true)
      const name = names.decode(this.bytes.subarray(at + 46, at + 46 + nameLength))
      const entry: ZipEntry = {
        name,
        flags: this.view.getUint16(at + 8, true),
        method: this.view.getUint16(at + 10, true),
        compressedSize: this.view.getUint32(at + 20, true),
        declaredSize: this.view.getUint32(at + 24, true),
        offset: this.view.getUint32(at + 42, true),
      }
      if (!this.entries.has(partKey(name))) this.entries.set(partKey(name), entry)
      at += 46 + nameLength + this.view.getUint16(at + 30, true) + this.view.getUint16(at + 32, true)
    }
  }
}
