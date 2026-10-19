// Les mots courants de la pseudonymisation (`pseudonymisation.md` § Le dictionnaire et la détection) : un nom de famille
// seul qui est un mot commun ou un prénom courant reste en clair, faute de quoi la porte masquerait « Brun » dans « un
// manteau brun » ou « Martin » prénom d'une autre personne. Deux listes générées par `scripts/mots-courants.mjs`, chacune
// sous sa licence (`words/`), lues une fois, au premier nom seul.
import { COMMON_WORDS } from "./words/common-words"
import { FIRST_NAMES } from "./words/first-names"

let common: ReadonlySet<string> | null = null

/** Vrai si la forme normalisée `form` est un mot commun ou un prénom courant. */
export function isCommonWord(form: string): boolean {
  common ??= new Set([...COMMON_WORDS.split(" "), ...FIRST_NAMES.split(" ")])
  return common.has(form)
}
