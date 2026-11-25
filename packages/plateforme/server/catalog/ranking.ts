// Classement des fonctions du catalogue pour une demande (`routage-et-recherche.md` § Classement des fonctions), servi à
// `context` (les fonctions proposées) et à `find` : les composantes du classement des nœuds (`route_candidates`),
// calculées en mémoire sur les fonctions reçues, parce que le catalogue vit dans le code et pas en base (H80), puis le
// mélange et le bonus d'usage du routage (`blendScore`, `applyBonuses`), au seuil propre aux fonctions (`FUNCTION_THRESHOLD`). Le nom de la fonction joue le titre, la première
// phrase de sa description le résumé, sa description entière porte les mots. Sans lui, « mets à jour mon template
// Brevo » mettait huit fonctions Brevo à égalité, départagées par le nom, et la bonne arrivait troisième.
//
// Approches assumées face au SQL : les trigrammes de `pg_trgm` sont reproduits (mots bordés de deux espaces devant, une
// derrière), `word_similarity` approchée sur des suites de mots entiers (`wordSimilarity`) ; pas de racines françaises
// (`platform.fr`) : deux mots se valent s'ils sont égaux, si l'un commence l'autre (quatre lettres au moins) ou s'ils ont
// les mêmes cinq premières lettres, comme `wordsInCommon` ; le lexique est celui des mots du catalogue ; la rareté d'un
// mot se compte sur les fonctions reçues. Le libellé et la description du connecteur n'y entrent pas : mesurés, ils ne
// changeaient aucun verdict du jeu (`tests/unit/function-routing.cases.ts`) et doublaient le temps du calcul.
import { normalizeTitle } from "../../schemas"
import { applyBonuses, blendScore, requestKind, type Components, type RequestKind } from "../routing"
import type { CatalogFunction } from "./define"

/**
 * Le seuil d'une fonction proposée, plus haut que celui des nœuds (`SHOW_THRESHOLD`, 0,30) : parmi plus de 1 500 fonctions
 * en anglais, une demande française touche souvent un mot rare par hasard (« comment », « résume »). Les taux qu'il donne
 * sont ceux du test de mesure (`tests/unit/function-routing.test.ts`), rapportés dans `routage-et-recherche.md` § Écart avec
 * le code (décidé par JB le 25/11/2026). Le même sous une procédure servie.
 */
const FUNCTION_THRESHOLD = 0.4

/**
 * Une demande d'édition (`requestKind` « edit » : « modifie », « mets à jour ») monte d'autant les fonctions dont le nom
 * commence par un verbe de modification, une question de données les fonctions de lecture : l'écart de la procédure dans
 * `find` (`PROCEDURE_BONUS`). Sans lui, `brevo.get_template`, au nom plus court, passait devant
 * `brevo_act.update_template` pour « mets à jour mon template Brevo ». Exception provisoire au « aucun dictionnaire de
 * vocabulaire » du routage, jusqu'aux mots-clés français déclarés par les connecteurs (décidé par JB le 25/11/2026).
 */
const KIND_BONUS = 0.05
/** Les verbes anglais d'un nom de fonction qui modifie ce qui existe (`update_template`, `edit_page_markdown`). */
const EDIT_VERBS = new Set(["update", "edit", "modify", "change", "set", "patch", "rename", "replace", "upsert"])

/**
 * Les mots vides d'une demande que la liste `french` de Postgres retire de `platform.fr`, et leurs équivalents anglais :
 * sans eux, « mon », « les » ou « the » comptaient comme des mots de la demande.
 */
const STOP_WORDS = new Set(
  (
    "au aux avec ce ces cet cette dans de des du elle en et eux il ils je la le les leur leurs lui ma mais me mes moi mon " +
    "ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous " +
    "est sont a d l y the an of to for in on with and or my your from by is are this that it its be as at"
  ).split(" "),
)

/**
 * Un mot corrigé par le lexique : six lettres au moins (cinq pour `lexicon_fix`) : à cinq, un mot français juste est
 * souvent à une lettre d'un mot anglais (« heure », « here »).
 */
