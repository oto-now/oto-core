// Ressource `transit-files` de l'API du paquet (fichiers et stockage, § Fichier en transit) : `POST transit-files` (la
// demande d'envoi d'un fichier sans nœud, rendue avec son échéance) et `POST transit-files/<id>/complete` (la
// confirmation) ; il se lit à son adresse, `/f/<id>`, comme un fichier joint (`files.ts`) ; `POST transit-files/<id>/keep`
// le garde sur une page (étape 3 du chantier « fichier », `server/files/keep.ts`). Adaptateur mince : l'auteur seul,
// l'échéance, le type, la taille et le quota sont décidés dans `server/files/transit.ts`. Aucun nœud avant la garde, donc
// aucune cible au journal, puis la page gardée ; aucun nom de fichier non plus, sa ligne n'en porte que l'identifiant, la
// taille et le type, et la page. Sans elle, une personne ne dépose, ne relit ni ne garde un fichier destiné à un connecteur.
import { FILE_ADDRESS, fileIdSchema, filePath, transitFileKeepSchema } from "../schemas"
import type { Json } from "../server/database"
import { invalidInput } from "../server/errors"
import { keepTransitFile } from "../server/files/keep"
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

/** Le journal d'une garde : l'identifiant du fichier, la page et la place du bloc, jamais le nom. */
function keepJournalArgs({ params, body }: { params: string[]; body: unknown }): Json {
  const args = {
    id: fileIdSchema.safeParse(params[0]).data,
    node: field(body, "node", "string"),
    base_revision: field(body, "base_revision", "number"),
    section: field(body, "section", "string"),
    after_block: field(body, "after_block", "string"),
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
      // L'identifiant est dans l'adresse ; le corps, du JSON comme tout `POST` de la porte (`{}`), n'est pas lu. La réponse
      // porte l'adresse du fichier, `/f/<id>`, où il se lit.
      async handle({ db, identity, params }) {
        const ready = await completeTransitUpload(db, identity, params[0])
        return { status: 200, data: { ...ready, url: filePath(ready.id) } }
      },
    },
    {
      params: 2,
      fixed: { 1: "keep" },
      journalArgs: keepJournalArgs,
      target: ({ body }) => {
        const node = field(body, "node", "string")
        return typeof node === "string" ? node : null
      },
      // La page par son chemin (`node`, comme `POST files`) ; garder sous la provenance de l'écran, la réponse portant les
      // liens absolus du fichier (`<origine>/f/<id>`).
      async handle({ db, identity, params, body, origin }) {
        const parsed = transitFileKeepSchema.safeParse(body)
        if (!parsed.success) throw invalidInput(parsed.error)
        const { node, ...place } = parsed.data
        const kept = await keepTransitFile(db, identity, { file: params[0], path: node, ...place }, { origin: { kind: "human" }, route: `${origin}${FILE_ADDRESS}` })
        return { status: 200, data: kept.data, journal: { target: typeof kept.data.path === "string" ? kept.data.path : node, teamId: kept.teamId } }
      },
    },
  ],
}
