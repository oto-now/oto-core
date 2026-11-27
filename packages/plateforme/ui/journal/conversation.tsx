// Le détail d'une conversation du journal (E05-S05, AC7, AC8) : un tiroir ouvert par `?conversation=`
// et fermé par l'adresse sans elle, qui montre la conversation puis ses appels dans l'ordre, arguments
// masqués dans un repli, ou non montrés sur l'espace personnel d'autrui (D44, décidé par le service).
// Server Component : le contenu est rendu ici, le tiroir (îlot client) le porte.
//
// Porté d'oto-frontend (`fiche-dun-appel.tsx`, `timeline-dun-deroule.tsx`). Repris : le `Drawer`, les appels
// en liste ordonnée (l'ordre est l'information), l'outil, l'issue en badge (le mot et la teinte), l'heure et
// la durée, l'erreur remontée montrée comme une donnée journalisée, les faits en liste de définitions, un
// tiret pour ce qui n'est pas servi. Retiré : « Serveur », « Session », « Déroulé », le lien vers le fil
// d'une exécution, et le refus d'afficher les arguments (ici masqués, pas cachés, HN-E05S05-7).
import type { ConversationDetail, JournalCall } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Badge } from "../ds/react/primitives"
import { LIEN } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { dateEtHeureLisibles, dureeLisible, heureLisible } from "../format/dates"
import { ABSENT, ARGUMENTS_NON_MONTRES, CONVERSATION_INTROUVABLE, erreurs, ISSUES, PERSONNE_RETIREE } from "./libelles"
import { TiroirDeConversation } from "./tiroir-de-conversation"

export type PanneauDeConversationProps = {
  /** `null` : code inconnu, hors de la portée de l'appelant ou mal formé, une seule phrase (H68). */
  resultat: Resultat<ConversationDetail | null>
  Lien: LienDeLHote
  /** L'adresse courante, pour « Réessayer ». */
  ici: string
  /** L'adresse sans la conversation ouverte. */
  fermer: string
  /** L'adresse des appels suivants, par leur curseur. */
  hrefDesAppelsSuivants: (curseur: string) => string
}

function Appel({ appel }: { appel: JournalCall }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-2">
        {/* Le rang écrit : le reset du design system retire la numérotation des listes. */}
        <span className="oto-caption oto-num" aria-hidden="true">{`${appel.rank}.`}</span>
        <strong>{appel.target ? `${appel.tool} ${appel.target}` : appel.tool}</strong>
        {appel.isError ? <Badge tone="fail">{ISSUES.echec}</Badge> : <Badge tone="ok">{ISSUES.reussi}</Badge>}
        <span className="oto-caption">{heureLisible(appel.ts) ?? ABSENT}</span>
        <span className="oto-caption">{`Durée : ${dureeLisible(appel.durationMs) ?? ABSENT}`}</span>
      </div>
      <p className="oto-caption">{`Équipe : ${appel.teamName ?? ABSENT} · Compte : ${appel.accountLabel ?? ABSENT}`}</p>
      {/* Une donnée du journal, pas un message de l'écran : l'erreur telle que l'outil l'a rendue (coupée à 500). */}
      {appel.error && <p>{`Erreur : ${appel.error}`}</p>}
      {appel.hidden ? (
        <p className="oto-caption">{ARGUMENTS_NON_MONTRES}</p>
      ) : (
        <details>
          <summary className={`w-fit cursor-pointer ${LIEN}`}>Arguments</summary>
          {/* Rendus en texte par React, jamais en HTML (`security-patterns.md § XSS Prevention`). */}
          <pre className="oto-mono mt-1 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(appel.args, null, 2)}</pre>
        </details>
      )}
    </li>
  )
}

function Detail({ detail, hrefDesAppelsSuivants, Lien }: { detail: ConversationDetail } & Pick<PanneauDeConversationProps, "hrefDesAppelsSuivants" | "Lien">) {
  const { summary, calls, nextCursor } = detail
  const faits: [string, string][] = [
    ["Personne", summary.userName ?? PERSONNE_RETIREE],
    ["Hôte", summary.host ?? ABSENT],
    ["Début", dateEtHeureLisibles(summary.startedAt) ?? ABSENT],
    ["Fin", dateEtHeureLisibles(summary.lastAt) ?? ABSENT],
    ["Appels", String(summary.calls)],
    ["Erreurs", summary.errors === 0 ? "Aucune" : erreurs(summary.errors)],
  ]
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {faits.map(([intitule, valeur]) => (
          <div key={intitule} className="contents">
            <dt className="oto-caption">{intitule}</dt>
            <dd>{valeur}</dd>
          </div>
        ))}
      </dl>
      {/* Numérotés depuis le premier appel de la conversation : la page suivante reprend au rang 201. */}
      <ol start={calls[0]?.rank ?? 1} className="flex flex-col gap-3">
        {calls.map((appel) => (
          <Appel key={appel.id} appel={appel} />
        ))}
      </ol>
      {nextCursor && (
        <Lien href={hrefDesAppelsSuivants(nextCursor)} className="oto-list-more">
          Appels suivants
        </Lien>
      )}
    </div>
  )
}

export function PanneauDeConversation({ resultat, Lien, ici, fermer, hrefDesAppelsSuivants }: PanneauDeConversationProps) {
  const detail = resultat.error === undefined ? resultat.data : null
  return (
    <TiroirDeConversation titre={detail ? `Conversation ${detail.summary.ctx}` : "Conversation"} fermer={fermer}>
      {resultat.error !== undefined ? (
        <ErreurDeLecture message={resultat.error} href={ici} Lien={Lien} />
      ) : detail ? (
        <Detail detail={detail} hrefDesAppelsSuivants={hrefDesAppelsSuivants} Lien={Lien} />
      ) : (
        <p>{CONVERSATION_INTROUVABLE}</p>
      )}
    </TiroirDeConversation>
  )
}
