// Les mentions dans le champ d'un commentaire et dans un commentaire lu (parcours 5.4) : la mention en cours de frappe
// (`@` puis un début de nom), les choix qu'elle propose, l'assistant en tête, et les morceaux d'un texte lu dont les
// mentions enregistrées se montrent en valeur. Sans directive : le champ et la carte les appellent, un test aussi. Ce
// qui est enregistré comme mention reste décidé par le service (`mentions` et `toAssistant` d'un commentaire) ; ici,
// seulement ce que l'écran propose et annonce avant l'envoi, par la lecture du service (`readMentions`, `mentionPlaces`
// de `schemas/comments.ts`). Sans ce module, le champ et la carte liraient chacun `@`.
import { mentionPlaces, readMentions } from "../../../schemas/comments"
import { CHAMP } from "./libelles"

export type Lecteur = { id: string; name: string }

/** Un choix de la liste des mentions : `cle` identifie l'option, `nom` s'écrit après `@`. */
export type ChoixDeMention = { cle: string; nom: string; aide: string; assistant: boolean }

const ASSISTANT = "assistant"

/** Le nombre de lecteurs proposés à la fois : la liste tient sous le champ sans défiler. */
const CHOIX_MAX = 6

// La frappe en cours se compare sans casse ; une mention écrite se lit par `schemas/comments.ts`.
const comparable = (texte: string) => texte.toLowerCase()

const LETTRE = /[\p{L}\p{N}_]/u

const dansUnMot = (caractere: string | undefined) => caractere !== undefined && LETTRE.test(caractere)

/**
 * La mention en cours de frappe : le `@` qui précède le curseur sans suivre un mot, et ce qui est tapé depuis, sur la
 * même ligne ; `null` hors d'une mention. Un nom porte des espaces : la frappe reste une mention tant qu'un choix lui
 * répond (`choixDeMention`).
 */
export function mentionEnCours(texte: string, curseur: number): { debut: number; saisie: string } | null {
  const avant = texte.slice(0, curseur)
  const debut = avant.lastIndexOf("@")
  if (debut === -1 || dansUnMot(avant[debut - 1])) return null
  const saisie = avant.slice(debut + 1)
  return saisie.includes("\n") ? null : { debut, saisie }
}

/** Les choix qui répondent à la saisie : l'assistant d'abord, puis les lecteurs dont le nom ou un de ses mots la commence. */
export function choixDeMention(saisie: string, lecteurs: readonly Lecteur[]): ChoixDeMention[] {
  const cherche = comparable(saisie)
  const commence = (nom: string) => {
    const lu = comparable(nom)
    return lu.startsWith(cherche) || lu.split(/\s+/).some((mot) => mot.startsWith(cherche))
  }
  const assistant: ChoixDeMention[] = ASSISTANT.startsWith(cherche) ? [{ cle: ASSISTANT, nom: ASSISTANT, aide: CHAMP.assistantAide, assistant: true }] : []
  const personnes = lecteurs.filter((lecteur) => commence(lecteur.name)).slice(0, CHOIX_MAX)
  return [...assistant, ...personnes.map((lecteur) => ({ cle: lecteur.id, nom: lecteur.name, aide: CHAMP.lecteur, assistant: false }))]
}

/** Le texte où la mention en cours devient `@nom `, et la place du curseur après elle. */
export function avecLaMention(texte: string, mention: { debut: number; saisie: string }, nom: string): { texte: string; curseur: number } {
  const tete = `${texte.slice(0, mention.debut)}@${nom} `
  return { texte: `${tete}${texte.slice(mention.debut + 1 + mention.saisie.length).replace(/^ /, "")}`, curseur: tete.length }
}

/**
 * Les lecteurs que le texte en cours mentionne, par nom : ceux que l'encadré de l'email nomme avant l'envoi, les mêmes
 * que le service enregistrera (`readMentions`).
 */
export function lecteursNommes(texte: string, lecteurs: readonly Lecteur[]): string[] {
  const noms = new Map(lecteurs.map((lecteur) => [lecteur.id, lecteur.name]))
  return [...new Set(readMentions(texte, lecteurs).flatMap((id) => noms.get(id) ?? []))]
}

export type Morceau = { texte: string; mention: boolean }

/**
 * Un commentaire lu, en morceaux : les mentions que le service a enregistrées (`noms`, et « assistant » quand il s'adresse
 * à lui) en valeur, le reste en texte. Les mentions se repèrent comme le service les lit (`mentionPlaces`), dans le
 * texte composé (NFC), que les morceaux rendent.
 */
export function morceauxDuTexte(texte: string, noms: readonly string[]): Morceau[] {
  const compose = texte.normalize("NFC")
  const morceaux: Morceau[] = []
  let lu = 0
  for (const { start, end } of mentionPlaces(compose, noms)) {
    if (start < lu) continue
    if (start > lu) morceaux.push({ texte: compose.slice(lu, start), mention: false })
    morceaux.push({ texte: compose.slice(start, end), mention: true })
    lu = end
  }
  if (lu < compose.length) morceaux.push({ texte: compose.slice(lu), mention: false })
  return morceaux
}

/** Les noms à mettre en valeur dans un commentaire lu : ses mentions enregistrées, et l'assistant s'il lui est adressé. */
export function nomsEnValeur(commentaire: { mentions: readonly { name: string }[]; toAssistant: boolean }): string[] {
  return [...commentaire.mentions.map((mention) => mention.name), ...(commentaire.toAssistant ? [ASSISTANT] : [])]
}
