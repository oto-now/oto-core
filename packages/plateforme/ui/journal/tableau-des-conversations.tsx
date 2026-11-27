"use client"

// Le tableau des conversations du journal (E05-S05, AC3, AC14 ; porté par E05-S09 partie d1). Porté
// d'oto-frontend (`journal-des-appels.tsx`, `deroules-du-suivi.tsx`) : le `Table` du design system, nommé par
// sa légende, qui défile sous 768 px ; la date, la personne, puis ce que la ligne a fait ; l'issue en badge,
// le mot et la teinte, jamais la teinte seule ; « Ouvrir », un lien et non une ligne cliquable, qui ouvre le
// détail par l'adresse. Changé : une ligne par conversation (un code `ctx`, H27), sa procédure servie ou sa
// demande, ses appels et ses erreurs ; les liens sont ceux de l'hôte (`useHote().Lien`), leurs adresses
// calculées par la page. Retiré : les clés des arguments et la durée (au détail), `run_id`.
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { LIEN } from "../components/classes"
import { Icon } from "../ds/react/icon"
import { Badge } from "../ds/react/primitives"
import { Table, type Column } from "../ds/react/table"
import { useHote } from "../hote/navigation"
import { erreurs, TITRE_DE_LA_LISTE } from "./libelles"

/** Une conversation telle que le tableau la montre, ses textes et ses adresses calculés par la page. */
export type LigneDeConversation = {
  ctx: string
  debut: string
  personne: string
  hote: string
  /** La procédure servie et l'adresse de sa page ; sinon, `servie` dit la demande ou son absence. */
  procedure: { chemin: string; href: string } | null
  servie: string
  appels: number
  erreurs: number
  /** L'adresse qui ouvre la conversation, filtres gardés. */
  ouverture: string
}

function ProcedureServie({ ligne }: { ligne: LigneDeConversation }) {
  const { Lien } = useHote()
  if (!ligne.procedure) return ligne.servie
  return (
    <Lien href={ligne.procedure.href} className={LIEN}>
      {ligne.procedure.chemin}
    </Lien>
  )
}

function Ouvrir({ ligne }: { ligne: LigneDeConversation }) {
  const { Lien } = useHote()
  return (
    <Lien href={ligne.ouverture} className="oto-btn anim-host" data-variant="ghost" data-size="sm">
      {/* Le code dans le nom accessible : cinquante liens « Ouvrir » se distinguent au lecteur d'écran. */}
      <span>
        Ouvrir<span className="oto-sr-only">{` la conversation ${ligne.ctx}`}</span>
      </span>
    </Lien>
  )
}

const COLONNES: Column<LigneDeConversation>[] = [
  { key: "debut", header: "Début", primary: true, render: (ligne) => ligne.debut },
  { key: "personne", header: "Personne", render: (ligne) => ligne.personne },
  { key: "hote", header: "Hôte", render: (ligne) => ligne.hote },
  { key: "procedure", header: "Procédure servie", render: (ligne) => <ProcedureServie ligne={ligne} /> },
  { key: "appels", header: "Appels", numeric: true, render: (ligne) => ligne.appels },
  {
    key: "erreurs",
    header: "Erreurs",
    render: (ligne) =>
      ligne.erreurs === 0 ? (
        <Badge tone="ok">Aucune</Badge>
      ) : (
        // Le texte d'un `Badge` s'ellipse, et sa largeur minimale n'en tient pas compte : sans `min-w-max`, la
        // colonne se serrait en « 1 e… » quand le tableau déborde de son cadre (contrôle visuel à 1 280 px).
        <Badge tone="fail" className="min-w-max" icon={<Icon as={WarningCircle} size="xs" />}>
          {erreurs(ligne.erreurs)}
        </Badge>
      ),
  },
  { key: "detail", header: "Détail", align: "end", render: (ligne) => <Ouvrir ligne={ligne} /> },
]

export function TableauDesConversations({ lignes }: { lignes: LigneDeConversation[] }) {
  return <Table<LigneDeConversation> caption={TITRE_DE_LA_LISTE} responsive="scroll" columns={COLONNES} rows={lignes} getRowId={(ligne) => ligne.ctx} />
}
