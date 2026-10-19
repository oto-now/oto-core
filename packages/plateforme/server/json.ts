// Garde « objet JSON » de `server/` (M10, doublon relevé par E08-S04) : une colonne `jsonb`
// (`orgs.brand`, `orgs.flags`, `members.profile`, `sim_outbox.payload`) peut porter `null`, un
// tableau, une chaîne ou un nombre ; ses champs ne se lisent qu'après cette garde. Sans ce module,
// chaque lecteur d'une telle colonne recopiait la même garde. Aussi les feuilles d'une valeur, que le journal compare
// pour retirer une donnée personnelle (`jsonLeaves`).

/** Vrai pour un objet JSON, jamais pour `null` ni pour un tableau : ses champs se lisent alors par clé. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Chaque chaîne non vide et chaque nombre fini (en texte) d'une valeur, à toute profondeur, clés exclues. */
export function jsonLeaves(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value !== "") into.add(value)
  } else if (typeof value === "number" && Number.isFinite(value)) into.add(String(value))
  else if (Array.isArray(value)) for (const item of value) jsonLeaves(item, into)
  else if (isJsonObject(value)) for (const item of Object.values(value)) jsonLeaves(item, into)
  return into
}
