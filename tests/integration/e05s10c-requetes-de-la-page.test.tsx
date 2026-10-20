// @vitest-environment node
// Le temps d'affichage de la page d'un nœud (E05-S10, partie c, AC-c1) : les requêtes SQL qu'un affichage
// envoie, comptées sur une vraie base par l'espion de la face SQL (`recordDb`), pour une page, une procédure
// et un tableau. Un affichage = ce que Next rend pour une adresse : les métadonnées, le layout `(dashboard)`
// (le rail) et la page, en parallèle, puis ce que la page laisse sous ses `<Suspense>` (« Contenus liés », les
// lignes du tableau). `cache` de React ne mémorise que dans un rendu serveur : il est rendu ici par requête,
// comme Next le fait (une mémoire par affichage). Le test échoue au-delà des nombres atteints par la partie c :
// une lecture ajoutée en série, ou une relecture de ce que le layout a déjà lu, se voit ici. Organisation de
// référence jetable (H120) ; suite portable.
import { isValidElement, type ReactElement } from "react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity } from "@otomata_tech/oto_platform/server"
import DashboardLayout from "@/app/(dashboard)/layout"
import NoeudPage, { generateMetadata } from "@/app/(dashboard)/n/[...chemin]/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { createSqlFixtures, portable, recordDb, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { ACME_PROCEDURES, ACME_TABLE, seedNodesOf } from "./fixtures/acme"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

/** La mémoire de `cache` d'un affichage : vidée avant chacun, comme Next en ouvre une par requête. */
const memoire = new Map<unknown, { args: unknown[]; valeur: unknown }[]>()

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>()
  const cache = <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      const connus = memoire.get(fn) ?? []
      memoire.set(fn, connus)
      const connu = connus.find((entree) => entree.args.length === args.length && entree.args.every((arg, rang) => Object.is(arg, args[rang])))
      // La mémoire est typée `unknown` pour toutes les fonctions ; celle de `fn` n'y range que ses propres `R`.
      if (connu) return connu.valeur as R
      const valeur = fn(...args)
      connus.push({ args, valeur })
      return valeur
    }
  return { ...react, cache }
})

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// La vue de la page se compte après la réponse (`after`, 1.4.13) : hors d'une requête de Next, `after` lèverait.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 180_000
const PAGE = "ventes/tarifs"
const PROCEDURE = ACME_PROCEDURES[0].path
const TABLEAU = ACME_TABLE.path

/**
 * Les nombres atteints par la partie c pour un affichage par Ada, administratrice : les instructions que les
 * services envoient, et les transactions, qui en coûtent chacune trois de plus (`begin`, les réglages de la
 * session, `commit`). Avant elle : une page 65 instructions dans 33 transactions, une procédure 55 dans 29, un
 * tableau 72 dans 40. Depuis la bascule d'organisation (plusieurs organisations par personne), le layout lit en plus
 * les organisations de la personne (`listMyOrganisations`) : une instruction et une transaction de plus par affichage, en
 * parallèle des autres lectures du rail.
 */
const PLAFONDS = {
  page: { instructions: 32, transactions: 7 },
  procedure: { instructions: 30, transactions: 7 },
  tableau: { instructions: 41, transactions: 9 },
} as const

/** Les promesses que la page laisse à ses `<Suspense>`, où qu'elles soient dans l'arbre rendu. */
function enAttente(noeud: unknown, vus = new Set<unknown>()): Promise<unknown>[] {
  if (noeud === null || typeof noeud !== "object" || vus.has(noeud)) return []
  vus.add(noeud)
  if (noeud instanceof Promise) return [noeud]
  if (Array.isArray(noeud)) return noeud.flatMap((enfant) => enAttente(enfant, vus))
  if (isValidElement(noeud)) return enAttente(noeud.props, vus)
  return Object.values(noeud).flatMap((valeur) => enAttente(valeur, vus))
}

type Mesure = { instructions: number; transactions: number; ms: number }

