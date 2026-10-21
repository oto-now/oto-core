"use client"

// Les dialogues des fichiers de l'éditeur (E10-S02, lot b : AC-b4 à AC-b6), sur le dialogue natif du design system
// (`Dialog`) : le choix d'une image ou d'un fichier par le « + », dont la zone de dépôt, reprise d'E10-S01, dit les types
// et les limites avant la sélection ; le choix au dépôt d'un `.md` (insérer le contenu, ou joindre) ou d'un `.csv`
// (importer en tableau, ou joindre), le focus sur la première option ; l'import d'un CSV dans le dialogue d'E10-S01, en
// tableau sous la page. Échap ferme sans rien écrire. Sans lui, un `.md` ou un `.csv` lâché dans une page n'aurait
// qu'une issue.
import { useEffect, useRef, type RefObject } from "react"
import { adressesAEssayer } from "../../coque/creation-dans-le-rail"
import { ImportDeFichier, ZoneDeDepot } from "../../coque/import-de-fichier"
import { Dialog } from "../../ds/react/dialog"
import { Button } from "../../ds/react/primitives"
import { FICHIERS } from "../libelles-des-fichiers"
import { accepteDe, limitesDe, type DialogueDeFichier, type Genre } from "./envoi-de-fichier"
import { useGestes } from "./gestes"
import { ChoixDeLIntegration } from "./integration-editee"
import type { OptionDuDepot } from "./gestes-des-fichiers"

/** Les issues d'un dépôt, la recommandée d'abord (AC-b5). */
const OPTIONS: Record<"md" | "csv", readonly (readonly [OptionDuDepot, string])[]> = {
  md: [
    ["contenu", FICHIERS.insererLeContenu],
    ["joindre", FICHIERS.joindre],
  ],
  csv: [
    ["tableau", FICHIERS.importerEnTableau],
    ["joindre", FICHIERS.joindre],
  ],
}

/** « Image » ou « Fichier » du « + » (AC-b1, AC-b2, AC-b4) : les types et les limites, puis la zone de dépôt. */
function ChoixDuFichier({ quoi }: { quoi: Genre }) {
  const gestes = useGestes()
  const hote = gestes.typesDeLHote()
  return (
    <Dialog open onClose={gestes.fermerLeDialogue} title={quoi === "image" ? FICHIERS.titreImage : FICHIERS.titreFichier} size="md">
      <ZoneDeDepot limites={limitesDe(quoi, hote)} accepte={accepteDe(quoi, hote)} choisir={gestes.fichierChoisi} />
    </Dialog>
  )
}

function Options({ extension, premiere }: { extension: "md" | "csv"; premiere: RefObject<HTMLButtonElement | null> }) {
  const gestes = useGestes()
  return OPTIONS[extension].map(([option, libelle], rang) => (
    <Button key={option} ref={rang === 0 ? premiere : undefined} variant={rang === 0 ? "primary" : "secondary"} onClick={() => gestes.choisirAuDepot(option)}>
      {libelle}
    </Button>
  ))
}

/** Le choix au dépôt d'un `.md` ou d'un `.csv` (AC-b5) : le focus sur la première option ; Échap ferme sans rien écrire. */
function ChoixAuDepot({ nom, extension }: { nom: string; extension: "md" | "csv" }) {
  const gestes = useGestes()
  const premiere = useRef<HTMLButtonElement>(null)
  // L'effet du dialogue, enfant, a déjà ouvert la fenêtre (`showModal`), qui donne le focus à « Fermer » : il va à la première option.
  useEffect(() => premiere.current?.focus(), [])
  return (
    <Dialog open onClose={gestes.fermerLeDialogue} title={FICHIERS.choix(nom)} size="sm">
      <div className="flex flex-col gap-2">
        <Options extension={extension} premiere={premiere} />
      </div>
    </Dialog>
  )
}

/** Un CSV importé en tableau sous la page, dans le dialogue d'E10-S01, sous ses droits (AC-b5, AC-b6, fiche D120). */
function ImportDuCsv({ chemin, fichier }: { chemin: string; fichier: File }) {
  const gestes = useGestes()
  return (
    <ImportDeFichier
      cible={{ genre: "sous", parent: chemin, nom: chemin, adresses: (segment) => adressesAEssayer(chemin, new Set(), segment) }}
      fichier={fichier}
      fermer={gestes.fermerLeDialogue}
      termine={(fait) => gestes.tableauImporte(fait.chemin)}
    />
  )
}

/** Le dialogue de fichier ouvert dans l'éditeur, s'il y en a un ; `chemin` : la page, sous laquelle un CSV devient un tableau. */
export function DialogueDesFichiers({ dialogue, chemin }: { dialogue: DialogueDeFichier | null; chemin: string }) {
  if (dialogue === null) return null
  if (dialogue.genre === "choisir") return <ChoixDuFichier quoi={dialogue.quoi} />
  if (dialogue.genre === "depot") return <ChoixAuDepot nom={dialogue.fichier.name} extension={dialogue.extension} />
  if (dialogue.genre === "integration") return <ChoixDeLIntegration adresse={dialogue.adresse} modifier={dialogue.modifier} />
  return <ImportDuCsv chemin={chemin} fichier={dialogue.fichier} />
}
