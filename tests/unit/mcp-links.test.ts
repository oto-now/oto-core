// @vitest-environment node
// Anciens chemins et blocs `reference` par le MCP (E03-S07, AC13) : un client `InMemoryTransport`
// (`connectDeps`) sur une base réelle (E01-S10, lot t1-b), dans l'état laissé par le déplacement de l'AC6,
// écrit sur l'organisation O de la graine du fichier. Ce qu'on vérifie est ce que le modèle lit : la ligne
// « moved to » et la ligne résolue (en commentaire, après la clôture) dans les deux canaux, et la cible du
// journal. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { McpDeps } from "../../packages/plateforme/mcp/server"
import { loadNode } from "../../packages/plateforme/server/nodes/read"
import { connectDeps } from "../helpers/mcp"
import { addBlocks, aliasRow, contentTables, identityOf, ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { replaceContent } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const CTX = "7K3Q-M2XA"

function movedOrg() {
  const tables = contentTables([], [
    { path: "ventes", title: "Ventes" },
    { path: "ventes/b", title: "B", summary: "La page B." },
    { path: "ventes/b/x", title: "X" },
    { path: "ventes/cite", title: "Cite" },
  ])
  addBlocks(tables, "ventes/b/x", "published", [{ type: "paragraph", text: "Texte de X.", data: {} }])
  addBlocks(tables, "ventes/cite", "published", [
    { type: "paragraph", text: "La page citée :", data: {} },
    { type: "reference", data: { path: "ventes/b" } },
  ])
  tables.node_aliases = [aliasRow("ventes/a", "ventes/b"), aliasRow("ventes/a/x", "ventes/b/x")]
  tables.orgs = tables.orgs.map((org) => ({ ...org, rules_version: 1 }))
  tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.lea.id, rules_version: 1, host: null }]
  return tables
}

describe.skipIf(!sqlConfigured)(portable("old paths and reference blocks through MCP (AC13)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  it("should serve the moved line and the resolved line in both channels, and journal the current path", async () => {
    const tables = movedOrg()
    await replaceContent(seed, ref, tables)
    await ref.write({ orgs: tables.orgs })
    // L'organisation simulée, son identifiant réel : le préfixe `acme` des outils et des textes servis.
    const identity = ref.identityOf("lea", { org: identityOf("lea").org })
    const deps: McpDeps = {
      db: await ref.db("lea"),
      org: identity.org,
      caller: { kind: "member", identity },
      userAgent: "unit-test",
      journal: [],
      activeConnectors: () => Promise.resolve(new Set<string>()), adoptedConnectors: () => Promise.resolve(new Set<string>()),
      origin: "https://acme.test",
    }
    const session = await connectDeps(deps)
    // Le code semé sous une valeur tirée au hasard (`DRAWN`) : celle que la conversation porte.
    const ctx = ref.id(CTX)

    const moved = await session.call("read", { ctx, path: "ventes/a/x" })
    expect(moved.isError).toBe(false)
    expect(moved.text.split("\n").slice(0, 2)).toEqual(["ventes/a/x moved to ventes/b/x on 2026-09-24: use the new path.", "# X"])
    expect(moved.result.structuredContent).toMatchObject({ text: moved.text, moved_from: "ventes/a/x", path: "ventes/b/x" })
    expect(session.journal.at(-1)).toMatchObject({ tool: "acme_read", target: "ventes/b/x" })

    const cited = await session.call("read", { ctx, path: "ventes/cite" })
    expect(cited.text).toContain("La page citée :\n\n```reference\nventes/b\n```\n<!-- → page: B — La page B. (ventes/b) -->")
    expect(cited.result.structuredContent).toMatchObject({ text: cited.text, references: [{ kind: "page", path: "ventes/b", title: "B", status: "ok" }] })
  })

  it("should lead an old path under perso/ to the node now under private/, for the assistant and the screen, and keep it unknown to anyone else (D107)", async () => {
    // Ce que la migration 20260928120000 laisse : le nœud sous `private/`, son ancien chemin en alias.
    const tables = contentTables([], [{ path: "private/lea/notes", title: "Notes" }])
    addBlocks(tables, "private/lea/notes", "published", [{ type: "paragraph", text: "Mes notes.", data: {} }])
    tables.node_aliases = [aliasRow("perso/lea/notes", "private/lea/notes", "lea")]
    tables.orgs = tables.orgs.map((org) => ({ ...org, rules_version: 1 }))
    tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.lea.id, rules_version: 1, host: null }]
    await replaceContent(seed, ref, tables)
    await ref.write({ orgs: tables.orgs })
    const lea = ref.identityOf("lea", { org: identityOf("lea").org })
    const session = await connectDeps({
      db: await ref.db("lea"),
      org: lea.org,
      caller: { kind: "member", identity: lea },
      userAgent: "unit-test",
      journal: [],
      activeConnectors: () => Promise.resolve(new Set<string>()), adoptedConnectors: () => Promise.resolve(new Set<string>()),
      origin: "https://acme.test",
    })

    const moved = await session.call("read", { ctx: ref.id(CTX), path: "perso/lea/notes" })
    expect(moved.text.split("\n").slice(0, 2)).toEqual(["perso/lea/notes moved to private/lea/notes on 2026-09-24: use the new path.", "# Notes"])
    expect(moved.result.structuredContent).toMatchObject({ moved_from: "perso/lea/notes", path: "private/lea/notes" })
    expect(session.journal.at(-1)).toMatchObject({ tool: "acme_read", target: "private/lea/notes" })
    // L'écran (`/n/perso/lea/notes`) lit le même nœud par `loadNode`.
    expect(await loadNode(await ref.db("lea"), lea, { path: "perso/lea/notes" })).toMatchObject({ path: "private/lea/notes", title: "Notes" })
    // Ada, qui administre, ne lit pas l'espace de Léa (D5) : l'ancien chemin est inconnu, comme le nouveau (H68).
    const ada = ref.identityOf("ada", { org: identityOf("ada").org })
    for (const path of ["perso/lea/notes", "private/lea/notes"]) {
      await expect(loadNode(await ref.db("ada"), ada, { path })).rejects.toMatchObject({ code: "not_found" })
    }
  })
})
