"use client"

// Les tableaux par équipe et par personne de l'onglet Statistiques (1.4.13) : le `Table` du design system, triable par
// colonne au clic de l'en-tête (`aria-sort`), le tri fait ici sur les lignes déjà servies, sans relire la page. Les lignes
// sont des données et des adresses calculées par la page (`portage-ecrans.md § 2`) ; dates et nombres mis en forme ici.
// Sans eux, ni le taux d'usage d'une équipe ni la personne inactive ne se voyaient.
import { useState } from "react"
import { INACTIVE_DAYS, type UsagePersonRow, type UsageTeamRow } from "../../../schemas"
import { Badge } from "../../ds/react/primitives"
import { Table, type Column, type TableSort } from "../../ds/react/table"
import { dateLisible } from "../../format/dates"
import { nombreLisible, tauxLisible } from "../../format/nombres"
import { useHote } from "../../hote/navigation"
import { ABSENT } from "../../journal/libelles"

/** Une équipe telle que le tableau la montre : la ligne du service et l'adresse de sa procédure la plus servie. */
export type LigneDEquipe = UsageTeamRow & { hrefDeLaProcedure: string | null }

type Valeur = number | string | null

/** Les lignes dans l'ordre du tri : une valeur absente en dernier, quel que soit le sens. */
function trier<T>(lignes: readonly T[], tri: TableSort | undefined, valeurs: Readonly<Record<string, (ligne: T) => Valeur>>): T[] {
  const valeur = tri ? valeurs[tri.key] : undefined
  if (!tri || !valeur) return [...lignes]
  const sens = tri.dir === "asc" ? 1 : -1
  return [...lignes].sort((a, b) => {
    const [x, y] = [valeur(a), valeur(b)]
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr")) * sens
  })
}

const date = (iso: string | null) => (iso ? (dateLisible(iso) ?? ABSENT) : ABSENT)
const instant = (iso: string | null) => (iso ? Date.parse(iso) : null)

function ProcedureLaPlusServie({ ligne }: { ligne: LigneDEquipe }) {
  const { Lien } = useHote()
  if (!ligne.topProcedure || !ligne.hrefDeLaProcedure) return ABSENT
  return (
    <Lien href={ligne.hrefDeLaProcedure} className="underline underline-offset-2">
      {ligne.topProcedure.title}
    </Lien>
  )
}

const COLONNES_DES_EQUIPES: Column<LigneDEquipe>[] = [
  { key: "name", header: "Équipe", primary: true, sortable: true, render: (ligne) => ligne.name },
  { key: "members", header: "Membres", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.members) },
  { key: "activeMembers", header: "Actifs", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.activeMembers) },
  { key: "usage", header: "Taux d'usage", numeric: true, sortable: true, render: (ligne) => tauxLisible(ligne.activeMembers, ligne.members) ?? ABSENT },
  { key: "conversations", header: "Conversations", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.conversations) },
  { key: "calls", header: "Appels", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.calls) },
  { key: "pages", header: "Pages écrites", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.pages) },
  { key: "proceduresServed", header: "Procédures servies", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.proceduresServed) },
  { key: "topProcedure", header: "La plus servie", sortable: true, render: (ligne) => <ProcedureLaPlusServie ligne={ligne} /> },
  { key: "lastActivity", header: "Dernière activité", sortable: true, render: (ligne) => date(ligne.lastActivity) },
]

const VALEURS_DES_EQUIPES: Record<string, (ligne: LigneDEquipe) => Valeur> = {
  name: (ligne) => ligne.name,
  members: (ligne) => ligne.members,
  activeMembers: (ligne) => ligne.activeMembers,
  usage: (ligne) => (ligne.members === 0 ? null : ligne.activeMembers / ligne.members),
  conversations: (ligne) => ligne.conversations,
  calls: (ligne) => ligne.calls,
  pages: (ligne) => ligne.pages,
  proceduresServed: (ligne) => ligne.proceduresServed,
  topProcedure: (ligne) => ligne.topProcedure?.title ?? null,
  lastActivity: (ligne) => instant(ligne.lastActivity),
}

