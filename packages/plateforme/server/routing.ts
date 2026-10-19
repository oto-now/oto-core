// Routage des intentions (ADR-003, H40 amendé par P37) : `route_candidates` (E01-S06) rend les
// composantes lexicales du titre et du résumé des procédures publiées ; ici, le service ne garde que
// celles que la personne lit (`nodeLevels`, H123, N22), les mélange en un score entre 0 et 1, ajoute les
// bonus d'équipe et d'usage, et décide au réglage de l'organisation : étapes servies seulement quand le
// premier candidat est net. Sans ce module, `context` ne reconnaît aucune procédure.
//
// Repris de la maquette (`mcp-test/src/proto/services/routing.ts` l. 20-95) : constantes, mélange,
// décision, tri, bonus lu dans le journal. Retiré : `canRead` (→ `nodeLevels` d'`access.ts`, H66), la
// lecture par clé de service, les seuils en constantes seules (→ réglage par organisation), la
// pénalité de voisine et `s_trigger` (→ `s_summary`, P37), le genre en paramètre (→ procédure, N18).
import * as z from "zod/v4"
import { normalizeTitle } from "../schemas"
import { ACCESS_LEVELS, nodeLevels } from "./access"
import type { PlatformDb } from "./db"
import { fromDatabaseError, inTransaction, PlatformError, READ_PAGE_ROWS } from "./errors"
import type { Identity } from "./identity"

/**
 * Parts du résumé (ou du titre), de la meilleure formulation du résumé et des lexèmes (E11-S04, AC-b1),
 * calibrées sur les jeux Acme, du pilote et « todo » (`tests/integration/routing.test.ts`). Les seuils de
 * `pg_trgm` de `route_candidates` en dépendent (E01-S13 AC-a4) : les changer, c'est changer la migration.
 */
export const WEIGHTS = { text: 0.25, phrase: 0.3, lexical: 0.45 } as const
/** Dans la part des lexèmes : ceux du titre et du résumé, puis ceux du titre seul (AC-a4). */
const LEXICAL_PARTS = { all: 0.75, title: 0.25 } as const
/** Sous ce nombre de lexèmes, la part lexicale est atténuée : « relance » seul trouvait tous les siens. */
const SHORT_QUERY_LEXEMES = 2
/** Procédure d'une équipe de la personne. */
export const TEAM_BONUS = 0.03
/** Chemin ciblé par la personne dans les `ROUTING_USAGE_DAYS` derniers jours. */
export const USAGE_BONUS = 0.03
const DEFAULT_THRESHOLD = 0.65
const DEFAULT_GAP = 0.1
/** Sous ce score, un candidat n'est pas montré. */
export const SHOW_THRESHOLD = 0.3
/**
 * Lignes demandées à `route_candidates`, déjà lisibles par la personne depuis E01-S13 (AC-a2) : le
 * filtre de niveau du service les redécide (N22).
 */
const PREFILTER = 50
/** Le genre de nœud que le routage sert (N18) : `p_kind` de `route_candidates`. */
const ROUTED_KIND = "procedure"
const ROUTING_USAGE_DAYS = 30
/**
 * Candidats montrés par `context`, par titre et résumé, entre lesquels l'assistant choisit (E11-S16) : sur
 * 25 paraphrases jouées en direct parmi 60 procédures, la bonne était en tête pour 21 et dans les trois
 * premiers pour 24 (story E11-S16, § Contexte) ; sur le jeu à l'échelle (`tests/integration/routing.test.ts`),
 * cinq montrés, aucune au rang 4 ou 5.
 */
export const CANDIDATES_SHOWN = 3
const DAY_MS = 86_400_000

/** Composantes rendues par `route_candidates` pour un nœud. */
export type Components = {
  s_summary: number
  s_title: number
  /** La meilleure formulation du résumé, comparée à la demande (E11-S04, AC-a2). */
  s_phrase: number
  lexical: number
  /** La part des lexèmes de la demande que porte le titre seul (AC-a4). */
  lexical_title: number
  query_lexemes: number
}

