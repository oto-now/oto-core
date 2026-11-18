// Mode d'un compte de connecteur (H85) tel que le modèle le lit, les connecteurs simulés et la garde du simulé.
// Fichier à part : la ligne du bloc `team` (`lines.ts`), `call` et le connecteur `mail` simulé en ont besoin, et
// `simulated/mail.ts`, importé par le catalogue, ne peut dépendre des services qui lisent le catalogue (l'import
// serait circulaire).
import type { AccountMode } from "../../schemas"
import { PlatformError } from "../errors"

/** simule → simulated, sandbox → sandbox, reel → live (N8). */
const MODE_LABELS: Record<AccountMode, string> = { simule: "simulated", sandbox: "sandbox", reel: "live" }

/** Mode lu en base (colonne texte sous contrainte `check`) ; une valeur inconnue compte comme réelle. */
export function accountMode(value: string): AccountMode {
  return value === "simule" || value === "sandbox" ? value : "reel"
}

export function modeLabel(mode: AccountMode): string {
  return MODE_LABELS[mode]
}

/**
 * Les connecteurs simulés du paquet (H85) : leurs comptes sont simulés, et eux seuls ; tout autre connecteur est réel
 * et ne court que sur un compte réel, son secret déchiffré à l'appel (`runCall`).
 */
const SIMULATED_CONNECTORS: ReadonlySet<string> = new Set(["mail"])

export function isSimulatedConnector(connector: string): boolean {
  return SIMULATED_CONNECTORS.has(connector)
}

/**
 * Les modes qu'un compte du connecteur admet à la création (H85) : `simule` pour un connecteur simulé, `reel` pour un
 * connecteur réel (son secret se pose ensuite, `setAccountSecret`) ; `sandbox` n'est pas encore admis. Servi à l'écran
 * (`OrgConnector.accountModes`) et appliqué par la création d'un compte (`requireCreatableMode`).
 */
export function creatableModes(connector: string): AccountMode[] {
  return isSimulatedConnector(connector) ? ["simule"] : ["reel"]
}

/**
 * Un connecteur simulé ne court que sur un compte simulé (H85) : un compte réel ou de bac à sable, posé par
 * l'outillage, est refusé avant toute écriture (E03-S04, AC12).
 */
export function requireSimulated(account: { label: string; mode: AccountMode }): void {
  if (account.mode === "simule") return
  throw new PlatformError(
    "unavailable_in_v1",
    `Account « ${account.label} » is a ${modeLabel(account.mode)} account (mode ${account.mode}): this connector is simulated in this version and runs on simulated accounts only. Nothing was sent.`,
  )
}
