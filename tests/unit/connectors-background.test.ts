// @vitest-environment node
// La fonction longue à la déclaration (`fonctions-longues.md` ; règle 21 de la fabrique de `connectors`) : les cas
// communs avec la lib (`connectors/_cases/background.yaml`, sortis par sa fabrique dans
// `@otomata_tech/connectors/background-cases`, dépendance de développement épinglée à un commit). Chaque fonction
// acceptée entre au catalogue avec ce qu'en lit `call` pour la mettre en file ; chaque fonction refusée l'est par son
// code, dans l'ordre de la règle, et la même sans `background` est acceptée. Sans base : la mise en file et l'exécution
// sont jouées sur une vraie base (`tests/integration/travaux-en-tache-de-fond.test.ts`).
import { backgroundAcceptedFunctions, backgroundRefusals, backgroundRefusedFunctions, connector } from "@otomata_tech/connectors/background-cases"
import { afterEach, describe, expect, it } from "vitest"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { actName, catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { BACKGROUND_SENTENCE } from "../../packages/plateforme/server/connectors/background-declaration"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"

afterEach(() => {
  registerConnectors([])
})

/** Le message du refus de la déclaration, ou `declared`. */
function refusedWith(definition: ConnectorDefinition, options: Parameters<typeof registerConnectors>[1] = {}): string {
  try {
    registerConnectors([definition], options)
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  return "declared"
}

/** La fonction sans `background` : ce que la fabrique vérifie aussi, aucune autre règle ne la refuse. */
function withoutBackground(fn: ConnectorFunctionDefinition): ConnectorFunctionDefinition {
  const rest = { ...fn }
  delete rest.background
  return rest
}

describe("the shared long functions (registerConnectors)", () => {
  it("should name the four refusals of rule 21, each with a refused function", () => {
    expect(backgroundRefusals).toEqual(["background_no_timeout", "background_async", "background_collect", "background_paginated"])
    expect(new Set(backgroundRefusedFunctions.map((one) => one.refusal))).toEqual(new Set(backgroundRefusals))
  })

  it("should declare the case connector, each long function queued by call with its own timeout and the fixed sentence", () => {
    expect(refusedWith(connector)).toBe("declared")
    for (const one of backgroundAcceptedFunctions) {
      const declared: ConnectorFunctionDefinition = one.function
      const served = findFunction(catalogFunctions(), declared.act ? (actName(declared.name) ?? declared.name) : declared.name)
      expect(served?.background?.timeoutMs, one.name).toBe(declared.timeoutMs)
      expect(served?.description, one.name).toBe(`${declared.description} ${BACKGROUND_SENTENCE}`)
      expect(served?.background?.files, one.name).toEqual(Object.values(declared.request.files ?? {}))
    }
  })

  it("should give call the worst case and the settled quantity of a long function, from the cost", () => {
    registerConnectors([connector])
    const transcribe = findFunction(catalogFunctions(), "background_cases.transcribe_audio")?.background
    expect(transcribe?.worst({ file: "f" })).toEqual({ quantity: 1, unit: "seconds" })
    expect(transcribe?.settled({ file: "f" }, [{ usage: { audio_seconds: 42 } }])).toEqual({ quantity: 42, unit: "seconds", from: "response", exceeded: true })
    const enrich = findFunction(catalogFunctions(), "background_cases_act.enrich_contacts")?.background
    expect(enrich?.worst({ contacts: [{ name: "Ada Example", domain: "example.test" }, { name: "Grace Example", domain: "example.test" }] })).toEqual({ quantity: 2, unit: "credits" })
    const draft = findFunction(catalogFunctions(), "background_cases.draft_campaign")?.background
    expect(draft?.worst({ brief: "b" })).toBeNull()
  })

  it.each(backgroundRefusedFunctions.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    const message = refusedWith({ ...connector, functions: [one.function, ...one.beside] })
    expect(message.startsWith(`${one.function.name}: `), message).toBe(true)
    expect(message.endsWith(`(${one.refusal}).`), message).toBe(true)
    expect(refusedWith({ ...connector, functions: [withoutBackground(one.function), ...one.beside] })).toBe("declared")
  })

  it("should keep a function that is not long out of the queue", () => {
    const declared = connector.functions.filter((fn) => fn.name === "background_cases.draft_campaign")
    registerConnectors([{ ...connector, functions: declared.map(withoutBackground) }])
    const draft = findFunction(catalogFunctions(), "background_cases.draft_campaign")
    expect(draft?.background).toBeUndefined()
    expect(draft?.description).not.toContain(BACKGROUND_SENTENCE)
  })

  it("should admit a process as the runner of background jobs, and refuse any other", () => {
    expect(refusedWith(connector, { backgroundRunner: "process" })).toBe("declared")
    expect(refusedWith(connector, { backgroundRunner: "serverless" as never })).toBe('backgroundRunner must be "process" (a process of the host that loops on runJobs) or absent.')
  })
})
