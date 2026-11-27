"use client"

// Le fil de l'écran de nœud (E05-S02, AC2 ; E05-S09, partie c1) : les maillons calculés par l'écran serveur
// (`fil.ts`) traduits en maillons du `Breadcrumb` du design system, chaque frère naviguant par l'hôte
// (`useHote`, sans recharger le document), comme le rail. Sans lui, le fil ne mène nulle part.
//
// Porté d'oto-frontend (`components/noeud/fil-du-noeud.tsx`) : la traduction frères → menus, le frère
// courant coché (`menuitemradio`), un frère sans destination affiché mais désactivé, `push` et non
// `replace`. Retiré : la coquille lue en cache (les frères arrivent avec la page), les destinations agent et
// exécution.
import { Breadcrumb, type Maillon } from "../ds/react/breadcrumb"
import type { MenuItem } from "../ds/react/overlays"
import { useHote } from "../hote/navigation"
import type { FrereDuFil, GlypheDuFil, MaillonDuFil } from "./fil"
import { GlypheDeNature, GlypheDePortee } from "./glyphes"

function Glyphe({ glyphe }: { glyphe: GlypheDuFil }) {
  return "nature" in glyphe ? <GlypheDeNature nature={glyphe.nature} /> : <GlypheDePortee portee={glyphe.portee} />
}

function menuDe(freres: readonly FrereDuFil[], naviguer: (adresse: string) => void): MenuItem[] {
  return freres.map((frere) => {
    const { href } = frere
    return {
      label: frere.libelle,
      icon: <Glyphe glyphe={frere.glyphe} />,
      radio: true,
      checked: frere.choisi,
      disabled: href === null,
      onSelect: href === null ? undefined : () => naviguer(href),
    }
  })
}

function maillonsDe(maillons: readonly MaillonDuFil[], naviguer: (adresse: string) => void): Maillon[] {
  // Sans glyphe dans le fil (refonte #216, maquette validée) : la couleur du thème n'y marque plus le maillon courant ;
  // les frères ouverts depuis un maillon gardent le leur.
  return maillons.map((maillon) => ({
    id: maillon.id,
    label: maillon.libelle,
    current: maillon.courant,
    menu: maillon.freres.length > 0 ? menuDe(maillon.freres, naviguer) : undefined,
  }))
}

export function FilDuNoeud({ maillons }: { maillons: MaillonDuFil[] }) {
  const { naviguer } = useHote()
  return <Breadcrumb label="Chemin" items={maillonsDe(maillons, naviguer)} />
}
