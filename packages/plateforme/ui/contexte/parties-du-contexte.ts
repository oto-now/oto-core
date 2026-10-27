// Le texte servi par `context`, découpé en ses parties (E05-S11, AC-11, AC-13 ; HN-E05S11-8, HN-E05S11-9) :
// chaque bloc du rapport de `previewContext` y prend ses caractères, dans l'ordre, les blocs étant séparés
// par une ligne vide, puis vient le reste (l'avis de budget). Fonctions pures, sans libellé. Même règle que
// `renderContext` et `recededReport` du moteur (`server/context/engine.ts`), réécrite ici parce que `ui/`
// n'importe pas `server/` : le test de parité les confronte (`tests/unit/texte-servi.test.ts`).
// Sans elles, la vue « Contexte » de l'accueil ne saurait pas où commence chaque partie, ni l'encart d'un
// Contexte où mener chaque ligne.
//
// E05-S12 (lot C, AC-4, AC-6 à AC-8 ; D109) : une partie de Contexte se reconnaît à son `name`, le chemin de son
// Contexte, servi ou non (`private` : un Privé sans `handle`) ; sa tête (en-tête, ligne de faits, connecteurs)
// se lit par le `head` du rapport, jamais recalculée ici.
//
// M71 : les listes d'index d'une partie (enfants, pages liées) ne sont que dans son texte servi, pas dans les blocs
// de son Contexte ; `morceauxDuContexte` les en relit par les textes que le service écrit (`CONTEXT_INDEX`).
import { CONTEXT_INDEX, NODE_PATH_PATTERN, SERVED_BUDGET, SERVED_RECENT } from "../../schemas"
import { PERSO } from "../arbre/depuis-l-arbre"
import type { DonneesDeLApercu } from "./apercu-du-contexte"

/** Un bloc du rapport (`BlockReport` du moteur). */
type BlocServi = DonneesDeLApercu["blocks"][number]

/**
 * Une partie du texte servi : son bloc, son texte tel qu'inclus (vide s'il est omis), son ancre, et ce texte
 * découpé par `head` : sa tête (`""` hors d'une partie de Contexte) et la suite, sans la fin de ligne qui les sépare.
 */
export type PartieServie = BlocServi & { texte: string; ancre: string; tete: string; suite: string }

/** Deux blocs inclus sont séparés par une ligne vide (`renderContext`). */
const SEPARATEUR = "\n\n"

/** Le Contexte de Tout le monde, par son chemin (P39). */
export const CONTEXTE_DE_TOUT_LE_MONDE = "contexte"

/**
 * Les ancres des blocs qui ne sont pas un Contexte, par leur nom servi (HN-E05S11-9, HN-E05S12-10), en anglais
 * (E11-S07). Aucune pour le bloc `code`, que ni la vue ni l'encart n'affichent plus (HN-E11S07-11) : son rang suffit.
 * Depuis le 2026-10-27, `context` ne sert plus ni nouveautés ni procédures utiles en blocs à part.
 */
const ANCRES_DES_BLOCS: Readonly<Record<string, string>> = {
  "recent content": "recent-content",
}

/**
 * Le bloc est-il la partie d'un Contexte (AC-4) ? Son nom est alors le chemin du Contexte (`contexte`,
 * `<slug>/contexte`, `private/<handle>/contexte`), ou `private` pour un Privé sans `handle`.
 */
export function estUnContexte(nom: string): boolean {
  return nom === CONTEXTE_DE_TOUT_LE_MONDE || nom === PERSO || nom.endsWith(`/${CONTEXTE_DE_TOUT_LE_MONDE}`)
}

/** Le Privé de la personne : `private/<handle>/contexte`, ou `private` sans `handle`. */
export function estLePrive(nom: string): boolean {
  return nom === PERSO || (nom.startsWith(`${PERSO}/`) && estUnContexte(nom))
}

/**
 * Le chemin du Contexte d'une partie, servi ou non (AC-7) : ce que la page de l'hôte lit (`loadNode`) pour
 * savoir si la personne peut l'écrire ; `null` pour un bloc qui n'est pas un Contexte et pour un Privé sans
 * `handle`, qui n'a pas de nœud à lire.
 */
export function cheminDuContexte(bloc: Pick<BlocServi, "name">): string | null {
  return estUnContexte(bloc.name) && bloc.name !== PERSO ? bloc.name : null
}