export type Candidate = {
  nodeId: string
  path: string
  title: string
  summary: string
  kind: string
  /** Équipe propriétaire effective (`node_owner`) ; nulle pour un nœud d'organisation. */
  ownerTeamId: string | null
  score: number
}

export type RoutingSettings = { threshold: number; gap: number }

/** Une ligne de `route_candidates` (E01-S06, « Contrat » § 4). */
type RouteRow = Components & {
  node_id: string
  path: string
  title: string
  summary: string
  kind: string
  owner_team_id: string | null
}

/**
 * Mélange : le résumé ou le titre, la meilleure formulation du résumé, puis les lexèmes partagés (titre
 * et résumé, et titre seul), atténués sous deux lexèmes ; dans [0, 1].
 */
export function blendScore(components: Components): number {
  const damping = Math.min(1, components.query_lexemes / SHORT_QUERY_LEXEMES)
  const lexical = (LEXICAL_PARTS.all * components.lexical + LEXICAL_PARTS.title * components.lexical_title) * damping
  const score =
    WEIGHTS.text * Math.max(components.s_summary, components.s_title) + WEIGHTS.phrase * components.s_phrase + WEIGHTS.lexical * lexical
  return Math.max(0, Math.min(1, score))
}

/** Score final : le mélange et les bonus mérités, plafonné à 1. */
export function applyBonuses(blend: number, bonus: { team: boolean; usage: boolean }): number {
  return Math.min(1, blend + (bonus.team ? TEAM_BONUS : 0) + (bonus.usage ? USAGE_BONUS : 0))
}

/**
 * Le candidat dont les étapes sont servies : le premier, s'il atteint le seuil et, quand il y a un
 * deuxième, si l'écart n'est pas inférieur à l'écart réglé (comparaison sur les flottants, comme la
 * maquette) ; sinon `null`. `candidates` est trié par score décroissant.
 */
export function decide(candidates: readonly Candidate[], settings: RoutingSettings): Candidate | null {
  const [first, second] = candidates
  if (!first || first.score < settings.threshold) return null
  if (second && first.score - second.score < settings.gap) return null
  return first
}

/** Réglage de `orgs.settings.routing` (H40) ; lu comme une entrée (`security-patterns.md § Validation`). */
const routingSettingsSchema = z.object({ threshold: z.number().min(0).max(1), gap: z.number().min(0).max(1) }).partial()

const settingsSchema = z.object({ routing: z.record(z.string(), z.unknown()) })

/** Une clé du réglage : sa valeur si le schéma l'admet, sinon son défaut (N3). */
function settingOf<Fallback extends number | null>(schema: z.ZodType<number | undefined>, value: unknown, fallback: Fallback): number | Fallback {
  const parsed = schema.safeParse(value)
  return parsed.success && parsed.data !== undefined ? parsed.data : fallback
}

/**
 * Seuil et écart lus clé par clé dans `orgs.settings.routing` : une clé absente, hors de [0, 1] ou non
 * numérique prend la valeur de `defaults`, l'autre clé gardant la sienne ; `null` la lit telle que
 * posée (E08-S03).
 */
function readRouting<Fallback extends number | null>(settings: unknown, defaults: { threshold: Fallback; gap: Fallback }) {
  const parsed = settingsSchema.safeParse(settings)
  const routing = parsed.success ? parsed.data.routing : {}
  return {
    threshold: settingOf(routingSettingsSchema.shape.threshold, routing.threshold, defaults.threshold),
    gap: settingOf(routingSettingsSchema.shape.gap, routing.gap, defaults.gap),
  }
}

/**
 * Seuil et écart d'une organisation, lus clé par clé dans `orgs.settings.routing` : une clé absente,
 * hors de [0, 1] ou non numérique reprend son défaut (0,65 ; 0,1), l'autre clé gardant la sienne.
 */
