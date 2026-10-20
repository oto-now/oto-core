// « Retours des assistants » (E08-S09 : AC9, AC10, AC15) : les tickets `feedback` de l'organisation,
// comptés par état, filtrés par l'adresse, et les gestes qui changent leur état après recoupement avec
// le journal (lien « Voir la conversation »). Server Component : la fenêtre et les filtres sont des îlots
// client qui changent l'adresse ; les gestes sont des îlots client, `ActionPlateforme` d'E05-S03 et le
// formulaire de refus.
//
// Porté d'oto-frontend (`signaux-du-suivi.tsx` l. 104-167, `suivi-de-lentreprise.tsx`,
// `fenetre-du-suivi.tsx`), E05-S09 partie d2. Repris : l'en-tête, sa méta (les comptes) et la fenêtre dans ses
// actions, un îlot pour la liste, les filtres en `SegmentedControl` sur sa barre d'outils, la table du design
// system, le corps du retour rendu (la cause est dans la prose), la colonne de réponse, l'état vide qui ne
// dit pas « rien ne manque ». Changé : l'état et le type filtrent par l'adresse (liens d'E08-S09 devenus des
// choix segmentés) ; « Voir les suivants » pagine. Retiré : manques agrégés par intention (→ conversations
// sans procédure, écran Usage), verdicts d'outil, `resolved_by` caché (ici « Traité par » est montré),
// TanStack Query. 1.4.13 : une organisation qui n'affiche pas ses retours le voit dit, et les affiche sur place.
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr/ChatCircleText"
import {
  feedbackTypeSchema,
  JOURNAL_PERIODS,
  type FeedbackList,
  type FeedbackListQuery,
  type FeedbackState,
  type FeedbackTicketView,
  type UsagePeriod,
} from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ActionPlateforme } from "../../components/action-plateforme"
import { EmptyState } from "../../ds/react/empty-state"
import { Badge } from "../../ds/react/primitives"
import { dateEtHeureLisibles, dateLisible } from "../../format/dates"
import { ABSENT, PERSONNE_RETIREE } from "../../journal/libelles"
import { EnTeteDAdministration } from "../en-tete"
import { FiltreSegmente } from "../filtre-segmente"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Chargement, Ilot } from "../ilot"
import { LienDeCellule, TableServeur } from "../../components/table-serveur"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { AUCUN_RETOUR, AUCUN_RETOUR_FILTRE, comptes, ETATS, FILTRES_D_ETAT, MESSAGES_DU_RETOUR, TONS, TYPES } from "./libelles"
import { RefusDuRetour } from "./refus-du-retour"
import { RetoursMasques } from "./retours-masques"

export type EcranRetoursProps = {
  /**
   * La liste lue, ou `{ masques: true }` (1.4.13) : l'administrateur d'une organisation qui n'affiche pas ses retours,
   * à qui l'écran propose de les afficher.
   */
  resultat: Resultat<FeedbackList> | { masques: true; data?: never; error?: never }
  /** Les paramètres de l'adresse, lus par `feedbackListQuerySchema`. */
  filtres: FeedbackListQuery
  Lien: LienDeLAdministration
  /** L'adresse de l'écran pour ces paramètres ; un paramètre absent n'y est pas écrit. */
  hrefDeFiltre: (parametres: FeedbackListQuery) => string
  /** La conversation du ticket dans l'écran Journal de l'hôte (E05-S05). */
  hrefDeConversation: (code: string, periode: UsagePeriod) => string
  /** Le fil de l'en-tête : les adresses que l'hôte donne au rail et le droit de la personne ; sans lui, pas de fil. */
  fil?: FilDeLEcran
}

/** Le titre de la liste : le focus y va quand un geste part avec la relecture. */
const ANCRE_DES_RETOURS = "retours-liste"
/** Au-delà, le texte d'un retour se lit dans un `<details>` (AC9). */
const APERCU = 200
/** Le choix « tous les types », qui retire le paramètre de l'adresse. */
const TOUS_LES_TYPES = "tous"

type GesteDEtat = Exclude<FeedbackState, "declined">