/**
 * L'ancre stable d'une partie (HN-E05S11-9, AC-8), en anglais (E11-S07) : un Contexte par sa portée
 * (`everyone-context`, `private-context`, `context-<slug d'équipe>`), un autre bloc par son nom servi, un nom
 * inconnu par son rang (`part-<n>`). Les deux ancres fixes ne commencent pas par `context-` : un slug d'équipe
 * (`[a-z0-9_]`, sans tiret) ne peut pas les reproduire, une équipe `everyone` comprise.
 */
export function ancreDeLaPartie(bloc: Pick<BlocServi, "name">, rang: number): string {
  if (estUnContexte(bloc.name)) {
    if (bloc.name === CONTEXTE_DE_TOUT_LE_MONDE) return "everyone-context"
    if (estLePrive(bloc.name)) return "private-context"
    return `context-${bloc.name.split("/")[0]}`
  }
  return ANCRES_DES_BLOCS[bloc.name] ?? `part-${rang + 1}`
}

/**
 * Les parties du texte servi, dans l'ordre du rapport, et le reste : ce qui suit la dernière partie incluse
 * (l'avis qui nomme les blocs omis), sans les lignes vides qui l'en séparent ; `""` sans avis.
 */
export function partiesDuContexte({ text, blocks }: Pick<DonneesDeLApercu, "text" | "blocks">): { parties: PartieServie[]; reste: string } {
  let debut = 0
  let fin = 0
  const parties = blocks.map((bloc, rang) => {
    const texte = text.slice(debut, debut + bloc.chars)
    if (bloc.chars > 0) {
      fin = debut + bloc.chars
      debut = fin + SEPARATEUR.length
    }
    // `head` est déjà ramené à la part incluse par le moteur ; le rapport d'avant E05-S12 n'en a pas.
    const tete = texte.slice(0, bloc.head ?? 0)
    const suite = texte.slice(tete.length).replace(/^\n/, "")
    return { ...bloc, texte, ancre: ancreDeLaPartie(bloc, rang), tete, suite }
  })
  return { parties, reste: text.slice(fin).trimStart() }
}

// E05-S13 (retour 8, AC-14 à AC-16 ; HN-E05S13-12, -13) : chaque partie relue ligne à ligne par les formats que le
// service écrit (`schemas/context-index.ts`), en morceaux que `ListesServies` dit en français ; toute ligne non
// reconnue reste un morceau `brut`, montré tel que servi (jamais perdu). Sans ces fonctions, l'écran ne montrerait
// que le texte anglais brut que lit l'assistant.

/** Une ligne reconnue d'une liste servie : `version`, un contenu publié depuis la conversation précédente. */
export type LigneServie =
  | { genre: "version"; chemin: string; nature: string; revision: number; date: string; titre: string }
  | { genre: "connecteur"; nom: string; date: string }
  | { genre: "recent"; chemin: string; nature: string; date: string; titre: string }
  | { genre: "index"; chemin: string; titre: string; resume: string }

/**
 * La légende d'une liste servie : la borne des nouveautés lue dans l'en-tête des contenus récents, ou le titre d'une
 * liste d'index d'un Contexte.
 */
export type Legende = { genre: "nouveautes"; depuis: string } | { genre: "children" } | { genre: "linked" }

/** Un morceau d'une partie relue : une liste, une phrase fixe, l'avis de budget, ou du texte tel que servi. */
export type MorceauServi =
  | { genre: "liste"; legende: Legende | null; lignes: LigneServie[] }
  | { genre: "phrase"; phrase: "suite" | "non-charge" }
  | { genre: "budget"; noms: { nom: string; coupe: boolean }[]; autres: number }
  | { genre: "brut"; texte: string }

/** Une date servie (`day`, `AAAA-MM-JJ`) et un nombre servi : reconnus à leur forme entière. */
const DATE_SERVIE = /^\d{4}-\d{2}-\d{2}$/
const NOMBRE_SERVI = /^\d+$/

/** `<avant><x><apres>` : `x`, ou `null` quand la ligne n'a pas cette forme. */
function entre(ligne: string, avant: string, apres: string): string | null {
  const assez = ligne.length >= avant.length + apres.length
  return assez && ligne.startsWith(avant) && ligne.endsWith(apres) ? ligne.slice(avant.length, ligne.length - apres.length) : null
}

/** `- <chemin><separateur><reste>`, le chemin au format des nœuds ; `null` sinon. */
function cheminEtReste(ligne: string, separateur: string): { chemin: string; reste: string } | null {
  if (!ligne.startsWith(CONTEXT_INDEX.item)) return null
  const corps = ligne.slice(CONTEXT_INDEX.item.length)
  const fin = corps.indexOf(separateur)
  const chemin = fin < 0 ? "" : corps.slice(0, fin)
  return NODE_PATH_PATTERN.test(chemin) ? { chemin, reste: corps.slice(fin + separateur.length) } : null
}

