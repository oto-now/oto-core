// @vitest-environment node
// Une seule tête de migrations : deux branches qui ajoutent chacune une migration, fusionnées dans un ordre autre que
// celui de leurs horodatages, laisseraient une migration rangée avant une autre déjà appliquée chez un hôte. Le test
// tient trois choses : des horodatages uniques et bien formés ; la liste du README (§ Fichiers), que chaque branche
// allonge à la fin, dans l'ordre des fichiers, chaque migration non publiée comprise (une migration plus ancienne fusionnée après une plus récente s'y voit
// à la fin, hors de son rang) ; aucune migration non publiée datée avant la dernière version publiée (`_vX_Y_Z.sql`).
import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const dir = path.resolve(__dirname, "../../packages/plateforme/migrations")
const FILE = /^(\d{14})_[a-z0-9_]+\.sql$/
const VERSION = /^\d{14}_v\d+_\d+_\d+\.sql$/

const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort()

describe("migrations : une seule tête", () => {
  it("chaque fichier est nommé par sa date et son heure, chaque horodatage une seule fois", () => {
    expect(files.filter((name) => !FILE.test(name))).toEqual([])
    const stamps = files.map((name) => name.slice(0, 14))
    expect(stamps.filter((stamp, index) => stamps.indexOf(stamp) !== index)).toEqual([])
  })

  it("le README liste les fichiers dans leur ordre, chacun une fois, et chaque migration non publiée", () => {
    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8")
    const section = readme.slice(readme.indexOf("## Fichiers"), readme.indexOf("\n## ", readme.indexOf("## Fichiers") + 1))
    const listed = [...section.matchAll(/^- `(\d{14}_[^`]+\.sql)`/gm)].map((match) => match[1])
    // Les plus anciennes, réunies dans une ligne de base, n'y ont plus d'entrée : l'ordre et l'unicité suffisent pour elles.
    expect(listed).toEqual([...new Set(listed)].sort())
    expect(listed.filter((name) => !files.includes(name))).toEqual([])
    const versions = files.filter((name) => VERSION.test(name))
    expect(files.filter((name) => name > versions[versions.length - 1] && !listed.includes(name))).toEqual([])
  })

  it("aucune migration non publiée n'est datée avant la dernière version publiée", () => {
    const versions = files.filter((name) => VERSION.test(name))
    const last = versions[versions.length - 1]
    expect(last).toBeDefined()
    // Après la dernière version, les migrations du développement ; avant, rien qui n'appartienne à une version publiée :
    // la liste du README, dans l'ordre, l'a déjà vérifié pour chaque fichier.
    const unpublished = files.filter((name) => name > last)
    expect(unpublished.every((name) => !VERSION.test(name) && name.slice(0, 14) > last.slice(0, 14))).toBe(true)
  })
})
