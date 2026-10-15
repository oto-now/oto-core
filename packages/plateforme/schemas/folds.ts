// Les plis d'une page à l'écran : chaque titre replie sa section de `splitSections` (`blocks-render.ts`), sous-sections
// comprises. Fonctions pures, partagées par la lecture (`BlocsRepliables`) et l'éditeur (`plis-de-l-editeur.ts`) : sans
// elles, chacun redécouperait les sections à sa façon.
import { headingOf, sectionEnd, type BlockLike } from "./blocks-render"

/** Un bloc lu à l'écran, et, sous un titre, ce que sa section replie (`foldTree`). */
export type Fold<B extends BlockLike> = { block: B; section?: Fold<B>[] }

const levelsOf = (blocks: readonly BlockLike[]) => blocks.map((block) => headingOf(block)?.level ?? null)

/**
 * Les blocs regroupés sous leurs titres : chacun porte sa section de `splitSections`, imbriquée ; les blocs d'avant le
 * premier titre restent à plat. Le rendu de la page replie une section sans changer celui des autres blocs.
 */
export function foldTree<B extends BlockLike>(blocks: readonly B[]): Fold<B>[] {
  const levels = levelsOf(blocks)
  const fold = (from: number, to: number): Fold<B>[] => {
    const folds: Fold<B>[] = []
    for (let index = from; index < to; ) {
      const block = blocks[index]
      const end = levels[index] !== null ? sectionEnd(levels, index) : index + 1
      folds.push(levels[index] !== null ? { block, section: fold(index + 1, end) } : { block })
      index = end
    }
    return folds
  }
  return fold(0, blocks.length)
}

/** Les blocs que cache un titre replié (`open` : faux), sous-sections comprises, par rang ; l'éditeur ne montre pas ceux-là. */
export function hiddenByFolds<B extends BlockLike>(blocks: readonly B[], open: (block: B, index: number) => boolean): boolean[] {
  const levels = levelsOf(blocks)
  const hidden = blocks.map(() => false)
  blocks.forEach((block, index) => {
    if (hidden[index] || levels[index] === null || open(block, index)) return
    for (let at = index + 1; at < sectionEnd(levels, index); at++) hidden[at] = true
  })
  return hidden
}

/** Les rangs des titres dont la section contient le bloc de rang `index`, du plus extérieur au plus proche. */
export function foldsAround<B extends BlockLike>(blocks: readonly B[], index: number): number[] {
  const levels = levelsOf(blocks)
  return blocks.flatMap((_, at) => (at < index && levels[at] !== null && index < sectionEnd(levels, at) ? [at] : []))
}
