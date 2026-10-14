// @vitest-environment node
// L'import d'un CSV sur une vraie base (E10-S01, AC-b3 à AC-b5, AC-c1, AC-c2 ; fiches D100, D117, D120) :
// `table.import` par `acme_call` (`InMemoryTransport`, `connectDeps`) et `POST tables/import` (la route de l'API),
// deux portes d'`importRows`. Création sous l'écriture du parent (E11-S02), en-tête publié, types et clé déduits, provenance
// `import` par cellule, second morceau fusionné sur la clé, lot tout ou rien, refus mot pour mot, aucune requête
// d'écriture après un refus de droit (`spyDb`), le journal de `call`. Et `write` : `tolerant` ignoré par le MCP,
// lu par l'API. Fixture des tableaux semée une fois (`seedTableFixture`), suite portable.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { tablesRoutes } from "../../packages/plateforme/api/tables"
import type { Route } from "../../packages/plateforme/api/handler"
import type { Identity } from "../../packages/plateforme/server/identity"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { importRows } from "../../packages/plateforme/server/tables/import"
import { connectDeps } from "../helpers/mcp"
import { ORG, PEOPLE, TEAMS } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { portable, seedWithAdmin, spyDb, sqlConfigured, writesOf, type SeededData } from "../helpers/sql"
import { PROSPECTS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity } from "../factories/table-publish-sql"
import { CASE_TIMEOUT, SEED_TIMEOUT } from "../factories/table-rows-sql"

const CTX = { lea: "ABCD-1234", claire: "ABCD-5678" } as const
const HEADER_LINE = "Nom;Ville;Montant;Inscrit le;Actif"
const CLIENTS = "ventes/clients"

/** La route `POST tables/import` de l'API, appelée comme la porte l'appelle. */
const importRoute = [tablesRoutes.POST].flat().find((route): route is Route => route?.fixed?.[0] === "import")

