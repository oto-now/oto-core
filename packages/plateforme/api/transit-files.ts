// Ressource `transit-files` de l'API du paquet (fichiers et stockage, § Fichier en transit) : `POST transit-files` (la
// demande d'envoi d'un fichier sans nœud, rendue avec son échéance) et `POST transit-files/<id>/complete` (la
// confirmation) ; il se lit à son adresse, `/f/<id>`, comme un fichier joint (`files.ts`). Adaptateur
// mince : l'auteur seul, l'échéance, le type, la taille et le quota sont décidés dans `server/files/transit.ts`. Aucun
// nœud, donc aucune cible au journal ; aucun nom de fichier non plus, sa ligne n'en porte que l'identifiant, la taille et
// le type. Sans elle, une personne ne dépose ni ne relit un fichier destiné à un connecteur.
import { fileIdSchema } from "../schemas"
import type { Json } from "../server/database"
import { clip } from "../server/journal"
import { completeTransitUpload, requestTransitUpload } from "../server/files/transit"
import type { ResourceRoutes } from "./handler"

/** Un champ de l'objet `value`, s'il est du type `kind`, une chaîne bornée à 255 caractères ; rien sinon. */
function field(value: unknown, key: string, kind: "string" | "number"): Json | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const found: unknown = (value as Record<string, unknown>)[key]
  if (typeof found !== kind) return undefined
  return typeof found === "string" ? clip(found, 255) : (found as number)
}

/**
 * Le journal d'un fichier en transit : l'identifiant, la taille et le type MIME, jamais le nom (décision du 19/10), ni dans
 * les arguments ni dans l'erreur (le code seul, par `journalArgs`). La réponse d'abord, sinon l'adresse et le corps.
 */
function transitJournalArgs({ params, body, data }: { params: string[]; body: unknown; data?: unknown }): Json {
  const args = {
    id: field(data, "id", "string") ?? fileIdSchema.safeParse(params[0]).data,
    size: field(data, "size", "number") ?? field(body, "size", "number"),
    mime: field(data, "mime", "string") ?? field(body, "mime", "string"),
  }
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as Json
}

export const transitFilesRoutes: ResourceRoutes = {
  POST: [
    {
      params: 0,
      journalArgs: transitJournalArgs,
      async handle({ db, identity, body }) {
        return { status: 201, data: await requestTransitUpload(db, identity, body) }
      },
    },
    {
      params: 2,
      fixed: { 1: "complete" },
      journalArgs: transitJournalArgs,
      // L'identifiant est dans l'adresse ; le corps, du JSON comme tout `POST` de la porte (`{}`), n'est pas lu.
      async handle({ db, identity, params }) {
        return { status: 200, data: await completeTransitUpload(db, identity, params[0]) }
      },
    },
  ],
}