export function routingSettings(settings: unknown): RoutingSettings {
  return readRouting(settings, { threshold: DEFAULT_THRESHOLD, gap: DEFAULT_GAP })
}

/** `orgs.settings` de l'organisation `orgId`, filtrée par son `id` ; `undefined` sans ligne. */
async function storedSettings(db: PlatformDb, orgId: string): Promise<{ settings: unknown } | undefined> {
  const [row] = await db.tx((sql) => sql<{ settings: unknown }[]>`select o.settings from platform.orgs o where o.id = ${orgId}`)
  return row
}

/**
 * Le réglage de l'organisation tel qu'il est posé, pour l'écran « Organisation » (E08-S03, AC3) : une
 * clé absente ou hors de [0, 1] vaut `null`, que `routingSettings` remplace par son défaut. Une panne
 * lève : l'écran la dit, au lieu de montrer les défauts comme un réglage. Sans ligne : `not_found`,
 * compté ici (HN-E01S10-5).
 */
export async function loadStoredRouting(db: PlatformDb, orgId: string): Promise<{ threshold: number | null; gap: number | null }> {
  const row = await inTransaction(db, "loadStoredRouting: orgs", () => storedSettings(db, orgId))
  if (!row) throw new PlatformError("not_found", "Not found.")
  return readRouting(row.settings, { threshold: null, gap: null })
}

/**
 * Le réglage de l'organisation de l'identité (`orgs.settings`, filtré par son `id`). En panne, les
 * défauts : le réglage ne fait que déplacer le seuil, sa lecture ne refuse pas `context` (N17). La
 * panne n'est dite qu'au log (`fromDatabaseError`, dont le refus n'est pas servi) ; ce qui ne vient pas
 * de la base, lui, remonte (HN-E01S10-15).
 */
export async function loadRoutingSettings(db: PlatformDb, orgId: string): Promise<RoutingSettings> {
  return storedSettings(db, orgId).then(
    (row) => routingSettings(row?.settings),
    (error) => {
      fromDatabaseError(error, "routing: orgs.settings read failed")
      return routingSettings(null)
    },
  )
}

/**
 * Le genre d'une demande (E11-S04, AC-b2) : `how` demande comment faire, `request` demande poliment une
 * action, `data` pose une question de données, `action` demande d'agir ; `edit` (E11-S19, AC-d3) demande de
 * modifier un contenu.
 */
export type RequestKind = "how" | "request" | "data" | "action" | "edit"

// Un mot ou une formule suivis d'une frontière de mot (H37, N1).
const BOUNDARY = String.raw`(?:$|[\s,?!.])`
const HOW = new RegExp(`^comment${BOUNDARY}`)
// HN-E11S04-12 : les formules de demande, liste fermée écrite ici, comme les interrogatifs.
const REQUEST_FORMULAS = [
  "peux-tu",
  "pouvez-vous",
  "pourrais-tu",
  "pourriez-vous",
  "tu peux",
  "vous pouvez",
  "tu pourrais",
  "vous pourriez",
  "est-ce que tu peux",
  "est-ce que vous pouvez",
  "est-ce que tu pourrais",
  "est-ce que vous pourriez",
  "tu veux bien",
  "vous voulez bien",
]
const REQUEST = new RegExp(`^(?:${REQUEST_FORMULAS.join("|")})${BOUNDARY}`)
// HN-E11S19-6 : les verbes d'une demande de modifier un texte, liste fermée, à l'impératif en tête ou à l'infinitif
// après une formule de demande. Ni « ajoute » (une création, souvent une procédure), ni « supprime », « retire »,
// « efface » : une suppression passe par `node.trash`, `table.delete_rows` ou l'en-tête d'un tableau, pas par find → write.
const EDIT_VERBS = [
  "modifie",
  "modifier",
  "corrige",
  "corriger",
  "change",
  "changer",
  "remplace",
  "remplacer",
  "mets à jour",
  "mettre à jour",
  "réécris",
  "réécrire",
  "reformule",
  "reformuler",
  "renomme",
  "renommer",
]
const EDIT = new RegExp(`^(?:(?:${REQUEST_FORMULAS.join("|")}) )?(?:${EDIT_VERBS.join("|")})${BOUNDARY}`)
// HN-E11S19-7 (H37 amendée) : une question dont la personne est le sujet et un tiers l'objet (« Qu'est-ce que je lui
// réponds ? ») demande quoi faire, pas une donnée ; « Qu'est-ce que j'ai à faire ? » reste une question de données.
const ACTION_QUESTION = new RegExp(`^(?:qu'est-ce que |qu'est-ce qu'|que )(?:je|on|nous|dois-je|puis-je|faut-il) (?:lui|leur)${BOUNDARY}`)
// H37, N1 : un interrogatif suivi d'une frontière de mot ; « est-ce qu' » sans condition. « comment »
// est une demande `how` (AC-b2).
const INTERROGATIVE = new RegExp(
  `^(?:(?:combien|lesquels|lesquelles|lequel|laquelle|qui|quel|quelle|quels|quelles|où|quand|pourquoi|est-ce que|y a-t-il)${BOUNDARY}|est-ce qu')`,
)

