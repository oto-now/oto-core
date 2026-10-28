// @vitest-environment node
// `server/rules.ts` (E05-S03 : AC15 à AC17 ; H66, H68, fiche D4) sur une vraie base : les niveaux sont
// ceux que la base calcule, sous la session de la personne. Chaque cas pose ses règles sur un nœud à lui,
// sous `ventes` : aucun ne dépend de l'ordre. Le partage refusé sous le niveau de gestion et la gestion
// réservée à l'administrateur sont décidés par le service, prouvés sur la base réelle par
// `tests/unit/equipes-droits.test.ts` : leurs cas sont retirés d'ici (M11b, liste d'E01-S07 ; M29). Suite portable
// depuis E01-S10 f2 (chaque personne par `fx.as`, sans Supabase Auth ni PostgREST) : le job
// `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  listNodeRules,
  PlatformError,
  removeRule,
  resolveIdentity,
  setGeneralAccess,
  setNodeRule,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

type Who = "ada" | "claire" | "lea" | "paul"
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
  privateFolderSuite(sqlConfigured ? "rules service" : `rules service (${SQL_SKIP_REASON})`, privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let o: SqlReferenceOrg
    let autre: SqlReferenceOrg
    const sessions = new Map<Who, Session>()

    function as(who: Who): Session {
      const found = sessions.get(who)
      if (!found) throw new Error(`${who} has no session`)
      return found
    }

    /** Une page de Ventes, à ce cas seulement. */
    async function pageDeVentes(): Promise<{ id: string; path: string }> {
      const path = `ventes/page_${hex(3)}`
      return { id: await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title: "Page" }), path }
    }

    const levels = (nodeId: string) => fx.admin`select subject_team_id, subject_user_id, level from platform.access_rules where node_id = ${nodeId}`

    beforeAll(async () => {
      fx = createSqlFixtures()
      o = await fx.buildReferenceOrg()
      autre = await fx.buildReferenceOrg(o.people)
      for (const who of ["ada", "claire", "lea", "paul"] as const) {
        const person = o.people[who]
        const db = fx.as(person)
        sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
      }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    describe("setNodeRule (AC17, fiche D4)", () => {
      it("should create a rule, then replace the level of the same subject", async () => {
        const page = await pageDeVentes()
        const input = { path: page.path, subject: { kind: "team" as const, id: o.teams.support }, level: "read" as const }

        const created = await setNodeRule(as("claire").db, as("claire").identity, input)
        const replaced = await setNodeRule(as("claire").db, as("claire").identity, { ...input, level: "write" })

        expect(created).toMatchObject({ data: { path: page.path, level: "read", created: true }, target: page.path, teamId: o.teams.ventes })
        expect(replaced.data).toMatchObject({ id: created.data.id, level: "write", created: false })
        expect(await levels(page.id)).toEqual([{ subject_team_id: o.teams.support, subject_user_id: null, level: "write" }])
      })

      it("should let a lead share with a person of the organisation (fiche D4)", async () => {
        const page = await pageDeVentes()
        const set = await setNodeRule(as("claire").db, as("claire").identity, { path: page.path, subject: { kind: "user", id: o.people.marc.id }, level: "read" })
        expect(set.data.created).toBe(true)
      })

      it("should refuse a subject of another organisation (invalid_arguments)", async () => {
        const page = await pageDeVentes()
        const error = await refusal(setNodeRule(as("ada").db, as("ada").identity, { path: page.path, subject: { kind: "team", id: autre.teams.ventes }, level: "read" }))
        expect(error.code).toBe("invalid_arguments")
      })
    })

    describe("removeRule (AC17)", () => {
      it("should remove a rule at the manage level, and refuse it below", async () => {
        const page = await pageDeVentes()
        const rule = await fx.addRule({ orgId: o.org.id, nodeId: page.id, teamId: o.teams.support, level: "read" })

        const refused = await refusal(removeRule(as("lea").db, as("lea").identity, rule))
        expect(refused.code).toBe("forbidden")

        const removed = await removeRule(as("claire").db, as("claire").identity, rule)
        expect(removed).toMatchObject({ data: { id: rule, path: page.path }, target: page.path, teamId: o.teams.ventes })
        expect(await levels(page.id)).toEqual([])
      })

      it("should answer a rule that does not exist as not_found", async () => {
        const error = await refusal(removeRule(as("ada").db, as("ada").identity, "3c2b1a09-8f7e-4d6c-9b5a-493827160514"))
        expect(error.code).toBe("not_found")
      })
    })

    describe("listNodeRules (AC16)", () => {
      it("should give the owner team and its lead, the level of who looks, and the rules, teams first", async () => {
        const page = await pageDeVentes()
        await fx.addRule({ orgId: o.org.id, nodeId: page.id, userId: o.people.marc.id, level: "none" })
        await fx.addRule({ orgId: o.org.id, nodeId: page.id, teamId: o.teams.support, level: "read" })

        const vue = await listNodeRules(as("claire").db, as("claire").identity, page.path)

        expect(vue).toMatchObject({ path: page.path, title: "Page", owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" }, viewerLevel: 3 })
        expect(vue.rules.map((rule) => [rule.subject.kind, rule.subject.name, rule.level])).toEqual([
          ["team", "Support", "read"],
          ["user", "Marc Petit", "none"],
        ])
        expect((await listNodeRules(as("lea").db, as("lea").identity, page.path)).viewerLevel).toBe(2)
      })

      // 1.4.12 : le niveau de chaque membre de l'équipe ; une règle sur une page surcharge celle d'au-dessus.
      it("should give each member of the owner team their level, what they would have without their own rule, and a page rule overriding the one above", async () => {
        const dessus = await pageDeVentes()
        const page = { path: `${dessus.path}/detail`, id: "" }
        page.id = await fx.createNode(o.org.id, { parentId: dessus.id, path: page.path, title: "Détail" })
        await fx.addRule({ orgId: o.org.id, nodeId: dessus.id, userId: o.people.lea.id, level: "read" })
        await fx.addRule({ orgId: o.org.id, nodeId: page.id, userId: o.people.lea.id, level: "none" })

        const lea = (vue: Awaited<ReturnType<typeof listNodeRules>>) => vue.people?.find((membre) => membre.name === "Léa Roux")
        const enHaut = await listNodeRules(as("claire").db, as("claire").identity, dessus.path, { people: true })
        expect(lea(enHaut)).toMatchObject({ lead: false, level: "read", inherited: "write", ruleId: expect.any(String) })
        expect(enHaut.people?.[0]).toMatchObject({ name: "Claire Morel", lead: true, level: "manage", inherited: "manage", ruleId: null })
        const enBas = await listNodeRules(as("claire").db, as("claire").identity, page.path, { people: true })
        expect(lea(enBas)).toMatchObject({ level: "none", inherited: "read" })
        // Hors d'une équipe, aucun membre.
        const annonces = `annonces_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: annonces, title: "Annonces" })
        expect((await listNodeRules(as("lea").db, as("lea").identity, annonces, { people: true })).people).toEqual([])
        // Sans la demande, l'affichage d'une page ne paie pas ce calcul.
        expect((await listNodeRules(as("claire").db, as("claire").identity, page.path)).people).toEqual([])
      })

      // 1.4.13 : l'accès par défaut de l'équipe propriétaire, sa règle sur la page, et l'équipe qui suit l'organisation.
      it("should give the owner team's default level, never below the whole organisation, and raise it with the organisation", async () => {
        const page = await pageDeVentes()
        const equipe = async () => (await listNodeRules(as("claire").db, as("claire").identity, page.path, { people: true })).team
        expect(await equipe()).toEqual({ teamId: o.teams.ventes, level: "write", inherited: "write", ruleId: null })

        const lire = await setNodeRule(as("claire").db, as("claire").identity, { path: page.path, subject: { kind: "team", id: o.teams.ventes }, level: "read" })
        expect(await equipe()).toEqual({ teamId: o.teams.ventes, level: "read", inherited: "write", ruleId: lire.data.id })
        // Un membre sans règle à lui suit l'équipe ; sa responsable garde la gestion.
        const vue = await listNodeRules(as("claire").db, as("claire").identity, page.path, { people: true })
        expect(vue.people?.map((membre) => [membre.name, membre.level])).toContainEqual(["Léa Roux", "read"])
        expect(vue.people?.find((membre) => membre.lead)?.level).toBe("manage")

        // Toute l'organisation monte au-dessus : l'équipe suit ; la poser sous l'organisation est refusé.
        await setGeneralAccess(as("claire").db, as("claire").identity, { path: page.path, access: "organisation", level: "write" })
        expect((await equipe())?.level).toBe("write")
        const sous = await refusal(setNodeRule(as("claire").db, as("claire").identity, { path: page.path, subject: { kind: "team", id: o.teams.ventes }, level: "read" }))
        expect(sous).toMatchObject({ code: "invalid_arguments", message: expect.stringContaining("cannot have less") })
        // Une autre équipe n'est pas tenue par l'organisation.
        await setNodeRule(as("claire").db, as("claire").identity, { path: page.path, subject: { kind: "team", id: o.teams.support }, level: "read" })
      })

      // 1.4.13 : l'accès de toute l'organisation hérité d'un dossier se lit sur la page, sert de plancher à l'équipe, et se ferme par « none ».
      it("should give the organisation's real level inherited from a folder, floor the owner team on it, and close a page with a none rule", async () => {
        const dossier = await pageDeVentes()
        const page = { path: `${dossier.path}/detail`, id: "" }
        page.id = await fx.createNode(o.org.id, { parentId: dossier.id, path: page.path, title: "Détail" })
        await setGeneralAccess(as("claire").db, as("claire").identity, { path: dossier.path, access: "organisation", level: "write" })

        const organisation = async () => (await listNodeRules(as("claire").db, as("claire").identity, page.path, { people: true })).organisation
        expect(await organisation()).toEqual({ level: "write", inherited: "write" })
        const sous = await refusal(setNodeRule(as("claire").db, as("claire").identity, { path: page.path, subject: { kind: "team", id: o.teams.ventes }, level: "read" }))
        expect(sous.code).toBe("invalid_arguments")

        await setGeneralAccess(as("claire").db, as("claire").identity, { path: page.path, access: "organisation", level: "none" })
        expect(await organisation()).toEqual({ level: "none", inherited: "write" })
        // Paul (Support) ne voit plus la page ; il garde le dossier.
        expect((await listNodeRules(as("paul").db, as("paul").identity, dossier.path)).viewerLevel).toBe(2)
        expect((await refusal(listNodeRules(as("paul").db, as("paul").identity, page.path))).code).toBe("not_found")
      })

      // Règle de la racine (28/10) : « Droits de Tout le monde… » règle la racine ; elle ouvre l'écriture sur un contenu de
      // Tout le monde sans partage propre, jamais sous une équipe, et la règle d'un contenu l'emporte.
      it("should open writing on the organisation's contents by a rule on the root, never under a team, a content rule winning", async () => {
        const annonces = `annonces_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: annonces, title: "Annonces" })
        const ventes = await pageDeVentes()
        const niveau = async (who: Who, path: string) => (await listNodeRules(as(who).db, as(who).identity, path)).viewerLevel
        await setGeneralAccess(as("ada").db, as("ada").identity, { path: "guide", access: "organisation", level: "write" })
        try {
          expect([await niveau("lea", annonces), (await refusal(listNodeRules(as("paul").db, as("paul").identity, ventes.path))).code]).toEqual([2, "not_found"])
          expect((await listNodeRules(as("ada").db, as("ada").identity, annonces, { people: true })).organisation).toEqual({ level: "write", inherited: "write" })
          await setGeneralAccess(as("ada").db, as("ada").identity, { path: annonces, access: "organisation", level: "read" })
          expect(await niveau("lea", annonces)).toBe(1)
        } finally {
          await setGeneralAccess(as("ada").db, as("ada").identity, { path: "guide", access: "restricted" })
        }
        // Le panneau de la racine lit, sur demande, les sujets à ajouter : ceux de l'organisation de l'adresse seulement.
        const { subjects } = await listNodeRules(as("ada").db, as("ada").identity, "guide", { people: true, subjects: true })
        expect(subjects?.teams.map((equipe) => equipe.id).sort()).toEqual([o.teams.support, o.teams.ventes].sort())
        expect(subjects?.organisation).toBe(o.org.name)
      })

      it("should describe an organisation node and a personal node", async () => {
        const annonces = `annonces_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: annonces, title: "Annonces" })

        expect(await listNodeRules(as("lea").db, as("lea").identity, annonces)).toMatchObject({ owner: { kind: "org" }, viewerLevel: 1, rules: [] })
        expect(await listNodeRules(as("lea").db, as("lea").identity, "private/lea")).toMatchObject({ owner: { kind: "user", userName: "Léa Roux" }, viewerLevel: 3 })
      })

      it.each([
        ["an unknown path", "nulle_part"],
        ["a malformed path", "Ventes/Devis"],
      ])("should answer %s as not_found (H68)", async (_cas, path) => {
        const error = await refusal(listNodeRules(as("lea").db, as("lea").identity, path))
        expect(error.code).toBe("not_found")
      })
    })
  },
)