/** Les gestes selon l'état (AC10) ; « Décliner », qui demande un motif, a son formulaire. */
const GESTES: Record<FeedbackState, readonly FeedbackState[]> = {
  open: ["acknowledged", "resolved", "declined"],
  acknowledged: ["resolved", "declined", "open"],
  resolved: ["open"],
  declined: ["open"],
}

const LIBELLES_DES_GESTES: Record<GesteDEtat, string> = { acknowledged: "Prendre en compte", resolved: "Résoudre", open: "Rouvrir" }

const COLONNES = ["Ticket", "Quand", "Personne", "Type", "À propos de", "Ce qui a été écrit", "État", "Réponse", "Traité par", "Conversation", "Traiter"].map(
  (entete) => ({ entete }),
)

/** Un texte long d'une cellule : il va à la ligne, dans sa mesure ; les cellules du design system ne se coupent pas. */
const PROSE = "block max-w-md whitespace-normal"

/** Le texte du retour ; au-delà de 200 caractères, un aperçu puis « Lire tout » (compté par point de code). */
function Texte({ texte }: { texte: string }) {
  const points = Array.from(texte)
  if (points.length <= APERCU) return <span className={PROSE}>{texte}</span>
  return (
    <span className={PROSE}>
      <span className="block">{`${points.slice(0, APERCU).join("")}…`}</span>
      <details>
        <summary className="cursor-pointer underline underline-offset-2">Lire tout</summary>
        <span className="block whitespace-pre-wrap">{texte}</span>
      </details>
    </span>
  )
}

function Gestes({ retour }: { retour: FeedbackTicketView }) {
  return (
    <div className="flex flex-wrap gap-2">
      {GESTES[retour.state].map((etat) =>
        etat === "declined" ? (
          <RefusDuRetour key={etat} ticket={retour.ticket} ancre={ANCRE_DES_RETOURS} />
        ) : (
          <ActionPlateforme
            key={etat}
            libelle={LIBELLES_DES_GESTES[etat]}
            nomAccessible={`${LIBELLES_DES_GESTES[etat]} ${retour.ticket}`}
            requete={{ methode: "PATCH", ressource: `feedback/${retour.ticket}`, corps: { state: etat } }}
            ancre={ANCRE_DES_RETOURS}
            messages={MESSAGES_DU_RETOUR}
          />
        ),
      )}
    </div>
  )
}

type LigneProps = { retour: FeedbackTicketView; periode: UsagePeriod } & Pick<EcranRetoursProps, "Lien" | "hrefDeConversation">

function LigneDeRetour({ retour, periode, Lien, hrefDeConversation }: LigneProps) {
  // Traité par quelqu'un qui n'est plus membre : la date reste, le nom manque.
  const traite = retour.handledAt ? `${retour.handledBy ?? "Hors de l'organisation"}, le ${dateLisible(retour.handledAt) ?? "?"}` : ABSENT
  return (
    <tr>
      <td data-primary="">
        <span className="oto-mono">{retour.ticket}</span>
      </td>
      <td>{dateEtHeureLisibles(retour.createdAt) ?? ABSENT}</td>
      <td>{retour.person ?? PERSONNE_RETIREE}</td>
      <td>{TYPES[retour.type]}</td>
      <td>{retour.target ?? ABSENT}</td>
      <td>
        <Texte texte={retour.text} />
      </td>
      <td>
        <Badge tone={TONS[retour.state]}>{ETATS[retour.state]}</Badge>
      </td>
      <td>
        <span className={PROSE}>{retour.resolution ?? ABSENT}</span>
      </td>
      <td>{traite}</td>
      <td>
        {retour.ctx ? (
          <LienDeCellule Lien={Lien} href={hrefDeConversation(retour.ctx, periode)}>
            Voir la conversation<span className="oto-sr-only">{` du retour ${retour.ticket}`}</span>
          </LienDeCellule>
        ) : (
          ABSENT
        )}
      </td>
      <td>
        <Gestes retour={retour} />
      </td>
    </tr>
  )
}

type VueProps = Omit<EcranRetoursProps, "resultat" | "fil"> & { liste: FeedbackList }

