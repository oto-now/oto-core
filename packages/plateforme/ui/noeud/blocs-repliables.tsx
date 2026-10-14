// Les blocs d'une page lue (la page, la page publique) : un titre repliable tient sa section (`foldTree`), repliée
// dans une `SectionRepliable` ; les autres blocs restent à plat, rendus comme avant. Ni directive ni état : rendu par
// le serveur, qui passe `rendre`, il ne pose d'îlot client qu'autour d'une section repliable. Sans lui, chaque page
// regrouperait ses sections à sa façon.
import { Fragment, type ReactNode } from "react"
import type { BlockLike } from "../../schemas/blocks-render"
import { foldTree, type Fold } from "../../schemas/folds"
import { SectionRepliable } from "./plis-lus"

export function BlocsRepliables<B extends BlockLike & { id?: string }>({ blocs, rendre }: { blocs: readonly B[]; rendre: (bloc: B) => ReactNode }): ReactNode {
  const plis = (liste: readonly Fold<B>[]): ReactNode =>
    liste.map(({ block, section }, rang) =>
      section === undefined ? (
        <Fragment key={block.id ?? rang}>{rendre(block)}</Fragment>
      ) : (
        <SectionRepliable key={block.id ?? rang} id={block.id} titre={rendre(block)}>
          {plis(section)}
        </SectionRepliable>
      ),
    )
  return plis(foldTree(blocs))
}
