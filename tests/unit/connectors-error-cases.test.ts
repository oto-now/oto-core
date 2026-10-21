// @vitest-environment node
// Les cas communs de la table d'erreurs (`connectors/_cases/errors.yaml`), partagés avec la lib Python du dépôt
// `connectors`, copiés (`tests/factories/error-cases.ts`) en attendant `@otomata_tech/connectors/error-cases` : chaque
// réponse du tiers (statut, corps JSON ou texte) rendue par un `fetch` simulé au chemin réel d'appel de la fonction des
// cas, qui lit le corps, choisit la ligne de la table et marque le compte. La ligne attendue se lit dans le refus (son
// code dans `details.refusal`, sa marque dans le code du refus et dans la marque posée) ; `null` : un succès sous un
// 2xx, sinon le refus propre au moteur, sans ligne de la table. Un écart est un désalignement à corriger du côté qui
// s'écarte du format, jamais un cas à retirer.
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { platformCode } from "../../packages/plateforme/server/connectors/error-table"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { memoryMark, memoryTokens } from "../factories/described-connector"
import { connector, errorCases, getRecord, type ErrorCase } from "../factories/error-cases"

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * La réponse du cas, neuve à chaque requête : un 429 se rejoue, `Retry-After: 0` pour ne pas attendre (le rejeu ne
 * change pas la réponse, toujours la même).
 */
function answerOf(c: ErrorCase): Response {
  const { status, json, text } = c.answer
  const body = text ?? JSON.stringify(json)
  const type = text === undefined ? "application/json" : "text/plain"
  return new Response(body, { status, headers: { "content-type": type, "retry-after": "0" } })
}

/** `get_record` appelée par le chemin réel sur la réponse du cas : son issue et les marques demandées pour le compte. */
async function call(c: ErrorCase) {
  vi.stubGlobal(
    "fetch",
    vi.fn<Fetch>(async () => answerOf(c)),
  )
  vi.spyOn(console, "error").mockImplementation(() => {})
  const fn = findFunction(catalogFunctions(), getRecord.name)
  if (!fn) throw new Error(`${getRecord.name} is not declared`)
  const mark = memoryMark()
  const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens(), mark }
  const outcome = await fn.run({ db: {}, identity: {}, credential, account: { id: "account-1" } } as unknown as FunctionContext, { id: "r-1" } as never).then(
    () => null,
    (error: unknown) => error,
  )
  return { outcome, sets: mark.sets }
}

describe("common error table cases", () => {
  it("should declare the case connector: its body conditions pass the declaration as they pass the fabrique", () => {
    expect(() => registerConnectors([connector])).not.toThrow()
  })

  it.each(errorCases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    registerConnectors([connector])
    const { outcome, sets } = await call(c)
    const { status } = c.answer
    if (c.entry === null && status >= 200 && status < 300) {
      expect(outcome).toBeNull()
      expect(sets).toEqual([null])
      return
    }
    if (!(outcome instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(outcome)}`)
    if (c.entry === null) {
      expect(outcome.details?.refusal).toBeUndefined()
      expect(sets).toEqual([])
      return
    }
    expect(outcome.details?.refusal).toBe(c.entry.code)
    expect(outcome.code).toBe(c.entry.marksAccount ?? platformCode(status))
    expect(sets).toEqual(c.entry.marksAccount === null ? [] : [c.entry.marksAccount])
  })

  it.todo("should play the error table cases of @otomata_tech/connectors/error-cases, shared with the Python lib, once the connectors pin brings them")
})
