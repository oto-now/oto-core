// Le lecteur XML des formats faits de XML dans un ZIP (`lecture-des-fichiers.md` § Sécurité) : un tokeniseur écrit pour
// le paquet, qui lit le document par morceaux (une entrée décompressée au fil de l'eau) et rend balises ouvrantes,
// fermantes et texte, sans arbre ni expression rationnelle sur le document. Aucune entité n'est jamais développée :
// seules les cinq entités prédéfinies et les références numériques sont lues, une autre reste telle quelle ; tout
// `<!DOCTYPE>` (ou autre déclaration `<!…>`) est refusé, `rejected_dtd` : un fichier Office n'en porte jamais, et c'est
// par lui que viennent l'expansion d'entités (« billion laughs ») et l'entité externe. Les noms se lisent sans leur
// préfixe d'espace de noms (`x:c` → `c`), ce qui lit aussi l'OOXML strict. Sans lui, il faudrait un parseur tiers.
import { ReaderStatusError } from "./status"

export type XmlAttributes = Readonly<Record<string, string>>

/** Ce que rend le tokeniseur ; `text` peut recevoir le texte d'un élément en plusieurs morceaux. */
export type XmlHandler = {
  open?: (name: string, attributes: XmlAttributes, empty: boolean) => void
  close?: (name: string) => void
  text?: (text: string) => void
}

/** Une balise, un commentaire ou une section CDATA inachevés au-delà : un document piégé, pas un fichier Office. */
const MARKUP_MAX = 1_048_576

/** Longueur d'une référence d'entité (`&#x10FFFF;`), au-delà de laquelle une esperluette est lue telle quelle. */
const ENTITY_MAX = 12

const PREDEFINED: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }

const CDATA = "<![CDATA["
const COMMENT = "<!--"

const isSpace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d

/** Le nom sans son préfixe d'espace de noms. */
const localName = (name: string) => {
  const colon = name.indexOf(":")
  return colon < 0 ? name : name.slice(colon + 1)
}

/** Une référence numérique (`#65`, `#x41`), `U+FFFD` pour un point de code hors d'Unicode. */
function numericEntity(body: string): string {
  const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
  const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
  return valid ? String.fromCodePoint(code) : "�"
}

/** Le texte avec ses références lues : les cinq prédéfinies et les numériques ; toute autre reste telle quelle. */
export function decodeEntities(text: string): string {
  let amp = text.indexOf("&")
  if (amp < 0) return text
  let out = ""
  let from = 0
  while (amp >= 0) {
    const semi = text.indexOf(";", amp + 1)
    if (semi > amp && semi - amp <= ENTITY_MAX) {
      const body = text.slice(amp + 1, semi)
      const value = body[0] === "#" ? numericEntity(body) : PREDEFINED[body]
      if (value !== undefined) {
        out += text.slice(from, amp) + value
        from = semi + 1
      }
    }
    amp = text.indexOf("&", amp + 1)
  }
  return out + text.slice(from)
}

/** Les attributs d'une balise ouvrante, de `at` (après le nom) à `end` (avant `>` ou `/>`). */
function attributesOf(tag: string, at: number, end: number): Record<string, string> {
  const attributes: Record<string, string> = {}
  let index = at
  while (index < end) {
    while (index < end && isSpace(tag.charCodeAt(index))) index++
    const nameStart = index
    while (index < end && tag[index] !== "=" && !isSpace(tag.charCodeAt(index))) index++
    const name = tag.slice(nameStart, index)
    while (index < end && isSpace(tag.charCodeAt(index))) index++
    if (tag[index] !== "=") break
    index++
    while (index < end && isSpace(tag.charCodeAt(index))) index++
    const quote = tag[index]
    if (quote !== '"' && quote !== "'") break
    const close = tag.indexOf(quote, index + 1)
    if (close < 0 || close > end) break
    if (name !== "" && !name.startsWith("xmlns")) attributes[localName(name)] = decodeEntities(tag.slice(index + 1, close))
    index = close + 1
  }
  return attributes
}

/** La fin (après `>`) d'une balise ouvrante commencée à `at`, hors des valeurs entre guillemets ; `-1` inachevée. */
function tagEnd(buffer: string, at: number): number {
  let quote = ""
  for (let index = at + 1; index < buffer.length; index++) {
    const char = buffer[index]
    if (quote !== "") {
      if (char === quote) quote = ""
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === ">") {
      return index + 1
    }
  }
  return -1
}

const dtdRefused = () => new ReaderStatusError({ status: "rejected_dtd", detail: "its XML declares a DOCTYPE, which is refused" })

/** Un tokeniseur XML qui lit son document par morceaux (`push`, puis `end`) ; `stop()` l'arrête en cours. */
export class XmlScanner {
  private pending = ""
  private stopped = false

  constructor(private readonly handler: XmlHandler) {}

  get done(): boolean {
    return this.stopped
  }

