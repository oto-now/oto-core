"use client"

// « Les partages de … » : ce qu'une équipe partage hors d'elle, ce que d'autres équipes partagent avec elle, et les
// liens de ses contenus que ses membres ne peuvent pas ouvrir (`GET teams/<slug>/shares`, `server/team-shares.ts`). Une
// lecture : rien ne s'y règle ; chaque contenu est un lien vers sa page, où « Partager » le règle. Construit comme « Les
// personnes de … » : des sections empilées sous leur compte, une rangée par contenu, l'objet à gauche et sa précision
// au bout ; sur un écran étroit, la précision passe sous le titre. Ouvert par le « ⋯ » de la section de l'équipe, pour
// ses membres et qui administre. Sans lui, une équipe ne voit nulle part ce qu'elle partage.
import { LinkBreak } from "@phosphor-icons/react/dist/csr/LinkBreak"
import type { NodeKind, ShareLevel, ShareSubject, TeamShares } from "../../schemas"
import { natureDuGenre, titreDeContexte } from "../arbre/depuis-l-arbre"
import { LIEN } from "../components/classes"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import { NotePanel } from "../ds/react/note-panel"
import { cx } from "../ds/react/outils"
import { Button } from "../ds/react/primitives"
import { Row, RowList } from "../ds/react/row-list"
import { useHote } from "../hote/navigation"
import { GlypheDeNature } from "../noeud/glyphes"
import { NiveauLu } from "../noeud/partage-visuel"
import { PARTAGES_D_EQUIPE } from "./libelles"

const ANCRE = "equipe-partages"

/** Les niveaux, du plus bas au plus haut : l'ordre des groupes d'une rangée. */
const NIVEAUX: readonly ShareLevel[] = ["read", "write", "manage"]

/** Une rangée : sur un écran étroit, le titre puis sa précision dessous ; au-delà, une seule ligne. */
const RANGEE = "flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3"

/**
 * Sur un écran étroit, un lien prend la hauteur d'un doigt (44 px, règle du design system) : son texte s'y centre, pour
 * rester sur la ligne de son glyphe.
 */
const CIBLE_TACTILE = "max-sm:inline-flex max-sm:items-center"

/** La précision sous le titre, sur un écran étroit : en retrait de son glyphe. */
const SOUS_LE_TITRE = "max-sm:ps-6"

/** Le nom d'un sujet : une équipe ou une personne par son nom, toute l'organisation. */
const nomDe = (sujet: ShareSubject) => (sujet.kind === "org" ? PARTAGES_D_EQUIPE.organisation : sujet.name)

/** Avec qui un contenu est partagé, niveau par niveau : « avec Support, Ventes » puis la pastille du niveau. */
function AvecQui({ sujets }: { sujets: readonly ShareSubject[] }) {
  return NIVEAUX.flatMap((niveau) => {
    const noms = sujets.filter((sujet) => sujet.level === niveau).map(nomDe)
    if (noms.length === 0) return []
    return [
      <span key={niveau} className="flex items-center gap-1.5">
        {/* Au-delà de trois, le compte ; la liste entière au survol. */}
        <span className="oto-caption" title={noms.length > 3 ? noms.join(", ") : undefined}>
          {PARTAGES_D_EQUIPE.avec(noms)}
        </span>
        <NiveauLu niveau={niveau} />
      </span>,
    ]
  })
}

type Navigation = { prefixeDesPages: string }

/** Le titre d'un contenu ; le Contexte d'une équipe se nomme comme dans le rail (« Contexte · Support »). */
const titreDe = (contenu: { title: string; kind: NodeKind }, equipe: string) => (contenu.kind === "context" ? titreDeContexte(equipe) : contenu.title)

/** Un contenu, par son titre : le lien vers sa page. */
function VersLeContenu({ chemin, titre, prefixeDesPages }: Navigation & { chemin: string; titre: string }) {
  const { Lien } = useHote()
  return (
    <Lien href={`${prefixeDesPages}${chemin}`} className={cx(LIEN, CIBLE_TACTILE)}>
      {titre || chemin}
    </Lien>
  )
}

/** Le glyphe de son genre et le titre d'un contenu : la première ligne d'une rangée, seule sur un écran étroit. */
function Objet({ chemin, titre, genre, prefixeDesPages, large }: Navigation & { chemin: string; titre: string; genre: NodeKind; large?: boolean }) {
  return (
    <span className={cx("flex min-w-0 items-center gap-2", large && "sm:flex-1")}>
      <GlypheDeNature nature={natureDuGenre(genre)} />
      <VersLeContenu chemin={chemin} titre={titre} prefixeDesPages={prefixeDesPages} />
    </span>
  )
}

