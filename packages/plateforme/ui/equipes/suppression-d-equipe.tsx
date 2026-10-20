"use client"

// La confirmation avant de supprimer une équipe (E05-S03, AC14 ; portée par E05-S09 partie d1 ; refaite en
// 1.4.13) : trois blocs courts. « Ce qui part » : ses membres la quittent, ses règles d'accès tombent, son Contexte est
// supprimé, ses pages à la corbeille sont effacées pour de bon ; « Ce qui bloque » : ses pages encore en place et ses
// comptes, chaque page avec son lien, le geste grisé tant qu'il en reste ; puis l'annulation impossible et le geste.
// Le récapitulatif se lit à l'ouverture (`GET teams/<slug>/deletion`, `describeTeamDeletion`, la lecture même du refus
// du service) ; le geste envoie `DELETE /api/platform/teams/<id>`, et son refus (une page rangée entre-temps) se dit
// dans le dialogue. Portée d'oto-frontend (`delete-team-dialog.tsx`) : « Annuler » face au geste destructeur, ni bouton
// par défaut ni autofocus, « Suppression… » pendant l'envoi. Sans lui, une équipe dont les pages dormaient à la
// corbeille ne se supprimait pas, et un mur de texte ne disait pas pourquoi.
import { useCallback, useEffect, useState } from "react"
import type { TeamDeletionView, TeamView } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { ConfirmDialog } from "../ds/react/confirm-dialog"
import { Button } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { useGeste } from "./gestes"
import { SUPPRESSION } from "./libelles"

type Lecture = { etat: "chargement" } | { etat: "erreur"; message: string } | { etat: "pret"; vue: TeamDeletionView }

/** Le récapitulatif de la suppression, lu à l'ouverture ; `relire` rejoue une lecture en échec. */
function useRecapitulatif(slug: string) {
  const [lecture, setLecture] = useState<Lecture>({ etat: "chargement" })
  const lire = useCallback(async () => {
    setLecture({ etat: "chargement" })
    const lu = await appelerPlateforme<TeamDeletionView>({ methode: "GET", ressource: `teams/${encodeURIComponent(slug)}/deletion` })
    setLecture(lu.erreur ? { etat: "erreur", message: messageDErreur(lu.erreur) } : { etat: "pret", vue: lu.data })
  }, [slug])
  useEffect(() => {
    void lire()
  }, [lire])
  return { lecture, relire: () => void lire() }
}

/** « Ce qui part » : chaque conséquence en une ligne. */
function CeQuiPart({ vue }: { vue: TeamDeletionView }) {
  return (
    <section aria-labelledby="suppression-part" className="flex flex-col gap-1">
      <h3 id="suppression-part" className="text-sm font-semibold text-ink">
        {SUPPRESSION.part}
      </h3>
      <ul className="list-disc ps-5 text-sm text-ink">
        <li>{SUPPRESSION.membres(vue.members.length)}</li>
        <li>{SUPPRESSION.regles(vue.rules)}</li>
        <li>{SUPPRESSION.contexte}</li>
        {vue.trashed > 0 && <li>{SUPPRESSION.corbeille(vue.trashed)}</li>}
      </ul>
    </section>
  )
}

/** « Ce qui bloque » : les pages encore en place, chacune avec son lien, et les comptes de l'équipe. */
function CeQuiBloque({ bloque, prefixeDesPages }: { bloque: NonNullable<TeamDeletionView["blockedBy"]>; prefixeDesPages: string }) {
  const { Lien } = useHote()
  return (
    <section aria-labelledby="suppression-bloque" className="flex flex-col gap-1">
      <h3 id="suppression-bloque" className="text-sm font-semibold text-ink">
        {SUPPRESSION.bloque}
      </h3>
      <p className="text-sm text-mute">{SUPPRESSION.bloqueDetail}</p>
      <ul className="list-disc ps-5 text-sm text-ink">
        {bloque.nodes.map(({ path }) => (
          <li key={path}>
            <Lien href={`${prefixeDesPages}${path}`} className="underline">
              {path}
            </Lien>
          </li>
        ))}
        {bloque.accounts.map(({ label }) => (
          <li key={label}>{SUPPRESSION.compte(label)}</li>
        ))}
      </ul>
    </section>
  )
}

type SuppressionDEquipeProps = {
  equipe: Pick<TeamView, "id" | "slug" | "name">
  onFermer: () => void
  apresUnDepart: () => void
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`), en chaîne : une page qui bloque y mène. */
  prefixeDesPages: string
}

export function SuppressionDEquipe({ equipe, onFermer, apresUnDepart, prefixeDesPages }: SuppressionDEquipeProps) {
  const geste = useGeste()
  const { lecture, relire } = useRecapitulatif(equipe.slug)
  const bloque = lecture.etat === "pret" ? lecture.vue.blockedBy : null
  const supprimer = () => {
    // Le geste reste gardé ici, pas seulement par `disabled` (`forms-patterns.md` § Double soumission).
    if (lecture.etat !== "pret" || bloque !== null || geste.enCours) return
    geste.envoyer(
      { methode: "DELETE", ressource: `teams/${equipe.id}` },
      { team_owns_objects: SUPPRESSION.refus(equipe.name) },
      {
        succes: () => {
          apresUnDepart()
          onFermer()
        },
      },
    )
  }
  const pied = (
    <>
      <Button variant="secondary" onClick={onFermer}>
        {SUPPRESSION.annuler}
      </Button>
      <Button variant="danger" onClick={supprimer} disabled={lecture.etat !== "pret" || bloque !== null || geste.enCours} aria-busy={geste.enCours}>
        {geste.enCours ? SUPPRESSION.enCours : SUPPRESSION.geste}
      </Button>
    </>
  )
  return (
    <ConfirmDialog open onCancel={onFermer} title={SUPPRESSION.titre(equipe.name)} footer={pied}>
      <div className="flex flex-col gap-4">
        {lecture.etat === "chargement" && (
          <p role="status" aria-busy="true" className="text-sm text-mute">
            {SUPPRESSION.lecture}
          </p>
        )}
        {lecture.etat === "erreur" && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-ink">
            {SUPPRESSION.illisible(lecture.message)}
            <Button variant="secondary" size="sm" onClick={relire}>
              {SUPPRESSION.reessayer}
            </Button>
          </div>
        )}
        {lecture.etat === "pret" && (
          <>
            <CeQuiPart vue={lecture.vue} />
            {bloque && <CeQuiBloque bloque={bloque} prefixeDesPages={prefixeDesPages} />}
            {!bloque && <p className="text-sm font-semibold text-ink">{SUPPRESSION.sansRetour}</p>}
          </>
        )}
        {geste.erreur && (
          <div role="alert" className="text-sm text-ink">
            {geste.erreur}
          </div>
        )}
      </div>
    </ConfirmDialog>
  )
}
