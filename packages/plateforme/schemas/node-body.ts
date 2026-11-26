// Corps de `POST /api/platform/nodes` et entrée que `writeNode` valide pour ses deux portes (E03-S03,
// N40, N45) : l'entrée de `write` (`writeNodeSchema`), dont chaque opération admet en plus `revision`
// (la révision lue du bloc visé) et `input` (un bloc structuré au format de `blockInputSchema`), plus
// `draft_stamp`, le tampon du brouillon lu par l'écran. Jamais servi au modèle.
//
// Fichier à part de `nodes.ts` : `blocks.ts` importe `NODE_PATH_PATTERN` de `nodes.ts` à son
// initialisation ; `nodes.ts` qui importerait `blockInputSchema` fermerait un cycle d'imports, et l'un
// des deux modules lirait l'autre avant qu'il soit initialisé.
import * as z from "zod/v4"
import { blockInputSchema } from "./blocks"
import { refinePathOrId, writeNodeSchema, writeOpSchema } from "./nodes"

const writeOpBodySchema = writeOpSchema.extend({
  revision: z.number().int().min(1).optional(),
  input: blockInputSchema.optional(),
})

export type WriteOpBody = z.infer<typeof writeOpBodySchema>

// Le nœud par son chemin ou par son identifiant, jamais les deux (`refinePathOrId`) : posé ici, la seule entrée que le service lit.
export const writeNodeBodySchema = writeNodeSchema.extend({
  ops: z.array(writeOpBodySchema).optional(),
  // PostgREST rend `timestamptz` avec son décalage (« +00:00 ») : sans `offset`, le tampon qu'il a
  // lui-même servi serait refusé.
  draft_stamp: z.iso.datetime({ offset: true }).optional(),
  // E10-S01 (AC-a2) : le mode tolérant de l'analyse, pour un collage ou un fichier importé par l'écran ; absent de
  // `writeNodeSchema`, dont `parseInput` refuse les clés inconnues : `write` reste strict.
  tolerant: z.literal(true).optional(),
}).superRefine(refinePathOrId())

export type WriteNodeBody = z.infer<typeof writeNodeBodySchema>
