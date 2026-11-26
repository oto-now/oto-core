// Ce que la personne peut appeler parmi des fonctions du catalogue (`routage-et-recherche.md` § Classement des fonctions) :
// une fonction sans compte requis (`needsAccount`), ou d'un connecteur dont elle sert un compte. Lu par `find` et par les
// propositions de `context`, qui mettent ces fonctions devant celles d'un connecteur à connecter (`usableFirst`). Sans ce
// module, une personne qui n'a branché que Brevo se voyait proposer d'abord des fonctions d'affinity, d'aircall ou d'allo
// (issue de test du 26/11/2026). La décision est celle des comptes (`accountLevels`), jamais celle de la RLS.
import { ACCOUNT_LEVELS, accountLevels, requiredAccountLevel, type AccountLevel } from "../access"
import type { CatalogFunction } from "../catalog/define"
import type { Missing } from "../catalog/ranking"
import { needsAccount } from "../catalog/registry"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"
import { accountRows } from "./accounts"

/**
 * Les connecteurs dont la personne peut servir au moins un compte, avec le meilleur niveau qu'elle y a, la règle de
 * `listUsableAccounts` pour tous à la fois : actif, visible (niveau lecture au moins : le sien, partagé avec elle,
 * d'équipe ou d'organisation), d'une personne encore membre. Deux lectures par appel, quel que soit le nombre de
 * connecteurs ou de fonctions : les comptes de l'organisation, puis leurs niveaux en un lot (`accountLevels`, une
 * transaction).
 */
export async function connectorsWithUsableAccount(db: PlatformDb, identity: Identity): Promise<Map<string, AccountLevel>> {
  const rows = await inTransaction(db, "connectorsWithUsableAccount: accounts", (sql) => accountRows(sql, identity.org.id))
  const live = rows.filter((row) => row.status === "active" && !row.owner_left)
  const levels = await accountLevels(db, identity, live.map((row) => row.id))
  const best = new Map<string, AccountLevel>()
  for (const row of live) {
    const level = levels.get(row.id) ?? ACCOUNT_LEVELS.none
    if (level >= ACCOUNT_LEVELS.read && level > (best.get(row.connector) ?? ACCOUNT_LEVELS.none)) best.set(row.connector, level)
  }
  return best
}

/**
 * Ce qui manque à la personne pour appeler chacune des fonctions à classer (`Missing`) : rien sans compte requis, ou
 * quand l'un de ses comptes du connecteur atteint le niveau que la classe de la fonction exige (`requiredAccountLevel`,
 * la règle de la résolution d'un appel) ; « connect » sans aucun compte, « access » sous ce niveau. `undefined` (rien ne
 * manque) sans fonction à compte parmi elles, sans aucune lecture, ou quand la lecture tombe en panne, dite au log sous
 * le nom du service : elle ne fait alors que ne plus départager.
 */
export async function usablePredicate(
  db: PlatformDb,
  identity: Identity,
  functions: readonly CatalogFunction[],
  service: string,
): Promise<((fn: CatalogFunction) => Missing) | undefined> {
  if (!functions.some(needsAccount)) return undefined
  try {
    const best = await connectorsWithUsableAccount(db, identity)
    return (fn) => {
      if (!needsAccount(fn)) return null
      const level = best.get(fn.connector)
      if (level === undefined) return "connect"
      return level >= requiredAccountLevel(fn.class) ? null : "access"
    }
  } catch (error) {
    console.error(`[platform] ${service}: usable accounts read failed`, error)
    return undefined
  }
}
