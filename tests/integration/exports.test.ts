// @vitest-environment node
// Les exports sur une vraie base (E10-S01, AC-a5, AC-b6) : `GET nodes/export` et `GET tables/export`, les routes de
// l'API appelées comme la porte les appelle. Une page publiée en `.md` (sans références de blocs, le brouillon
// laissé de côté), les refus d'une page jamais publiée, d'un tableau et d'un nœud illisible ; un tableau en `.csv`
// dans la langue de l'organisation, formules neutralisées, refusé au-delà de 5 000 lignes. Suite portable.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Route } from "../../packages/plateforme/api/handler"
import { nodesRoutes } from "../../packages/plateforme/api/nodes"
import { tablesRoutes } from "../../packages/plateforme/api/tables"
import type { Identity } from "../../packages/plateforme/server/identity"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import type { Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, seedWithAdmin, sqlConfigured, type SeededData } from "../helpers/sql"
import { fixtureTables, manyRows, PERSONAL_TABLE, PROSPECTS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity } from "../factories/table-publish-sql"
import { BIG_TABLE_TIMEOUT, CASE_TIMEOUT, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

const BOM = String.fromCodePoint(0xfeff)

/** La route `GET <ressource>/export` d'une ressource. */
function exportRoute(routes: { GET?: Route | readonly Route[] }): Route {
  const route = [routes.GET ?? []].flat().find((one) => one.fixed?.[0] === "export")
  if (!route) throw new Error("no export route")
  return route
}

/** Le texte d'un export rendu par la route. */
function contenuDe(sortie: unknown): string {
  // La route rend `{ status, data: { filename, content } }` : son statut est vérifié avant de lire le texte.
  return (sortie as { data: { content: string } }).data.content
}

const row = (data: Record<string, unknown>): RowBlock => ({ key: String(data.entreprise), data, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null })

describe.skipIf(!sqlConfigured)(portable("the exports of a page and of a table"), { timeout: CASE_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let fixture: FixtureRows

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    fixture = fixtureRows(seed, ref)
  }, SEED_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SEED_TIMEOUT)

  async function exported(routes: { GET?: Route | readonly Route[] }, person: Person, path: string, identity?: Identity) {
    const request = new Request(`https://acme.test/api/platform/x/export?path=${encodeURIComponent(path)}`)
    const context = { db: await ref.db(person), identity: identity ?? acmeIdentity(ref, person), request, params: ["export"], body: undefined, origin: "https://acme.test", linkOrigin: "https://acme.test" }
    return exportRoute(routes).handle(context).catch((error: unknown) => error)
  }

  const write = async (input: Record<string, unknown>) => writeNode(await ref.db("claire"), acmeIdentity(ref, "claire"), input, { kind: "human" })

  it("should export a published page as its title, an empty line and its published blocks, without block references (AC-a5)", async () => {
    await write({ path: "ventes/cr_export", title: "Compte rendu", summary: "Le compte rendu.", ops: [{ op: "add_section", section: "Décisions", text: "- Relancer\n- Signer" }], publish: true })
    await write({ path: "ventes/cr_export", base_revision: 1, ops: [{ op: "append", section: "Décisions", text: "Pas encore publié." }], publish: false })
    // Rendu entier : aucune ligne de journal, un export est une lecture (HN-E10S01-18).
    expect(await exported(nodesRoutes, "lea", "ventes/cr_export")).toEqual({
      status: 200,
      data: { filename: "cr_export.md", content: "# Compte rendu\n\n## Décisions\n\n- Relancer\n- Signer\n" },
    })
  })

  it("should refuse a page never published, a table, and a node the person cannot read (AC-a5)", async () => {
    await write({ path: "ventes/cr_brouillon", title: "Brouillon", summary: "Jamais publié.", ops: [{ op: "add_section", section: "S", text: "t" }], publish: false })
    expect(await exported(nodesRoutes, "claire", "ventes/cr_brouillon")).toMatchObject({ code: "invalid_arguments", message: "ventes/cr_brouillon has no published version" })
    expect(await exported(nodesRoutes, "lea", PROSPECTS.path)).toMatchObject({ code: "invalid_arguments", message: "ventes/suivi_prospects is a table: use tables/export" })
    expect(await exported(nodesRoutes, "lea", PERSONAL_TABLE)).toMatchObject({ code: "not_found", message: "Unknown path private/claire/notes." })
  })

  it("should export a table with a BOM, the column names, ; and the decimal comma in French, , and the point otherwise, formulas guarded (AC-b6)", async () => {
    await fixture.use(fixtureTables([], [row({ entreprise: "Atelier 2", contact: "-Jean", montant_estime: 12.5, dernier_contact: "2026-03-02", actif: true, notes: "=1+1", statut: "à traiter" })]))
    const french = await exported(tablesRoutes, "lea", PROSPECTS.path)
    expect(french).toMatchObject({ status: 200, data: { filename: "suivi_prospects.csv" } })
    const lines = contenuDe(french).split("\r\n")
    expect(lines).toEqual([`${BOM}entreprise;contact;email;ville;montant_estime;dernier_contact;relance_le;actif;notes;statut`, "Atelier 2;'-Jean;;;12,5;2026-03-02;;true;'=1+1;à traiter", ""])
    const lea = acmeIdentity(ref, "lea")
    const english = await exported(tablesRoutes, "lea", PROSPECTS.path, { ...lea, org: { ...lea.org, brand: { language: "en" } } })
    expect(contenuDe(english).split("\r\n")[1]).toBe("Atelier 2,'-Jean,,,12.5,2026-03-02,,true,'=1+1,à traiter")
  })

  it("should refuse a table the person cannot read and a page (AC-b6)", async () => {
    expect(await exported(tablesRoutes, "lea", PERSONAL_TABLE)).toMatchObject({ code: "not_found" })
    await write({ path: "ventes/page_a_exporter", title: "Page", summary: "Une page.", ops: [{ op: "add_section", section: "S", text: "t" }], publish: true })
    expect(await exported(tablesRoutes, "lea", "ventes/page_a_exporter")).toMatchObject({ code: "invalid_arguments", message: "ventes/page_a_exporter is a page, not a table. Read it with acme_read." })
  })

  it("should refuse a table of more than 5,000 rows (AC-b6)", { timeout: BIG_TABLE_TIMEOUT }, async () => {
    await fixture.use(fixtureTables([], manyRows(5_001)))
    expect(await exported(tablesRoutes, "lea", PROSPECTS.path)).toMatchObject({
      code: "too_large",
      message: "ventes/suivi_prospects has more than 5,000 rows: an export holds 5,000 at most in this version.",
    })
  })
})