  stop(): void {
    this.stopped = true
  }

  push(chunk: string): void {
    if (this.stopped) return
    this.pending += chunk
    this.scan(false)
  }

  end(): void {
    if (this.stopped) return
    this.scan(true)
    if (this.pending !== "" && !this.stopped) throw new ReaderStatusError({ status: "unsupported", detail: "the file is damaged: an XML part ends inside a tag" })
  }

  private emitText(text: string): void {
    if (text !== "") this.handler.text?.(decodeEntities(text))
  }

  private scan(final: boolean): void {
    const buffer = this.pending
    let at = 0
    while (at < buffer.length && !this.stopped) {
      const lt = buffer.indexOf("<", at)
      if (lt !== at) {
        at = this.textRun(buffer, at, lt, final)
        if (lt < 0) break
        continue
      }
      const next = this.markup(buffer, at, final)
      if (next < 0) break
      at = next
    }
    this.pending = buffer.slice(at)
    if (this.pending.length > MARKUP_MAX) throw new ReaderStatusError({ status: "unsupported", detail: "the file is damaged: an XML tag runs over 1 MB" })
  }

  /** Le texte de `at` au prochain `<` ; sans `<`, gardé depuis une esperluette qui attend son `;` au morceau suivant. */
  private textRun(buffer: string, at: number, lt: number, final: boolean): number {
    let stop = lt < 0 ? buffer.length : lt
    if (lt < 0 && !final) {
      const amp = buffer.lastIndexOf("&")
      if (amp >= at && buffer.length - amp <= ENTITY_MAX && buffer.indexOf(";", amp) < 0) stop = amp
    }
    this.emitText(buffer.slice(at, stop))
    return stop
  }

  /** La construction qui commence par `<` à `at` ; sa fin, ou `-1` si le morceau la coupe. */
  private markup(buffer: string, at: number, final: boolean): number {
    const second = buffer[at + 1]
    if (second === undefined) return -1
    if (second === "?") return this.skipTo(buffer, at, "?>")
    if (second === "!") return this.declaration(buffer, at, final)
    if (second === "/") {
      const end = buffer.indexOf(">", at + 2)
      if (end < 0) return -1
      this.handler.close?.(localName(buffer.slice(at + 2, end).trim()))
      return end + 1
    }
    const end = tagEnd(buffer, at)
    if (end < 0) return -1
    const empty = buffer[end - 2] === "/"
    const close = empty ? end - 2 : end - 1
    let nameEnd = at + 1
    while (nameEnd < close && !isSpace(buffer.charCodeAt(nameEnd))) nameEnd++
    this.handler.open?.(localName(buffer.slice(at + 1, nameEnd)), attributesOf(buffer, nameEnd, close), empty)
    if (empty) this.handler.close?.(localName(buffer.slice(at + 1, nameEnd)))
    return end
  }

  /** Un commentaire, une section CDATA (son texte, tel quel), ou une déclaration : refusée. */
  private declaration(buffer: string, at: number, final: boolean): number {
    const head = buffer.slice(at, at + CDATA.length)
    if (head.startsWith(COMMENT)) return this.skipTo(buffer, at, "-->")
    if (head === CDATA) {
      const end = buffer.indexOf("]]>", at + CDATA.length)
      if (end < 0) return -1
      const text = buffer.slice(at + CDATA.length, end)
      if (text !== "") this.handler.text?.(text)
      return end + 3
    }
    // Un début coupé par le morceau peut encore être un commentaire ou une section CDATA.
    if (!final && (COMMENT.startsWith(head) || CDATA.startsWith(head))) return -1
    throw dtdRefused()
  }

  private skipTo(buffer: string, at: number, close: string): number {
    const end = buffer.indexOf(close, at + 2)
    return end < 0 ? -1 : end + close.length
  }
}

/** Le décodeur d'une partie XML d'après ses premiers octets : UTF-16 sur sa marque d'ordre, UTF-8 sinon. */
function decoderFor(first: Uint8Array): TextDecoder {
  if (first[0] === 0xff && first[1] === 0xfe) return new TextDecoder("utf-16le")
  if (first[0] === 0xfe && first[1] === 0xff) return new TextDecoder("utf-16be")
  return new TextDecoder("utf-8")
}

/**
 * Lit une partie XML passée en octets, morceau par morceau (`feed` les donne à son `sink`, qui rend `false` quand le
 * tokeniseur est arrêté), avec `scanner`, que son handler arrête par `stop()` quand il a ce qu'il lui faut.
 */
export function scanXml(feed: (sink: (bytes: Uint8Array) => boolean) => void, scanner: XmlScanner): void {
  let decoder: TextDecoder | null = null
  feed((bytes) => {
    decoder ??= decoderFor(bytes)
    scanner.push(decoder.decode(bytes, { stream: true }))
    return !scanner.done
  })
  if (decoder !== null) scanner.push((decoder as TextDecoder).decode())
  scanner.end()
}