export function TableauDesEquipesActives({ lignes }: { lignes: LigneDEquipe[] }) {
  const [tri, setTri] = useState<TableSort | undefined>({ key: "conversations", dir: "desc" })
  return (
    <Table<LigneDEquipe>
      caption="Activité par équipe"
      responsive="scroll"
      columns={COLONNES_DES_EQUIPES}
      rows={trier(lignes, tri, VALEURS_DES_EQUIPES)}
      getRowId={(ligne) => ligne.id}
      sort={tri}
      onSortChange={setTri}
    />
  )
}

/** « Jamais connecté » et « Inactif depuis 30 j » (`INACTIVE_DAYS`) : le mot et la teinte, jamais la teinte seule. */
function Etiquettes({ ligne }: { ligne: UsagePersonRow }) {
  if (ligne.neverSignedIn) return <Badge tone="review">Jamais connecté</Badge>
  if (ligne.inactive) return <Badge tone="idle">{`Inactif depuis ${INACTIVE_DAYS} j`}</Badge>
  return null
}

function NomDeLaPersonne({ ligne }: { ligne: UsagePersonRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{ligne.name}</span>
      <Etiquettes ligne={ligne} />
    </span>
  )
}

const COLONNES_DES_PERSONNES: Column<UsagePersonRow>[] = [
  { key: "name", header: "Personne", primary: true, sortable: true, render: (ligne) => <NomDeLaPersonne ligne={ligne} /> },
  { key: "teams", header: "Équipes", sortable: true, render: (ligne) => (ligne.teams.length > 0 ? ligne.teams.join(", ") : ABSENT) },
  { key: "lastSignInAt", header: "Dernière connexion", sortable: true, render: (ligne) => date(ligne.lastSignInAt) },
  { key: "lastAssistantUse", header: "Dernier usage d'un assistant", sortable: true, render: (ligne) => date(ligne.lastAssistantUse) },
  { key: "conversations", header: "Conversations", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.conversations) },
  { key: "calls", header: "Appels", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.calls) },
  { key: "pagesByHand", header: "Pages à la main", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.pagesByHand) },
  { key: "pagesByAssistant", header: "Pages par l'assistant", numeric: true, sortable: true, render: (ligne) => nombreLisible(ligne.pagesByAssistant) },
  { key: "assistant", header: "Assistant", sortable: true, render: (ligne) => ligne.assistant ?? ABSENT },
]

const VALEURS_DES_PERSONNES: Record<string, (ligne: UsagePersonRow) => Valeur> = {
  name: (ligne) => ligne.name,
  teams: (ligne) => (ligne.teams.length > 0 ? ligne.teams.join(", ") : null),
  lastSignInAt: (ligne) => instant(ligne.lastSignInAt),
  lastAssistantUse: (ligne) => instant(ligne.lastAssistantUse),
  conversations: (ligne) => ligne.conversations,
  calls: (ligne) => ligne.calls,
  pagesByHand: (ligne) => ligne.pagesByHand,
  pagesByAssistant: (ligne) => ligne.pagesByAssistant,
  assistant: (ligne) => ligne.assistant,
}

export function TableauDesPersonnes({ lignes }: { lignes: UsagePersonRow[] }) {
  const [tri, setTri] = useState<TableSort | undefined>({ key: "name", dir: "asc" })
  return (
    <Table<UsagePersonRow>
      caption="Activité par personne"
      responsive="scroll"
      columns={COLONNES_DES_PERSONNES}
      rows={trier(lignes, tri, VALEURS_DES_PERSONNES)}
      getRowId={(ligne) => ligne.userId}
      sort={tri}
      onSortChange={setTri}
    />
  )
}
