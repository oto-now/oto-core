// Un assistant ne laisse plus de brouillon : `publish: false` reçu à une porte d'assistant (`write` du MCP,
// `node.write_many`, `upload.link`) est retiré avant le service, et la réponse le dit. Un brouillon d'assistant n'est
// trouvé par aucune recherche et ne se commente pas, et la frappe suivante de n'importe qui le publiait entier ; pour
// proposer sans modifier, un assistant commente. Le service garde l'option : l'écran (sa file d'opérations), l'import
// d'une arborescence et le dépôt par lien écrivent en deux temps. Module feuille, sans import : les fonctions du
// catalogue le lisent sans cycle par le registre (`coding-standards.md § Imports`).

/** La ligne ajoutée à la réponse d'un appel qui demandait `publish: false`. */
export function publishedAnywayLine(prefix: string): string {
  return `publish: false is no longer supported: everything written is published at once. To suggest a change without editing, comment with ${prefix}_call comment.add.`
}

/** L'entrée sans son `publish: false`, et s'il y était ; toute autre valeur, `publish: true` comprise, passe telle quelle. */
export function withoutDraftRequest<T extends { publish?: boolean | undefined }>(input: T): { input: T; asked: boolean } {
  if (input.publish !== false) return { input, asked: false }
  return { input: { ...input, publish: undefined }, asked: true }
}

/** Un résultat qui dit que `publish: false` n'a pas été suivi. */
export function sayingPublished<T extends { text: string }>(output: T, prefix: string): T {
  return { ...output, text: `${output.text}\n${publishedAnywayLine(prefix)}` }
}