/** `- <chemin> — <titre> — <résumé>` (M71) ; un titre qui porterait lui-même le séparateur laisse la suite au résumé. */
function ligneDIndex(ligne: string): LigneServie | null {
  const lue = cheminEtReste(ligne, CONTEXT_INDEX.separator)
  if (!lue) return null
  const milieu = lue.reste.indexOf(CONTEXT_INDEX.separator)
  const titre = milieu < 0 ? lue.reste : lue.reste.slice(0, milieu)
  const resume = milieu < 0 ? "" : lue.reste.slice(milieu + CONTEXT_INDEX.separator.length)
  return { genre: "index", chemin: lue.chemin, titre, resume }
}

/** `- Connector <nom> activated (<date>)`. */
function ligneDeConnecteur(ligne: string): LigneServie | null {
  const corps = entre(ligne, SERVED_RECENT.connector, SERVED_RECENT.connectorEnd)
  const activation = corps === null ? -1 : corps.lastIndexOf(SERVED_RECENT.activated)
  if (corps === null || activation <= 0) return null
  const date = corps.slice(activation + SERVED_RECENT.activated.length)
  return DATE_SERVIE.test(date) ? { genre: "connecteur", nom: corps.slice(0, activation), date } : null
}

/** `- <chemin> (<genre>, <date>): <titre>`, `- <chemin> (<genre>, new v<rév>, <date>): <titre>`, ou un connecteur activé. */
function ligneRecente(ligne: string): LigneServie | null {
  const connecteur = ligneDeConnecteur(ligne)
  if (connecteur) return connecteur
  const lue = cheminEtReste(ligne, SERVED_RECENT.kindStart)
  const fin = lue ? lue.reste.indexOf(SERVED_RECENT.dateEnd) : -1
  if (!lue || fin < 0) return null
  const [nature, ...suite] = lue.reste.slice(0, fin).split(SERVED_RECENT.dateStart)
  const date = suite.at(-1)
  if (!nature || date === undefined || !DATE_SERVIE.test(date) || suite.length > 2) return null
  const titre = lue.reste.slice(fin + SERVED_RECENT.dateEnd.length)
  if (suite.length === 1) return { genre: "recent", chemin: lue.chemin, nature, date, titre }
  const revision = entre(suite[0], SERVED_RECENT.newMark, "")
  if (revision === null || !NOMBRE_SERVI.test(revision)) return null
  return { genre: "version", chemin: lue.chemin, nature, revision: Number(revision), date, titre }
}

/** Les morceaux en construction : une ligne non reconnue rejoint le morceau brut qui la précède, une ligne reconnue la liste. */
function assembleur() {
  const morceaux: MorceauServi[] = []
  return {
    morceaux,
    brut(texte: string) {
      const dernier = morceaux.at(-1)
      if (dernier?.genre === "brut") dernier.texte = `${dernier.texte}\n${texte}`
      else morceaux.push({ genre: "brut", texte })
    },
    ligne(ligne: LigneServie) {
      const dernier = morceaux.at(-1)
      if (dernier?.genre === "liste") dernier.lignes.push(ligne)
      else morceaux.push({ genre: "liste", legende: null, lignes: [ligne] })
    },
  }
}

/** Les lignes d'un bloc sous sa légende : chacune reconnue par `lire`, sinon brute. */
function lignesDuBloc(lignes: readonly string[], legende: Legende | null, lire: (ligne: string) => LigneServie | null) {
  const { morceaux, brut, ligne } = assembleur()
  if (legende) morceaux.push({ genre: "liste", legende, lignes: [] })
  for (const texte of lignes) {
    const lue = lire(texte)
    if (lue) ligne(lue)
    else brut(texte)
  }
  return morceaux
}

/** `## Recent content`, ou `## Recent content (new: published since <date>)` : la borne en légende. */
function recents(lignes: readonly string[]): MorceauServi[] | null {
  const { title, sinceStart, sinceEnd } = SERVED_RECENT
  if (lignes[0] === title) return lignesDuBloc(lignes.slice(1), null, ligneRecente)
  const depuis = entre(lignes[0], `${title}${sinceStart}`, sinceEnd)
  if (depuis === null || !DATE_SERVIE.test(depuis)) return null
  return lignesDuBloc(lignes.slice(1), { genre: "nouveautes", depuis }, ligneRecente)
}

const LECTURES_DES_BLOCS: Readonly<Record<string, (lignes: readonly string[]) => MorceauServi[] | null>> = {
  "recent content": recents,
}

