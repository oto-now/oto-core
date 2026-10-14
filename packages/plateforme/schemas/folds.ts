// Les plis d'une page à l'écran : les titres repliables (`isCollapsible`) et ce que chacun replie, sa section de
// `splitSections` (`blocks-render.ts`), sous-sections comprises. Fonctions pures, partagées par la lecture
// (`BlocsRepliables`) et l'éditeur (`plis-de-l-editeur.ts`) : sans elles, chacun redécouperait les sections à sa façon.
import { isCollapsible } from "./blocks"
import { headingOf, sectionEnd, type BlockLike } from "./blocks-render"

/** Un bloc lu à l'écran, et, sous un titre repliable, ce que sa section replie (`foldTree`). */
export type Fold<B extends BlockLike> = { block: B; section?: Fold<B>[] }

/**
 * Les blocs regroupés sous leurs titres repliables (`isCollapsible`) : chacun porte sa section de `splitSections`,
 * imbriquée ; les autres blocs restent à plat. Le rendu de la page replie une section sans changer celui des autres blocs.
 */
export function foldTree<B extends BlockLike>(blocks: readonly B[]): Fold<B>[] {
  const levels = blocks.map((block) => headingOf(block)?.level ?? null)
  const fold = (from: number, to: number): Fold<B>[] => {
    const folds: Fold<B>[] = []
    for (let index = from; index < to; ) {
      const block = blocks[index]
      const collapsible = levels[index] !== null && isCollapsible(block)
      const end = collapsible ? sectionEnd(levels, index) : index + 1
      folds.push(collapsible ? { block, section: fold(index + 1, end) } : { block })
      index = end
    }
    return folds
  }
  return fold(0, blocks.length)
}

/** Les blocs que cache un titre repliable fermé (`open` : faux), sous-sections comprises, par rang ; l'éditeur ne rend pas ceux-là. */
export function hiddenByFolds<B extends BlockLike>(blocks: readonly B[], open: (block: B, index: number) => boolean): boolean[] {
  const levels = blocks.map((block) => headingOf(block)?.level ?? null)
  const hidden = blocks.map(() => false)
  blocks.forEach((block, index) => {
    if (hidden[index] || levels[index] === null || !isCollapsible(block) || open(block, index)) return
    for (let at = index + 1; at < sectionEnd(levels, index); at++) hidden[at] = true
  })
  return hidden
}

/** Les rangs des titres repliables dont la section contient le bloc de rang `index`, du plus extérieur au plus proche. */
export function foldsAround<B extends BlockLike>(blocks: readonly B[], index: number): number[] {
  const levels = blocks.map((block) => headingOf(block)?.level ?? null)
  return blocks.flatMap((block, at) => (at < index && levels[at] !== null && isCollapsible(block) && index < sectionEnd(levels, at) ? [at] : []))
}
