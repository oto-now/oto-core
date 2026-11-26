// @vitest-environment node
// Les règles d'ordre du classement des fonctions (`routage-et-recherche.md` § Classement des fonctions) : les fonctions que
// la personne peut appeler devant celles d'un connecteur sans compte, une « à connecter » seulement quand elle répond
// nettement mieux, ou quand rien d'utilisable ne répond ; une question ne met que des lectures en tête ; à score égal, la
// lecture avant l'écriture ; une seule fonction par nom proche. Le cas de l'issue de test du 26/11/2026 est rejoué sur
// les définitions de `@otomata_tech/connectors` (version épinglée) : Brevo seul branché, quatre connecteurs sans compte.
import * as connectorsLibrary from "@otomata_tech/connectors"
import * as z from "zod/v4"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { defineFunction, type CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { rankFunctions, usableFirst } from "../../packages/plateforme/server/catalog/ranking"
import { assistantFunctions, needsAccount } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { hintLines, proposedFunctions } from "../../packages/plateforme/server/context/hints"

const ok = async () => ({ text: "ok" })

function fn(name: string, description: string, fnClass: CatalogFunction["class"] = "read"): CatalogFunction {
  return defineFunction({ name, connector: name.split(".")[0].replace(/_act$/, ""), class: fnClass, origin: "erp", description, schema: z.strictObject({}), examples: [], refusals: [], run: ok })
}

const names = (ranked: readonly { fn: CatalogFunction }[]) => ranked.map((result) => result.fn.name)

describe("rankFunctions: order without accounts", () => {
  it("should put the read before the write at an equal score, reads first for a question, and one function per close name", () => {
    // Même description, verbes de même longueur : seul le genre les départage ; par le nom, l'écriture passait devant.
    const tied = [fn("crm.make_invoices", "Invoices of the customer, by month.", "write"), fn("crm.read_invoices", "Invoices of the customer, by month.")]
    const scores = rankFunctions(tied, "invoices of the customer", 5).map((result) => result.score)
    const catalog = [
      fn("crm.send_invoices", "Sends the invoices of the month to each customer by email.", "write"),
      fn("crm.invoice_totals", "Reads the totals of the invoices of the month."),
      fn("crm.get_user", "Gets the user of the API key."),
      fn("crm.get_user_v1", "Gets the user of the API key, through the first API."),
    ]
    expect({
      tie: [scores[0] === scores[1], names(rankFunctions(tied, "invoices of the customer", 5))],
      action: names(rankFunctions(catalog, "send the invoices of the month", 5)),
      question: names(rankFunctions(catalog, "send the invoices of the month ?", 5)),
      close: names(rankFunctions(catalog, "user of the API key", 5)),
    }).toEqual({
      tie: [true, ["crm.read_invoices", "crm.make_invoices"]],
      action: ["crm.send_invoices", "crm.invoice_totals"],
      question: ["crm.invoice_totals", "crm.send_invoices"],
      close: ["crm.get_user"],
    })
  })
})

/** Les définitions de la bibliothèque des connecteurs nommés. */
function libraryConnectors(wanted: readonly string[]): ConnectorDefinition[] {
  return Object.values(connectorsLibrary).flatMap((module: unknown) =>
    typeof module === "object" && module !== null && "connector" in module && wanted.includes((module.connector as ConnectorDefinition).name)
      ? [module.connector as ConnectorDefinition]
      : [],
  )
}

describe("rankFunctions: usable first (test of 26/11/2026)", () => {
  beforeAll(() => {
    registerConnectors(libraryConnectors(["brevo", "affinity", "aircall", "allo", "amplitude"]))
  })

  afterAll(() => {
    registerConnectors([])
  })

  /** Brevo branché ; affinity, aircall, allo et amplitude sans compte ; le paquet s'appelle sans compte. */
  const usable = (one: CatalogFunction) => (!needsAccount(one) || one.connector === "brevo" ? null : ("connect" as const))
  const ranked = (phrase: string, limit = 5) => usableFirst(rankFunctions(assistantFunctions(), phrase, assistantFunctions().length), limit, usable).map((result) => [result.fn.name, result.missing])
  const connectors = (phrase: string) => [...new Set(usableFirst(rankFunctions(assistantFunctions(), phrase, assistantFunctions().length), 5, usable).map((result) => result.fn.connector))]

  it("should rank Brevo first, propose no unconnected function that does not answer clearly better, and keep the catalogue findable", () => {
    expect({
      contacts: ranked("liste de contacts").slice(0, 2),
      // Le score de 1,00 d'allo, d'amplitude, d'affinity et d'aircall venait d'un mot du catalogue qui commençait celui
      // de la demande (« new », « email ») : aucune n'est plus proposée.
      newsletter: connectors("newsletter"),
      emailing: connectors("emailing"),
      subscribers: connectors("combien d'abonnés"),
      // Aircall répond nettement mieux que les fonctions Brevo trouvées par « contacts » : après elles, la dernière place.
      better: ranked("contacts Aircall", 3),
      // Rien d'utilisable ne répond : les meilleures à connecter sortent.
      nothingUsable: ranked("liste les appels Aircall", 2),
    }).toEqual({
      contacts: [
        ["brevo.list_contacts_of_list", null],
        ["brevo.list_contacts", null],
      ],
      newsletter: [],
      emailing: [],
      subscribers: [],
      better: [
        ["brevo.list_contacts", null],
        ["brevo.list_contacts_of_list", null],
        ["aircall.get_contact", "connect"],
      ],
      nothingUsable: [
        ["aircall.list_calls", "connect"],
        ["aircall.list_contacts", "connect"],
      ],
    })
    expect(connectors("liste de contacts")).toEqual(["brevo"])
  })

  it("should mark a proposal to connect in the context, with connector.connect", () => {
    const lines = hintLines({ functions: proposedFunctions(assistantFunctions(), "liste les appels Aircall", undefined, usable).slice(0, 1), help: null }, "acme")
    expect(lines).toEqual([
      "Functions that may do it (read a contract with acme_read path <function>, run it with acme_call):",
      `- aircall.list_calls (to connect): ${lines[1].split(": ").slice(1).join(": ")}`,
      'Marked "to connect": no account the user can use yet; offer to connect the connector with acme_call {"function": "connector.connect", "arguments": {"connector": "<connector>"}} instead of calling the function.',
    ])
    // Un compte sous le niveau de la classe : demander l'accès, jamais brancher un compte de plus.
    expect(hintLines({ functions: [{ name: "affinity_act.create_note", sentence: "Creates a note.", missing: "access" }], help: null }, "acme").slice(1)).toEqual([
      "- affinity_act.create_note (ask for access): Creates a note.",
      `Marked "ask for access": the user's accounts of this connector do not allow this function; ask whoever manages the account for access instead of calling it.`,
    ])
  })
})
