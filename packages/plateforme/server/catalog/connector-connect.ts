// `connector.connect` (`connexion-par-l-agent.md` § Fonction), derrière `call`, sans outil ajouté (ADR-002) : l'adresse
// stable où la personne fait le seul geste qui manque pour connecter un connecteur (consentir chez le tiers, coller une
// clé, brancher son compte, ou, administrateur, confirmer l'activation), demandée sans attendre un refus. Adaptateur
// fin : la décision est celle des refus (`planConnection`), l'action dite comme eux (`actionSentence`). Connecteur
// `connector`, classe `read` : rien ne s'écrit ni ne part chez un tiers avant que la personne ouvre l'adresse.
import { connectorConnectSchema } from "../../schemas/connectors"
import { defineFunction } from "./define"

export const connectorConnect = defineFunction({
  name: "connector.connect",
  connector: "connector",
  class: "read",
  origin: "paquet",
  description:
    "Gives the link where the user connects a connector in one gesture (connecter un connecteur, activer un connecteur): authorize it at the third party (OAuth), paste its API key, or link their account; an administrator confirms there the activation of a connector that is off, then connects it. Use it when a call answers not_enabled, or before the first call to a connector that has no account; when an account already works in that space, it says so (gesture none) and gives no link. The link holds no secret and does not expire: it only works for a signed-in member of this organisation, whose rights are checked again when it opens. space: me (default for a connector where each person connects their own), org or team:<slug>. access: required for a connector with several accesses, refused otherwise.",
  schema: connectorConnectSchema,
  examples: [{ connector: "crm" }, { connector: "crm", space: "org" }, { connector: "crm", space: "team:ventes" }],
  refusals: [
    "An unknown or built-in connector (not_found, invalid_arguments); for a connector with several accesses, a missing or unknown access, and an access given to a connector with one (invalid_arguments); an unknown team (not_found).",
    "A space the user cannot connect (forbidden, saying why): an organisation account by someone who does not administer it, a team account by someone who neither administers the organisation nor leads the team, an owner the connector does not take.",
    "The public address of this organisation is not set (internal): ask whoever runs this application.",
  ],
  next: [],
  // Différé : la logique lit les comptes et les déclarations, qui lisent le registre (`connect-function.ts`).
  run: async (context, args) => (await import("../connectors/connect-function")).runConnectorConnect(context, args),
  // L'adresse va à une personne, dans une conversation.
  checkArgs: async () => ["connector.connect is called by an assistant, not by a procedure"],
})
