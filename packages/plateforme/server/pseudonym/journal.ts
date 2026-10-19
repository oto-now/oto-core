// Le journal pseudonymisé à l'écriture (`pseudonymisation.md` § Journal, retours et appels de l'hôte) : arguments,
// cible et message d'erreur de chaque ligne, aux trois portes qui journalisent une requête (MCP, `callFunction`, API
// HTTP), par leur écrivain commun (`writeJournal`). L'écriture suit la réponse : le coût est hors du chemin critique.
// Un dictionnaire illisible à ce moment ne garde ni les arguments (`{ _withheld: true }`), ni la cible, ni le message
// d'erreur (son code seul) : jamais en clair.
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { pseudonymizerFor, type Pseudonymizer } from "./service"

/** Les colonnes d'une ligne que la porte touche ; le reste (outil, durée, identifiants) ne nomme personne. */
type Line = { org_id?: string | null; args?: Json | null; target?: string | null; error?: string | null }

/** Le code seul d'une colonne `error` (`<code>: <message>`). */
function codeOnly(error: string): string {
  return error.split(":")[0]
}

function withheld<T extends Line>(line: T): T {
  return {
    ...line,
    ...(line.args === undefined || line.args === null ? {} : { args: { _withheld: true } }),
    ...(line.target === undefined || line.target === null ? {} : { target: null }),
    ...(typeof line.error === "string" ? { error: codeOnly(line.error) } : {}),
  }
}

function gated<T extends Line>(gate: Pseudonymizer, line: T): T {
  return {
    ...line,
    ...(line.args === undefined || line.args === null ? {} : { args: gate.json(line.args) }),
    ...(typeof line.target === "string" ? { target: gate.text(line.target) } : {}),
    ...(typeof line.error === "string" ? { error: gate.text(line.error) } : {}),
  }
}

/** Les lignes telles qu'elles s'écrivent : pseudonymisées par organisation, ou retenues si sa porte est en panne. */
export async function pseudonymizedLines<T extends Line>(db: PlatformDb, lines: readonly T[]): Promise<T[]> {
  const gates = new Map<string, Pseudonymizer | null | "unavailable">()
  for (const orgId of new Set(lines.flatMap((line) => (line.org_id ? [line.org_id] : [])))) {
    try {
      gates.set(orgId, await pseudonymizerFor(db, orgId))
    } catch {
      // La cause est déjà au log (`pseudonymizerFor`) ; le journal, qui ne lève jamais, retient ce qu'il ne peut masquer.
      gates.set(orgId, "unavailable")
    }
  }
  return lines.map((line) => {
    const gate = line.org_id ? gates.get(line.org_id) : null
    if (gate === "unavailable") return withheld(line)
    return gate ? gated(gate, line) : line
  })
}
