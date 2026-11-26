// `node.move` (E11-S18, AC-5 ; P12 amendée par HN-E11S18-5) : le déplacement de l'écran (« Déplacer… », E03-S07)
// derrière `call`, par `moveNode`, sans rien de plus : la gestion du nœud et l'écriture sous la destination exigées, les
// sous-pages qui suivent, l'ancien chemin gardé en alias par la base, chaque refus de l'AC9 d'E03-S07. Sans elle, un
// assistant qui veut ranger ou renommer une page la recrée puis met l'ancienne à la corbeille : son historique, ses
// liens entrants et ses anciens chemins se perdent. Le nœud se désigne aussi par son identifiant stable (`id`), résolu en
// son chemin courant par `findNodeById` : un hôte qui garde ses pages par identifiant les range ou les publie ainsi.
import { moveNodeArgsSchema, NODE_ID_EXAMPLE } from "../../schemas"
import { defineFunction } from "../catalog/define"
import { findNodeById } from "./lookup"
import { moveNode } from "./move"

export const nodeMove = defineFunction({
  name: "node.move",
  connector: "node",
  class: "write",
  origin: "paquet",
  description:
    "Moves or renames a page, procedure, table or folder to a new path, with every page under it, as Move does on the screen: use it to reorganize the tree, put a page in a folder, rename a path or choose the path a new title gave. The old paths still lead to it (links, bookmarks). Never recreate a page and trash the old one: move it. Needs the manage level on the node and the write level under the new parent. The node is given by its path, or by its stable id (as read, find and write return it) instead. In French: déplacer, renommer, ranger dans un dossier, réorganiser.",
  schema: moveNodeArgsSchema,
  examples: [
    { path: "ventes/relance_devis", new_path: "ventes/procedures/relance_devis" },
    { id: NODE_ID_EXAMPLE, new_path: "ventes/procedures/relance_devis" },
  ],
  refusals: [
    "Unknown path: not a node you can read.",
    "Both path and id, or neither; an unknown id, or one of a content in the trash (the refusal says so).",
    "The root, a personal space, a Contexte or the folder of a team: they stay in place; move the pages inside instead.",
    "A new path under the node itself, or whose parent does not exist (the refusal names the closest existing page).",
    "A parent reached by an old path: the refusal gives the path to use.",
    "Moving is reserved to those who manage the node, and needs the write level under the new parent: the refusal says whom to ask.",
    "A new path already taken: the node goes to the first free path after it, e.g. ventes/relance_devis_2.",
    "The node changed meanwhile: read it again, then retry.",
  ],
  run: async (context, args) => {
    const path = args.id === undefined ? args.path : (await findNodeById(context.db, context.identity, args.id)).node.path
    const moved = await moveNode(context.db, context.identity, { path, new_path: args.new_path })
    return { text: moved.text, data: { path: moved.target, moves: moved.moves }, teamId: moved.teamId }
  },
})
