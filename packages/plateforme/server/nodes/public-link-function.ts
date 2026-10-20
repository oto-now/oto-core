// `node.public_link` (1.4.13) : « Partager sur le web » derrière `call`, en deux temps comme `node.trash` : le
// récapitulatif dit ce qui deviendra lisible sans compte, l'accord de la personne crée le lien (`shareNode`) ou le
// désactive (`revokeShare`). Le service décide : l'accès complet au nœud, ni la structure de l'arbre ni l'espace privé
// d'une autre personne (ADR-013). Sans elle, un assistant ne pouvait pas publier une page sur le web à la demande.
import { nodePublicLinkArgsSchema, type NodePublicLinkArgs, type ShareView } from "../../schemas"
import { defineFunction, type FunctionContext, type FunctionSummary } from "../catalog/define"
import { PlatformError } from "../errors"
import { nodeShare, revokeShare, shareNode } from "../shares"
import { findNode, unknownNode } from "./lookup"

/** Ce que le lien couvre : la page seule, ou avec les pages rangées dessous. */
function covers(includeChildren: boolean): string {
  return includeChildren ? "the page and every page under it" : "the page only (the pages under it stay private)"
}

function since(share: ShareView): string {
  return `created on ${share.createdAt.slice(0, 10)}${share.createdByName ? ` by ${share.createdByName}` : ""}`
}

/** Le nœud, son titre et son lien actif ; l'accès complet exigé par `nodeShare` avant toute écriture. */
async function current(context: FunctionContext, path: string) {
  const found = await findNode(context.db, context.identity, path)
  if (!found) throw unknownNode(path, context.identity.org.prefix)
  const share = await nodeShare(context.db, context.identity, found.node.path)
  return { node: found.node, share }
}

function noLink(path: string): PlatformError {
  return new PlatformError("not_found", `${path} has no active public link: nothing to disable.`)
}

/** Le récapitulatif, sans rien écrire : ce qui deviendra public, ou le lien qui cessera de marcher. */
async function summarizeLink(context: FunctionContext, args: NodePublicLinkArgs): Promise<FunctionSummary> {
  const { node, share } = await current(context, args.path)
  const page = `${node.path} « ${node.title} »`
  if (args.action === "disable") {
    if (!share) throw noLink(node.path)
    return {
      text: `About to disable the public link of ${page} (${since(share)}): anyone who has it will no longer read ${share.includeChildren ? "the page and the pages under it" : "the page"}.`,
      data: { path: node.path, action: "disable" },
    }
  }
  const includeChildren = args.include_children ?? share?.includeChildren ?? false
  const text = share
    ? `${page} already has a public link (${since(share)}); it will cover ${covers(includeChildren)}.`
    : `About to make ${page} readable on the web by anyone who has the link, without an account: ${covers(includeChildren)}. The link can be disabled at any time.`
  return { text, data: { path: node.path, action: "create", include_children: includeChildren, already_public: share !== null } }
}

async function runLink(context: FunctionContext, args: NodePublicLinkArgs) {
  const { db, identity } = context
  if (args.action === "disable") {
    const { node, share } = await current(context, args.path)
    if (!share) throw noLink(node.path)
    const revoked = await revokeShare(db, identity, share.id)
    return { text: `The public link of ${node.path} is disabled: it no longer works.`, data: { path: node.path, active: false }, teamId: revoked.teamId }
  }
  const shared = await shareNode(db, identity, { path: args.path, include_children: args.include_children })
  const { share } = shared.data
  const url = `${context.origin ?? ""}/p/${share.token}`
  return {
    text: `${share.path} is ${shared.data.created ? "now" : "still"} public: [public link](${url}). Anyone with it reads ${covers(share.includeChildren)}, without an account. Give it to the user; disable it with node.public_link action disable.`,
    data: { path: share.path, url, include_children: share.includeChildren, created: shared.data.created },
    teamId: shared.teamId,
  }
}

export const nodePublicLink = defineFunction({
  name: "node.public_link",
  connector: "node",
  class: "sensitive",
  origin: "paquet",
  description:
    "Makes a page, procedure or table readable on the web by anyone who has its link, without an account, or disables that link, as Share on the web does on the screen. Use it only when the user asks to publish a content outside the organisation. Two steps: a summary of what would become public, then confirm: true after the user agreed. Needs the manage level. In French: lien public, publier sur le web, partager à l'extérieur, désactiver le lien.",
  schema: nodePublicLinkArgsSchema,
  examples: [{ path: "ventes/offre", action: "create" }],
  refusals: [
    "Unknown path: not a node you can read.",
    "Public links are reserved to those who manage the node: the refusal says whom to ask.",
    "The root, a personal space, a Contexte or the folder of a team: share the pages inside instead.",
    "The private space of another person: only its owner shares it on the web.",
    "disable on a node without an active link.",
  ],
  summarize: (context, args) => summarizeLink(context, args),
  run: (context, args) => runLink(context, args),
})