const FIXABLE = /^[a-z]{6,40}$/
/** Deux mots se valent s'ils ont ces premières lettres en commun (`wordsInCommon`), ou si l'un commence l'autre dès ce nombre. */
const SAME_STEM = 5
const PREFIX_MIN = 4
/** Une suite de mots comparée par `wordSimilarity` a au plus deux mots de plus que le texte cherché : au-delà, elle ne fait que baisser. */
const WINDOW_SLACK = 2
/** La phrase d'une description qui déclare ses formules françaises, séparées de virgules (`team.create`, `node.move`…). */
const FRENCH_FORMULAS = /In French: ([^.]*)\./
/** La demande lue au plus, comme `route_candidates`. */
const QUERY_MAX_CHARS = 500

/** Un texte pour les trigrammes : les siens, et ceux de chacun de ses mots, dans l'ordre. */
type Grams = { all: Set<string>; words: Set<string>[] }

type Prepared = {
  /** Le verbe du nom, son premier mot après le connecteur (`update` de `brevo_act.update_template`). */
  verb: string | undefined
  /** Les mots du nom (connecteur compris), sans casse ni accents. */
  titleWords: Set<string>
  /** Les mots du nom et de la description entière. */
  words: Set<string>
  title: Grams
  summary: Grams
  /** Les formulations de la première phrase, coupées comme celles d'un résumé (`route_candidates`). */
  pieces: Grams[]
}

/** Une fonction ne change pas une fois déclarée : ce qu'en lit le classement se calcule une fois. */
const preparedOf = new WeakMap<CatalogFunction, Prepared>()
/**
 * Le lexique d'un catalogue servi : les mots de ses fonctions, ce que `lexicon_fix` lit dans `platform.lexicon` pour une
 * organisation. Calculé sur les seules fonctions reçues par l'appel, gardé par la liste de leurs noms pour les appels
 * suivants sur le même catalogue (`LEXICON_CACHE_MAX` catalogues au plus, le plus ancien sorti d'abord) : une correction
 * ne dépend jamais d'un autre catalogue servi avant elle.
 */
const lexicons = new Map<string, ReadonlySet<string>>()
const LEXICON_CACHE_MAX = 16

function lexiconOf(functions: readonly { fn: CatalogFunction; prepared: Prepared }[]): ReadonlySet<string> {
  const key = functions.map(({ fn }) => fn.name).join("\n")
  const known = lexicons.get(key)
  if (known) return known
  const lexicon = new Set(functions.flatMap(({ prepared }) => [...prepared.words]))
  if (lexicons.size >= LEXICON_CACHE_MAX) lexicons.delete(lexicons.keys().next().value ?? "")
  lexicons.set(key, lexicon)
  return lexicon
}

/** La première phrase d'une description : ce que `find`, `context` et `read functions` servent d'une fonction. */
export function firstSentence(description: string): string {
  const end = description.search(/\.(?:\s|$)/)
  return `${(end === -1 ? description : description.slice(0, end)).trim()}.`
}

/** Sans casse ni accents, les mots (`platform.norm_words`). */
function normWords(text: string): string[] {
  return normalizeTitle(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "")
}

/** Les trigrammes de `pg_trgm` : chaque mot bordé de deux espaces devant et d'une derrière. */
function trigrams(words: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const word of words) {
    const padded = `  ${word} `
    for (let at = 0; at + 3 <= padded.length; at += 1) found.add(padded.slice(at, at + 3))
  }
  return found
}

function gramsOf(words: readonly string[]): Grams {
  return { all: trigrams(words), words: words.map((word) => trigrams([word])) }
}

function shared(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let count = 0
  for (const gram of small) if (large.has(gram)) count += 1
  return count
}

/** `similarity` : trigrammes communs sur l'union. */
function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const common = shared(a, b)
  const union = a.size + b.size - common
  return union === 0 ? 0 : common / union
}

/**
 * `word_similarity(a, b)`, approchée : la meilleure `similarity` entre `a` et une suite de mots entiers de `b`, de deux mots
 * de plus que `a` au plus, les trigrammes d'une suite comptés mot par mot (un trigramme que deux mots portent compte deux
 * fois).
 */