function LiensCasses({ partages, prefixeDesPages }: Navigation & { partages: TeamShares }) {
  const reste = partages.brokenTotal - partages.brokenLinks.length
  return (
    <NotePanel title={PARTAGES_D_EQUIPE.liensAVerifier(partages.brokenTotal)} icon={<AnimatedIcon as={LinkBreak} size="xs" />}>
      <p>{PARTAGES_D_EQUIPE.liensCasses(partages.brokenTotal, partages.team.name)}</p>
      <ul className="flex flex-col gap-1">
        {partages.brokenLinks.map((lien) => (
          <li key={`${lien.from.path}>${lien.to.path}`}>
            <VersLeContenu chemin={lien.from.path} titre={lien.from.title} prefixeDesPages={prefixeDesPages} />
            {PARTAGES_D_EQUIPE.meneA}
            {/* Le titre d'un contenu que la personne ne lit pas ne lui est pas servi : son chemin, écrit dans la page. */}
            {lien.to.title === null ? <span className="oto-code">{lien.to.path}</span> : <VersLeContenu chemin={lien.to.path} titre={lien.to.title} prefixeDesPages={prefixeDesPages} />}
          </li>
        ))}
      </ul>
      {reste > 0 && <p className="oto-caption">{PARTAGES_D_EQUIPE.etAutresLiens(reste)}</p>}
    </NotePanel>
  )
}

function Partages({ partages, prefixeDesPages }: Navigation & { partages: TeamShares }) {
  return (
    <section aria-labelledby={`${ANCRE}-partages`} className="flex flex-col gap-2">
      <h3 id={`${ANCRE}-partages`} className="oto-caption">
        {PARTAGES_D_EQUIPE.partages(partages.opened.length)}
      </h3>
      {partages.opened.length === 0 ? (
        <p className="oto-caption">{PARTAGES_D_EQUIPE.commentPartager}</p>
      ) : (
        <RowList className="flex flex-col gap-1" aria-label={PARTAGES_D_EQUIPE.listeDesPartages(partages.team.name)}>
          {partages.opened.map((contenu) => (
            <Row key={contenu.path}>
              <span className={RANGEE}>
                <Objet chemin={contenu.path} titre={titreDe(contenu, partages.team.name)} genre={contenu.kind} prefixeDesPages={prefixeDesPages} large />
                <span className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end", SOUS_LE_TITRE)}>
                  <AvecQui sujets={contenu.subjects} />
                </span>
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </section>
  )
}

function Recus({ partages, prefixeDesPages }: Navigation & { partages: TeamShares }) {
  const nombre = partages.received.reduce((somme, equipe) => somme + equipe.entries.length, 0)
  return (
    <section aria-labelledby={`${ANCRE}-recus`} className="flex flex-col gap-2">
      <h3 id={`${ANCRE}-recus`} className="oto-caption">
        {PARTAGES_D_EQUIPE.recus(nombre)}
      </h3>
      {nombre > 0 && (
        <RowList className="flex flex-col gap-1" aria-label={PARTAGES_D_EQUIPE.listeDesRecus(partages.team.name)}>
          {partages.received.flatMap((equipe) =>
            equipe.entries.map((entree) => (
              <Row key={entree.path}>
                <span className={RANGEE}>
                  <Objet chemin={entree.path} titre={titreDe(entree, equipe.team.name)} genre={entree.kind} prefixeDesPages={prefixeDesPages} />
                  {/* Sur un écran large, le compte reste collé au titre et l'équipe va au bout ; étroit, les deux sous le titre. */}
                  <span className={cx("flex items-center gap-1.5 sm:flex-1", entree.under === 0 && "sm:justify-end", SOUS_LE_TITRE)}>
                    {entree.under > 0 && <span className="oto-caption sm:flex-1">{PARTAGES_D_EQUIPE.dessous(entree.under)}</span>}
                    {entree.under > 0 && (
                      <span className="oto-caption sm:hidden" aria-hidden="true">
                        ·
                      </span>
                    )}
                    <span className="oto-caption">{PARTAGES_D_EQUIPE.de(equipe.team.name)}</span>
                  </span>
                </span>
              </Row>
            )),
          )}
        </RowList>
      )}
    </section>
  )
}

export type PartagesDeLEquipeProps = Navigation & { partages: TeamShares; onFermer: () => void }

export function PartagesDeLEquipe({ partages, prefixeDesPages, onFermer }: PartagesDeLEquipeProps) {
  return (
    <Dialog
      open
      onClose={onFermer}
      title={PARTAGES_D_EQUIPE.titre(partages.team.name)}
      description={PARTAGES_D_EQUIPE.explication}
      size="xl"
      footer={
        <Button variant="secondary" onClick={onFermer}>
          {PARTAGES_D_EQUIPE.fermer}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {partages.brokenTotal > 0 && <LiensCasses partages={partages} prefixeDesPages={prefixeDesPages} />}
        <Partages partages={partages} prefixeDesPages={prefixeDesPages} />
        <Recus partages={partages} prefixeDesPages={prefixeDesPages} />
      </div>
    </Dialog>
  )
}
