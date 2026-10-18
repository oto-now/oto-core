// @vitest-environment node
// Services connecteurs sur une vraie base (E04-S01, AC1 à AC5, AC7 à AC9, AC23) : activation par
// l'administrateur, comptes simulés sous RLS, sous la session de chaque personne (le client du paquet,
// comme dans l'hôte) ; la connexion d'administration ne sert qu'à poser et relire. Les refus servis au
// modèle se comparent mot pour mot (H04, P14). Ce qui se refuse avant la base (AC6, connecteur inconnu ou
// natif, bornes du libellé) est dans `tests/unit/connectors-services.test.ts`, comme, depuis E01-S07,
// l'activation refusée à un membre (AC2) et la création d'un compte refusée à qui ne mène pas l'équipe ou
// n'administre pas (AC7), décidées avant toute écriture, textes à l'octet : leurs cas sur la vraie base
// sont retirés (M11b). Suite portable depuis E01-S10 f2 (chaque personne par `fx.as`, sans Supabase Auth
// ni PostgREST) : le job `bare-postgres` la joue.
import { randomUUID } from "crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createAccount,
  disableAccount,
  listUsableAccounts,
} from "../../packages/plateforme/server/connectors/accounts"
import {
  activateConnector,
  deactivateConnector,
  listConnectorsForOrg,
  loadActiveConnectors,
} from "../../packages/plateforme/server/connectors/activations"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { hex, REFERENCE_PEOPLE, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

// Projet partagé par les agents d'une vague : jusqu'à 30 s mesurées pour un test, le 2026-09-24.
const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 180_000
const FUNCTIONS = [
  { name: "mail.create_draft", class: "write" },
  { name: "mail.send_draft", class: "sensitive" },
]

type Session = { db: PlatformDb; identity: Identity }

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(sqlConfigured ? "connector services on a real database" : `connector services on a real database (${SQL_SKIP_REASON})`, privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let o: SqlReferenceOrg
    const sessions = new Map<ReferencePerson, Session>()

    function as(who: ReferencePerson): Session {
      const found = sessions.get(who)
      if (!found) throw new Error(`${who} has no session`)
      return found
    }

    const activationRows = () => fx.admin`select connector, state, activated_by from platform.connector_activations where org_id = ${o.org.id}`

    async function resetActivations() {
      await fx.admin`delete from platform.connector_activations where org_id = ${o.org.id}`
    }

    async function accountRow(id: string) {
      const [row] = await fx.admin<{ status: string; owner_user_id: string | null }[]>`
        select owner_kind, owner_team_id, owner_user_id, label, mode, status, secret_ciphertext from platform.accounts where id = ${id}`
      if (!row) throw new Error("account read failed: no row")
      return row
    }

    beforeAll(async () => {
      fx = createSqlFixtures()
      o = await fx.buildReferenceOrg()
      // Marc, simple membre de Support (AC8).
      await fx.addTeamMember(o.teams.support, o.people.marc.id)
      for (const person of REFERENCE_PEOPLE) {
        const user = o.people[person]
        const db = fx.as(user)
        sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
      }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    describe("activation (AC1 to AC4)", () => {
      it("should let the administrator activate mail once, then deactivate it, accounts untouched (AC1)", async () => {
        await resetActivations()
        const account = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `Mail AC1 ${hex(3)}` })
        const { db, identity } = as("ada")
        const first = await activateConnector(db, identity, { connector: "mail" })
        expect(first).toEqual({
          connector: "mail",
          state: "active",
          activatedAt: expect.any(String),
          activatedBy: { userId: o.people.ada.id, name: "Ada Martin" },
          functions: FUNCTIONS,
        })
        expect(await loadActiveConnectors(db, o.org.id)).toEqual(new Set(["mail"]))
        const again = await activateConnector(db, identity, { connector: " mail " })
        expect(again.activatedAt).toBe(first.activatedAt)
        expect(await activationRows()).toEqual([{ connector: "mail", state: "active", activated_by: o.people.ada.id }])

        expect(await deactivateConnector(db, identity, { connector: "mail" })).toEqual({
          connector: "mail",
          state: "inactive",
          activatedAt: null,
          activatedBy: null,
          functions: FUNCTIONS,
        })
        expect(await activationRows()).toEqual([{ connector: "mail", state: "inactive", activated_by: o.people.ada.id }])
        expect(await loadActiveConnectors(db, o.org.id)).toEqual(new Set())
        // La ligne inactive, relue : ni date ni auteur, comme sans ligne (N18, écran « Inactif » d'E08-S03).
        expect(await listConnectorsForOrg(db, identity)).toEqual([
          { connector: "mail", state: "inactive", activatedAt: null, activatedBy: null, functions: FUNCTIONS },
        ])
        expect((await accountRow(account)).status).toBe("active")
        expect((await activateConnector(db, identity, { connector: "mail" })).state).toBe("active")
      })

      it("should list each activable connector with its state, who activated it and its functions, to any member (AC3)", async () => {
        await resetActivations()
        const lea = as("lea")
        expect(await listConnectorsForOrg(lea.db, lea.identity)).toEqual([
          { connector: "mail", state: "inactive", activatedAt: null, activatedBy: null, functions: FUNCTIONS },
        ])
        const ada = as("ada")
        await activateConnector(ada.db, ada.identity, { connector: "mail" })
        const [mail] = await listConnectorsForOrg(lea.db, lea.identity)
        expect(mail).toMatchObject({ state: "active", activatedBy: { userId: o.people.ada.id, name: "Ada Martin" } })
        expect(Date.parse(mail.activatedAt ?? "")).not.toBeNaN()
      })
    })

    describe("accounts (AC5 to AC9, AC23)", () => {
      it("should let a lead create a simulated team account, label trimmed, no secret column served (AC5, AC23)", async () => {
        const tag = hex(3)
        const { db, identity } = as("claire")
        const created = await createAccount(db, identity, { connector: "mail", owner_kind: "team", team_id: o.teams.ventes, label: ` Mail Ventes ${tag} ` })
        expect(created).toEqual({
          id: expect.any(String),
          label: `Mail Ventes ${tag}`,
          connector: "mail",
          mode: "simule",
          owner: { kind: "team", teamId: o.teams.ventes, userId: null, description: "team Ventes" },
        })
        expect(JSON.stringify(created)).not.toContain("secret")
        expect(await accountRow(created.id)).toEqual({
          owner_kind: "team",
          owner_team_id: o.teams.ventes,
          owner_user_id: null,
          label: `Mail Ventes ${tag}`,
          mode: "simule",
          status: "active",
          secret_ciphertext: null,
        })
      })

      it("should let an administrator create organisation and team accounts, and everyone only their own personal one (AC5)", async () => {
        const tag = hex(3)
        const ada = as("ada")
        const org = await createAccount(ada.db, ada.identity, { connector: "mail", owner_kind: "org", label: `Mail Acme ${tag}` })
        expect(org.owner).toEqual({ kind: "org", teamId: null, userId: null, description: "organisation" })
        const team = await createAccount(ada.db, ada.identity, { connector: "mail", owner_kind: "team", team_id: o.teams.support, label: `Mail Support ${tag}` })
        expect(team.owner.description).toBe("team Support")
        const own = await createAccount(ada.db, ada.identity, { connector: "mail", owner_kind: "user", label: `Mail Ada ${tag}` })
        expect(own.owner).toEqual({ kind: "user", teamId: null, userId: o.people.ada.id, description: "personal" })
        const lea = as("lea")
        const hers = await createAccount(lea.db, lea.identity, { connector: "mail", owner_kind: "user", label: `Mail Léa ${tag}` })
        expect((await accountRow(hers.id)).owner_user_id).toBe(o.people.lea.id)
        const seenByAda = await listUsableAccounts(ada.db, ada.identity, { connector: "mail" })
        expect(seenByAda.map((account) => account.id)).toContain(own.id)
        expect(seenByAda.map((account) => account.id)).not.toContain(hers.id)
      })

      it("should refuse a team account for a team unknown in the organisation (N19)", async () => {
        const unknown = randomUUID()
        const { db, identity } = as("ada")
        const error = await refusal(createAccount(db, identity, { connector: "mail", owner_kind: "team", team_id: unknown, label: `X ${hex(3)}` }))
        expect(error.code).toBe("invalid_arguments")
        expect(error.message).toBe(`Unknown team ${unknown} in Acme Test.`)
      })

      it("should refuse a label already taken in the organisation, without case, other connectors and invisible accounts included (AC7)", async () => {
        const tag = hex(3)
        await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `Mail Ventes ${tag}` })
        await fx.createAccount(o.org.id, { connector: "notion", ownerKind: "org", label: `Notion ${tag}`, mode: "reel" })
        await fx.createAccount(o.org.id, { ownerKind: "user", ownerUserId: o.people.paul.id, label: `Perso Paul ${tag}` })
        const { db, identity } = as("claire")
        for (const label of [`mail ventes ${tag}`, `NOTION ${tag}`, `perso paul ${tag}`]) {
          const error = await refusal(createAccount(db, identity, { connector: "mail", owner_kind: "user", label }))
          expect(error.code, label).toBe("conflict")
          expect(error.message, label).toBe(`An account labelled ${label} already exists in Acme Test.`)
        }
      })

      it("should list the active accounts a Support member can use, with level, mode and owner, and nothing else (AC8, AC23)", async () => {
        const tag = hex(3)
        await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `A Ventes ${tag}` })
        const support = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.support, label: `A Support ${tag}` })
        const acme = await fx.createAccount(o.org.id, { ownerKind: "org", label: `A Acme ${tag}` })
        await fx.createAccount(o.org.id, { ownerKind: "user", ownerUserId: o.people.lea.id, label: `A Léa ${tag}` })
        // Posé désactivé, par la connexion d'administration.
        await fx.admin`
          insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, label, mode, status)
          values (${o.org.id}, 'mail', 'team', ${o.teams.support}, ${`A Old ${tag}`}, 'simule', 'disabled')`
        const { db, identity } = as("marc")
        const usable = (await listUsableAccounts(db, identity, { connector: "mail" })).filter((account) => account.label.endsWith(tag))
        expect(usable).toEqual([
          { id: acme, label: `A Acme ${tag}`, connector: "mail", mode: "simule", owner: { kind: "org", teamId: null, userId: null, description: "organisation" }, level: "read" },
          {
            id: support,
            label: `A Support ${tag}`,
            connector: "mail",
            mode: "simule",
            owner: { kind: "team", teamId: o.teams.support, userId: null, description: "team Support" },
            // Un membre va jusqu'aux fonctions sensibles du compte de son équipe (partage des comptes, #68).
            level: "sensitive",
          },
        ])
        expect(JSON.stringify(usable)).not.toContain("secret")
        const paul = as("paul")
        const lead = (await listUsableAccounts(paul.db, paul.identity, { connector: "mail" })).find((account) => account.id === support)
        expect(lead?.level).toBe("manage")
      })

      it("should list nothing in an organisation without account (AC8)", async () => {
        const empty = await fx.buildReferenceOrg(o.people)
        const db = fx.as(o.people.marc)
        const identity = await resolveIdentity(db, empty.host, { userId: o.people.marc.id, email: o.people.marc.email })
        expect(await listUsableAccounts(db, identity, { connector: "mail" })).toEqual([])
      })

      it("should let those who manage an account disable it, and refuse the others (AC9)", async () => {
        const tag = hex(3)
        const team = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `D Ventes ${tag}` })
        const org = await fx.createAccount(o.org.id, { ownerKind: "org", label: `D Acme ${tag}` })
        const own = await fx.createAccount(o.org.id, { ownerKind: "user", ownerUserId: o.people.lea.id, label: `D Léa ${tag}` })
        const lea = as("lea")
        const denied = await refusal(disableAccount(lea.db, lea.identity, { account_id: team }))
        expect(denied.code).toBe("forbidden")
        expect(denied.message).toBe(`Disabling « D Ventes ${tag} » is reserved to those who manage it: team Ventes (lead: Claire Morel).`)
        expect((await accountRow(team)).status).toBe("active")

        const claire = as("claire")
        expect(await disableAccount(claire.db, claire.identity, { account_id: team })).toMatchObject({ id: team, status: "disabled" })
        const ada = as("ada")
        expect((await disableAccount(ada.db, ada.identity, { account_id: org })).status).toBe("disabled")
        expect((await disableAccount(lea.db, lea.identity, { account_id: own })).status).toBe("disabled")
        for (const id of [team, org, own]) expect((await accountRow(id)).status).toBe("disabled")

        const paul = as("paul")
        for (const id of [own, randomUUID()]) {
          const unknown = await refusal(disableAccount(paul.db, paul.identity, { account_id: id }))
          expect(unknown.code).toBe("not_found")
          expect(unknown.message).toBe(`Unknown account ${id}.`)
        }
      })
    })
  },
)