function wordSimilarity(a: Grams, b: Grams): number {
  const common = b.words.map((word) => shared(a.all, word))
  let best = 0
  for (let start = 0; start < b.words.length; start += 1) {
    let [found, size] = [0, 0]
    for (let end = start; end < Math.min(b.words.length, start + a.words.length + WINDOW_SLACK); end += 1) {
      found += common[end]
      size += b.words[end].size
      best = Math.max(best, found / (a.all.size + size - found))
    }
  }
  return best
}

function prepare(fn: CatalogFunction): Prepared {
  const known = preparedOf.get(fn)
  if (known) return known
  const [, bare = fn.name] = fn.name.split(".")
  const titleWords = normWords(`${fn.connector} ${bare}`)
  const summary = firstSentence(fn.description)
  const prepared: Prepared = {
    verb: titleWords[normWords(fn.connector).length],
    titleWords: new Set(titleWords),
    words: new Set(normWords(`${fn.connector} ${bare} ${fn.description}`)),
    title: gramsOf(titleWords),
    summary: gramsOf(normWords(summary)),
    // Les formules françaises que la description déclare (« In French: exporter les pages d'une équipe…, sauvegarder. »)
    // comptent comme des formulations du résumé : seules parmi les mots de la description, une demande qui les reprend
    // restait sous le seuil des fonctions (« exporte toutes les pages de l'équipe SAV », « déplacer renommer dossier »).
    pieces: [...summary.split(/[«»"“”.;:!?]/), ...(FRENCH_FORMULAS.exec(fn.description)?.[1] ?? "").split(",")]
      .map(normWords)
      // Une formulation a deux mots au moins : un mot isolé entre deux-points ou guillemets (« comment ») en serait une.
      .filter((piece) => piece.length >= 2)
      .map(gramsOf),
  }
  preparedOf.set(fn, prepared)
  return prepared
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= SAME_STEM && b.length >= SAME_STEM && a.slice(0, SAME_STEM) === b.slice(0, SAME_STEM)) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= PREFIX_MIN && long.startsWith(short)
}

/**
 * Une seule faute de frappe sépare `a` de `b` : une lettre de plus, de moins ou changée, ou deux lettres voisines
 * échangées (distance de Damerau-Levenshtein restreinte d'au plus 1).
 */
function oneTypo(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let at = 0
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1
  const [restA, restB] = [a.slice(at), b.slice(at)]
  return (
    restA.slice(1) === restB.slice(1) ||
    restA.slice(1) === restB ||
    restA === restB.slice(1) ||
    (restA.length >= 2 && restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2))
  )
}

/**
 * La correction d'un mot de la demande que le lexique ne porte pas (`lexicon_fix`) : le mot du lexique qu'une seule faute
 * de frappe en sépare, six lettres au moins, le premier par ordre alphabétique ; `null` sinon. Plus stricte que
 * `lexicon_fix` (trigrammes à 0,3) : la demande est en français et le catalogue en anglais, et une telle ressemblance
 * corrigeait des mots français justes vers des mots anglais sans rapport (« horaires » vers « hires »).
 */
function lexiconFix(word: string, lexicon: ReadonlySet<string>): string | null {
  if (!FIXABLE.test(word) || lexicon.has(word)) return null
  let best: string | null = null
  for (const candidate of lexicon) if (oneTypo(word, candidate) && (best === null || candidate < best)) best = candidate
  return best
}

/** Les mots du lexique que valent un mot de la demande et sa correction (`sameWord`). */
function matching(alts: readonly string[], lexicon: ReadonlySet<string>): Set<string> {
  return new Set([...lexicon].filter((word) => alts.some((alt) => sameWord(alt, word))))
}

const carries = (words: ReadonlySet<string>, matched: ReadonlySet<string>) => [...matched].some((word) => words.has(word))

type Query = { kind: RequestKind; grams: Grams[]; lexemes: { matched: Set<string>; weight: number }[] }

/**
 * La demande telle quelle et corrigée (trigrammes de l'une et de l'autre), son genre, et ses mots, chacun avec les mots
 * du lexique qu'il vaut, lui ou sa correction, et son poids de rareté sur les fonctions reçues : 1 + ln(n / df), 1 quand
 * aucune ne le porte (`route_candidates`).
 */
function readQuery(phrase: string, functions: readonly Prepared[], lexicon: ReadonlySet<string>): Query {
  const words = normWords(phrase.slice(0, QUERY_MAX_CHARS))
  const fixes = new Map(words.map((word) => [word, lexiconFix(word, lexicon)]))
  const fixed = words.map((word) => fixes.get(word) ?? word)
  const lexemes = [...new Set(words.filter((word) => !STOP_WORDS.has(word)))].map((word) => {
    const fix = fixes.get(word)
    const matched = matching(fix ? [word, fix] : [word], lexicon)
    const df = functions.filter((fn) => carries(fn.words, matched)).length
    return { matched, weight: df === 0 ? 1 : 1 + Math.log(functions.length / df) }
  })
  const grams = fixed.join(" ") === words.join(" ") ? [gramsOf(words)] : [gramsOf(words), gramsOf(fixed)]
  return { kind: requestKind(phrase), grams, lexemes }
}

/** Les composantes d'une fonction pour la demande, comme `route_candidates` les rend pour un nœud. */
function components(fn: Prepared, query: Query): Components {
  const best = (score: (grams: Grams) => number) => Math.max(0, ...query.grams.map(score))
  const total = query.lexemes.reduce((sum, lexeme) => sum + lexeme.weight, 0)
  const part = (words: ReadonlySet<string>) =>
    query.lexemes.filter((lexeme) => carries(words, lexeme.matched)).reduce((sum, lexeme) => sum + lexeme.weight, 0) / total
  return {
    // Le nom dans la demande, la demande dans le résumé, une formulation dans la demande (`route_candidates`).
    s_title: best((grams) => Math.max(similarity(fn.title.all, grams.all), wordSimilarity(fn.title, grams))),
    s_summary: best((grams) => Math.max(similarity(fn.summary.all, grams.all), wordSimilarity(grams, fn.summary))),
    s_phrase: best((grams) => Math.max(0, ...fn.pieces.map((piece) => Math.max(similarity(piece.all, grams.all), wordSimilarity(piece, grams))))),
    lexical: part(fn.words),
    lexical_title: part(fn.titleWords),
    query_lexemes: query.lexemes.length,
  }
}

/** Le bonus du genre de la demande (`KIND_BONUS`) : une édition vers un verbe de modification, une question vers une lecture. */
function kindBonus(fn: CatalogFunction, prepared: Prepared, kind: RequestKind): number {
  if (kind === "edit" && prepared.verb !== undefined && EDIT_VERBS.has(prepared.verb)) return KIND_BONUS
  if (kind === "data" && fn.class === "read") return KIND_BONUS
  return 0
}

/**
 * Les fonctions reçues qui répondent à la demande, `limit` au plus : score mêlé des composantes (`blendScore`), plus le
 * bonus d'usage (`USAGE_BONUS` du routage : son nom parmi `used`, les cibles récentes de la personne, `usedPaths`) et
 * celui du genre de la demande, plafonné à 1 ; seules celles qui atteignent `FUNCTION_THRESHOLD`, triées par score
 * décroissant, puis par nom servi à score égal.
 */
export function rankFunctions(
  functions: readonly CatalogFunction[],
  phrase: string,
  limit: number,
  used: ReadonlySet<string> = new Set(),
): { fn: CatalogFunction; score: number }[] {
  const prepared = functions.map((fn) => ({ fn, prepared: prepare(fn) }))
  const query = readQuery(phrase, prepared.map((entry) => entry.prepared), lexiconOf(prepared))
  if (query.lexemes.length === 0) return []
  return prepared
    .map(({ fn, prepared: one }) => {
      const blend = applyBonuses(blendScore(components(one, query)), { team: false, usage: used.has(fn.name) })
      return { fn, score: Math.min(1, blend + kindBonus(fn, one, query.kind)) }
    })
    .filter((result) => result.score >= FUNCTION_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.fn.name.localeCompare(b.fn.name))
    .slice(0, limit)
}
