// Le chemin réservé de `read` qui liste les fonctions, dans un module feuille, sans import : `find.ts` relit le registre
// du catalogue, qui importe les fonctions de `call` ; une fonction qui lisait ce chemin par `find.ts` fermait un cycle, et
// le build d'un hôte levait « Cannot access … before initialization » quand `find.ts` ouvrait le graphe.

/** Le chemin réservé de `read` qui liste toutes les fonctions (E11-S19, AC-e3, HN-E11S19-8), comme `journal` (P22). */
export const FUNCTIONS_PATH = "functions"
