// @vitest-environment node
// Vues du tableau de bord ajoutées aux services de connecteurs (E08-S03, AC11 ; sécurité :
// `security-patterns.md § Droits dans le service`), sur une base réelle (E01-S10, lot t1-d1) : O et P de
// la fixture de référence, où l'isolation seule rend toute ligne d'O, procédures et comptes de niveau 0
// compris ; le service les retire lui-même. Chaque lecture non bornée se lit par pages : les cas en
// posent au-delà de 1 000 lignes (`supabase-patterns.md § Error Handling`). Les services viennent de la
// face `./server`.
import { randomUUID } from "crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BlockInput } from "@otomata_tech/oto_platform/schemas"
import { createAccount, deactivationImpact, listOrgAccounts } from "@otomata_tech/oto_platform/server"
import { addBlocks, contentTables, openDraftRow, ORG, OTHER_ORG } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { namesOf, opOf, sqlConfigured, recordDb, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const call = (fn: string): BlockInput => ({ type: "call", text: null, data: { function: fn, args: {} } })

/** Au-delà d'une page de PostgREST (1 000 lignes) : une lecture qui ne pagine pas perd la suite. */
const PAGE_AND_MORE = 1000

/** Un uuid tiré au hasard qui se range après tout autre : `ffffffff-` puis la fin d'un uuid neuf. */
const lastId = () => `ffffffff-${randomUUID().slice(9)}`

/**
 * O et P : les procédures et la page d'O dont des blocs `call` appellent `mail` ou non, une procédure
 * publiée de P qui appelle `mail` ; les comptes d'O simulés et actifs. `last` : les blocs de
 * `ventes/relance`, qui appellent `mail`, et l'identifiant réel qui les range après les 1 000 autres
 * (`seedReferenceTables`, `extra`) ; la base tire les autres au hasard.
 */
function dashboardTables(): { tables: Tables; last: Record<string, string> } {
  const tables = contentTables(
    [],
    [
      { path: "ventes/relance", kind: "procedure" },
      { path: "ventes/brouillon", kind: "procedure" },
      { path: "ventes/devis", kind: "page" },
      { path: "private/claire/relance", kind: "procedure" },
      { path: "ventes/mailbox", kind: "procedure" },
    ],
  )
  // Page 1 : 1 000 appels d'une autre fonction ; l'appel de `mail` vient après, en page 2.
  addBlocks(tables, "ventes/brouillon", "published", Array.from({ length: PAGE_AND_MORE }, () => call("table.rows")))
  addBlocks(tables, "ventes/brouillon", "draft", [call("mail.create_draft")])
  // Son brouillon ouvert : sans lui, la RLS (`blocks_select_level`) cache le bloc `draft`, et le filtre
  // `state` de la requête resterait sans preuve (E01-S10, lot d1).
  openDraftRow(tables, "ventes/brouillon")
  addBlocks(tables, "ventes/devis", "published", [call("mail.create_draft")])
  addBlocks(tables, "private/claire/relance", "published", [call("mail.send_draft")])
  addBlocks(tables, "ventes/mailbox", "published", [call("mailbox.send")])
  const relance = addBlocks(tables, "ventes/relance", "published", [call("mail.create_draft"), call("mail.send_draft")])
  // Une procédure publiée de P qui appelle `mail` : une autre organisation. Le schéma veut une position
  // à tout bloc qui n'est pas une ligne (`blocks_position_check`).
  const other = { id: "other:node:relance", org_id: OTHER_ORG.id, path: "relance", kind: "procedure", status: "published" }
  tables.nodes.push(other)
  const otherCall = { id: "ffffffff-0000-4000-8000-000000000000", state: "published", org_id: OTHER_ORG.id, node_id: other.id, position: 1024 }
  tables.blocks.push({ ...otherCall, type: "call", data: { function: "mail.create_draft", args: {} } })
  for (const account of tables.accounts) Object.assign(account, { mode: "simule", status: "active" })
  return { tables, last: Object.fromEntries(relance.map((id) => [id, lastId()])) }
}

describe.skipIf(!sqlConfigured)(portable("dashboard views of the connector services (AC11)"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    const { tables, last } = dashboardTables()
    ref = await seedReferenceTables(seed, tables, last)
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  /** Ce que la vue d'un compte dit d'un secret jamais posé. */
const NO_SECRET = { secret: { fields: [], updatedAt: null }, settings: {}, statusReason: null }

describe("deactivationImpact (AC11, H123)", () => {
    it("should name and count only the published procedures the caller reads, whose published call block calls the connector", async () => {
      // Ada administre : Mail Org et Mail Ventes comptent, pas le compte personnel de Claire ni la procédure de sa section Perso.
      expect(await deactivationImpact(await ref.db("ada"), ref.identityOf("ada"), "mail")).toEqual({
        functions: ["mail.create_draft", "mail.send_draft"],
        procedures: ["ventes/relance"],
        accounts: 2,
      })
    })
  })

  describe("listOrgAccounts (AC11, H123)", () => {
    it("should serve every account of the organisation the caller sees, disabled ones included, and never one of level 0", async () => {
      // 1 000 comptes de l'organisation de plus : sans lecture par pages, 3 comptes au moins manquent.
      const fillers: Row[] = Array.from({ length: PAGE_AND_MORE }, (_, rank) => ({
        id: `account:filler-${String(rank).padStart(4, "0")}`,
        org_id: ORG.id,
        connector: "mail",
        label: `Compte ${rank}`,
        owner_kind: "org",
        mode: "simule",
        status: "active",
      }))
      const old = { id: "account:mail-old", org_id: ORG.id, connector: "mail", label: "Mail Ancien", owner_kind: "org", mode: "simule", status: "disabled" }
      await ref.write({ accounts: [...fillers, old] })
      try {
        const accounts = ref.readable(await listOrgAccounts(await ref.db("ada"), ref.identityOf("ada")))

        expect(accounts).toHaveLength(PAGE_AND_MORE + 3)
        expect(accounts.filter((account) => !account.label.startsWith("Compte "))).toEqual([
          // Un compte simulé n'a ni secret ni réglage : l'écran le lit tel quel.
          { id: "account:mail-old", label: "Mail Ancien", connector: "mail", owner: { kind: "org" }, mode: "simule", status: "disabled", ...NO_SECRET },
          { id: "account:mail-org", label: "Mail Org", connector: "mail", owner: { kind: "org" }, mode: "simule", status: "active", ...NO_SECRET },
          { id: "account:mail-ventes", label: "Mail Ventes", connector: "mail", owner: { kind: "team", teamName: "Ventes" }, mode: "simule", status: "active", ...NO_SECRET },
        ])
        // Ni le compte personnel de Claire, ni celui de P.
        expect(accounts.map((account) => account.label)).not.toContain("Mail Claire")
        expect(accounts.map((account) => account.label)).not.toContain(OTHER_ORG.account.label)
      } finally {
        await seed.admin`delete from platform.accounts where org_id = ${ref.org.id} and (label like 'Compte %' or label = 'Mail Ancien')`
      }
    })
  })

  describe("createAccount on a label already taken (AC11, N6)", () => {
    it("should answer conflict from the unique index, without reading the accounts first, even when the account holding the label is of level 0", async () => {
      // « Mail Claire » est le compte personnel de Claire, invisible d'Ada : l'index `accounts (org_id, lower(label))` refuse l'insertion.
      const { db, requests } = recordDb(await ref.db("ada"))

      await expect(createAccount(db, ref.identityOf("ada"), { connector: "mail", owner_kind: "org", label: "mail claire" })).rejects.toMatchObject({
        code: "conflict",
        message: "An account labelled mail claire already exists in Acme Test.",
      })
      expect(requests.filter((sent) => namesOf(sent).includes("accounts")).map(opOf)).toEqual(["insert"])
    })
  })
})
