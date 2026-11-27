// « Ce que votre assistant peut faire » d'un outil (écran Connecteurs) : ses fonctions en trois groupes, « Lire »,
// « Créer et modifier » et « Avec votre accord » (les seules fonctions sensibles, que l'assistant confirme en deux
// temps), une ligne repliable par groupe avec son nombre, la liste de ses fonctions dépliée. Lue par la fiche d'ajout et
// par le détail d'un connecteur : sans elle, chacun recomposait ses groupes. Module sans « use client », sans état (le
// pli est celui de `<details>`) : le détail, rendu par le serveur, et la fenêtre d'ajout, cliente, le montent tous deux.
import type { ReactNode } from "react"
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye"
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple"
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck"
import type { AccountLevelName, OrgConnector } from "../../../schemas"
import { Icon, type Glyphe } from "../../ds/react/icon"
import { fonctions as nombreDeFonctions } from "./libelles-des-partages"

type Classe = OrgConnector["functions"][number]["class"]

/** Les trois groupes, dans l'ordre des niveaux du partage qui les ouvrent ; le même glyphe que la pastille du niveau. */
const GROUPES: readonly { classe: Classe; titre: string; glyphe: Glyphe; avant?: string }[] = [
  { classe: "read", titre: "Lire", glyphe: Eye },
  { classe: "write", titre: "Créer et modifier", glyphe: PencilSimple },
  { classe: "sensitive", titre: "Avec votre accord", glyphe: ShieldCheck, avant: "il vous demande avant" },
]

/** Les classes qu'un niveau ouvre, cumulatives : « Lire » n'ouvre que la lecture, la gestion tout. */
export function classesDuNiveau(niveau: Exclude<AccountLevelName, "none">): Classe[] {
  if (niveau === "read") return ["read"]
  if (niveau === "write") return ["read", "write"]
  return ["read", "write", "sensitive"]
}

function Groupe({ titre, glyphe, avant, noms }: { titre: string; glyphe: Glyphe; avant?: string; noms: string[] }) {
  const nombre = nombreDeFonctions(noms.length)
  return (
    <li>
      <details className="oto-accordion-item">
        <summary aria-label={`${titre}${avant ? `, ${avant}` : ""}. ${nombre}, afficher la liste`} className="oto-accordion-trigger focus-visible:ring-2 focus-visible:ring-ink">
          <Icon as={glyphe} size="sm" />
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            {titre}
            {avant && <span className="oto-caption">{avant}</span>}
          </span>
          <span className="oto-caption flex-none">{nombre}</span>
          <Icon as={CaretDown} size="xs" className="oto-accordion-chevron" />
        </summary>
        {/* Sous le titre, au-delà du glyphe (16 px) et de l'écart du déclencheur (10 px). */}
        <ul className="oto-accordion-body flex flex-col gap-1 pl-6.5">
          {noms.map((nom) => (
            <li key={nom} className="font-mono text-ink">
              {nom}
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

type FonctionsDuConnecteurProps = {
  /** Le titre de la section : « Ce que votre assistant pourra faire » dans la fiche d'ajout, « peut faire » au détail. */
  titre: string
  fonctions: OrgConnector["functions"]
  /** Les classes ouvertes à la personne (`classesDuNiveau`) ; toutes par défaut. */
  classes?: readonly Classe[]
  /** Ce qui suit les groupes, dans la section (le niveau de qui reçoit le connecteur en partage). */
  pied?: ReactNode
}

export function FonctionsDuConnecteur({ titre, fonctions, classes = ["read", "write", "sensitive"], pied }: FonctionsDuConnecteurProps) {
  const groupes = GROUPES.filter(({ classe }) => classes.includes(classe))
    .map((groupe) => ({ ...groupe, noms: fonctions.filter((fonction) => fonction.class === groupe.classe).map((fonction) => fonction.name) }))
    .filter(({ noms }) => noms.length > 0)
  return (
    <section className="flex flex-col gap-3">
      <h3 className="oto-section-title">{titre}</h3>
      {groupes.length === 0 ? (
        <p className="oto-caption">Les fonctions de cet outil ne sont pas décrites dans cette version de la plateforme.</p>
      ) : (
        <ul className="oto-accordion">
          {groupes.map(({ classe, titre: libelle, glyphe, avant, noms }) => (
            <Groupe key={classe} titre={libelle} glyphe={glyphe} avant={avant} noms={noms} />
          ))}
        </ul>
      )}
      {pied}
    </section>
  )
}
