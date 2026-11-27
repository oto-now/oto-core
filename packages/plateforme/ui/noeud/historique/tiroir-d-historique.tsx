"use client"

// Le tiroir « Historique des versions » d'un contenu (maquette validée de la refonte, épic #216) : non modal, à droite ;
// dès 1 024 px, un panneau posé dans la piste de droite de l'écran, comme celui des commentaires (`place="panneau"`, monté
// par `ColonnesDuNoeud`), la page restant lisible et active à côté ; dessous, un `Drawer` non modal à droite, en bas et
// modal sur un téléphone. En tête, « Page » ou « Ce bloc » ; puis les versions publiées, de la plus récente à la plus
// ancienne (qui, quand, ce qui a changé ; le nom de la personne seul, même quand son assistant a écrit) ; sous la version
// choisie, l'aperçu de ce qui a changé ; au pied, « Revenir à cette version », confirmé en ligne, offert à qui écrit le
// contenu. Un tableau ne montre que les versions de son en-tête, ses lignes n'ayant pas d'historique. Les quatre états :
// chargement, échec avec « Réessayer », aucune version, données. Ouvert par l'en-tête (la page) ou par l'icône d'un bloc
// (`historique-du-noeud.tsx`).
import { useEffect, useId, useState } from "react"
import { X } from "@phosphor-icons/react/dist/csr/X"
import { Drawer } from "../../ds/react/drawer"
import { Icon } from "../../ds/react/icon"
import { IconButton } from "../../ds/react/primitives"
import { SegmentedControl, type Segment } from "../../ds/react/segmented-control"
import { BasDuTiroir } from "./bas-du-tiroir"
import { HISTORIQUE } from "./libelles"
import { ListeDesVersions } from "./liste-des-versions"
import { useVersions } from "./use-versions"

/** La page entière, ou un bloc publié (son identifiant). */
export type PorteeDuTiroir = "page" | { block: string }

export type TiroirDHistoriqueProps = {
  /** Le contenu ouvert : son chemin, que lisent les routes de l'historique, et son titre. */
  node: { chemin: string; titre: string }
  /** Ce que montre le tiroir à l'ouverture ; la personne passe ensuite de l'un à l'autre. */
  scope: PorteeDuTiroir
  open: boolean
  onClose: () => void
  /** `panneau` : dans la piste de droite de l'écran (dès 1 024 px), monté seulement ouvert ; `tiroir` par défaut. */
  place?: "tiroir" | "panneau"
}

function segments(bloc: string | undefined): Segment[] {
  return [
    { value: "page", label: HISTORIQUE.page },
    { value: "bloc", label: HISTORIQUE.bloc, disabled: bloc === undefined },
  ]
}

export function TiroirDHistorique({ node, scope, open, onClose, place = "tiroir" }: TiroirDHistoriqueProps) {
  const titreId = useId()
  const bloc = typeof scope === "object" ? scope.block : undefined
  const [portee, setPortee] = useState<"page" | "bloc">(bloc === undefined ? "page" : "bloc")
  const [choisie, setChoisie] = useState<number | null>(null)
  // Rouvert sur une autre portée (l'icône d'un autre bloc), le tiroir repart de celle demandée.
  useEffect(() => {
    setPortee(bloc === undefined ? "page" : "bloc")
    setChoisie(null)
  }, [bloc, open])
  const blocLu = portee === "bloc" ? bloc : undefined
  const { lecture, relire, plus } = useVersions(node.chemin, blocLu, open)
  const tableau = lecture.etat === "pret" && lecture.vue.kind === "table"
  const pied =
    lecture.etat === "pret" && !tableau && choisie !== null ? (
      <BasDuTiroir chemin={node.chemin} vue={lecture.vue} versions={lecture.versions} choisie={choisie} apres={relire} />
    ) : undefined
  const corps = (
    <div className="oto-history-stack">
      {!tableau && (
        <SegmentedControl
          block
          variant="neutral"
          label={HISTORIQUE.portee}
          options={segments(bloc)}
          value={portee}
          onChange={(valeur) => {
            setPortee(valeur === "bloc" ? "bloc" : "page")
            setChoisie(null)
          }}
        />
      )}
      <ListeDesVersions chemin={node.chemin} bloc={blocLu} lecture={lecture} choisie={choisie} choisir={setChoisie} relire={relire} plus={plus} />
      {tableau && <p className="oto-caption">{HISTORIQUE.lignesDuTableau}</p>}
    </div>
  )

  if (place === "panneau") {
    return (
      <section className="oto-history-panel" aria-labelledby={titreId}>
        <header className="oto-comments-panel-head">
          <h2 id={titreId} className="oto-section-title">
            {HISTORIQUE.titre}
          </h2>
          <IconButton label={HISTORIQUE.fermer} size="sm" onClick={onClose}>
            <Icon as={X} size="xs" />
          </IconButton>
        </header>
        {corps}
        {pied && <footer className="oto-history-panel-foot">{pied}</footer>}
      </section>
    )
  }
  return (
    <Drawer open={open} onClose={onClose} modal={false} side="right" title={HISTORIQUE.titre} closeLabel={HISTORIQUE.fermer} footer={pied}>
      {corps}
    </Drawer>
  )
}
