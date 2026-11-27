// La définition d'un connecteur privé des tests (`connecteurs-prives.md`) : l'ERP fictif d'une organisation, joint par
// une clé d'API en en-tête, une lecture et une écriture sensible. Une copie neuve à chaque appel : un test la change à
// son gré. Adresse dans un domaine réservé aux tests ; sa résolution est remplacée par la suite qui l'emploie.

/** L'espace servi de l'ERP fictif. */
export const ERP = "custom_erp"

export function erpDefinition() {
  return {
    connector: {
      name: ERP,
      label: "ERP",
      namespace: ERP,
      version: "1.0.0",
      api_version: "v1",
      base_url: "https://erp.exemple.test/api",
      auth: { kind: "api_key", in: "header", name: "X-Erp-Key", key: "token" },
      credential: [{ name: "token", label: "API key", secret: true }],
      modes: ["byo_user", "byo_org"],
      errors: [
        {
          status: 401,
          code: "unauthorized",
          retryable: false,
          marks_account: "credential_rejected",
          message: "The ERP refuses the key of this account: it must be set again.",
        },
      ],
    },
    functions: [
      {
        name: "search_produits",
        class: "read",
        description: "Products of the catalogue whose name contains the text searched.",
        input: { type: "object", additionalProperties: false, required: ["q"], properties: { q: { type: "string", minLength: 1 } } },
        examples: [{ title: "Chairs", input: { q: "chaise" } }],
        call: { method: "GET", path: "/produits", query: { q: "q" } },
        output: { items: "data" },
      },
      {
        name: "create_commande",
        class: "sensitive",
        effect: "send",
        description: "Create an order of a customer, with its lines.",
        input: {
          type: "object",
          additionalProperties: false,
          required: ["client", "lignes"],
          properties: {
            client: { type: "string", minLength: 1 },
            lignes: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["produit", "quantite"],
                properties: { produit: { type: "string", minLength: 1 }, quantite: { type: "integer", minimum: 1 } },
              },
            },
          },
        },
        examples: [{ title: "Two chairs", input: { client: "cl_1", lignes: [{ produit: "pr_1", quantite: 2 }] } }],
        confirm: { summary: "Create an order for {client}." },
        call: { method: "POST", path: "/commandes", body: { client: "client", lignes: "lignes" } },
      },
    ],
  }
}
