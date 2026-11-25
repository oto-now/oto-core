"use client"

// Le geste « Page ⇄ Procédure » de l'en-tête d'un contenu : un bouton en icône seule, le glyphe du genre courant (celui
// du rail), à gauche de « Télécharger ». Au clic, sans confirmation dans un sens ni dans l'autre (décision de JB), le
// genre opposé part en une écriture publiée par la file d'opérations de la page (`POST /api/platform/nodes`, la porte
// de `write`), puis la page se relit ; le service l'écrit tout ou rien (`writesAtomically`) : un refus des blocs `call`
// laisse la page en page, sans brouillon. L'issue s'annonce (`role="status"`), suivie après un passage en procédure des
// conseils d'écriture que sert la publication (`data.warnings`, phrases anglaises sans code, montrées telles quelles et
// repliées, sans bloquer) ; un refus se dit sous la rangée
// (`role="alert"`), refus par refus quand c'est le contrôle d'une procédure. Bloqué, et dit dans son infobulle : une page
// rangée sous une procédure (ses sous-étapes restent des pages), et un brouillon que la page n'a pas écrit (le geste le
// publierait sans qu'on l'ait vu, comme « Réglages » d'un tableau). Le bouton n'est que `aria-disabled` : il garde le
// focus et son infobulle pendant l'envoi comme bloqué. Sans lui, changer le genre d'un contenu se demande à un assistant.
import { useRef, useState } from "react"
import type { ErreurPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import { FOCUS } from "../components/classes"
import { IconButton } from "../ds/react/primitives"
import { Tooltip } from "../ds/react/tooltip"
import { useRafraichir } from "../hote/rafraichir"
import { publicationRefusee } from "../procedure/libelles"
import { lireLesRefus, RefusDePublication, type RefusLu } from "../procedure/refus-de-publication"
import { useFileDOperations } from "./editeur/file-d-operations"
import { GlypheDeNature } from "./glyphes"
import { GENRE } from "./libelles"

type Genre = "page" | "procedure"

/** Un bloc servi : un refus y trouve la référence qui ancre son bloc (« Aller au bloc »). */
type BlocAncre = { id: string; ref: string }

type GenreDuNoeudProps = {
  /** Le genre que l'en-tête montre (`genreDuNoeud`). */
  genre: Genre
  /** Le titre montré, que l'annonce nomme. */
  titre: string
  /** Un ancêtre de l'arbre visible est une procédure : le passage en procédure est bloqué. */
  sousUneProcedure: boolean
  blocs: readonly BlocAncre[]
}

/** L'issue d'un geste : l'annonce et les conseils d'une procédure, ou le refus (la liste du contrôle, sinon une phrase). */
type Issue = { annonce: string; conseils: readonly string[]; alerte: string; refus: RefusLu[] | null }

const AUCUNE: Issue = { annonce: "", conseils: [], alerte: "", refus: null }

function issueDuRefus(erreur: ErreurPlateforme): Issue {
  const refus = erreur.code === "invalid_arguments" ? lireLesRefus(erreur.details) : null
  return { ...AUCUNE, alerte: refus ? "" : messageDErreur(erreur), refus }
}

/** Les conseils servis, repliés sous leur compte ; le texte anglais du service tel quel, faute de code stable. */
function ConseilsDEcriture({ conseils }: { conseils: readonly string[] }) {
  return (
    <details className="order-last basis-full text-sm text-ink">
      <summary className={`cursor-pointer rounded-sm ${FOCUS}`}>{GENRE.conseils(conseils.length)}</summary>
      <ul lang="en" className="mt-1 list-disc space-y-1 ps-5">
        {conseils.map((conseil) => (
          <li key={conseil}>{conseil}</li>
        ))}
      </ul>
    </details>
  )
}

/** L'envoi du genre opposé : un seul à la fois, son issue, puis la relecture (ou celle d'une page changée ailleurs). */
function useChangerDeGenre({ genre, titre }: Pick<GenreDuNoeudProps, "genre" | "titre">) {
  const { envoyer, remplacerLArret, brouillon, ecrit } = useFileDOperations()
  const rafraichir = useRafraichir()
  const [envoi, setEnvoi] = useState(false)
  const [issue, setIssue] = useState<Issue>(AUCUNE)
  // Un double geste arrive avant que le bouton occupé soit rendu : ce verrou tient l'envoi unique.
  const enCours = useRef(false)

  function changer() {
    if (enCours.current) return
    enCours.current = true
    const cible: Genre = genre === "page" ? "procedure" : "page"
    setEnvoi(true)
    setIssue(AUCUNE)
    envoyer({
      tampon: true,
      corps: () => ({ kind: cible, publish: true }),
      issue: (resultat) => {
        enCours.current = false
        setEnvoi(false)
        if (resultat.erreur) {
          // Le refus sort de la file : les écritures suivantes de la page repartent.
          remplacerLArret(null)
          setIssue(issueDuRefus(resultat.erreur))
          if (resultat.erreur.code === "stale_revision" || resultat.erreur.code === "not_found") rafraichir()
          return
        }
        const conseils = cible === "procedure" ? (resultat.data.warnings ?? []) : []
        setIssue({ ...AUCUNE, annonce: GENRE.devenue[cible](titre), conseils })
        rafraichir()
      },
    })
  }

  // Un brouillon ouvert que cette page n'a pas écrit vient d'ailleurs (un assistant) : le geste le publierait.
  return { envoi, issue, changer, brouillonDAilleurs: brouillon && !ecrit }
}

export function GenreDuNoeud({ genre, titre, sousUneProcedure, blocs }: GenreDuNoeudProps) {
  const { envoi, issue, changer, brouillonDAilleurs } = useChangerDeGenre({ genre, titre })
  const bloque = brouillonDAilleurs ? GENRE.enAttente : genre === "page" && sousUneProcedure ? GENRE.sousUneProcedure : null
  const inerte = bloque !== null || envoi
  return (
    <>
      <Tooltip content={bloque ?? GENRE.aide[genre]} side="bottom">
        <IconButton
          label={GENRE.nom[genre]}
          variant="secondary"
          size="sm"
          className="oto-genre"
          aria-disabled={inerte || undefined}
          aria-busy={envoi || undefined}
          onClick={() => {
            if (!inerte) changer()
          }}
        >
          <GlypheDeNature nature={natureDuGenre(genre)} />
        </IconButton>
      </Tooltip>
      {/* Montée vide, sous la rangée de l'en-tête : l'issue s'annonce quand elle arrive. */}
      <p role="status" className={issue.annonce ? "order-last basis-full text-sm text-ink" : "oto-sr-only"}>
        {issue.annonce}
      </p>
      {issue.conseils.length > 0 && <ConseilsDEcriture conseils={issue.conseils} />}
      {issue.alerte && (
        <p role="alert" className="oto-field-error order-last basis-full">
          {issue.alerte}
        </p>
      )}
      {issue.refus && (
        <div className="order-last basis-full space-y-2">
          <p role="alert" className="text-sm font-medium text-ink">
            {publicationRefusee(issue.refus.length)}
          </p>
          <RefusDePublication refus={issue.refus} blocs={blocs} />
        </div>
      )}
    </>
  )
}
