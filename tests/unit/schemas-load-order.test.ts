// @vitest-environment node
import { execFile } from "child_process"
import path from "path"
import { promisify } from "util"
import { beforeAll, describe, expect, it } from "vitest"

// Un hôte n'importe pas `schemas/` par son index : avec `"sideEffects": false`, son bundler peut
// charger en premier n'importe quel module de la face (la page publique commence par `files.ts`).
// Chaque module doit donc s'évaluer quand il ouvre le graphe. Le chargement se joue dans un Node
// natif (`tests/helpers/native-load-first.mjs`) : l'exécuteur de Vitest masque l'erreur.
const SCHEMAS = path.resolve(__dirname, "../../packages/plateforme/schemas")
const HELPER = path.resolve(__dirname, "../helpers/native-load-first.mjs")

// Un seul processus charge les modules l'un après l'autre : 10 s au calme, marge pour la charge.
const LOAD_TIMEOUT = 60_000

describe("schemas face load order", () => {
  let failures: Record<string, string> = {}

  beforeAll(async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [HELPER, SCHEMAS], { timeout: LOAD_TIMEOUT })
    failures = JSON.parse(stdout)
  }, LOAD_TIMEOUT)

  // Le différentiel nomme chaque module fautif et son erreur.
  it("should load every module of the face when it is imported first", () => {
    expect(failures).toEqual({})
  })
})
