#!/usr/bin/env node
/**
 * changelog-version — dans la pull request de version, verse les fragments du CHANGELOG du paquet
 * (`packages/plateforme/changelog.d/AAAA-MM-JJ-<sujet>.md`, un par changement) dans la section de la version, puis les supprime.
 *
 * Usage : `pnpm changelog:version <x.y.z> [--date AAAA-MM-JJ]` (date du jour à Paris par défaut), à la racine du dépôt.
 * Les lignes encore écrites sous `## Unreleased` sont versées avec eux, avant eux ; `## Unreleased` reste, vide, en tête.
 * Refuse, sans rien écrire, un fragment mal formé, une version déjà présente ou une version sans aucune ligne. `scripts/ci/version-publiable.mjs`
 * refuse ensuite le tag d'un commit où un fragment, ou une ligne sous `## Unreleased`, reste.
 *
 * Pourquoi des fragments : chaque pull request qui écrivait sous `## Unreleased` mettait toutes les autres en conflit
 * à sa fusion ; un fichier neuf par changement n'en crée aucun.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

export const CHANGELOG = "packages/plateforme/CHANGELOG.md"
export const FRAGMENTS = "packages/plateforme/changelog.d"
const LISTES = ["### Assistants", "### Hosts"]
/** Le nom d'un fragment : `AAAA-MM-JJ-<sujet>.md`, sujet en minuscules, chiffres et tirets ; l'ordre des noms est celui des dates. */
const NOM_DE_FRAGMENT = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/

const lignesDe = (texte) => texte.replace(/\r\n/g, "\n").split("\n")

/** Les bornes du corps de `## Unreleased` (premier rang après le titre, rang du titre suivant), ou null sans ce titre. */
function bornesDUnreleased(lignes) {
  const debut = lignes.findIndex((ligne) => ligne.trim() === "## Unreleased")
  if (debut < 0) return null
  const suivante = lignes.findIndex((ligne, rang) => rang > debut && ligne.startsWith("## "))
  return { debut: debut + 1, fin: suivante < 0 ? lignes.length : suivante }
}

/**
 * Les lignes sous `## Unreleased`, jusqu'au titre de version suivant ; aucune sans ce titre.
 * `scripts/ci/version-publiable.mjs` refuse une version où l'une n'est pas blanche.
 * @param {string[]} lignes
 * @returns {string[]}
 */
export function lignesSousUnreleased(lignes) {
  const bornes = bornesDUnreleased(lignes)
  return bornes ? lignes.slice(bornes.debut, bornes.fin) : []
}

/**
 * Les défauts des listes d'un texte du CHANGELOG du paquet (le fichier après son premier `## `, ou un fragment) : des
 * listes `### Assistants` et `### Hosts` seules, d'entrées d'une ligne `- …` ; une entrée Assistants, servie à un
 * assistant, tient en 200 caractères. `versions` : un titre `## …` (une version) ferme la liste en cours ; sans lui
 * (un fragment), il est un défaut.
 * @param {string[]} lignes
 * @param {{ versions?: boolean }} [options]
 * @returns {string[]}
 */
export function defautsDesListes(lignes, { versions = true } = {}) {
  const defauts = []
  let liste = null
  for (const ligne of lignes) {
    if (!ligne.trim()) continue
    if (ligne.startsWith("#")) {
      if (versions && ligne.startsWith("## ")) liste = null
      else if (LISTES.includes(ligne)) liste = ligne
      else {
        defauts.push(`titre inattendu : ${ligne}`)
        liste = null
      }
    } else if (!liste) defauts.push(`entrée hors d'une liste : ${ligne}`)
    else if (!/^- \S/.test(ligne)) defauts.push(`entrée qui n'ouvre pas sur « - » : ${ligne}`)
    else if (liste === "### Assistants" && ligne.length - 2 > 200) defauts.push(`entrée Assistants de plus de 200 caractères : ${ligne}`)
  }
  return defauts
}

/**
 * Les défauts d'un fragment : son nom, ses listes (sans titre de version), au moins une entrée.
 * @param {string} nom
 * @param {string} texte
 * @returns {string[]}
 */
