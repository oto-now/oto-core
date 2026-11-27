// Les refus du contrôle d'une procédure (E05-S04, AC6, AC7 ; H60, P38, HN-E05S04-2) : une ligne par
// refus, dans l'ordre servi, qui dit l'emplacement (section, rang du bloc, étape), la fonction ou
// l'argument en cause et le genre en français, mène au bloc fautif (« Aller au bloc », ancre de sa
// référence, E05-S02 AC4) et replie le texte anglais du service sous « Détail technique ». Ni directive
// ni état : il sert la publication (îlot client), que le service refuse encore pour une procédure trop longue
// ou un bloc `call` déjà écrit (M59, HN-M59-3). Sans lui, un refus de publication ne dirait que « Certaines
// valeurs sont invalides. ».
import type { ProcedureRefusal } from "../../schemas"
import { isRecord } from "../../schemas/tables"
import { LIEN } from "../components/classes"
import { CONTROLE, GENRE_INCONNU, GENRES_DE_REFUS } from "./libelles"

/** Un refus lu dans `details.refusals` ; un genre que l'écran ne connaît pas encore reste lisible. */
export type RefusLu = Omit<ProcedureRefusal, "kind"> & { kind: string }

/** Un bloc du brouillon : l'identifiant d'un refus y trouve la référence qui ancre le bloc. */
type BlocAncre = { id?: string; ref?: string }

/** Les genres par leur nom servi : un genre que l'écran ne connaît pas n'y est pas. */
const GENRES = new Map<string, string>(Object.entries(GENRES_DE_REFUS))

const chaine = (valeur: unknown) => (typeof valeur === "string" ? valeur : undefined)
const entier = (valeur: unknown) => (typeof valeur === "number" && Number.isInteger(valeur) ? valeur : undefined)

/**
 * `details.refusals` d'un refus de publication (E03-S06, `procedurePublicationError`), relu champ par
 * champ : le détail servi n'est pas validé par le client (`ErreurPlateforme.details`). `null` : aucun
 * refus lisible, l'écran dit alors le message du code.
 */
export function lireLesRefus(details: unknown): RefusLu[] | null {
  const servis = isRecord(details) ? details.refusals : undefined
  if (!Array.isArray(servis)) return null
  const lus = servis.flatMap((refus): RefusLu[] => {
    if (!isRecord(refus) || typeof refus.kind !== "string" || typeof refus.message !== "string") return []
    const { section, block, step, block_id, function: fonction, element } = refus
    return [
      {
        kind: refus.kind,
        message: refus.message,
        section: chaine(section),
        block: entier(block),
        step: entier(step),
        block_id: chaine(block_id),
        function: chaine(fonction),
        element: chaine(element),
      },
    ]
  })
  return lus.length > 0 ? lus : null
}

/**
 * L'emplacement d'un refus (AC7) : « Section « Étapes », bloc 4, étape 6 » ; sans section, « Avant le
 * premier titre » ; sans rang mais avec un bloc, « bloc de code » ; ni rang ni bloc : « Procédure ».
 */
function emplacementDuRefus(refus: RefusLu): string {
  if (refus.block === undefined && refus.block_id === undefined) return "Procédure"
  const section = refus.section === undefined ? "Avant le premier titre" : `Section « ${refus.section} »`
  const bloc = refus.block === undefined ? "bloc de code" : `bloc ${refus.block}`
  return `${section}, ${bloc}${refus.step === undefined ? "" : `, étape ${refus.step}`}`
}

/** L'emplacement, la fonction ou l'argument en cause, puis le genre : « … · table.release, argument « state » · valeur refusée ». */
function ligneDuRefus(refus: RefusLu): string {
  const argument = refus.element === undefined ? undefined : `argument « ${refus.element} »`
  const enCause = [refus.function, argument].filter((partie) => partie !== undefined && partie !== "").join(", ")
  return [emplacementDuRefus(refus), enCause, GENRES.get(refus.kind) ?? GENRE_INCONNU].filter((partie) => partie !== "").join(" · ")
}

type RefusDePublicationProps = { refus: readonly RefusLu[]; blocs: readonly BlocAncre[] }

export function RefusDePublication({ refus, blocs }: RefusDePublicationProps) {
  return (
    <ul className="space-y-3">
      {refus.map((un, rang) => {
        const ref = un.block_id === undefined ? undefined : blocs.find((bloc) => bloc.id === un.block_id)?.ref
        return (
          // Un refus n'a pas d'identité : son rang dans la liste servie, que rien ne réordonne.
          <li key={rang} className="space-y-1 text-sm text-ink">
            <p>{ligneDuRefus(un)}</p>
            {ref !== undefined && (
              <a href={`#${encodeURIComponent(ref)}`} className={LIEN}>
                {CONTROLE.allerAuBloc}
                <span className="sr-only">{` (${emplacementDuRefus(un)})`}</span>
              </a>
            )}
            <details>
              <summary className={`w-fit cursor-pointer ${LIEN}`}>{CONTROLE.detail}</summary>
              <p className="break-words font-mono">{un.message}</p>
            </details>
          </li>
        )
      })}
    </ul>
  )
}