/**
 * Après `trim`, sans casse et l'apostrophe typographique ramenée à `'` : `how` quand la phrase commence
 * par « comment », `edit` par un verbe d'édition (après une formule de demande au besoin), `request` par une
 * formule de demande, `action` pour une question sur quoi faire à un tiers, `data` quand elle finit par « ? »
 * ou commence par un interrogatif (H37, N1), `action` sinon. Sans candidate, `data` et `edit` ont leur
 * consigne (`server/context/blocks/code.ts`).
 */
export function requestKind(phrase: string): RequestKind {
  const text = phrase.trim().toLowerCase().replace(/’/g, "'")
  if (HOW.test(text)) return "how"
  if (EDIT.test(text)) return "edit"
  if (REQUEST.test(text)) return "request"
  if (ACTION_QUESTION.test(text)) return "action"
  return text.endsWith("?") || INTERROGATIVE.test(text) ? "data" : "action"
}

/** Longueur d'un mot compté par `wordsInCommon` ; en dessous, surtout des mots vides (« les », « une »). */
const COMMON_WORD_MIN = 4
/** Deux mots de même racine approchée : mêmes cinq premières lettres (« relance », « relancer »). */
const COMMON_STEM = 5

/** Les mots d'un texte, en minuscules, avec leur forme sans casse ni accents. */
function wordsOf(text: string): { word: string; bare: string }[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= COMMON_WORD_MIN)
    .map((word) => ({ word, bare: normalizeTitle(word) }))
}

function sameWord(a: string, b: string): boolean {
  return a === b || (a.length >= COMMON_STEM && b.length >= COMMON_STEM && a.slice(0, COMMON_STEM) === b.slice(0, COMMON_STEM))
}

/**
 * Les mots de la demande trouvés dans le titre ou le résumé d'une candidate (E11-S19, AC-d2, HN-E11S19-5), une fois
 * chacun, dans l'ordre de la demande : quatre lettres au moins, comparés sans casse ni accents, égaux ou de mêmes cinq
 * premières lettres. Une approche des lexèmes du score, pour qu'un auteur sache quels mots ajouter au résumé.
 */
export function wordsInCommon(phrase: string, candidate: Pick<Candidate, "title" | "summary">): string[] {
  const found = wordsOf(`${candidate.title} ${candidate.summary}`).map((entry) => entry.bare)
  const seen = new Set<string>()
  return wordsOf(phrase).flatMap(({ word, bare }) => {
    if (seen.has(bare) || !found.some((other) => sameWord(bare, other))) return []
    seen.add(bare)
    return [word]
  })
}

/** Une question de données (H37, N1) : elle appelle « cherche et réponds » (`structuredContent.data_question`). */
export function isDataQuestion(phrase: string): boolean {
  return requestKind(phrase) === "data"
}

