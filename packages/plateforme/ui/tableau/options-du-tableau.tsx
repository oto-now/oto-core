"use client"

// Les réglages d'un tableau à l'écran (E11-S01, lot g ; AC-g1 à AC-g7 ; HN-E11S01-16 à 21) : « Réglages du tableau… »
// du menu « ⋯ » de l'en-tête (refonte #218), dès le niveau écriture, ouvre le dialogue « Réglages du tableau » et ses interrupteurs,
// « Preuve exigée » (`proof`), « L'assistant peut décider la revue » (`lifecycle.review.agents_may_decide`,
// seulement si le tableau a une revue) et « Fermé » (`closed`). Chaque bascule publie l'en-tête en un geste par
// la file d'opérations de la page (`POST /api/platform/nodes`, la porte de `write`), qui pose la révision et
// le tampon courants (HN-E11S01-18) ; l'issue s'annonce, la page se relit (HN-E11S01-19), un refus se dit sous
// les interrupteurs et l'interrupteur revient à l'état publié. Un changement d'en-tête en attente dans le
// brouillon bloque le panneau (AC-g6, HN-E11S01-20) : publier le réglage publierait aussi ce changement sans
// qu'on l'ait vu. Le service décide des droits (AC-g8). Nommé « options » : `adresse.ts` appelle déjà
// `Reglages` le tri et les filtres. Sans lui, une personne qui écrit dans le tableau ne change ces trois
// attributs qu'en le demandant à un assistant.
import { useEffect, useRef, useState } from "react"
import type { TableHeader } from "../../schemas"
import { messageDErreur } from "../api/messages"
import { Dialog } from "../ds/react/dialog"
import { Switch } from "../ds/react/switch"
import { useRafraichir } from "../hote/rafraichir"
import { useFileDOperations } from "../noeud/editeur/file-d-operations"
import { OPTIONS, REFUS_DES_OPTIONS } from "./libelles"

type Cle = "proof" | "agents_may_decide" | "closed"

/** Un interrupteur : son intitulé, son aide, sa valeur publiée et le `header` qui publie une valeur (AC-g3). */
type Reglage = { cle: Cle; intitule: string; aide: string; publie: boolean; entete: (valeur: boolean) => Record<string, unknown> }

/** Les interrupteurs de l'en-tête publié, dans l'ordre d'AC-g2 ; celui de la revue seulement si le tableau en a une (HN-E11S01-17). */
function reglagesDe(entete: TableHeader): Reglage[] {
  const preuve: Reglage = { cle: "proof", intitule: OPTIONS.preuve.intitule, aide: OPTIONS.preuve.aide, publie: entete.proof, entete: (valeur) => ({ proof: valeur }) }
  const ferme: Reglage = { cle: "closed", intitule: OPTIONS.ferme.intitule, aide: OPTIONS.ferme.aide, publie: entete.closed, entete: (valeur) => ({ closed: valeur }) }
  const cycle = entete.lifecycle
  const revue = cycle?.review
  if (!cycle || !revue) return [preuve, ferme]
  const decision: Reglage = {
    cle: "agents_may_decide",
    intitule: OPTIONS.revue.intitule,
    aide: OPTIONS.revue.aide(revue),
    publie: revue.agents_may_decide === true,
    // Le cycle se remplace entier (règle 3 de `write.table`) : le cycle publié, où seule la décision change.
    entete: (valeur) => ({ lifecycle: { ...cycle, review: { ...revue, agents_may_decide: valeur } } }),
  }
  return [preuve, decision, ferme]
}

/**
 * Les bascules : la valeur voulue de chaque interrupteur tant que la relecture ne l'a pas remplacée, l'envoi en
 * cours, l'annonce et l'alerte. Le focus revient à l'interrupteur touché à la fin de l'envoi : désactivé
 * pendant l'envoi, il l'avait perdu. La demande est un état compté, une réponse immédiate rendant le début et
 * la fin de l'envoi dans le même rendu (`accessibility-patterns.md § Après une action`).
 */
