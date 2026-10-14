// Les avertissements d'une procédure publiée (1.4.3) : ce qui la fait mal suivre sans la rendre invalide, dit dans la
// réponse de la publication, jamais refusé (le guide de la plateforme, section procedures, en donne les règles). Une
// procédure sans partie « Quand l'utiliser » se sert à tort ; une procédure qui nomme ses outils avec le préfixe d'une
// organisation devient fausse copiée dans une autre. Sans lui, ces deux défauts ne se voyaient qu'à l'usage.
import type { DocBlock } from "./nodes/document"
import { toolPrefixesIn } from "./transfer/links"

/** Les avertissements des blocs d'une procédure publiée ; vide quand rien n'est à redire. */
export function procedureAdvice(blocks: readonly Pick<DocBlock, "type" | "text">[]): string[] {
  const headings = blocks.filter((block) => block.type === "heading").map((block) => (block.text ?? "").toLowerCase())
  const when = headings.some((heading) => heading.includes("quand") || heading.includes("when"))
  const prefixes = toolPrefixesIn(blocks.flatMap((block) => (block.text ? [block.text] : [])).join("\n"))
  return [
    ...(when ? [] : ["Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures)."]),
    ...(prefixes.length === 0 ? [] : [`Procedure: tools named with an organisation prefix (${prefixes[0]}_…): write read, write, find, call without prefix, so the text stays right in another organisation.`]),
  ]
}
