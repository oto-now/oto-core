// @vitest-environment node
// Le partage public d'un contenu par lien sur une vraie base (E05-S10 partie d, ADR-013) : un test par cas
// de fuite (AC-d5, ADR-013 § Conséquences) — autre nœud, sous-nœud sans « Inclure les sous-contenus »,
// brouillon, lien désactivé, autre organisation, nœud à la corbeille, sous-contenu que l'auteur du lien ne
// lit pas, auteur retiré —, la lecture de la dernière version publiée (AC-d2, AC-d3, AC-d4) et ses seuls
// champs publics, un sous-contenu renommé, les refus de partager et de lire le jeton sans l'accès complet
// (AC-d1) et de partager la structure de l'arbre ou le Privé d'une autre personne, la liste de
// l'administrateur (AC-d7) et la route publique, hors session, `noindex` (AC-d6). La base est le sujet :
// `public_node_by_token` s'exécute sous `anon`, bornée au jeton et à ce que l'auteur du lien lit. Suite
// portable.
import type postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import {
  listShares,
  moveNode,
  nodeShare,
  readPublicNode,
  resolveIdentity,
  revokeShare,
  shareNode,
  trashNode,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, failureOf, spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "public share of a content by link on a real database (E05-S10, part d)"
const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!ready || privatePending)(privateFolderSuite(ready ? SUITE : `${SUITE} (${skipReason})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let otherHost: string
  let ada: Session
  let claire: Session
  let lea: Session
  let marc: Session

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    const session = async (person: "ada" | "claire" | "lea" | "marc"): Promise<Session> => {
      const user = o.people[person]
      const db = fx.as(user)
      return { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
    }
    ada = await session("ada")
    claire = await session("claire")
    lea = await session("lea")
    marc = await session("marc")
    otherHost = `t${hex(4)}.example.invalid`
    const other = await fx.createOrg({ hosts: [otherHost] })
    await fx.createTree(other.id)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  /**
   * Un contenu publié de l'organisation à `path` (sous la racine, ou sous `parent`), ses paragraphes et ses
   * liens ; `owner` : l'équipe propriétaire explicite.
   */
  async function published(path: string, texts: string[], links: { block: number; path: string }[] = [], owner?: string): Promise<string> {
    const at = path.lastIndexOf("/")
    const parentId = at === -1 ? o.nodes.root : await fx.nodeId(o.org.id, path.slice(0, at))
    const team = owner ? { ownerKind: "team" as const, ownerTeamId: owner } : {}
    const id = await fx.createNode(o.org.id, { parentId, path, title: `Titre ${path}`, ...team })
    await fx.publishBlocks(id, texts.map((text) => ({ type: "paragraph" as const, text })), { links })
    return id
  }

  /** Un contenu partagé par Ada : `root` publié, `root/sous` publié, `root/brouillon` jamais publié ; rend le jeton. */
  async function sharedTree(root: string, includeChildren: boolean): Promise<string> {
    await published(root, [`Voir [[${root}/sous]] et [[ventes/devis]].`], [
      { block: 0, path: `${root}/sous` },
      { block: 0, path: "ventes/devis" },
    ])
    await published(`${root}/sous`, ["Sous-contenu."])
    await fx.createNode(o.org.id, { parentId: await fx.nodeId(o.org.id, root), path: `${root}/brouillon`, title: "Jamais publié" })
    return (await shareNode(ada.db, ada.identity, { path: root, include_children: includeChildren })).data.share.token
  }

  const notFound = { code: "not_found", message: "Not found." }

  it("should show the last published version of the shared content, its covered links only, no children without the option (AC-d2, AC-d4)", async () => {
    const token = await sharedTree("pub_a", false)
    const view = await readPublicNode(o.host, token)
    expect({ node: view.node.path, title: view.node.title, texts: view.blocks.map((block) => block.text), children: view.children, links: view.links }).toEqual({
      node: "pub_a",
      title: "Titre pub_a",
      texts: ["Voir [[pub_a/sous]] et [[ventes/devis]]."],
      children: [],
      links: [],
    })
  })

  // E11-S05 (AC-d3, HN-E11S05-11) : la langue de l'organisation, pour le séparateur du `.csv` bâti par la page.
  it("should expose the public fields only: no author, provenance nor rule (ADR-013 § 3), and the language of the organisation", async () => {
    const token = await sharedTree("pub_k", true)
    const view = await readPublicNode(o.host, token)
    const keys = (value: object) => Object.keys(value).sort().join(",")
    const shapes = (values: object[]) => [...new Set(values.map(keys))]
    expect({
      view: keys(view),
      root: keys(view.root),
      node: keys(view.node),
      blocks: shapes(view.blocks),
      children: shapes(view.children),
      links: shapes(view.links),
    }).toEqual({
      view: "blocks,children,includeChildren,language,links,node,root,table",
      root: "path,title",
      node: "kind,meta,path,revision,summary,title,updatedAt",
      blocks: ["data,id,key,position,text,type"],
      children: ["kind,path,title"],
      links: ["path,to"],
    })
    // Sans langue écrite dans sa marque, l'organisation est en français (`organisationLanguage`).
    expect(view.language).toBe("fr")
  })

  it("should refuse a sub-content when the link does not include them, and open it with the option (AC-d3)", async () => {
    const token = await sharedTree("pub_b", false)
    await expect(readPublicNode(o.host, token, "pub_b/sous")).rejects.toMatchObject(notFound)
    await shareNode(ada.db, ada.identity, { path: "pub_b", include_children: true })
    const view = await readPublicNode(o.host, token)
    expect([view.children.map((child) => child.path), view.links]).toEqual([["pub_b/sous"], [{ path: "pub_b/sous", to: "pub_b/sous" }]])
    expect((await readPublicNode(o.host, token, "pub_b/sous")).blocks.map((block) => block.text)).toEqual(["Sous-contenu."])
  })

  it("should open a renamed sub-content by its old path, and link it at its current address", async () => {
    const token = await sharedTree("pub_l", true)
    await moveNode(ada.db, ada.identity, { path: "pub_l/sous", new_path: "pub_l/nouveau" })
    const view = await readPublicNode(o.host, token)
    expect([view.children.map((child) => child.path), view.links]).toEqual([["pub_l/nouveau"], [{ path: "pub_l/sous", to: "pub_l/nouveau" }]])
    expect((await readPublicNode(o.host, token, "pub_l/sous")).node.path).toBe("pub_l/nouveau")
    expect((await readPublicNode(o.host, token, view.links[0].to)).blocks.map((block) => block.text)).toEqual(["Sous-contenu."])
  })

  it("should serve only the sub-contents the author of the link reads now: not another team's added later, not one closed to them", async () => {
    await published("ventes/pa", ["Voir [[ventes/pa/lu]], [[ventes/pa/equipe]] et [[ventes/pa/cache]]."], [
      { block: 0, path: "ventes/pa/lu" },
      { block: 0, path: "ventes/pa/equipe" },
      { block: 0, path: "ventes/pa/cache" },
    ])
    await published("ventes/pa/lu", ["Lu."])
    const closed = await published("ventes/pa/cache", ["Fermé à Claire."])
    await fx.addRule({ orgId: o.org.id, nodeId: closed, userId: o.people.claire.id, level: "none" })
    const token = (await shareNode(claire.db, claire.identity, { path: "ventes/pa", include_children: true })).data.share.token
    // Rangé plus tard par un autre, sous l'équipe Support que Claire ne lit pas.
    await published("ventes/pa/equipe", ["Support."], [], o.teams.support)

    const view = await readPublicNode(o.host, token)
    expect([view.children.map((child) => child.path), view.links]).toEqual([["ventes/pa/lu"], [{ path: "ventes/pa/lu", to: "ventes/pa/lu" }]])
    for (const path of ["ventes/pa/equipe", "ventes/pa/cache"]) await expect(readPublicNode(o.host, token, path)).rejects.toMatchObject(notFound)
    expect((await readPublicNode(o.host, token, "ventes/pa/lu")).blocks.map((block) => block.text)).toEqual(["Lu."])
  })

  it("should make whoever changes the link its author, whose reading then bounds it (HN-E05S10e-20)", async () => {
    await published("ventes/pb", ["Racine."])
    await published("ventes/pb/equipe", ["Support."], [], o.teams.support)
    const token = (await shareNode(ada.db, ada.identity, { path: "ventes/pb" })).data.share.token
    const changed = await shareNode(claire.db, claire.identity, { path: "ventes/pb", include_children: true })
    expect([changed.data.share.token, changed.data.share.createdByName]).toEqual([token, o.people.claire.name])
    await expect(readPublicNode(o.host, token, "ventes/pb/equipe")).rejects.toMatchObject(notFound)
  })

  it("should answer 404 once the author of the link has left the organisation", async () => {
    const author = await fx.createUser()
    await fx.addMember(o.org.id, author.id, { role: "admin" })
    const db = fx.as(author)
    const identity = await resolveIdentity(db, o.host, { userId: author.id, email: author.email })
    await published("pub_n", ["Auteur parti."])
    const token = (await shareNode(db, identity, { path: "pub_n" })).data.share.token
    expect((await readPublicNode(o.host, token)).node.path).toBe("pub_n")
    await fx.admin`delete from platform.members where org_id = ${o.org.id} and user_id = ${author.id}`
    await expect(readPublicNode(o.host, token)).rejects.toMatchObject(notFound)
  })

  it("should never reach another node than the shared one and its sub-contents (leak: another node)", async () => {
    const token = await sharedTree("pub_c", true)
    await published("pub_cx", ["Voisin."])
    for (const path of ["ventes/devis", "pub_cx", "contexte"]) await expect(readPublicNode(o.host, token, path)).rejects.toMatchObject(notFound)
  })

  it("should show nothing of a draft: neither its pending title and blocks, nor a sub-content never published (leak: draft)", async () => {
    const token = await sharedTree("pub_d", true)
    await fx.draftBlocks(await fx.nodeId(o.org.id, "pub_d"), [{ type: "paragraph", text: "Brouillon secret." }], { title: "Titre du brouillon" })
    const view = await readPublicNode(o.host, token)
    expect([view.node.title, view.blocks.map((block) => block.text)]).toEqual(["Titre pub_d", ["Voir [[pub_d/sous]] et [[ventes/devis]]."]])
    expect(view.children.map((child) => child.path)).not.toContain("pub_d/brouillon")
    await expect(readPublicNode(o.host, token, "pub_d/brouillon")).rejects.toMatchObject(notFound)
  })

  it("should answer 404 alike for a disabled link, an unknown token and a malformed one (leak: disabled link)", async () => {
    const token = await sharedTree("pub_e", true)
    const [share] = await fx.admin<{ id: string }[]>`select id from platform.node_shares where token = ${token}`
    await revokeShare(ada.db, ada.identity, share.id)
    await expect(readPublicNode(o.host, token)).rejects.toMatchObject(notFound)
    await expect(readPublicNode(o.host, token, "pub_e/sous")).rejects.toMatchObject(notFound)
    await expect(readPublicNode(o.host, "A".repeat(43))).rejects.toMatchObject(notFound)
    await expect(readPublicNode(o.host, "court")).rejects.toMatchObject(notFound)
  })

  it("should never reach a content of another organisation than the one of the address (leak: another organisation)", async () => {
    const token = await sharedTree("pub_f", true)
    await expect(readPublicNode(otherHost, token)).rejects.toMatchObject(notFound)
    await expect(readPublicNode("inconnu.example.invalid", token)).rejects.toMatchObject(notFound)
  })

  it("should hide a content in the trash, and a sub-content in the trash, and drop its link from the list (leak: node in the trash)", async () => {
    const token = await sharedTree("pub_g", true)
    await trashNode(ada.db, ada.identity, { path: "pub_g/sous" })
    await expect(readPublicNode(o.host, token, "pub_g/sous")).rejects.toMatchObject(notFound)
    const view = await readPublicNode(o.host, token)
    expect([view.children, view.links]).toEqual([[], []])
    await trashNode(ada.db, ada.identity, { path: "pub_g" })
    await expect(readPublicNode(o.host, token)).rejects.toMatchObject(notFound)
    // Par son identifiant : un contenu que l'administrateur ne lit pas (la corbeille vaut 0) y perdrait son chemin.
    const [share] = await fx.admin<{ id: string }[]>`select id from platform.node_shares where token = ${token}`
    expect((await listShares(ada.db, ada.identity)).map((listed) => listed.id)).not.toContain(share.id)
  })

  it("should refuse to share without full access, decided before any write (AC-d1)", async () => {
    await published("pub_h", ["Organisation."])
    const spy = spyDb(claire.db)
    await expect(shareNode(spy.db, claire.identity, { path: "pub_h" })).rejects.toMatchObject({ code: "forbidden" })
    expect(writesOf(spy.sent)).toEqual([])
  })

  it("should refuse to share the structure of the tree, or a page of another person's private space, before any write", async () => {
    const [space] = await fx.admin<{ path: string }[]>`select path from platform.nodes where id = ${o.spaces.claire}`
    const own = await fx.createNode(o.org.id, { parentId: o.spaces.claire, path: `${space.path}/prive_p`, title: "Privé partagé" })
    await fx.addRule({ orgId: o.org.id, nodeId: own, userId: o.people.lea.id, level: "manage" })
    const admin = spyDb(ada.db)
    for (const path of ["guide", "private", "ventes"]) {
      await expect(shareNode(admin.db, ada.identity, { path })).rejects.toMatchObject({ code: "invalid_arguments" })
    }
    const other = spyDb(lea.db)
    await expect(shareNode(other.db, lea.identity, { path: `${space.path}/prive_p` })).rejects.toMatchObject({ code: "forbidden" })
    expect([writesOf(admin.sent), writesOf(other.sent)]).toEqual([[], []])
    // Sa propriétaire la partage.
    expect((await shareNode(claire.db, claire.identity, { path: `${space.path}/prive_p` })).data.created).toBe(true)
  })

  it("should not give the token of a link to a reader, before reading the link (AC-d1)", async () => {
    await sharedTree("pub_o", false)
    const spy = spyDb(claire.db)
    await expect(nodeShare(spy.db, claire.identity, "pub_o")).rejects.toMatchObject({ code: "forbidden" })
    expect(spy.sent.filter((query) => query.target === "node_shares")).toEqual([])
  })

  it("should refuse to disable a link to a member who is neither admin nor manager of its content, before any write (AC-d7)", async () => {
    const token = await sharedTree("pub_p", false)
    const [share] = await fx.admin<{ id: string }[]>`select id from platform.node_shares where token = ${token}`
    const spy = spyDb(claire.db)
    // Depuis `20261021130000`, la base ne rend un lien qu'à qui partage son contenu (niveau 3) ou administre
    // l'organisation : à Claire, lectrice, ce lien est inconnu, comme un lien d'un contenu qu'elle ne lit pas.
    await expect(revokeShare(spy.db, claire.identity, share.id)).rejects.toMatchObject({ code: "not_found", message: `No public link ${share.id} in ${claire.identity.org.name}.` })
    expect(writesOf(spy.sent)).toEqual([])
  })

  it("should list the active links of the organisation to its administrator, without token, and refuse a member (AC-d7)", async () => {
    await sharedTree("pub_i", false)
    const shares = await listShares(ada.db, ada.identity)
    expect(shares.find((share) => share.path === "pub_i")).toMatchObject({ title: "Titre pub_i", includeChildren: false, createdByName: o.people.ada.name })
    expect(shares.every((share) => !("token" in share))).toBe(true)
    await expect(listShares(marc.db, marc.identity)).rejects.toMatchObject({ code: "forbidden" })
  })

  it("should serve the public route without a session, never indexed, 404 alike for an unknown or malformed token, extra parameters ignored (AC-d5, AC-d6)", async () => {
    const token = await sharedTree("pub_j", false)
    const get = (value: string) =>
      handlePlateforme(new Request(`https://${o.host}/api/platform/public/${value}`), { accessToken: null, host: o.host })
    const found = await get(`${token}?utm_source=lettre`)
    expect([found.status, found.headers.get("x-robots-tag"), ((await found.json()) as { data: { node: { path: string } } }).data.node.path]).toEqual([
      200,
      "noindex, nofollow",
      "pub_j",
    ])
    for (const value of ["B".repeat(43), "%E0%A4%A"]) {
      const missing = await get(value)
      expect([missing.status, missing.headers.get("x-robots-tag"), await missing.json()]).toEqual([404, "noindex, nofollow", { error: notFound }])
    }
  })

  it("should refuse node_level_of to anon and to a signed-in member: its person would be forged (HN-E05S10e-21)", async () => {
    const levelOf = (sql: postgres.TransactionSql) =>
      sql`select platform.node_level_of(${o.people.ada.id}::uuid, ${o.org.id}::uuid, 'ventes'::extensions.ltree, null, null, null)`
    const denied = async (query: PromiseLike<unknown>) => (await failureOf(query))?.message ?? "served"
    const anon = await denied(
      fx.admin.begin(async (tx) => {
        await tx.unsafe("set local role anon")
        return levelOf(tx)
      }),
    )
    const member = await denied(marc.db.tx((sql) => levelOf(sql)))
    expect([anon, member]).toEqual(["permission denied for function node_level_of", "permission denied for function node_level_of"])
  })
})
