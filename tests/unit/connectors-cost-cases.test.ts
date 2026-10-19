// @vitest-environment node
// Les cas communs du coût, partagés avec la lib Python du dépôt `connectors` (`connectors/_cases/cost.yaml`, sortis par
// sa fabrique dans `@otomata_tech/connectors/cost-cases`, dépendance de développement épinglée à un commit) : le même
// fichier, joué ici contre `costOf`, `settledQuantity` et `collectionOf`, l'est là-bas contre `oto.connectors.cost`.
// Des cas synthétiques : le connecteur des cas n'est déclaré que le temps du test. Un écart est un désalignement à
// corriger du côté qui s'écarte du format, jamais un cas à retirer.
import { connector, costCases } from "@otomata_tech/connectors/cost-cases"
import type { CostCaseOutcome } from "@otomata_tech/connectors/cost-cases"
import { afterEach, describe, expect, it } from "vitest"
import { registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { collectionOf, ConnectorCostError, costOf, settledQuantity } from "../../packages/plateforme/server/connectors/cost"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"

afterEach(() => {
  registerConnectors([])
  registerFunctions([])
})

/** Ce que rend `compute`, comparé à l'attendu du cas : une valeur, `null`, ou `"error"`, un refus du coût. */
function expectOutcome<T>(expected: CostCaseOutcome<T>, compute: () => unknown): void {
  if (expected === "error") expect(compute).toThrow(ConnectorCostError)
  else expect(compute()).toEqual(expected)
}

describe("common cost cases", () => {
  it("should declare the case connector: its cost and jobs pass the declaration as they pass the fabrique", () => {
    expect(() => registerConnectors([connector])).not.toThrow()
  })

  it.each(costCases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const fn: ConnectorFunctionDefinition = c.function
    const args = c.args as Record<string, unknown>
    expectOutcome(c.worstCase, () => costOf(fn, args))
    expectOutcome(c.settled, () => settledQuantity(fn, args, c.answers))
    expectOutcome(c.collection, () => collectionOf(fn, c.submission))
  })
})
