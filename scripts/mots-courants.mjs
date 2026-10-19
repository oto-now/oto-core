#!/usr/bin/env node
// Génère la liste des mots courants de la pseudonymisation (`docs/conception/pseudonymisation.md` § Le dictionnaire et
// la détection) : un nom de famille seul qui est un mot courant ou un prénom reste en clair. Deux sources, épinglées par
// version et empreinte, chacune dans son fichier avec sa notice :
// - les mots communs du lexique de Grammalecte (MPL 2.0), sans noms propres, prénoms ni patronymes, vus au moins
//   `MIN_OCCURRENCES` fois dans ses corpus ;
// - les prénoms du fichier des prénoms de l'Insee (Licence Ouverte 2.0), donnés au moins `MIN_BIRTHS` fois.
// Lancer : `node scripts/mots-courants.mjs` (Node 24, qui lit `normalize.ts`). Demande `curl` et `unzip`.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizedText } from "../packages/plateforme/server/pseudonym/normalize.ts"

const OUT = new URL("../packages/plateforme/server/pseudonym/words/", import.meta.url)

const LEXICON = {
  url: "https://grammalecte.net/dic/lexique-grammalecte-fr-v7.7.zip",
  sha256: "bdccf2065e252010253171000a38de84581407896b6bc60aca7d4d69dab7e4d2",
  entry: "lexique-grammalecte-fr-v7.7.txt",
}
const FIRST_NAMES = {
  url: "https://www.insee.fr/fr/statistiques/fichier/8595130/prenoms-2025-nat_csv.zip",
  sha256: "4c3662bbc75a021a2203b9bed0beff7e85c7928779b88602814ed407cfee512e",
  entry: "prenoms-2025-nat.csv",
  published: "16/07/2026",
}
/** Au-dessous, un prénom est trop rare pour qu'un nom de famille qui l'écrit reste en clair (Durand : 75 naissances). */
const MIN_BIRTHS = 1000
/**
 * Au-dessous (environ 0,7 par million de mots des corpus du lexique), un mot est trop rare pour qu'un nom de famille
 * qui l'écrit reste en clair : « moreau » (4 030) ou « fournier » (13 104) se masquent, « brun » ou « fontaine » non.
 */
const MIN_OCCURRENCES = 100_000
/** Les étiquettes du lexique qui ne sont pas des mots communs : nom propre, prénom, patronyme. */
const PROPER = new Set(["npr", "prn", "patr"])
/** Une forme gardée : des lettres, tirets compris, au moins trois lettres (le nom seul en a au moins trois). */
const KEPT = /^[a-z]+(?:-[a-z]+)*$/u

/** Le texte de `entry` dans l'archive de `source`, téléchargée dans `dir` et contrôlée par son empreinte. */
function sourceText(source, dir) {
  const zip = join(dir, source.entry + ".zip")
  execFileSync("curl", ["-sSfL", "-o", zip, source.url])
  const sha = createHash("sha256").update(readFileSync(zip)).digest("hex")
  if (sha !== source.sha256) throw new Error(`${source.url}: sha256 ${sha}, expected ${source.sha256}`)
  return execFileSync("unzip", ["-p", zip, source.entry], { maxBuffer: 1 << 28 }).toString("utf8")
}

function kept(word) {
  const form = normalizedText(word)
  return KEPT.test(form) && form.replaceAll("-", "").length >= 3 ? form : null
}

function lexiconWords(text) {
  const words = new Set()
  let header = false
  for (const line of text.split("\n")) {
    if (!header) {
      header = line.startsWith("id\tfid\t")
      continue
    }
    const columns = line.split("\t")
    const [, , flexion, , tags] = columns
    if (!flexion || flexion !== flexion.toLowerCase() || Number(columns[15]) < MIN_OCCURRENCES) continue
    if ((tags ?? "").split(" ").some((tag) => PROPER.has(tag))) continue
    const form = kept(flexion)
    if (form) words.add(form)
  }
  return words
}

function firstNames(text) {
  const births = new Map()
  for (const line of text.split("\n").slice(1)) {
    const [, name, , count] = line.split(";")
    if (!name || name.startsWith("_")) continue
    births.set(name, (births.get(name) ?? 0) + Number(count))
  }
  const names = new Set()
  for (const [name, total] of births) {
    const form = total >= MIN_BIRTHS ? kept(name) : null
    if (form) names.add(form)
  }
  return names
}

function tsModule(notice, name, words) {
  const list = [...words].sort().join(" ")
  return `${notice}\n// Généré par \`scripts/mots-courants.mjs\` : ne pas modifier à la main.\n\n/** ${words.size} formes normalisées, séparées par une espace. */\nexport const ${name} = "${list}"\n`
}

const dir = mkdtempSync(join(tmpdir(), "mots-courants-"))
try {
  const words = lexiconWords(sourceText(LEXICON, dir))
  const names = firstNames(sourceText(FIRST_NAMES, dir))
  writeFileSync(
    new URL("common-words.ts", OUT),
    tsModule(
      `// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Les mots communs du lexique des formes fléchies du français de Grammalecte, version 7.7 (Olivier R.,
// https://grammalecte.net/), sous MPL 2.0 : formes normalisées, sans noms propres, prénoms ni patronymes, vues au moins
// ${MIN_OCCURRENCES} fois dans ses corpus.`,
      "COMMON_WORDS",
      words,
    ),
  )
  writeFileSync(
    new URL("first-names.ts", OUT),
    tsModule(
      `// Source : Insee, fichier des prénoms (état civil, naissances en France de 1900 à 2025), paru le ${FIRST_NAMES.published},
// https://www.insee.fr/fr/statistiques/8595130, sous Licence Ouverte 2.0 (Etalab) : les prénoms donnés au moins
// ${MIN_BIRTHS} fois, en formes normalisées.`,
      "FIRST_NAMES",
      names,
    ),
  )
  console.log(`common words: ${words.size}, first names: ${names.size}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
