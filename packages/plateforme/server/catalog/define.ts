// Forme commune d'une fonction du catalogue derrière `call` (H80, H81). Fichier à part du registre :
// les sources de fonctions (`table.*` E07-S01, `mail` simulé E04-S01, ERP E08-S05) en ont besoin, et
// le registre les importe ; sans lui, l'import serait circulaire.
//
// Repris de la maquette (`mcp-test/src/proto/functions/define.ts` l. 8-45) : classe, contrat,
// exemples, refus, `strictObject`. Ajouté : l'origine (H80) et la suite proposée (`next`, H87).
import type * as z from "zod/v4"
import type { ViewKind } from "../../schemas/views"
import type { AccountCredential } from "../connectors/auth"
import type { ResolvedAccount } from "../connectors/resolution"
import type { PlatformDb } from "../db"
import type { Identity } from "../identity"
import type { JsonSchemaArguments } from "./arguments"

/** read : lecture ; write : écriture ; sensitive : envoie, supprime ou paie → deux temps (H86). */
export type FunctionClass = "read" | "write" | "sensitive"

/**
 * paquet : native ; erp : inscrite par l'hôte ; connecteur : fonction d'un connecteur, qui s'active par organisation
 * et court sur un compte résolu (H81, H83).
 */
export type FunctionOrigin = "paquet" | "erp" | "connecteur"

export type FunctionContext = {
  db: PlatformDb
  identity: Identity
  /** Jeton vérifié de l'appelant (E08-S05, NH4), posé pour une fonction de l'ERP seule (NH19) : elle construit sur lui son client de l'ERP. */
  accessToken?: string
  /** Compte résolu (H83) d'une fonction de connecteur ; absent pour une fonction native ou ERP (E04-S01). */
  account?: ResolvedAccount
  /**
   * Le compte résolu ouvert : ses champs déchiffrés, ses réglages et son jeton, par `runCall` pour un compte réel d'un
   * connecteur réel, et pour `run` seul (jamais `summarize`) : le connecteur les pose dans sa requête au tiers, jamais
   * dans un texte, un log ou une erreur.
   */
  credential?: AccountCredential
  /** Code `ctx` de l'appel (E03-S04, N9) : la provenance d'une écriture faite par un assistant (ADR-011 § 2). */
  ctx?: string | null
  /** Client MCP de la conversation (`ctx.host`, `nom@version`), rangé dans la provenance d'une écriture (E11-S01, AC-d2) ; absent sans lui. */
  host?: string | null
  /** Origine de l'adresse appelée (`https://acme.oto.cx`) : lien d'un écran cité par un refus (E07-S02, AC17). */
  origin?: string
}

/** Récapitulatif d'une fonction sensible, montré avant l'accord : texte et données en champs (H26). */
export type FunctionSummary = { text: string; data?: Record<string, unknown> }

export type FunctionOutput = {
  text: string
  data?: Record<string, unknown>
  /** Fonctions proposées ensuite ; les sensibles en sont retirées à la mise en forme (H87). */
  next?: string[]
  teamId?: string | null
  /**
   * Ce que l'exécution a fait, en nombres, pour la ligne de journal de l'appel (`args._outcome`) : le fil de
   * l'accueil le relit (E11-S02, AC-h2, HN-E11S02-16) ; `table.delete_rows` seule le pose.
   */
  outcome?: Record<string, number>
  /** La vue du widget qui rend `data` (`table`, `record`) ; `runCall` la recopie au résultat de `call`. */
  view?: ViewKind
}

/** Un schéma d'arguments strict : une clé inconnue (« filters » pour « filter ») est refusée. */
export type StrictSchema = z.ZodObject<z.core.$ZodShape, z.core.$strict>

/**
 * Contrôle propre à la fonction (E03-S06, R13), rejoué à la publication d'une procédure sur les
 * arguments d'un bloc `call` que son schéma accepte hors espaces réservés : `args` tels qu'écrits, un
 * espace réservé compris ; `isPlaceholder(chemin)` dit si la valeur à ce chemin en est un (règle 4,
 * `isPlaceholderValue`), jamais contrôlée. Rend les problèmes, en anglais et sans emplacement ; `[]`
 * sans problème. Contexte : la base et l'identité de qui publie, ou d'un simple lecteur de la procédure
 * (contrôle de l'écran, `checkProcedure`, dès le niveau 1) : `checkArgs` décide lui-même, par
 * `access.ts`, de ce qu'il lit et de ce que ses problèmes en montrent (`security-patterns.md § Droits
 * dans le service`).
 */
type CheckArgs = (
  context: Pick<FunctionContext, "db" | "identity">,
  args: Readonly<Record<string, unknown>>,
  isPlaceholder: (path: readonly PropertyKey[]) => boolean,
) => Promise<string[]>

export type CatalogFunction = {
  name: string
  connector: string
  class: FunctionClass
  origin: FunctionOrigin
  /** Anglais, première phrase = ce qu'elle fait. */
  description: string
  /** Zod strict (native, ERP) ou JSON Schema d'un connecteur décrit, validé et servi tel quel (`arguments.ts`). */
  schema: StrictSchema | JsonSchemaArguments
  examples: Record<string, unknown>[]
  refusals: string[]
  next?: string[]
  /** Une fonction de l'ERP : le nom de la vue de l'hôte qui rend `data` (`erp:<nom>`, story widgets-dans-la-conversation). */
  view?: string
  /**
   * Réservée au serveur de l'hôte (`pseudonymisation.md` § Les quatre primitives) : `callFunction` la court, l'assistant
   * ne la voit jamais (`assistantFunctions`) ; par le MCP, elle est inconnue.
   */
  serverOnly?: boolean
  /**
   * Une fonction de l'ERP : ses arguments d'entité (chemin pointé → sorte déclarée, `pseudonymisation.md` § Les jetons dans
   * les arguments) ; le jeton reçu de l'assistant y devient l'identifiant de l'entité.
   */
  entityArguments?: Readonly<Record<string, string>>
  run: (context: FunctionContext, args: never) => Promise<FunctionOutput>
  /** Fonctions sensibles : récapitulatif nominatif montré avant l'accord, sans rien exécuter. */
  summarize?: (context: FunctionContext, args: never) => Promise<FunctionSummary>
  checkArgs?: CheckArgs
}

/** Une fonction au schéma Zod (native, ERP), telle que la rend `defineFunction`. */
export type ZodCatalogFunction = CatalogFunction & { schema: StrictSchema }

/** Fonction typée par son schéma, effacée au type commun du catalogue. */
export function defineFunction<S extends StrictSchema>(fn: {
  name: string
  connector: string
  class: FunctionClass
  origin: FunctionOrigin
  description: string
  schema: S
  examples: z.input<S>[]
  refusals: string[]
  next?: string[]
  view?: string
  serverOnly?: boolean
  entityArguments?: Readonly<Record<string, string>>
  run: (context: FunctionContext, args: z.output<S>) => Promise<FunctionOutput>
  summarize?: (context: FunctionContext, args: z.output<S>) => Promise<FunctionSummary>
  checkArgs?: CheckArgs
}): ZodCatalogFunction {
  // `run` et `summarize` reçoivent des arguments déjà validés par `schema` : leur type précis
  // s'efface ici au type commun du catalogue (`never`, jamais appelé sans validation).
  return fn as unknown as ZodCatalogFunction
}