function useBascules(reglages: readonly Reglage[]) {
  const { envoyer, remplacerLArret } = useFileDOperations()
  const rafraichir = useRafraichir()
  const [voulues, setVoulues] = useState<Partial<Record<Cle, boolean>>>({})
  const [envoi, setEnvoi] = useState<Cle | null>(null)
  const [annonce, setAnnonce] = useState("")
  const [alerte, setAlerte] = useState("")
  // Un double geste arrive avant que les interrupteurs désactivés soient rendus : ce verrou tient l'envoi unique.
  const enCours = useRef(false)
  const entrees = useRef<Partial<Record<Cle, HTMLInputElement | null>>>({})
  const aFocaliser = useRef<Cle | null>(null)
  const [demandeDeFocus, setDemandeDeFocus] = useState(0)
  const demandeServie = useRef(0)
  useEffect(() => {
    if (envoi !== null || demandeDeFocus === demandeServie.current) return
    demandeServie.current = demandeDeFocus
    if (aFocaliser.current) entrees.current[aFocaliser.current]?.focus()
  })

  // L'en-tête relu remplace les valeurs voulues (`portage-ecrans.md § 2`) : l'interrupteur suit l'en-tête publié.
  const publiees = reglages.map((reglage) => `${reglage.cle}:${reglage.publie}`).join()
  const [lues, setLues] = useState(publiees)
  if (lues !== publiees) {
    setLues(publiees)
    setVoulues({})
  }

  function basculer({ cle, intitule, entete }: Reglage, valeur: boolean) {
    if (enCours.current) return
    enCours.current = true
    aFocaliser.current = cle
    setVoulues((avant) => ({ ...avant, [cle]: valeur }))
    setEnvoi(cle)
    setAnnonce("")
    setAlerte("")
    envoyer({
      tampon: true,
      corps: () => ({ header: entete(valeur), publish: true }),
      issue: (issue) => {
        enCours.current = false
        setEnvoi(null)
        setDemandeDeFocus((demande) => demande + 1)
        if (issue.erreur) {
          // Le refus sort de la file : les écritures suivantes de la page repartent ; l'interrupteur revient à l'état publié.
          remplacerLArret(null)
          setVoulues((avant) => ({ ...avant, [cle]: undefined }))
          setAlerte(messageDErreur(issue.erreur, REFUS_DES_OPTIONS))
          return
        }
        setAnnonce(OPTIONS.annonce(intitule, valeur))
        rafraichir()
      },
    })
  }

  return { voulues, envoi, annonce, alerte, entrees, basculer }
}

function Interrupteurs({ entete, bloques }: { entete: TableHeader; bloques: boolean }) {
  const reglages = reglagesDe(entete)
  const { voulues, envoi, annonce, alerte, entrees, basculer } = useBascules(reglages)
  return (
    <div className="flex flex-col gap-3" aria-busy={envoi !== null || undefined}>
      {reglages.map((reglage) => (
        <Switch
          key={reglage.cle}
          ref={(entree) => {
            entrees.current[reglage.cle] = entree
          }}
          label={reglage.intitule}
          description={reglage.aide}
          checked={voulues[reglage.cle] ?? reglage.publie}
          // Bloqués, ils montrent l'état publié et n'envoient rien (AC-g6) : un clic distribué à un interrupteur
          // désactivé déclenche encore `onChange`, le blocage ne tient donc pas au seul `disabled`.
          disabled={bloques || envoi !== null}
          onChange={(evenement) => {
            if (!bloques) basculer(reglage, evenement.target.checked)
          }}
        />
      ))}
      {/* Montée vide : l'issue d'une bascule s'annonce quand elle arrive. */}
      <p role="status" className="text-sm text-ink">
        {annonce}
      </p>
      {alerte && (
        <p role="alert" className="text-sm text-ink">
          {alerte}
        </p>
      )}
    </div>
  )
}

type ReglagesDuTableauProps = {
  /** L'en-tête publié du tableau (`tableHeaderSchema`). */
  entete: TableHeader
  /** Un changement d'en-tête attend dans le brouillon (`vue.draft.meta`) : le panneau est bloqué (AC-g6). */
  enAttente: boolean
  open: boolean
  onClose: () => void
}

/**
 * Le dialogue « Réglages du tableau » (AC-g1 ; refonte #218), ouvert par « Réglages du tableau… » du menu « ⋯ » de
 * l'en-tête ; ses interrupteurs et leurs textes inchangés. Monté sous la file d'opérations de la page, au niveau
 * écriture seulement.
 */
export function ReglagesDuTableau({ entete, enAttente, open, onClose }: ReglagesDuTableauProps) {
  return (
    <Dialog open={open} onClose={onClose} title={OPTIONS.titre} size="md">
      <div className="flex flex-col gap-3">
        {enAttente && <p className="text-sm text-ink">{OPTIONS.enAttente}</p>}
        <Interrupteurs entete={entete} bloques={enAttente} />
      </div>
    </Dialog>
  )
}
