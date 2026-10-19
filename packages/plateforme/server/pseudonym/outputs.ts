// Les champs déclarés d'une sortie (`pseudonymisation.md` § Les champs déclarés, J3) : une fonction de l'hôte nomme les
// champs de `data` qui portent le nom d'une entité déclarée (`output.entityFields`). Servis à l'assistant, ils
// deviennent le jeton de l'entité, quel que soit le nom : « Martin » seul, un prénom seul, que la porte laisserait en
// clair. Le texte que compose la fonction perd aussi ces valeurs. Une entité que le dictionnaire ne connaît pas (non
// déclarée, effacée) : la valeur est retenue. `callFunction`, du serveur de l'hôte, reste en clair.
import { isRecord } from "../../schemas/tables"
import { entityToken, type Dictionary } from "./dictionary"

/** Des enregistrements de `data` (`at`, un objet ou une liste d'objets ; défaut : `data`), l'identifiant et les champs. */
export type EntityFields = { kind: string; at?: string; id: string; fields: readonly string[] }

/** Ce qui remplace une valeur qu'aucun jeton ne peut porter : le marqueur de la retenue d'un champ (J2b). */
export const WITHHELD = "[withheld]"

const keysOf = (path: string): string[] => path.split(".")

/** Les objets au chemin `keys` de `value` ; une liste sur le chemin donne chacun de ses éléments. */
function recordsAt(value: unknown, keys: readonly string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => recordsAt(item, keys))
  if (!isRecord(value)) return []
  if (keys.length === 0) return [value]
  return recordsAt(value[keys[0]], keys.slice(1))
}

/** Le parent et la clé du chemin `keys` dans `record`, ou `null`. */
function slotOf(record: Record<string, unknown>, keys: readonly string[]): { parent: Record<string, unknown>; key: string } | null {
  let parent: unknown = record
  for (const key of keys.slice(0, -1)) parent = isRecord(parent) ? parent[key] : undefined
  return isRecord(parent) ? { parent, key: keys[keys.length - 1] } : null
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

/** `text`, chaque valeur remplacée par son jeton, en mots entiers, la plus longue d'abord. */
function substituted(text: string, replacements: ReadonlyMap<string, string>): string {
  let out = text
  for (const [value, replacement] of [...replacements].sort(([a], [b]) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped(value)}(?![\\p{L}\\p{N}])`, "gu"), replacement)
  }
  return out
}

/** Les champs déclarés d'un enregistrement, remplacés en place ; chaque valeur et son remplaçant vont à `replacements`. */
function replaceFields(dictionary: Dictionary, record: Record<string, unknown>, { kind, id, fields }: EntityFields, replacements: Map<string, string>): void {
  const idSlot = slotOf(record, keysOf(id))
  const entity = idSlot?.parent[idSlot.key]
  const found = typeof entity === "string" || typeof entity === "number" ? entityToken(dictionary, kind, String(entity)) : null
  for (const field of fields) {
    const slot = slotOf(record, keysOf(field))
    const value = slot?.parent[slot.key]
    if (!slot || typeof value !== "string" || value.trim() === "") continue
    const replacement = found ?? WITHHELD
    slot.parent[slot.key] = replacement
    replacements.set(value.trim(), replacement)
  }
}

/** La sortie d'une fonction, ses champs déclarés devenus le jeton de leur entité, dans `data` et dans le texte. */
export function withEntityTokens(
  dictionary: Dictionary,
  output: { text: string; data?: Record<string, unknown> },
  declarations: readonly EntityFields[],
): { text: string; data?: Record<string, unknown> } {
  if (output.data === undefined) return output
  const data = structuredClone(output.data)
  const replacements = new Map<string, string>()
  for (const declared of declarations) {
    for (const record of recordsAt(data, declared.at ? keysOf(declared.at) : [])) replaceFields(dictionary, record, declared, replacements)
  }
  return { text: substituted(output.text, replacements), data }
}
