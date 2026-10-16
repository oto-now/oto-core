// @vitest-environment node
// Le moteur des connecteurs décrits (story moteur-des-connecteurs-decrits, AC5 à AC11) : la fonction déclarée court
// sur un `fetch` simulé, sans réseau ni base. Requête composée depuis la définition, pagination, contrôles avant l'appel
// et sur la réponse, table d'erreurs, texte du résultat ; le secret, tiré à l'exécution, ne va qu'à l'en-tête
// d'authentification.
import { randomBytes } from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { describedConnector, memoryTokens } from "../factories/described-connector"
import { loggedText } from "../helpers/logs"

const secret = () => `key_${randomBytes(12).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** Le contexte qu'en donne `runCall` : le compte résolu (clé du rythme) et le compte ouvert (champ `api_key`). */
function context(secretValue: string | undefined): FunctionContext {
  const credential = secretValue === undefined ? undefined : { fields: { api_key: secretValue }, settings: {}, tokens: memoryTokens() }
  // Seuls `account.id` et `credential` sont lus par le moteur : le reste du contexte ne sert pas ici.
  return { credential, account: { id: `account-${randomBytes(4).toString("hex")}` } } as unknown as FunctionContext
}

/** La fonction déclarée, appelée comme `call` l'appelle : arguments validés, puis exécution ; `null` : sans secret. */
async function run(name: string, args: Record<string, unknown>, credential: string | null = secret()) {
  const fn = findFunction(catalogFunctions(), name)
  if (!fn) throw new Error(`${name} is not declared`)
  const checked = checkArguments(fn.schema, args)
  if (!checked.success) throw new Error(`invalid test arguments for ${name}`)
  // Le type commun du catalogue efface les arguments en `never` ; ils ont passé le schéma.
  return fn.run(context(credential ?? undefined), checked.data as never)
}

async function refusal(work: Promise<unknown>): Promise<PlatformError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

/** `fetch` simulé, ses réponses dans l'ordre ; chaque requête gardée (adresse, méthode, en-têtes, corps). */
function stub(...answers: Response[]) {
  const send = vi.fn<Fetch>(async () => answers.shift() ?? json({}))
  vi.stubGlobal("fetch", send)
  const sent = () =>
    send.mock.calls.map(([url, init]) => ({ url, method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) }))
  return { send, sent }
}

beforeEach(() => {
  registerConnectors([describedConnector()])
})

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("described connector engine", () => {
  it("should compose a GET from the connector headers, the query constants, lists as brackets and a JSON-encoded argument, the token last (AC5)", async () => {
    const key = secret()
    const { sent } = stub(json({ items: [], has_more: false, next_cursor: null }))
    await run("crm.list_contacts", { limit: 2, tags: ["vip", "lyon"], filter: [{ field: "city", value: "Lyon" }] }, key)
    const filter = encodeURIComponent(JSON.stringify([{ field: "city", value: "Lyon" }]))
    expect(sent()).toEqual([
      {
        url: `https://crm.example.test/v2/contacts?view=full&limit=2&tags%5B%5D=vip&tags%5B%5D=lyon&filter=${filter}`,
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}`, "crm-version": "2026-10" },
        body: undefined,
      },
    ])
  })

  it("should send the body constants with the arguments, a constant header, an encoded path, and a body on PUT and DELETE (AC5)", async () => {
    const { sent } = stub(json({ id: 9 }), json({ id: "a/b c" }), json({}))
    await run("crm.post_entry", { label: "Fees", lines: [{ debit: "15.00" }, { credit: "15" }] })
    await run("crm.rename_contact", { contact_id: "a/b c", name: "Ada" })
    await run("crm.untag_contact", { tag_id: "t-1", reason: "duplicate" })
    expect(sent().map(({ url, method, body }) => [method, url, body])).toEqual([
      ["POST", "https://crm.example.test/v2/entries", { draft: false, label: "Fees", lines: [{ debit: "15.00" }, { credit: "15" }] }],
      ["PUT", "https://crm.example.test/v2/contacts/a%2Fb%20c", { name: "Ada" }],
      ["DELETE", "https://crm.example.test/v2/tags/t-1", { reason: "duplicate" }],
    ])
    expect(sent()[0].headers["crm-mode"]).toBe("strict")
  })

  it("should read one page and say how to read the next, without the stripped keys (AC6, AC11)", async () => {
    stub(json({ items: [{ id: "c-1", name: "Ada", secret_note: "x" }], has_more: true, next_cursor: "p2" }))
    const output = await run("crm.list_contacts", {})
    expect(output.text).toBe(
      ['crm.list_contacts: 1 item:', '- {"id":"c-1","name":"Ada"}', 'More results: call again with cursor: "p2", or with all_pages: true (3 pages at most).'].join("\n"),
    )
    expect(output.data).toEqual({ items: [{ id: "c-1", name: "Ada" }], next_cursor: "p2", pages: 1 })
  })

  it("should follow the cursor with all_pages until more is false, then stop (AC6)", async () => {
    const { sent } = stub(
      json({ items: [{ id: "c-1" }], has_more: true, next_cursor: "p2" }),
      json({ items: [{ id: "c-2" }], has_more: false, next_cursor: "p3" }),
    )
    const output = await run("crm.list_contacts", { all_pages: true, limit: 1 })
    expect(sent().map((request) => request.url)).toEqual([
      "https://crm.example.test/v2/contacts?view=full&limit=1",
      "https://crm.example.test/v2/contacts?view=full&limit=1&cursor=p2",
    ])
    expect(output.text).toBe(['crm.list_contacts: 2 items from 2 pages:', '- {"id":"c-1"}', '- {"id":"c-2"}'].join("\n"))
  })

  it("should follow the cursor into the argument requestParam names, under another name in the query, as the factory renders it", async () => {
    // L'argument `cursor` part sous le nom `pageToken`, comme `page_token` chez Gmail ; `requestParam` nomme l'argument.
    const base = describedConnector()
    const query = { limit: "limit", pageToken: "cursor", tags: "tags", filter: "filter" }
    registerConnectors([{ ...base, functions: base.functions.map((fn) => (fn.name === "crm.list_contacts" ? { ...fn, request: { ...fn.request, query } } : fn)) }])
    const { sent } = stub(json({ items: [], has_more: true, next_cursor: "p2" }), json({ items: [], has_more: false }))
    await run("crm.list_contacts", { all_pages: true })
    expect(sent().map((request) => request.url)).toEqual(["https://crm.example.test/v2/contacts?view=full", "https://crm.example.test/v2/contacts?view=full&pageToken=p2"])
  })

  it("should stop at max_pages and give the cursor of the page left (AC6)", async () => {
    const page = (n: number) => json({ items: [{ id: `c-${n}` }], has_more: true, next_cursor: `p${n + 1}` })
    const { send } = stub(page(1), page(2), page(3))
    const output = await run("crm.list_contacts", { all_pages: true, max_pages: 2 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(output.text.split("\n").at(-1)).toBe('More results: call again with cursor: "p3".')
  })

  it("should refuse an unbalanced entry by its named refusal, sending nothing, and sum decimals exactly (AC7)", async () => {
    const { send } = stub(json({ id: 1 }))
    const error = await refusal(run("crm.post_entry", { label: "Fees", lines: [{ debit: "15.00" }, { credit: "14.99" }] }))
    expect({ code: error.code, message: error.message, details: error.details }).toEqual({
      code: "invalid_arguments",
      message: "The entry is not balanced: total debits must equal total credits. Nothing was sent. (entry_unbalanced)",
      details: { refusal: "entry_unbalanced" },
    })
    expect(send).not.toHaveBeenCalled()
    // 0.1 + 0.2 vaut 0.30000000000000004 en virgule flottante : la somme décimale exacte l'égale à 0.3.
    await run("crm.post_entry", { label: "Fees", lines: [{ debit: "0.1" }, { debit: "0.2" }, { credit: "0.3" }] })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("should refuse an answer without the expected value by its named refusal, and keep the projected keys only (AC8)", async () => {
    stub(json({ id: "c-42", name: "Ada", email: "", phone: "0" }), json({ id: "c-42", name: "Ada", email: "ada@example.test", phone: "0" }))
    const error = await refusal(run("crm.get_contact", { contact_id: "c-42" }))
    expect({ code: error.code, message: error.message }).toEqual({ code: "not_found", message: "The contact has no email. (email_missing)" })
    const output = await run("crm.get_contact", { contact_id: "c-42" })
    expect(output.text).toBe('crm.get_contact:\n{"id":"c-42","name":"Ada","email":"ada@example.test"}')
  })

  it.each([
    [404, "not_found", "No contact with this id. (contact_not_found)"],
    [403, "upstream_error", "Crm refused access: the key is invalid or lacks the scope. (access_rejected)"],
    [400, "invalid_arguments", "Crm rejected the request as invalid. (invalid_request)"],
    [503, "upstream_error", "Crm is temporarily unavailable: retry later. (upstream_unavailable)"],
  ])("should translate status %i by the function's refusals first, then the connector's table, never with the token (AC9)", async (status, code, message) => {
    const key = secret()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    stub(json({ echo: key }, status))
    const error = await refusal(run("crm.get_contact", { contact_id: "c-42" }, key))
    expect({ code: error.code, message: error.message }).toEqual({ code, message })
    expect([JSON.stringify(error.details), error.message, loggedText(errors)].join(" ")).not.toContain(key)
  })

  it("should fail as internal, sending nothing, without the secret of a live account (AC10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { send } = stub(json({}))
    expect((await refusal(run("crm.get_company", {}, null))).code).toBe("internal")
    expect(send).not.toHaveBeenCalled()
  })

  it("should summarize a sensitive function from its template, its arguments in place (AC10)", async () => {
    const fn = findFunction(catalogFunctions(), "crm.post_entry")
    const summary = await fn?.summarize?.(context(secret()), { label: "Fees", lines: [] } as never)
    expect(summary).toEqual({ text: 'Post entry "Fees": it cannot be deleted.', data: { arguments: { label: "Fees", lines: [] } } })
  })
})
