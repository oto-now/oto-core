// @vitest-environment node
// Application de base (E08-S05, AC12, NH2) : `src/lib/fonctions-metier.ts` est importé par chaque route de
// l'hôte qui monte une porte du paquet. L'état d'un module vit dans chaque bundle serverless : une route qui
// l'oublierait servirait un catalogue sans les fonctions de l'ERP, et la publication d'une procédure qui les
// cite passerait par une porte et serait refusée par l'autre. Dans l'application de base, la liste est vide, celle
// des connecteurs décrits aussi (moteur des connecteurs décrits).
import fs from "fs"
import path from "path"
import * as z from "zod/v4"
import { describe, expect, it } from "vitest"
import { defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { find } from "../../packages/plateforme/server/find"
import { describedConnector } from "../factories/described-connector"
import { identityOf } from "../helpers/reference-org"
import { simulatedDb } from "../helpers/simulated-db"

const root = path.resolve(__dirname, "../..")
const GATES = ["src/app/api/mcp/route.ts", "src/app/api/mcp-admin/route.ts", "src/app/api/platform/[...route]/route.ts"]

/** Une route qui monte une porte du paquet : elle importe sa face `mcp` ou `api`. */
const mountsGate = (text: string) => /from\s+["']@otomata_tech\/oto_platform\/(?:mcp|api)["']/.test(text)

/** Une route qui inscrit les fonctions de l'ERP : l'import de `@/lib/fonctions-metier` pour son effet. */
const registersErp = (text: string) => /^import\s+["']@\/lib\/fonctions-metier["']/m.test(text)

/** Une page qui lit les connecteurs que l'hôte déclare : leur catalogue ou leurs formulaires. */
const readsConnectors = (text: string) => /\b(?:connectorAccountForms|listConnectorsForOrg)\(/.test(text)

/** Les fichiers nommés `name` sous `dir`, récursivement. */
function filesNamed(dir: string, name: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return filesNamed(full, name)
    return entry.name === name ? [path.relative(root, full).split(path.sep).join("/")] : []
  })
}

const read = (file: string) => ({ file, text: fs.readFileSync(path.join(root, file), "utf8") })

describe("ERP functions of the host (E08-S05)", () => {
  // Délai explicite : le fichier de l'hôte charge toute la face `server`, de 4,6 s au calme à 23 s sous la
  // charge des agents, lancé à froid (2026-09-25).
  it("should import them in every API route that mounts a gate of the package, and register none in the base application (AC12)", { timeout: 60_000 }, async () => {
    const routes = filesNamed(path.join(root, "src/app/api"), "route.ts").map(read)
    expect(routes.filter((route) => mountsGate(route.text)).map((route) => route.file)).toEqual(expect.arrayContaining(GATES))
    expect(routes.filter((route) => mountsGate(route.text) && !registersErp(route.text)).map((route) => route.file)).toEqual([])
    // La garde voit une route qui oublie l'import.
    expect(registersErp('import { handleMcpPost } from "@otomata_tech/oto_platform/mcp"\n')).toBe(false)
    // Une page qui lit les connecteurs déclarés les inscrit aussi : son bundle n'a pas ceux des routes.
    const pages = filesNamed(path.join(root, "src/app"), "page.tsx").map(read).filter((page) => readsConnectors(page.text))
    expect(pages.map((page) => page.file)).toEqual(["src/app/(dashboard)/admin/connectors/page.tsx"])
    expect(pages.filter((page) => !registersErp(page.text)).map((page) => page.file)).toEqual([])

    // Une fonction inscrite avant : le fichier de l'application de base la remplace par sa liste, vide.
    registerFunctions([
      defineErpFunction({
        name: "erp.lookup_customer",
        class: "read",
        description: "Reads a customer of the ERP by its code.",
        schema: z.strictObject({ code: z.string() }),
        examples: [{ code: "C-001" }],
        run: async () => ({ text: "ok" }),
      }),
    ])
    // Un connecteur décrit déclaré avant : l'application de base déclare une liste vide, qui le remplace.
    registerConnectors([describedConnector()])
    await import("@/lib/fonctions-metier")
    const found = await find(simulatedDb().db, identityOf("claire"), { query: "erp", type: "function" }, { functions: catalogFunctions(), activeConnectors: new Set() })
    expect(found.text).not.toContain("erp.")
    expect(catalogFunctions().filter((fn) => fn.connector === describedConnector().name)).toEqual([])
  })
})