export function formatScore(score: number): string {
  return score.toFixed(2)
}

/** Un score en données (H26) : à deux décimales, comme le texte l'écrit (`formatScore`). */
export function roundScore(score: number): number {
  return Number(formatScore(score))
}

/**
 * Les composantes des nœuds publiés de l'organisation du genre `kind` (`null` : tous), 50 lignes, sous la session
 * de la personne. Arguments nommés : la fonction les reçoit par leur nom, comme par PostgREST.
 */
async function routeRows(db: PlatformDb, identity: Identity, query: string, kind: string | null): Promise<RouteRow[]> {
  return inTransaction(db, "rankCandidates: route_candidates", (sql) => sql<RouteRow[]>`
    select r.node_id, r.path, r.title, r.summary, r.kind, r.owner_team_id, r.s_summary, r.s_title, r.s_phrase, r.lexical, r.lexical_title, r.query_lexemes
      from platform.route_candidates(p_org => ${identity.org.id}, p_query => ${query}, p_kind => ${kind}, p_limit => ${PREFILTER}) r`)
}

/**
 * Les chemins ciblés par la personne dans l'organisation depuis 30 jours (N5), filtrés dans la
 * requête, sur ses `READ_PAGE_ROWS` lignes les plus récentes : une lecture bornée, pour un bonus qui ne
 * fait que départager (N32). En panne, aucun : sa lecture ne refuse pas `context` ; la panne n'est dite
 * qu'au log (`fromDatabaseError`), ce qui ne vient pas de la base remonte (HN-E01S10-15).
 */
async function usedPaths(db: PlatformDb, identity: Identity): Promise<Set<string>> {
  const since = new Date(Date.now() - ROUTING_USAGE_DAYS * DAY_MS)
  return db
    .tx((sql) => sql<{ target: string }[]>`
      select j.target from platform.journal j
       where j.org_id = ${identity.org.id} and j.user_id = ${identity.user.id} and j.ts >= ${since} and j.target is not null
       order by j.ts desc
       limit ${READ_PAGE_ROWS}`)
    .then(
      (rows) => new Set(rows.map((row) => row.target)),
      (error) => {
        fromDatabaseError(error, "routing: journal read failed")
        return new Set<string>()
      },
    )
}

/**
 * Les procédures candidates pour `query` (ou les nœuds des genres `kinds`, par le même classement : les contenus proches
 * de `context`), que la personne lit, triées par score décroissant puis par chemin, de score ≥ 0,30, `limit` au plus. Le niveau des nœuds rendus est calculé en un lot et un
 * nœud de niveau 0 est retiré avant tout mélange, bonus ou coupe (H123, N22) : `route_candidates` ne
 * rend déjà que les procédures publiées que la demande présélectionne et que la personne lit (E01-S13,
 * AC-a2), et le service garde sa propre décision (`security-patterns.md § Droits dans le service`).
 */
export async function rankCandidates(
  db: PlatformDb,
  identity: Identity,
  request: { query: string; limit: number; kinds?: readonly string[] },
): Promise<Candidate[]> {
  const kinds = request.kinds ?? [ROUTED_KIND]
  const [all, used] = await Promise.all([routeRows(db, identity, request.query, kinds.length === 1 ? kinds[0] : null), usedPaths(db, identity)])
  const rows = all.filter((row) => kinds.includes(row.kind))
  const levels = await nodeLevels(db, identity, rows.map((row) => row.node_id))
  const teams = new Set(identity.teams.map((team) => team.id))
  return rows
    .filter((row) => (levels.get(row.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
    .map((row) => ({
      nodeId: row.node_id,
      path: row.path,
      title: row.title,
      summary: row.summary,
      kind: row.kind,
      ownerTeamId: row.owner_team_id,
      score: applyBonuses(blendScore(row), {
        team: row.owner_team_id !== null && teams.has(row.owner_team_id),
        usage: used.has(row.path),
      }),
    }))
    .filter((candidate) => candidate.score >= SHOW_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, request.limit)
}