/** L'écran que la page rend : le nœud lu, tel que l'écran le reçoit. */
type EcranLu = ReactElement<{ noeud: { data?: { path: string } } }>

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(portable("requests of one display of a node page (E05-S10, part c, AC-c1)"), privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let identity: Identity

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    await fx.seedNodes(o.org.id, seedNodesOf([ACME_PROCEDURES[0], ACME_TABLE], { ventes: o.teams.ventes, support: o.teams.support, conseil: o.teams.support }))
    const tarifs = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: PAGE, title: "Tarifs" })
    await fx.createNode(o.org.id, { parentId: tarifs, path: `${PAGE}/remises`, title: "Remises" })
    const blocs = [
      { type: "heading" as const, text: "Grille", data: { level: 1 as const } },
      { type: "paragraph" as const, text: `Les prospects sont suivis dans [[${TABLEAU}]].` },
      { type: "paragraph" as const, text: "Voir aussi [[ventes/devis]]." },
    ]
    await fx.publishBlocks(tarifs, blocs, { title: "Tarifs", summary: "Les tarifs.", links: [{ block: 1, path: TABLEAU }, { block: 2, path: "ventes/devis" }] })
    const ada = o.people.ada
    identity = await resolveIdentity(fx.as(ada), o.host, { userId: ada.id, email: ada.email })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    memoire.clear()
  })

  /** Un affichage de `chemin` par Ada : métadonnées, layout et page en parallèle, puis les `<Suspense>`. */
  async function afficher(chemin: string): Promise<Mesure & { ecran: EcranLu; attendus: unknown[] }> {
    const espion = recordDb(fx.as(o.people.ada))
    const session: PlatformSession = { user: { id: o.people.ada.id, email: o.people.ada.email }, accessToken: "", host: o.host, db: espion.db }
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity, session } })
    const segments = chemin.split("/")
    const debut = performance.now()
    const [, , page] = await Promise.all([
      generateMetadata({ params: Promise.resolve({ chemin: segments }) }),
      DashboardLayout({ children: null }),
      NoeudPage({ params: Promise.resolve({ chemin: segments }), searchParams: Promise.resolve({}) }),
    ])
    const attendus = (await Promise.allSettled(enAttente(page))).map((issue) => (issue.status === "fulfilled" ? issue.value : issue.reason))
    const ms = Math.round(performance.now() - debut)
    const instructions = espion.requests.filter((requete) => requete.kind === "statement").length
    const transactions = espion.requests.filter((requete) => requete.kind === "transaction").length
    if (process.env.E05S10C_MESURE) console.info(`[e05s10c] ${chemin}: ${instructions} instructions, ${transactions} transactions, ${ms} ms`)
    if (!isValidElement<EcranLu["props"]>(page)) throw new Error("the page rendered no element")
    return { instructions, transactions, ms, ecran: page, attendus }
  }

  it("should display a page within its query budget, links included", async () => {
    const mesure = await afficher(PAGE)
    expect(mesure.ecran.props.noeud.data?.path).toBe(PAGE)
    expect(mesure.attendus).toContainEqual({ data: expect.objectContaining({ links_out_total: 2 }) })
    expect(mesure.instructions).toBeLessThanOrEqual(PLAFONDS.page.instructions)
    expect(mesure.transactions).toBeLessThanOrEqual(PLAFONDS.page.transactions)
  })

  it("should display a procedure within its query budget", async () => {
    const mesure = await afficher(PROCEDURE)
    expect(mesure.ecran.props.noeud.data?.path).toBe(PROCEDURE)
    expect(mesure.instructions).toBeLessThanOrEqual(PLAFONDS.procedure.instructions)
    expect(mesure.transactions).toBeLessThanOrEqual(PLAFONDS.procedure.transactions)
  })

  it("should display a table within its query budget, rows included", async () => {
    const mesure = await afficher(TABLEAU)
    expect(mesure.ecran.props.noeud.data?.path).toBe(TABLEAU)
    expect(mesure.attendus).toContainEqual(expect.objectContaining({ lignes: { data: expect.objectContaining({ count: ACME_TABLE.rows?.length }) } }))
    expect(mesure.instructions).toBeLessThanOrEqual(PLAFONDS.tableau.instructions)
    expect(mesure.transactions).toBeLessThanOrEqual(PLAFONDS.tableau.transactions)
  })
})
