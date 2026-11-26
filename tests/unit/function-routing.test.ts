// @vitest-environment node
// La mesure des fonctions (`routage-et-recherche.md` § Mesure continue sans host) : le jeu `function-routing.cases.ts` rejoué
// sur le catalogue de `@otomata_tech/connectors` (version épinglée), chaque connecteur que ce paquet accepte déclaré et
// actif, plus les fonctions du paquet. Une demande directe est reconnue quand sa fonction est parmi les trois que
// `context` propose (`proposedFunctions`) ; une négative, quand aucune fonction n'est proposée. Les ratées et les
// négatives bruyantes sont figées ici : un changement du classement qui en gagne ou en perd une se voit au diff. Les taux
// sont imprimés, avec le poids de `read path functions` sur ce catalogue, plan par connecteur au-delà de 45 000 caractères (AC11).
import * as connectorsLibrary from "@otomata_tech/connectors"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assistantFunctions } from "../../packages/plateforme/server/catalog/registry"
import { contractNames } from "../../packages/plateforme/server/catalog/contracts"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { proposedFunctions } from "../../packages/plateforme/server/context/hints"
import { functionCatalog } from "../../packages/plateforme/server/find"
import { MAX_RESULT_CHARS } from "../../packages/plateforme/server/tool-output"
import { FUNCTION_ROUTING_CASES } from "./function-routing.cases"

/** Les définitions de la bibliothèque : chaque module généré exporte son connecteur sous `connector`. */
function libraryConnectors(): ConnectorDefinition[] {
  return Object.values(connectorsLibrary).flatMap((module: unknown) =>
    typeof module === "object" && module !== null && "connector" in module
      ? // La bibliothèque déclare ses définitions au format de `ConnectorDefinition` (« Structural data only ») : le
        // paquet les valide à la déclaration, juste après.
        [module.connector as ConnectorDefinition]
      : [],
  )
}

/** Celles que cette version du paquet accepte, une à une : une définition refusée ne prive pas la mesure des autres. */
function accepted(definitions: readonly ConnectorDefinition[]): ConnectorDefinition[] {
  return definitions.filter((definition) => {
    try {
      registerConnectors([definition])
      return true
    } catch (error) {
      console.info(`function routing: ${definition.name} left out (${String(error)})`)
      return false
    }
  })
}

/** Les demandes directes que le classement manque aujourd'hui (dans les trois propositions), mesurées. */
const MISSED_DIRECT = [
  "cherche un record dans le CRM HubSpot",
  "crée une issue Linear",
  "crée une demande de signature Yousign depuis un template",
  "cherche une entreprise par son SIREN dans Sirene",
  "liste les conversations Crisp",
  "cherche un site SharePoint",
]

/**
 * Les négatives qui reçoivent une proposition aujourd'hui, au seuil de 0,40 : l'homographe « comment », « créer », formule
 * française déclarée par `team.create`, et une description de `fod` qui porte des mots français.
 */
const NOISY_NEGATIVES = ["bonjour, comment vas-tu ?", "quels sont nos horaires d'ouverture ?", "créer une tâche"]

const rate = (found: number, total: number) => `${found}/${total} (${((100 * found) / total).toFixed(1)} %)`

describe("function routing measure", () => {
  beforeAll(() => {
    registerConnectors(accepted(libraryConnectors()))
  })

  afterAll(() => {
    registerConnectors([])
  })

  it("should find the expected function among the three proposed for the direct requests, and measure paraphrases and negatives", () => {
    const functions = assistantFunctions()
    const verdicts = FUNCTION_ROUTING_CASES.map((one) => {
      const proposed = proposedFunctions(functions, one.phrase).map(({ name }) => name)
      return { ...one, rank: one.expected === null ? -1 : proposed.indexOf(one.expected), proposed }
    })
    const ofKind = (kind: string) => verdicts.filter((verdict) => verdict.kind === kind)
    const found = (kind: string) => ofKind(kind).filter((verdict) => verdict.rank >= 0).length
    const first = (kind: string) => ofKind(kind).filter((verdict) => verdict.rank === 0).length
    // Le bonus d'usage, borne haute : chaque fonction attendue appelée par la personne dans les 30 derniers jours.
    const used = new Set(FUNCTION_ROUTING_CASES.flatMap((one) => (one.expected === null ? [] : [one.expected])))
    const withUsage = ofKind("direct").filter((verdict) => verdict.expected !== null && proposedFunctions(functions, verdict.phrase, used).some(({ name }) => name === verdict.expected)).length
    // AC11 : le plan et la lecture du plus gros connecteur tiennent sous le plafond d'un résultat, données comprises.
    const outline = functionCatalog(functions, contractNames(), "acme")
    const counts = new Map<string, number>()
    for (const fn of functions) counts.set(fn.connector, (counts.get(fn.connector) ?? 0) + 1)
    const [biggest] = [...counts].sort((a, b) => b[1] - a[1])[0]
    const weight = (output: { text: string; data?: unknown }) => output.text.length + JSON.stringify(output.data ?? {}).length
    const weights = [weight(outline), weight(functionCatalog(functions, contractNames(), "acme", { section: biggest }))]
    console.info(
      [
        `function routing on ${functions.length} functions:`,
        `direct ${rate(found("direct"), ofKind("direct").length)} in the three, ${rate(first("direct"), ofKind("direct").length)} first;`,
        `with each expected function used lately, direct ${rate(withUsage, ofKind("direct").length)};`,
        `paraphrase ${rate(found("paraphrase"), ofKind("paraphrase").length)} in the three;`,
        `negative ${rate(ofKind("negative").filter((verdict) => verdict.proposed.length > 0).length, ofKind("negative").length)} with a proposal;`,
        `read path functions: outline ${weights[0]} characters, its biggest connector (${biggest}) ${weights[1]}.`,
      ].join(" "),
    )
    expect({
      missed: ofKind("direct").filter((verdict) => verdict.rank < 0).map((verdict) => verdict.phrase),
      noisy: ofKind("negative").filter((verdict) => verdict.proposed.length > 0).map((verdict) => verdict.phrase),
      // AC5 : la demande de la mise à jour d'un template Brevo, première proposée.
      brevo: verdicts.find((verdict) => verdict.phrase === "mets à jour mon template Brevo")?.rank,
      withinCeiling: weights.every((one) => one <= MAX_RESULT_CHARS),
    }).toEqual({ missed: MISSED_DIRECT, noisy: NOISY_NEGATIVES, brevo: 0, withinCeiling: true })
  })
})
