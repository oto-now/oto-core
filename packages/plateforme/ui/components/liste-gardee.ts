// Une liste de chaînes gardée dans CE navigateur (`localStorage`), une ligne par valeur : les plis du rail
// (`use-rail-folds.ts`) et les titres et menus dépliants ouverts d'une page (`plis-gardes.ts`). Un stockage refusé
// (navigation privée, données bloquées) rend une liste vide et n'écrit rien : l'écran garde son défaut.
const SEPARATEUR = "\n"

export function lireLaListe(cle: string): string[] {
  try {
    return (window.localStorage.getItem(cle) ?? "").split(SEPARATEUR).filter(Boolean)
  } catch {
    // Stockage indisponible : la liste est vide pour cette session.
    return []
  }
}

export function ecrireLaListe(cle: string, valeurs: readonly string[]): void {
  try {
    window.localStorage.setItem(cle, valeurs.join(SEPARATEUR))
  } catch {
    // La valeur vaut pour la session en cours ; elle ne survivra simplement pas au rechargement.
  }
}