/** L'état et le type, sur la barre d'outils de la liste : un choix de l'un garde l'autre et la fenêtre. */
function Filtres({ filtres, hrefDeFiltre }: Pick<VueProps, "filtres" | "hrefDeFiltre">) {
  const { state: etat, type, period } = filtres
  const etats = FILTRES_D_ETAT.map((filtre) => ({ valeur: filtre.etat, libelle: filtre.libelle, adresse: hrefDeFiltre({ state: filtre.etat, type, period }) }))
  const types = [
    { valeur: TOUS_LES_TYPES, libelle: "Tous les types", adresse: hrefDeFiltre({ state: etat, period }) },
    ...feedbackTypeSchema.options.map((choix) => ({ valeur: choix, libelle: TYPES[choix], adresse: hrefDeFiltre({ state: etat, type: choix, period }) })),
  ]
  return (
    <div className="oto-list-tools flex-wrap">
      <FiltreSegmente libelle="Filtrer par état" choix={etats} valeur={etat} />
      <FiltreSegmente libelle="Filtrer par type" choix={types} valeur={type ?? TOUS_LES_TYPES} />
    </div>
  )
}

/** Vide : « rien sur la période » seulement quand la fenêtre n'a aucun ticket, quel que soit l'état, sans filtre de type. */
function Vide({ liste, filtres, Lien, hrefDeFiltre }: VueProps) {
  const rien = filtres.type === undefined && Object.values(liste.counts).every((nombre) => nombre === 0)
  if (rien) return <EmptyState title={AUCUN_RETOUR} />
  return (
    <EmptyState
      title={AUCUN_RETOUR_FILTRE}
      action={
        <Lien href={hrefDeFiltre({ state: "all", period: filtres.period })} className="oto-btn" data-variant="secondary" data-size="sm">
          Voir tous les retours
        </Lien>
      }
    />
  )
}

function Liste(props: VueProps) {
  const { liste, filtres, Lien } = props
  return (
    <Ilot id={ANCRE_DES_RETOURS} titre="Retours, le plus récent d'abord">
      <Filtres filtres={filtres} hrefDeFiltre={props.hrefDeFiltre} />
      {liste.tickets.length === 0 ? (
        <Vide {...props} />
      ) : (
        <div className="flex flex-col gap-3">
          <TableServeur legende="Retours, le plus récent d'abord" colonnes={COLONNES}>
            {liste.tickets.map((retour) => (
              <LigneDeRetour key={retour.ticket} retour={retour} periode={filtres.period} Lien={Lien} hrefDeConversation={props.hrefDeConversation} />
            ))}
          </TableServeur>
          {liste.nextCursor && (
            <Lien href={props.hrefDeFiltre({ ...filtres, cursor: liste.nextCursor })} className="oto-list-more">
              Voir les suivants
            </Lien>
          )}
        </div>
      )}
    </Ilot>
  )
}

/** La fenêtre, dans les actions de l'en-tête : elle règle l'écran entier, l'état et le type gardés. */
function Fenetre({ filtres, hrefDeFiltre }: Pick<VueProps, "filtres" | "hrefDeFiltre">) {
  const { state, type } = filtres
  const fenetres = JOURNAL_PERIODS.map((jours) => ({ valeur: String(jours), libelle: `${jours} jours`, adresse: hrefDeFiltre({ state, type, period: jours }) }))
  return <FiltreSegmente libelle="La période observée" choix={fenetres} valeur={String(filtres.period)} />
}

export function EcranRetours({ resultat, fil, ...props }: EcranRetoursProps) {
  const liste = resultat.data
  return (
    <>
      <EnTeteDAdministration
        courant="retours"
        fil={fil}
        titre="Retours des assistants"
        glyphe={ChatCircleText}
        meta={liste && comptes(liste.counts)}
        actions={liste && <Fenetre filtres={props.filtres} hrefDeFiltre={props.hrefDeFiltre} />}
      />
      {/* Une seule lecture : son échec, ou la réserve d'un non-administrateur (AC1), se dit une fois. */}
      {"masques" in resultat ? (
        <RetoursMasques />
      ) : resultat.error !== undefined ? (
        <ErreurDeLecture message={resultat.error} href={props.hrefDeFiltre(props.filtres)} Lien={props.Lien} />
      ) : (
        <Liste liste={resultat.data} {...props} />
      )}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC15). */
export function EcranRetoursChargement() {
  return <Chargement texte="Chargement des retours…" />
}