export function defautsDuFragment(nom, texte) {
  const lignes = lignesDe(texte)
  const defauts = defautsDesListes(lignes, { versions: false })
  if (!NOM_DE_FRAGMENT.test(nom)) defauts.unshift("nom hors de la forme AAAA-MM-JJ-<sujet>.md (minuscules, chiffres, tirets)")
  if (!lignes.some((ligne) => ligne.startsWith("- "))) defauts.push("aucune entrée")
  return defauts.map((defaut) => `${nom} : ${defaut}`)
}

/** Les entrées d'un texte, par liste, dans leur ordre. */
function entreesParListe(lignes) {
  const entrees = Object.fromEntries(LISTES.map((liste) => [liste, []]))
  let liste = null
  for (const ligne of lignes) {
    if (LISTES.includes(ligne)) liste = ligne
    else if (liste && ligne.startsWith("- ")) entrees[liste].push(ligne)
  }
  return entrees
}

/**
 * Le CHANGELOG où les lignes de `## Unreleased` puis les fragments (dans l'ordre donné) forment la section
 * `## <version> — <date>`, placée sous `## Unreleased` vidé.
 * @param {string} changelog
 * @param {{ nom: string, texte: string }[]} fragments
 * @param {string} version
 * @param {string} date
 * @returns {string}
 */
function verser(changelog, fragments, version, date) {
  const defauts = fragments.flatMap(({ nom, texte }) => defautsDuFragment(nom, texte))
  if (defauts.length) throw new Error(`fragments mal formés :\n${defauts.join("\n")}`)
  const lignes = lignesDe(changelog)
  if (lignes.some((ligne) => ligne.startsWith(`## ${version} — `))) throw new Error(`la section ## ${version} existe déjà`)
  const bornes = bornesDUnreleased(lignes)
  if (!bornes) throw new Error("aucune section ## Unreleased")

  const entrees = entreesParListe(lignesSousUnreleased(lignes))
  for (const { texte } of fragments) {
    const siennes = entreesParListe(lignesDe(texte))
    for (const liste of LISTES) entrees[liste].push(...siennes[liste])
  }
  if (!LISTES.some((liste) => entrees[liste].length)) throw new Error(`aucune ligne à verser dans ## ${version} : ni fragment, ni ligne sous ## Unreleased`)
  const section = [`## ${version} — ${date}`, ""]
  for (const liste of LISTES) if (entrees[liste].length) section.push(liste, ...entrees[liste], "")
  // Les fins de ligne du fichier sont gardées : un checkout Windows (autocrlf) le lit en CRLF.
  const finDeLigne = changelog.includes("\r\n") ? "\r\n" : "\n"
  return [...lignes.slice(0, bornes.debut), "", ...section, ...lignes.slice(bornes.fin)].join(finDeLigne)
}

/** La date du jour à Paris, `AAAA-MM-JJ`. */
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date())

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ options: { date: { type: "string" } }, allowPositionals: true })
  const [version] = positionals
  const date = values.date ?? aujourdhui()
  if (positionals.length !== 1 || !/^\d+\.\d+\.\d+$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: pnpm changelog:version <x.y.z> [--date AAAA-MM-JJ]")
    process.exit(2)
  }
  const dossier = join(process.cwd(), FRAGMENTS)
  const noms = existsSync(dossier) ? readdirSync(dossier).filter((nom) => nom.endsWith(".md")).sort() : []
  const fragments = noms.map((nom) => ({ nom, texte: readFileSync(join(dossier, nom), "utf8") }))
  const fichier = join(process.cwd(), CHANGELOG)
  try {
    writeFileSync(fichier, verser(readFileSync(fichier, "utf8"), fragments, version, date))
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : String(erreur))
    process.exit(1)
  }
  for (const nom of noms) rmSync(join(dossier, nom))
  console.log(`## ${version} — ${date} : ${noms.length} fragment(s) versé(s) dans ${CHANGELOG}, puis supprimés`)
}
