// Drapeaux par organisation (E08-S04, ADR-006 § 7, H107) : un changement de comportement servi à
// un client passe derrière un drapeau, lu dans `orgs.flags` `{nom: true|false}`. Sans ce module, ni
// lecture sûre (valeur inconnue ou mal formée = `false`, sans erreur), ni écriture gardée (nom
// déclaré, droits, concurrence) pour l'écran d'E08-S03 et le code qui gatera une fonctionnalité.
//
// Repris d'Oto (`oto_mcp/datastore/definition.py`, rapport `tableaux.md` § 1) : un nom inconnu se
// refuse. Retiré : le simple signalement d'un attribut inconnu, qui laisse passer une coquille.
import { FEEDBACK_VISIBLE, flagToggleSchema, type FlagView } from "../schemas"
import { describeOwner, isOrgAdmin } from "./access"
import type { Json } from "./database"
import type { PlatformDb } from "./db"
import { inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { isJsonObject } from "./json"

/** Un drapeau déclaré : son nom (`flagNameSchema`) et ce qu'il change, en une phrase. */
type FlagDeclaration = { name: string; description: string }

/**
 * Registre des drapeaux : déclarer ici chaque drapeau lu par du code (`isEnabled`). `setFlag`
 * refuse un nom absent d'ici, `listFlags` ne rend que ceux-ci (NH1).
 */
export const FLAGS: readonly FlagDeclaration[] = [
  // Lu par `handlesFeedback` : les administrateurs de l'organisation entrent dans les retours.
  { name: FEEDBACK_VISIBLE, description: "Les administrateurs de l'organisation lisent et traitent les retours des assistants (menu « Retours »)." },
]

const INVALID_CHANGE = "Invalid flag change: send a snake_case name and enabled true or false, and no other field."

/**
 * Vrai seulement pour la valeur stockée `true` : un drapeau absent, toute autre valeur (`"true"`,
 * `1`) et des drapeaux mal formés (nul, tableau, chaîne) valent `false`, sans erreur (NH2).
 */
export function isEnabled(org: { flags: unknown }, name: string): boolean {
  return isJsonObject(org.flags) && Object.hasOwn(org.flags, name) && org.flags[name] === true
}

/** Les drapeaux avec `name` posé à `enabled`, les autres clés gardées telles quelles ; mal formés, ils repartent de `{}`. */
export function withFlag(flags: Json, name: string, enabled: boolean): { [key: string]: Json | undefined } {
  return { ...(isJsonObject(flags) ? flags : {}), [name]: enabled }
}

/** L'état d'un drapeau dans l'organisation de l'identité, en une lecture ; une organisation illisible vaut `false`. */
export async function readFlag(db: PlatformDb, identity: Identity, name: string): Promise<boolean> {
  const [org] = await inTransaction(db, "readFlag: orgs", (sql) => sql<{ flags: Json }[]>`select o.flags from platform.orgs o where o.id = ${identity.org.id}`)
  return org ? isEnabled(org, name) : false
}

/**
 * Les drapeaux déclarés, dans l'ordre du registre, avec leur état dans l'organisation de
 * l'identité. Une clé de `orgs.flags` absente du registre n'est pas listée (NH1). `registry` sert
 * les tests.
 */
export async function listFlags(
  db: PlatformDb,
  identity: Identity,
  registry: readonly FlagDeclaration[] = FLAGS,
): Promise<FlagView[]> {
  const [org] = await inTransaction(db, "listFlags: orgs", (sql) => sql<{ flags: Json }[]>`select o.flags from platform.orgs o where o.id = ${identity.org.id}`)
  // Aucune ligne : l'organisation de l'identité n'est plus lisible, compté ici (HN-E01S10-5).
  if (!org) throw new PlatformError("not_found", "Not found.")
  return registry.map((flag) => ({ name: flag.name, description: flag.description, enabled: isEnabled(org, flag.name) }))
}

/**
 * Pose un drapeau déclaré pour l'organisation de l'identité : entrée validée, nom déclaré, droit
 * de l'administrateur, puis écriture sous garde de la version lue (`updated_at`, NH3) ; les autres
 * clés restent telles quelles. Rend le drapeau écrit et la cible du journal de la porte (H07).
 */
export async function setFlag(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
  registry: readonly FlagDeclaration[] = FLAGS,
): Promise<{ data: FlagView; target: string }> {
  const parsed = flagToggleSchema.safeParse(input)
  if (!parsed.success) throw new PlatformError("invalid_arguments", INVALID_CHANGE)
  const { name, enabled } = parsed.data
  const declared = registry.find((flag) => flag.name === name)
  if (!declared) {
    const names = registry.map((flag) => flag.name).join(", ") || "none"
    throw new PlatformError("invalid_arguments", `Unknown flag ${name}. Declared flags: ${names}.`)
  }
  // Administrateur, ou équipe plateforme avec un accès en cours, membre simple compris (`isOrgAdmin`,
  // fiche D17 ; remplace NH9 d'E08-S04) : décidé ici, avant toute lecture d'`orgs`.
  if (!isOrgAdmin(identity)) {
    const who = await describeOwner(db, identity, { kind: "org", teamId: null, userId: null })
    throw new PlatformError("forbidden", `Changing the flags of ${identity.org.name} is reserved to ${who}. Ask them.`)
  }

  // La lecture et l'écriture gardée, dans une transaction. `updated_at` relu en texte et comparé converti
  // dans la requête : une `Date` en perdrait les microsecondes, et la garde ne trouverait jamais la ligne.
  const written = await inTransaction(db, "setFlag: orgs", async (sql) => {
    const [current] = await sql<{ flags: Json; updated_at: string }[]>`
      select o.flags, o.updated_at::text as updated_at from platform.orgs o where o.id = ${identity.org.id}`
    if (!current) throw new PlatformError("not_found", "Not found.")
    const [row] = await sql<{ flags: Json }[]>`
      update platform.orgs set flags = ${sql.json(withFlag(current.flags, name, enabled))}
       where id = ${identity.org.id} and updated_at = ${current.updated_at}::text::timestamptz
      returning flags`
    return row
  })
  // Aucune ligne : `orgs` a été écrite depuis la lecture (un drapeau, la marque, un réglage). Un
  // conflit à remonter, jamais un succès dont la valeur aurait disparu.
  if (!written) {
    console.error(`[platform] setFlag: no row written for organisation ${identity.org.id}`)
    throw new PlatformError("conflict", `The flags of ${identity.org.name} changed meanwhile. Reload them and retry.`)
  }
  return {
    data: { name, description: declared.description, enabled: isEnabled(written, name) },
    target: `flags/${name}`,
  }
}
