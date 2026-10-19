// La sonde dans la déclaration d'un connecteur décrit (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) :
// une lecture du connecteur sans argument requis, ses chemins à trouver non vides et, pour un compte payant, son solde
// (`balance`), contrôlés comme la règle 5 de la fabrique du dépôt `connectors`. Tenu à part de `declaration.ts`, qui
// l'appelle une fois les fonctions préparées.
import { isJsonObject } from "../json"
import type { ConnectorDefinition } from "./definition"

/** Un chemin pointé bien formé : des segments non vides, sans espace (`credits.remaining`, `accounts.0.balance`). */
const DOTTED_PATH = /^[^.\s]+(\.[^.\s]+)*$/

/**
 * Le solde d'une sonde (`balance`), comme la fabrique le contrôle : un chemin pointé, un seuil numérique positif ou nul,
 * une unité, et rien d'autre.
 */
function balanceProblem(name: string, balance: unknown): string | null {
  const keys = isJsonObject(balance) ? Object.keys(balance) : []
  if (
    !isJsonObject(balance) ||
    keys.some((key) => !["path", "min", "unit"].includes(key)) ||
    typeof balance.path !== "string" ||
    !DOTTED_PATH.test(balance.path) ||
    typeof balance.min !== "number" ||
    !Number.isFinite(balance.min) ||
    balance.min < 0 ||
    typeof balance.unit !== "string" ||
    balance.unit === ""
  ) {
    return `${name}: probe balance must give a dotted path, a min of zero or more and a unit, and nothing else.`
  }
  return null
}

/**
 * La sonde (`probe`) : une lecture du connecteur, sans argument requis, et des chemins à trouver non vides ; avec un
 * solde (`balance`), sa fonction ne déclare aucun coût, comme la règle 5 de la fabrique.
 */
export function probeProblem(definition: ConnectorDefinition): string | null {
  const probe = definition.probe
  if (probe === undefined) return null
  const fn = definition.functions.find((candidate) => candidate.name === probe.function)
  const required = fn && Array.isArray(fn.schema.required) ? fn.schema.required : []
  if (!fn || fn.class !== "read" || required.length > 0 || !Array.isArray(probe.nonEmpty) || probe.nonEmpty.some((path) => typeof path !== "string")) {
    return `${definition.name}: probe must name a read function of the connector without required arguments, and list nonEmpty paths.`
  }
  if (probe.balance === undefined) return null
  if (fn.cost !== undefined) return `${definition.name}: probe ${fn.name} reads a balance, so it must declare no cost: one never pays to learn whether one can pay.`
  return balanceProblem(definition.name, probe.balance)
}
