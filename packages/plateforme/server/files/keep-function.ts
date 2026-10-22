// `file.keep` (fichiers et stockage, § Garder un fichier en transit sur une page ; étape 3 du chantier « fichier ») :
// garder un fichier sur une page derrière `call`, par `keepTransitFile`, sans rien de plus. Écrire à la main le lien d'un
// fichier en transit est refusé, et le refus renvoie ici. Sans elle, un fichier rendu par une fonction s'efface à son
// échéance, et un assistant ne peut le ranger nulle part.
import { FILE_ADDRESS, fileKeepSchema } from "../../schemas"
import { defineFunction } from "../catalog/define"
import { keepTransitFile } from "./keep"

export const fileKeep = defineFunction({
  name: "file.keep",
  connector: "file",
  class: "write",
  origin: "paquet",
  description:
    "Keeps a file on a page: a file a function returned or you uploaded lives 24 hours in transit; this shows it in the page as a file or image block (at the end of the section given, right after the block given, or at the bottom) and keeps it there, with the rights of the page. Never write the link of a file in transit by hand: keep it. A file already on another page is copied. A text file over 4 MB is not kept. In French: garder, ranger, joindre un fichier à une page.",
  schema: fileKeepSchema,
  examples: [{ file: "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f", path: "ventes/appels_semaine", base_revision: 7, section: "Mardi" }],
  refusals: [
    "Unknown path, a table, or a page you cannot write: the refusal says whom to ask.",
    "Unknown file: not a file you produced or uploaded, nor a file on a page you read.",
    "A file deleted: the refusal gives its date and what to do.",
    "A stale or missing base_revision: nothing is written, read the page again.",
    "Both section and after_block, or an unknown section or block.",
    "A text file (html, md, txt, csv, json) over 4 MB: download it from its link before it expires.",
  ],
  run: async (context, args) => {
    const kept = await keepTransitFile(context.db, context.identity, args, {
      origin: { kind: "agent", ctx: context.ctx ?? null },
      route: `${context.origin ?? ""}${FILE_ADDRESS}`,
    })
    return { text: kept.text, data: kept.data, teamId: kept.teamId }
  },
})