describe.skipIf(!sqlConfigured)(portable("table.import and POST tables/import on a real database"), { timeout: CASE_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    await ref.write({ ctx: (["lea", "claire"] as const).map((person) => ({ code: CTX[person], user_id: PEOPLE[person].id, org_id: ORG.id, rules_version: 1, host: null })) })
  }, SEED_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SEED_TIMEOUT)

  async function session(person: keyof typeof CTX) {
    const identity = acmeIdentity(ref, person)
    const deps = { db: await ref.db(person), org: identity.org, caller: { kind: "member" as const, identity }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" }
    const connected = await connectDeps(deps)
    return { ...connected, run: (fn: string, args: Record<string, unknown>) => connected.call("call", { ctx: ref.id(CTX[person]), function: fn, arguments: args }) }
  }

  /** Les lignes d'un tableau de O, par clé, relues par la connexion d'administration. */
  async function rowsOf(path: string): Promise<Row[]> {
    const rows = await seed.admin<Row[]>`
      select b.key, b.data, b.provenance, b.revision from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = ${path} and b.state = 'published' and b.type = 'row' order by b.key`
    return ref.readable([...rows])
  }

  it("should create and publish a table with the types and key read from the CSV, each value carrying its import provenance, then merge a second piece on the key (AC-c1, AC-b3)", async () => {
    const claire = await session("claire")
    const csv = `${HEADER_LINE}\nBoulangerie du Pont;Valbrune;12 500,50;29/09/2026;oui\nAtelier 2;Brémontier;8000;2026-09-30;non`
    const created = await claire.run("table.import", { table: CLIENTS, csv, create: { title: "Clients", summary: "Les clients exportés." }, file_name: "clients.csv" })
    expect([created.isError, created.text.split("\n").slice(0, 2)]).toEqual([
      false,
      [
        "Created and published ventes/clients: nom (text), ville (text), montant (number), inscrit_le (date), actif (bool); key nom.",
        "ventes/clients: 2 row(s) created, 0 updated, 0 unchanged.",
      ],
    ])
    expect(created.result.structuredContent).toMatchObject({ result: { table: CLIENTS, created: 2, updated: 0, unchanged: 0, key: "nom" } })
    const [node] = await seed.admin<{ revision: number; status: string }[]>`select revision, status from platform.nodes where org_id = ${ref.org.id} and path = ${CLIENTS}`
    expect(node).toEqual({ revision: 1, status: "published" })
    const boulangerie = (await rowsOf(CLIENTS)).find((row) => row.key === "Boulangerie du Pont")
    expect(boulangerie?.data).toEqual({ nom: "Boulangerie du Pont", ville: "Valbrune", montant: 12500.5, inscrit_le: "2026-09-29", actif: true })
    expect(boulangerie?.provenance).toMatchObject({
      ville: { origin: "import", by: PEOPLE.claire.id, ctx: expect.any(String), at: expect.stringMatching(/Z$/), comment: "Importé de clients.csv" },
      nom: { origin: "import", by: PEOPLE.claire.id },
    })

    const piece = `${HEADER_LINE};Inconnue\nAtelier 2;Valbrune;8000;2026-09-30;non;x\nScierie Vallon;Port-Lise;1;2026-10-01;oui;y\nBoulangerie du Pont;Valbrune;12 500,50;29/09/2026;oui;z`
    const merged = await claire.run("table.import", { table: CLIENTS, csv: piece, file_name: "clients.csv" })
    expect(merged.text.split("\n").slice(0, 2)).toEqual(["ventes/clients: 1 row(s) created, 1 updated, 1 unchanged.", "Ignored columns, not in the table or its state column: Inconnue."])
    expect(merged.result.structuredContent).toMatchObject({ next_actions: expect.arrayContaining(["table.rows", "table.write", "table.import"]) })
    // Chaque ligne du tableau porte `ville` : `data` est relu de la base sans type.
    expect((await rowsOf(CLIENTS)).map((row) => [row.key, row.revision, (row.data as { ville: string }).ville])).toEqual([
      ["Atelier 2", 2, "Valbrune"],
      ["Boulangerie du Pont", 1, "Valbrune"],
      ["Scierie Vallon", 1, "Port-Lise"],
    ])
    expect(ref.readable(claire.journal.map((line) => [line.tool, line.target, line.team_id, line.is_error ?? false]))).toEqual([
      ["acme_call", "table.import", TEAMS.ventes.id, false],
      ["acme_call", "table.import", TEAMS.ventes.id, false],
    ])
  })

  it("should key a table on a column of dates, first column or named by key, rows matched on the date however written (FB-0014)", async () => {
    const claire = await session("claire")
    const create = (table: string, csv: string, key?: string) =>
      claire.run("table.import", { table, csv, create: { title: "Journées", summary: "Les ventes par jour." }, ...(key ? { key } : {}) })
    const first = await create("ventes/journees", "Jour;Ventes\n29/09/2026;12\n2026-09-30;15")
    const named = await create("ventes/journees_vendeur", "Vendeur;Jour\nA;29/09/2026\nA;30/09/2026", "Jour")
    const merged = await claire.run("table.import", { table: "ventes/journees", csv: "Jour;Ventes\n30/09/2026;16" })

    expect([first.text.split("\n")[0], named.text.split("\n")[0], merged.text.split("\n")[0]]).toEqual([
      "Created and published ventes/journees: jour (date), ventes (number); key jour.",
      "Created and published ventes/journees_vendeur: vendeur (text), jour (date); key jour.",
      "ventes/journees: 0 row(s) created, 1 updated, 0 unchanged.",
    ])
    expect((await rowsOf("ventes/journees")).map((row) => [row.key, (row.data as { ventes: number }).ventes])).toEqual([
      ["2026-09-29", 12],
      ["2026-09-30", 16],
    ])
  })

  it("should serve its refusals word for word: cells, no key, a taken path, an unknown table, too large (AC-c1)", async () => {
    const claire = await session("claire")
    const refusal = async (args: Record<string, unknown>) => {
      const result = await claire.run("table.import", args)
      expect(result.isError, JSON.stringify(args).slice(0, 80)).toBe(true)
      return result.text
    }
    expect(await refusal({ table: PROSPECTS.path, csv: "Entreprise;Montant estimé\nAtelier 2;abc\n;3" })).toBe(
      'Nothing was written: line 2, column montant_estime: "abc" is not a number; line 3, column entreprise: "" is not a key: every line needs one.',
    )
    expect(await refusal({ table: "ventes/sans_cle", csv: "a;b\nx;1\nx;1", create: { title: "Sans clé", summary: "Aucune clé." } })).toBe(
      "no column has a value on every line, all distinct: pass key, the column that identifies a row",
    )
    expect(await refusal({ table: PROSPECTS.path, csv: "a\nx", create: { title: "Pris", summary: "Chemin pris." } })).toBe("Path ventes/suivi_prospects is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path.")
    expect(await refusal({ table: "ventes/inconnu", csv: "a\nx" })).toMatch(/^Unknown table ventes\/inconnu\. Tables you can read: /)
    expect(await refusal({ table: CLIENTS, csv: `nom\n${"x".repeat(40_000)}` })).toBe(
      "csv is 40,004 characters; 40,000 at most per call: send it in pieces of about 20,000 characters, each starting with the header line.",
    )
    // Une cellule trop longue ne se coupe pas en morceaux : sa consigne est la sienne.
    expect(await refusal({ table: PROSPECTS.path, csv: `Entreprise\n${"x".repeat(10_001)}` })).toBe(
      "line 2: a cell of more than 10,000 characters; 10,000 at most: shorten that cell; a long text belongs in a page, whose path the cell can hold.",
    )
  })

  it("should create and publish a table under a parent the caller writes, and refuse a reader of the parent before any write, saying whom to ask (AC-b3, E11-S02)", async () => {
    const request = { by: { kind: "human" as const }, comment: "Importé de essai.csv", headers: ["nom"], rows: [["x"]] }
    const create = (title: string) => ({ title, summary: "Essai.", header: { columns: [{ name: "nom", type: "text" as const }], key: "nom" } })
    // Léa écrit `ventes` (membre de l'équipe Ventes) sans le gérer : écrire publie, la création comprise.
    await importRows({ db: await ref.db("lea"), identity: acmeIdentity(ref, "lea") }, { ...request, path: "ventes/de_lea", create: create("De Léa") })
    const [node] = await seed.admin<{ revision: number; status: string }[]>`select revision, status from platform.nodes where org_id = ${ref.org.id} and path = 'ventes/de_lea'`
    expect(node).toEqual({ revision: 1, status: "published" })

    const [rule] = await ref.addRules([{ node: "ventes", user: "marc", level: "read" }])
    try {
      const { db, sent } = spyDb(await ref.db("marc"))
      const refused = await importRows({ db, identity: acmeIdentity(ref, "marc") }, { ...request, path: "ventes/de_marc", create: create("De Marc") }).catch((error: unknown) => error)
      expect(refused).toMatchObject({ code: "forbidden", message: "Writing under ventes is reserved to team Ventes (lead: Claire Morel). Ask them for access." })
      // Aucune écriture : ni instruction, ni fonction qui ouvre un brouillon ou publie.
      expect([...writesOf(sent), ...sent.filter((query) => query.op === "call" && ["open_draft", "publish_node"].includes(query.target ?? ""))]).toEqual([])
    } finally {
      await seed.admin`delete from platform.access_rules where id = ${rule}`
    }
  })

  it("should keep a table whose first lot is refused after its creation, say its path, and fill it on a resume without create (HN-E10S01-21)", async () => {
    const context = { db: await ref.db("claire"), identity: acmeIdentity(ref, "claire") }
    const path = "ventes/obligatoire"
    const header = { columns: [{ name: "nom", type: "text" as const }, { name: "ville", type: "text" as const, required: true }], key: "nom" }
    const request = { path, by: { kind: "human" as const }, comment: "Importé de obligatoire.csv", headers: ["nom", "ville"] }
    const refused = await importRows(context, { ...request, create: { title: "Obligatoire", summary: "Une colonne requise.", header }, rows: [["Atelier", ""]] }).catch((error: unknown) => error)
    expect(refused).toMatchObject({
      code: "invalid_arguments",
      message:
        "The table ventes/obligatoire was created and published, but none of these rows was written: line 2: ville: required when creating a row: set it, or verified_empty with a reason. Send them again to ventes/obligatoire, without create.",
      details: { created: path },
    })
    const [node] = await seed.admin<{ status: string }[]>`select status from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    expect([node?.status, await rowsOf(path)]).toEqual(["published", []])

    const resumed = await importRows(context, { ...request, rows: [["Atelier", "Valbrune"]] })
    expect([resumed.table.node.path, resumed.created]).toEqual([path, 1])
  })

  it("should say the created table when a read fails after its creation, before any row is written (HN-E10S01-21)", async () => {
    const path = "ventes/panne_apres_creation"
    let published = false
    let owners = 0
    const { db } = spyDb(await ref.db("claire"), {
      fail: (query) => {
        published ||= query.target === "publish_node"
        if (!published || query.target !== "node_owner") return null
        owners += 1
        // Le premier `node_owner` après la publication est celui du résultat de `write` ; le second, l'équipe du tableau.
        return owners === 2 ? { code: "57014" } : null
      },
    })
    const header = { columns: [{ name: "nom", type: "text" as const }], key: "nom" }
    const request = { path, by: { kind: "human" as const }, comment: "Importé de panne.csv", headers: ["nom"], rows: [["Atelier"]] }
    const refused = await importRows({ db, identity: acmeIdentity(ref, "claire") }, { ...request, create: { title: "Panne", summary: "Une panne après la création.", header } }).catch((error: unknown) => error)
    expect(refused).toMatchObject({
      code: "internal",
      message: `The table ${path} was created and published, but none of these rows was written: Internal error. Send them again to ${path}, without create.`,
      details: { created: path },
    })
    const [node] = await seed.admin<{ status: string }[]>`select status from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    expect([owners, node?.status, await rowsOf(path)]).toEqual([2, "published", []])
  })

  it("should write a lot of the screen into an existing table, merged on the key, the state column ignored, all or nothing (AC-b5)", async () => {
    if (!importRoute) throw new Error("no POST tables/import route")
    const lea: Identity = acmeIdentity(ref, "lea")
    const send = async (body: Record<string, unknown>) => importRoute.handle({ db: await ref.db("lea"), identity: lea, body, origin: "https://acme.test", request: new Request("https://acme.test/api/platform/tables/import"), params: ["import"] })
    const columns = ["entreprise", "ville", "statut"]
    const done = await send({ table: PROSPECTS.path, file_name: "prospects.csv", columns, rows: [["Atelier 2", "Valbrune", "écarté"], ["Boulangerie Fournier", "Brémontier", "x"], ["Nouvelle Forge", "Valbrune", ""]] })
    expect(done).toMatchObject({ status: 200, data: { path: PROSPECTS.path, created: 1, updated: 1, unchanged: 1, ignored: ["statut"] }, journal: { target: PROSPECTS.path } })
    const forge = (await rowsOf(PROSPECTS.path)).find((row) => row.key === "Nouvelle Forge")
    expect(forge?.data).toEqual({ entreprise: "Nouvelle Forge", ville: "Valbrune", statut: "à traiter" })
    expect(forge?.provenance).toMatchObject({ ville: { origin: "import", by: PEOPLE.lea.id, ctx: null, comment: "Importé de prospects.csv" } })
    // « Atelier 10 » est réservé par Claire : tout le lot est refusé, « Scierie Neuve » n'est pas créée.
    const refused = await send({ table: PROSPECTS.path, file_name: "prospects.csv", columns, rows: [["Scierie Neuve", "Valbrune", ""], ["Atelier 10", "Valbrune", ""]] }).catch((error: unknown) => error)
    expect(refused).toMatchObject({ code: "invalid_arguments", message: expect.stringMatching(/^Nothing was written: line 3: Atelier 10 is claimed by worker claude-claire until \d{2}:\d{2} UTC\.$/) })
    expect((await rowsOf(PROSPECTS.path)).some((row) => row.key === "Scierie Neuve")).toBe(false)
  })

  it("should keep write strict through MCP, tolerant refused as an unknown key, and read tolerant from the body of the API (AC-a2)", async () => {
    const claire = await session("claire")
    const text = "# Titre\n\n```call\nx {\n```"
    const strict = await claire.call("write", { ctx: ref.id(CTX.claire), path: "ventes/cr_strict", title: "CR", summary: "Un compte rendu.", ops: [{ op: "insert_after", text }], tolerant: true })
    expect([strict.isError, strict.text]).toEqual([true, "Invalid arguments for acme_write: unknown key « tolerant »; keys: ctx, path, base_revision, title, summary, kind, ops, header, publish"])
    const screen = await writeNode(await ref.db("claire"), acmeIdentity(ref, "claire"), { path: "ventes/cr_ecran", title: "CR", summary: "Un compte rendu.", ops: [{ op: "insert_after", text }], tolerant: true }, { kind: "human" })
    expect(screen.data).toMatchObject({ kept_as_text: 1 })
  })

  it("should serve the contract of table.import and the sentences of AC-c2 in write.table (AC-c2)", async () => {
    const claire = await session("claire")
    const sentence = "A CSV or a spreadsheet the user gives you becomes a table: use table.import, in pieces of 40,000 characters, each starting with the header line."
    const contract = await claire.call("read", { ctx: ref.id(CTX.claire), path: "table.import" })
    expect(contract.text.split("\n")[0]).toBe("Function table.import (connector table, origin paquet, class write)")
    expect(contract.text).toContain(sentence)
    const table = await claire.call("read", { ctx: ref.id(CTX.claire), path: "write.table" })
    expect(table.text).toContain(sentence)
    expect(table.text).toContain("A markdown file the user gives you becomes a page with write: its first # heading is the title, the rest goes in ops [{\"op\": \"set_markdown\", \"text\": \"<the rest>\"}]; a YAML front matter (--- … ---) is not content: take title and summary from it.")
  })
})