/**
 * Un bloc qui n'est pas un Contexte, relu par son nom (AC-14) ; un bloc inconnu, ou dont l'en-tête n'a pas la forme
 * servie, reste entier tel que servi.
 */
export function morceauxDuBloc(nom: string, texte: string): MorceauServi[] {
  if (texte === "") return []
  return LECTURES_DES_BLOCS[nom]?.(texte.split("\n")) ?? [{ genre: "brut", texte }]
}

/**
 * La suite d'une partie de Contexte (M71 ; E05-S13, AC-4, AC-15) : le corps servi de son Contexte, ses listes d'index
 * (enfants, puis pages liées, lues depuis la fin), puis ce qui la finit (pointeur de coupe, ou Contextes non lus). Une
 * liste coupée avant sa première ligne n'est pas rendue ; la première ouvre la suite ou suit une ligne vide
 * (`contextBody`) : sinon ses lignes sont du corps, et aucune liste n'est rendue. `sansCorps` : l'éditeur montre le
 * corps (un Contexte écrivable), ou les blocs publiés (l'encart d'Organisation).
 */
export function morceauxDuContexte(suite: string, { sansCorps = false }: { sansCorps?: boolean } = {}): MorceauServi[] {
  if (suite.startsWith(CONTEXT_INDEX.notLoaded) && !suite.includes("\n")) return [{ genre: "phrase", phrase: "non-charge" }]
  const lignes = suite === "" ? [] : suite.split("\n")
  const derniere = lignes.at(-1) ?? ""
  // Les deux pointeurs d'un Contexte servi en partie (E11-S03, AC-b2, AC-b4) : listes arrêtées, ou coupe du plafond.
  const coupe = [CONTEXT_INDEX.listsStopped, CONTEXT_INDEX.bodyCut].some((debut) => derniere.startsWith(debut)) && derniere.includes(CONTEXT_INDEX.readRest)
  const avantLaCoupe = lignes.length - (coupe ? 1 : 0)
  let fin = avantLaCoupe - 1
  const listes: MorceauServi[] = []
  for (const genre of ["linked", "children"] as const) {
    let debut = fin
    while (debut >= 0 && ligneDIndex(lignes[debut]) !== null) debut -= 1
    if (debut < 0 || lignes[debut] !== CONTEXT_INDEX[genre]) continue
    if (debut < fin) listes.unshift({ genre: "liste", legende: { genre }, lignes: lignes.slice(debut + 1, fin + 1).flatMap((ligne) => ligneDIndex(ligne) ?? []) })
    fin = debut - 1
  }
  // Des listes servies suivent le corps après une ligne vide ; sinon leurs lignes sont du corps (M71).
  const avecListes = listes.length > 0 && (fin < 0 || lignes[fin] === "")
  const corps = lignes.slice(0, avecListes ? Math.max(fin, 0) : avantLaCoupe).join("\n")
  const morceaux: MorceauServi[] = corps !== "" && !sansCorps ? [{ genre: "brut", texte: corps }] : []
  if (avecListes) morceaux.push(...listes)
  if (coupe) morceaux.push({ genre: "phrase", phrase: "suite" })
  return morceaux
}

/** La fin du texte (AC-14) : l'avis de budget et les blocs omis (« (cut) » pour le coupé, « and <k> more ») ; sinon tel que servi. */
export function morceauxDeLaFin(reste: string): MorceauServi[] {
  if (reste === "") return []
  const fin = reste.lastIndexOf(SERVED_BUDGET.end)
  const liste = reste.startsWith(SERVED_BUDGET.start) && reste.endsWith("]") && fin > SERVED_BUDGET.start.length ? reste.slice(SERVED_BUDGET.start.length, fin) : null
  if (liste === null) return [{ genre: "brut", texte: reste }]
  const plus = liste.endsWith(SERVED_BUDGET.moreEnd) ? liste.lastIndexOf(SERVED_BUDGET.moreStart) : -1
  const compte = plus < 0 ? "" : liste.slice(plus + SERVED_BUDGET.moreStart.length, liste.length - SERVED_BUDGET.moreEnd.length)
  const autres = NOMBRE_SERVI.test(compte) ? Number(compte) : 0
  const noms = (autres > 0 ? liste.slice(0, plus) : liste).split(", ").map((nom) => (nom.endsWith(SERVED_BUDGET.cut) ? { nom: nom.slice(0, -SERVED_BUDGET.cut.length), coupe: true } : { nom, coupe: false }))
  return [{ genre: "budget", noms, autres }]
}

