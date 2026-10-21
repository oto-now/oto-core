// La vue « Contexte » servie et l'encart d'un Contexte : chaque partie servie, nommée, à son ancre, écrite en place
// quand la personne le peut, ses listes en français. Un `describe` par chantier, ses données à lui.
import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView, NodeView } from "@otomata_tech/oto_platform/schemas"
import { AnnexesDuContexte, ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { ContexteDeLEntreprise } from "../../../packages/plateforme/ui/admin/organisation/contexte-de-l-entreprise"
import type { DonneesDeLApercu } from "../../../packages/plateforme/ui/contexte/apercu-du-contexte"
import { ContexteServi, type DonneesDuContexteServi } from "../../../packages/plateforme/ui/contexte/contexte-servi"
import { nomDuBloc } from "../../../packages/plateforme/ui/contexte/libelles"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { bloc, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"

const rafraichir = vi.fn()
const ECHEC = "Une erreur est survenue. Réessayez."

function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  rafraichir.mockReset()
})

describe("la vue « Contexte » servie (E05-S11)", () => {
  // La vue « Contexte » de l'accueil (E05-S11, retours 4 et 6 de JB, AC-13 à AC-15) : les parties du texte que
  // `context` servirait, empilées dans l'ordre, chacune nommée et à son ancre (sans chiffres depuis E05-S13) ; un Contexte que la personne peut écrire (niveau décidé par le service, lu par la page) s'y écrit en
  // place avec l'éditeur d'une page, les autres se lisent ; les échecs se disent. E11-S10 (lot f) : ni tête servie, ni
  // lien vers Profil, ni « Règles Oto » ; une partie sans corps le dit ; « Nouveautés » toujours là ; l'ancre suivie.
  // `fetch` simulé pour `POST /api/platform/nodes`, relecture espionnée.

  /** Les têtes des parties de Contexte (E05-S12, D109) : en-tête et ligne de faits. */
  const TETES = {
    toutLeMonde: "## Context: everyone (contexte)\nOrganisation: Démo.",
    prive: "## Context: you only (private/lea/contexte)\nYou: Léa Martin (lea), member of Démo.",
    ventes: "## Context: team Ventes (ventes/contexte)\nTeam Ventes, your default team.",
  }

  const PARTIES = {
    code: "ctx: XXXX-XXXX",
    toutLeMonde: `${TETES.toutLeMonde}\nNous vendons des logiciels.`,
    prive: `${TETES.prive}\nSignature : Léa.`,
    ventes: `${TETES.ventes}\nTutoie les clients.`,
    avis: "[Context budget reached. Omitted: news. Use demo_find or demo_read for more.]",
  }

  const TEXTE = [PARTIES.code, PARTIES.toutLeMonde, PARTIES.prive, PARTIES.ventes, PARTIES.avis].join("\n\n")

  const APERCU = {
    data: {
      text: TEXTE,
      budget: 20_000,
      blocks: [
        { name: "code", chars: PARTIES.code.length, status: "full", path: null, head: 0 },
        { name: "contexte", chars: PARTIES.toutLeMonde.length, status: "full", path: "contexte", head: TETES.toutLeMonde.length },
        { name: "private/lea/contexte", chars: PARTIES.prive.length, status: "full", path: "private/lea/contexte", head: TETES.prive.length },
        { name: "ventes/contexte", chars: PARTIES.ventes.length, status: "cut", path: "ventes/contexte", head: TETES.ventes.length },
        { name: "news", chars: 0, status: "omitted", path: null, head: 0 },
      ],
    },
  }

  const TOUT_LE_MONDE = bloc("a1000000-0000-4000-8000-000000000001", "paragraph", "Nous vendons des logiciels.")
  const VENTES = bloc("b2000000-0000-4000-8000-000000000002", "paragraph", "Tutoie les clients.")

  const PRIVE = bloc("c3000000-0000-4000-8000-000000000003", "paragraph", "Signature : Léa.")

  /** Les trois Contextes servis, lus par la page, aux niveaux que le service donnerait à la personne. */
  function contextes(niveaux: { toutLeMonde: NodeView["level"]; ventes: NodeView["level"]; prive: NodeView["level"] }): DonneesDuContexteServi["contextes"] {
    return {
      contexte: { data: vueDuNoeud({ id: "n-contexte", path: "contexte", kind: "context", level: niveaux.toutLeMonde, blocks: [TOUT_LE_MONDE] }) },
      "ventes/contexte": { data: vueDuNoeud({ id: "n-ventes", path: "ventes/contexte", kind: "context", level: niveaux.ventes, blocks: [VENTES] }) },
      "private/lea/contexte": { data: vueDuNoeud({ id: "n-prive", path: "private/lea/contexte", kind: "context", level: niveaux.prive, owner: { kind: "user", userName: "Léa Martin" }, blocks: [PRIVE] }) },
    }
  }

  /** Tout le monde en lecture (niveau 1), Ventes en gestion (3), le Contexte Privé en écriture (2). */
  const CONTEXTES = contextes({ toutLeMonde: 1, ventes: 3, prive: 2 })

  const DONNEES: DonneesDuContexteServi = { apercu: APERCU, contextes: CONTEXTES, equipes: [{ slug: "ventes", name: "Ventes" }] }

  function monter(donnees: Partial<DonneesDuContexteServi> = {}) {
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <ContexteServi donnees={{ ...DONNEES, ...donnees }} Lien={LienDeTest} prefixeDesPages="/n/" ici="/context" />
      </ContexteDeRafraichissement.Provider>,
    )
  }

  const partie = (nom: string) => within(screen.getByRole("region", { name: nom }))

  describe("la vue « Contexte » (AC-13)", () => {
    it("should stack every served part in order, each named and at its anchor, without figures (E05-S13, AC-13)", () => {
      monter()
      const parties = screen.getAllByRole("region")
      // Sans « Règles Oto » (E11-S10, AC-f4) : les autres parties gardent leur ancre.
      expect(parties.map((une) => [une.getAttribute("aria-labelledby") ? within(une).getByRole("heading", { level: 2 }).textContent : une.getAttribute("aria-label"), une.id])).toEqual([
        ["Contexte : Tout le monde", "everyone-context"],
        ["Contexte : Privé", "private-context"],
        ["Contexte : équipe Ventes", "context-ventes"],
        ["Nouveautés", "news"],
        ["Fin du texte", ""],
      ])
      // E05-S13 (AC-13) : ni taille, ni état, ni note des versions, ni total.
      expect(document.body.textContent).not.toMatch(/caractères|reflète les versions/)
      // Une partie en lecture : son corps tel que servi, dans sa carte, sans la tête servie (E11-S10, AC-f1) ; l'avis de
      // fin, en français.
      expect(partie("Contexte : Tout le monde").getAllByText(/./, { selector: "pre" }).map((texte) => texte.textContent)).toEqual(["Nous vendons des logiciels."])
      expect(partie("Fin du texte").getByText("Budget atteint : l'assistant ne lit pas Nouveautés.")).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/## Context:|Organisation: Démo\.|You: |Team Ventes, /)
    })
  })

  describe("écrire un Contexte dans la vue (AC-14)", () => {
    it("should write in place the Contextes the person can write, and read the others as served, without a link to Profil", () => {
      monter()
      // Gestion (Ventes) et écriture (Privé) : l'éditeur d'une page, chaque bloc modifiable (lu au repos, champ monté au focus).
      expect(partie("Contexte : équipe Ventes").getByRole("textbox", { name: "Modifier ce texte — Tutoie les clients." })).toBeInTheDocument()
      expect(partie("Contexte : Privé").getByRole("textbox", { name: "Modifier ce texte — Signature : Léa." })).toBeInTheDocument()
      // Écrire publie (E11-S02, AC-c2) : au niveau écriture aussi, la publication seule, sans phrase.
      expect(partie("Contexte : Privé").getByRole("group", { name: "Publication" })).toBeInTheDocument()
      expect(partie("Contexte : Privé").queryByText(/La publication revient/)).toBeNull()
      // Lecture (Tout le monde) : le texte servi, aucun champ.
      expect(partie("Contexte : Tout le monde").queryByRole("textbox")).toBeNull()
      expect(partie("Contexte : Tout le monde").getByText("Nous vendons des logiciels.", { selector: "pre" })).toBeInTheDocument()
      // E11-S10 (AC-f3) : la partie Privé ne renvoie plus à Profil.
      expect(screen.queryByRole("link", { name: "Modifier dans Profil" })).toBeNull()
    })

    it("should publish a written Contexte on its own path, then read the view again", async () => {
      const api = simulerLAPI()
      monter()
      const champ = ouvrirLeChamp("Modifier ce texte — Tutoie les clients.", screen.getByRole("region", { name: "Contexte : équipe Ventes" }))
      fireEvent.change(champ, { target: { value: "Tutoie les clients, toujours." } })
      fireEvent.keyDown(champ, { key: "Escape" })
      await waitFor(() => expect(api.envoyes).toHaveLength(1))
      act(() => window.dispatchEvent(new Event("pagehide")))
      await waitFor(() => expect(api.envoyes).toHaveLength(2))
      expect(api.envoyes.map((corps) => [corps.path, corps.publish ?? false])).toEqual([
        ["ventes/contexte", false],
        ["ventes/contexte", true],
      ])
      await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    })
  })

  describe("la vue « Contexte », états (AC-15)", () => {
    it("should say a failed preview with « Réessayer » on the view's address", () => {
      monter({ apercu: { error: ECHEC } })
      expect(screen.getByRole("alert")).toHaveTextContent(`L'aperçu n'a pas pu être calculé.${ECHEC}`)
      expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/context")
      expect(screen.queryByRole("region")).toBeNull()
    })

    it("should say an omitted part is not read, and a Contexte that could not be read, its served text kept", () => {
      monter({ contextes: { ...CONTEXTES, contexte: { error: ECHEC } } })
      expect(partie("Nouveautés").getByText("Cette partie ne tient pas dans le budget : l'assistant ne la lit pas.")).toBeInTheDocument()
      expect(partie("Contexte : Tout le monde").getByText("Nous vendons des logiciels.", { selector: "pre" })).toBeInTheDocument()
      expect(partie("Contexte : Tout le monde").getByRole("alert")).toHaveTextContent(ECHEC)
    })

    it("should read everything when no Contexte is writable, their served heads hidden (E11-S10, AC-f1)", () => {
      monter({ contextes: contextes({ toutLeMonde: 1, ventes: 1, prive: 1 }) })
      expect(screen.queryByRole("textbox")).toBeNull()
      expect(screen.getAllByText(/./, { selector: "pre" }).map((texte) => texte.textContent)).toEqual(["Nous vendons des logiciels.", "Signature : Léa.", "Tutoie les clients."])
    })
  })

  /** Un aperçu fait de ces parties, dans cet ordre, chacune servie en entier ; `head` : la tête d'une partie de Contexte. */
  function apercuDe(parties: { name: string; texte: string; head?: number }[]): DonneesDuContexteServi["apercu"] {
    return {
      data: {
        text: parties.map((une) => une.texte).join("\n\n"),
        budget: 20_000,
        blocks: parties.map(({ name, texte, head }) => ({ name, chars: texte.length, status: "full", path: null, head: head ?? 0 })),
      },
    }
  }

  describe("la vue « Contexte » allégée (E11-S10, lot f)", () => {
    const SUPPORT = "## Context: team Support (support/contexte)\nTeam Support. Lead: Paul."

    it("should say a part the person cannot write when nothing is served after its head (AC-f2)", () => {
      monter({
        apercu: apercuDe([{ name: "support/contexte", texte: SUPPORT, head: SUPPORT.length }]),
        contextes: { "support/contexte": { data: vueDuNoeud({ id: "n-support", path: "support/contexte", kind: "context", level: 1, blocks: [] }) } },
        equipes: [{ slug: "support", name: "Support" }],
      })
      expect(partie("Contexte : équipe Support").getByText("L'assistant ne reçoit rien de ce contexte pour l'instant.")).toBeInTheDocument()
      expect(document.body.textContent).not.toContain("Lead: Paul")
    })

    it("should keep a « Nouveautés » section when none is served, before the procedures, and only one when news are served (AC-f5)", () => {
      monter({
        apercu: apercuDe([
          { name: "code", texte: "ctx: XXXX-XXXX" },
          { name: "contexte", texte: PARTIES.toutLeMonde, head: TETES.toutLeMonde.length },
          { name: "procedures", texte: "Procédures du jour." },
        ]),
      })
      expect(screen.getAllByRole("region").map((une) => [within(une).getByRole("heading", { level: 2 }).textContent, une.id])).toEqual([
        ["Contexte : Tout le monde", "everyone-context"],
        ["Nouveautés", "news"],
        ["Procédures utiles", "procedures"],
      ])
      expect(partie("Nouveautés").getByText("Aucune nouveauté n'est servie à l'assistant en ce moment.")).toBeInTheDocument()
      cleanup()

      monter({ apercu: apercuDe([{ name: "news", texte: "Nouveau depuis hier." }]) })
      expect(document.querySelectorAll("#news")).toHaveLength(1)
      expect(screen.queryByText("Aucune nouveauté n'est servie à l'assistant en ce moment.")).toBeNull()
    })

    it("should bring the part of the address on mount and on each hashchange, the top of the view for an unknown anchor, and stop at unmount (AC-f6)", () => {
      const amenes: string[] = []
      const avant = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        amenes.push(this.id)
      })
      try {
        window.history.replaceState(null, "", "#context-ventes")
        monter()
        window.history.replaceState(null, "", "#news")
        act(() => window.dispatchEvent(new HashChangeEvent("hashchange")))
        window.history.replaceState(null, "", "#rules")
        act(() => window.dispatchEvent(new HashChangeEvent("hashchange")))
        expect(amenes).toEqual(["context-ventes", "news", "haut-de-la-vue"])
        cleanup()
        window.dispatchEvent(new HashChangeEvent("hashchange"))
        expect(amenes).toHaveLength(3)
      } finally {
        Element.prototype.scrollIntoView = avant
        window.history.replaceState(null, "", window.location.pathname)
      }
    })
  })
})

describe("une partie par Contexte (E05-S12, lot C)", () => {
  // Les écrans du Contexte après E05-S12, lot C (D109, retours 1, 2 et 4) : la vue « Contexte » de l'accueil et
  // l'encart d'un Contexte nomment une partie par Contexte, servie ou non (AC-6) ; dans une partie, la tête servie
  // se lit toujours, l'éditeur dessous quand la personne peut écrire le Contexte, même non servi (AC-7) ; ancres et
  // « (ce contexte) » par le nom de la partie (AC-8). E11-S10 (lot f, lot g) : la tête servie n'est plus montrée, ni
  // « Modifier dans Profil », ni « Règles Oto », dans la vue comme dans l'encart. Le rapport est celui du moteur
  // (`head`, lot A) ; les parties servies nommées et leurs ancres sont aussi relues par la vue d'E05-S11, plus haut,
  // et `contexte.test.tsx`. L'échec de lecture d'un Contexte servi se dit sous son texte servi : « should say an omitted
  // part is not read, and a Contexte that could not be read, its served text kept », plus haut.

  const TETES = {
    toutLeMonde: "## Context: everyone (contexte)\nOrganisation: Démo. Domains: demo.fr.",
    prive: "## Context: you only (private/lea/contexte)\nYou: Léa Martin (lea), member of Démo. Teams: Ventes (default), Conseil. Reply in French unless the user writes in another language.",
    ventes: "## Context: team Ventes (ventes/contexte)\nTeam Ventes, your default team. Lead: Claire Morel.\nConnectors (the team that runs each call unless the procedure's place says otherwise):\n- mail: team Ventes (write)",
    conseil: "## Context: team Conseil (conseil/contexte)\nTeam Conseil.",
  }

  const PARTIES = {
    code: "ctx: XXXX-XXXX\nPass this ctx to every other tool.\n## How this workspace works\n- Six tools.\n## This request\nNo request given.",
    toutLeMonde: `${TETES.toutLeMonde}\nNous vendons des logiciels.`,
    // Le Privé n'est pas servi (jamais publié) : sa tête seule.
    prive: TETES.prive,
    ventes: `${TETES.ventes}\nTutoie les clients.`,
    // Conseil n'est pas servi non plus, et la personne ne peut pas l'écrire.
    conseil: TETES.conseil,
    contenus: "## Recent content\n- ventes/tarifs — Tarifs",
  }

  const TEXTE = [PARTIES.code, PARTIES.toutLeMonde, PARTIES.prive, PARTIES.ventes, PARTIES.conseil, PARTIES.contenus].join("\n\n")

  /** Le rapport du moteur : `name` = chemin d'une partie de Contexte, `path` seulement quand son corps est servi. */
  const APERCU = {
    data: {
      text: TEXTE,
      budget: 20_000,
      blocks: [
        { name: "code", chars: PARTIES.code.length, status: "full", path: null, head: 0 },
        { name: "contexte", chars: PARTIES.toutLeMonde.length, status: "full", path: "contexte", head: TETES.toutLeMonde.length },
        { name: "private/lea/contexte", chars: PARTIES.prive.length, status: "full", path: null, head: TETES.prive.length },
        { name: "ventes/contexte", chars: PARTIES.ventes.length, status: "full", path: "ventes/contexte", head: TETES.ventes.length },
        { name: "conseil/contexte", chars: PARTIES.conseil.length, status: "full", path: null, head: TETES.conseil.length },
        { name: "recent content", chars: PARTIES.contenus.length, status: "full", path: null, head: 0 },
      ],
    },
  }

  const EQUIPES = [
    { slug: "ventes", name: "Ventes" },
    { slug: "conseil", name: "Conseil" },
  ]

  /** Le Contexte Privé jamais publié, en brouillon, que Léa écrit (niveau 2). */
  const PRIVE_EN_BROUILLON: NodeView = vueDuNoeud({
    id: "n-prive",
    path: "private/lea/contexte",
    kind: "context",
    status: "draft",
    revision: 0,
    level: 2,
    owner: { kind: "user", userName: "Léa Martin" },
    blocks: [],
    draft: {
      baseRevision: 0,
      savedAt: "2026-09-28T09:00:00.000Z",
      draftStamp: "2026-09-28T09:00:00.000000+00:00",
      blocks: [bloc("c3000000-0000-4000-8000-000000000003", "paragraph", "Signature : Léa.")],
      title: null,
      summary: null,
      kind: null,
      meta: null,
    },
  })

  /** Ce que la page lit : Tout le monde en lecture, Ventes en gestion, le Privé non servi en écriture, Conseil illisible. */
  const CONTEXTES: DonneesDuContexteServi["contextes"] = {
    contexte: { data: vueDuNoeud({ id: "n-contexte", path: "contexte", kind: "context", level: 1, blocks: [] }) },
    "private/lea/contexte": { data: PRIVE_EN_BROUILLON },
    "ventes/contexte": {
      data: vueDuNoeud({ id: "n-ventes", path: "ventes/contexte", kind: "context", level: 3, blocks: [bloc("b2000000-0000-4000-8000-000000000002", "paragraph", "Tutoie les clients.")] }),
    },
    "conseil/contexte": { error: ECHEC },
  }

  function monterLaVue(donnees: Partial<DonneesDuContexteServi> = {}) {
    render(
      <ContexteServi
        donnees={{ apercu: APERCU, contextes: CONTEXTES, equipes: EQUIPES, ...donnees }}
        Lien={LienDeTest}
        prefixeDesPages="/n/"
        ici="/context"
      />,
    )
  }

  function monterLEncart(cheminCourant: string) {
    render(
      <AnnexesDuContexte
        cheminCourant={cheminCourant}
        handle="lea"
        apercu={APERCU}
        equipes={EQUIPES}
        hrefDuContexteServi="/context"
        ici={`/n/${cheminCourant}`}
        Lien={LienDeTest}
      />,
    )
  }

  const partie = (nom: string) => within(screen.getByRole("region", { name: nom }))
  const textesServis = (nom: string) => partie(nom).queryAllByText(/./, { selector: "pre" }).map((texte) => texte.textContent)

  describe("une partie par Contexte (AC-6)", () => {
    it("should name every part in the view and in the insert, a Contexte not served by its name, and none after the old blocks", () => {
      monterLaVue()
      // Sans « Règles Oto » (E11-S10, AC-f4, AC-g2) ; « Nouveautés » dans la vue même quand rien n'en est servi (AC-f5).
      const noms = ["Contexte : Tout le monde", "Contexte : Privé", "Contexte : équipe Ventes", "Contexte : équipe Conseil", "Contenus récents"]
      expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby") && document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent)).toEqual([
        ...noms.slice(0, 4),
        "Nouveautés",
        "Contenus récents",
      ])
      for (const ancien of ["Vous", "Organisation", "Vos équipes", "Connecteurs", "Code de la conversation", "Documents récents"]) {
        expect(screen.queryByRole("region", { name: ancien })).toBeNull()
      }
      // Le Privé d'une personne sans `handle` s'appelle `private` (AC-3) : c'est toujours sa partie Privé.
      expect(nomDuBloc({ name: "private" }, EQUIPES)).toBe("Contexte : Privé")
      cleanup()
      monterLEncart("ventes/contexte")
      const lignes = within(screen.getByRole("list", { name: "Ordre de lecture" })).getAllByRole("link")
      // E05-S13 (AC-13) : le nom seul, sans taille ni état.
      expect(lignes.map((ligne) => ligne.textContent?.replace(/ \(ce contexte\)$/, ""))).toEqual(noms)
    })
  })

  describe("une partie, puis son Contexte (AC-7 ; E11-S10, AC-f1 à AC-f3)", () => {
    it("should hide the served head, then show the editor of a writable Contexte even not served, else the rest of the served text", () => {
      monterLaVue()
      // Ni faits ni connecteurs à l'écran : l'assistant les reçoit toujours (HN-E11S10-14).
      expect(document.body.textContent).not.toMatch(/Organisation: Démo|You: Léa|Team Ventes|Team Conseil|Connectors/)
      // Tout le monde, en lecture : la suite servie ; aucun champ.
      expect(textesServis("Contexte : Tout le monde")).toEqual(["Nous vendons des logiciels."])
      expect(partie("Contexte : Tout le monde").queryByRole("textbox")).toBeNull()
      // Ventes, en gestion : l'éditeur, le corps servi n'est pas répété.
      expect(textesServis("Contexte : équipe Ventes")).toEqual([])
      expect(partie("Contexte : équipe Ventes").getByRole("textbox", { name: "Modifier ce texte — Tutoie les clients." })).toBeInTheDocument()
      // Le Privé, jamais publié donc non servi, mais écrivable : son éditeur, sans lien vers Profil.
      expect(textesServis("Contexte : Privé")).toEqual([])
      expect(partie("Contexte : Privé").getByRole("textbox", { name: "Modifier ce texte — Signature : Léa." })).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: "Modifier dans Profil" })).toBeNull()
      // Conseil, non servi et en échec de lecture pour la page : rien de servi, aucun champ, et l'échec se dit
      // (portage-ecrans.md § 4 ; un Contexte absent, `not_found`, la page ne le lit pas en erreur).
      expect(partie("Contexte : équipe Conseil").getByText("L'assistant ne reçoit rien de ce contexte pour l'instant.")).toBeInTheDocument()
      expect(partie("Contexte : équipe Conseil").queryByRole("textbox")).toBeNull()
      expect(partie("Contexte : équipe Conseil").getByRole("alert")).toHaveTextContent(ECHEC)
    })
  })

  describe("ancres et « (ce contexte) » par le nom de la partie (AC-8)", () => {
    it("should lead each line of the insert to its anchor, and mark the opened Contexte even when it is not published", () => {
      monterLEncart("private/lea/contexte")
      const liste = within(screen.getByRole("list", { name: "Ordre de lecture" }))
      expect(liste.getAllByRole("link").map((lien) => lien.getAttribute("href"))).toEqual(
        ["everyone-context", "private-context", "context-ventes", "context-conseil", "recent-content"].map((ancre) => `/context#${ancre}`),
      )
      const marquees = liste.getAllByRole("link").filter((lien) => lien.getAttribute("aria-current") === "page")
      expect(marquees.map((lien) => lien.textContent?.startsWith("Contexte : Privé (ce contexte)"))).toEqual([true])
      cleanup()
      monterLaVue()
      expect(screen.getAllByRole("region").map((region) => region.id)).toEqual(["everyone-context", "private-context", "context-ventes", "context-conseil", "news", "recent-content"])
    })
  })

  describe("sans « Règles Oto » (E11-S10, AC-f4, AC-g2)", () => {
    it("should render no part and no line for the code block, in the view as in the insert", () => {
      monterLaVue()
      expect(screen.queryByText("Règles Oto")).toBeNull()
      expect(document.body.textContent).not.toContain("How this workspace works")
      expect(document.body.textContent).not.toContain("ctx: XXXX-XXXX")
      cleanup()
      monterLEncart("contexte")
      expect(screen.queryByText(/Règles Oto/)).toBeNull()
    })
  })
})

describe("les parties servies en français (E05-S13, lot A)", () => {
  // E05-S13, lot A (retours 1 et 8 de JB du 2026-09-28) : l'encart « Contexte · Tout le monde » d'Organisation montre,
  // sous les blocs publiés, les listes que le texte servi de ce Contexte porte (AC-4) ; dans la vue « Contexte » de
  // l'accueil, chaque partie hors Contexte est une carte sous son titre, ses lignes en français, chaque chemin ou titre
  // un lien (AC-14). Les textes servis sont écrits en toutes lettres : ce sont ceux du contrat ; leur parité avec le
  // service est tenue par `tests/unit/texte-servi.test.ts`. AC-13 (sans chiffres) et AC-17 (« À quoi sert
  // cette page ») : `contexte.test.tsx` et la vue d'E05-S11, plus haut. Aucune carte pour « Règles Oto » : « should
  // render no part and no line for the code block, in the view as in the insert », plus haut.

  /** Un rapport d'aperçu pour des parties données : chacune son nom, son texte servi et sa tête. */
  function apercu(parties: readonly { name: string; texte: string; tete?: number }[]): DonneesDeLApercu {
    return {
      text: parties.map((partie) => partie.texte).join("\n\n"),
      budget: 20_000,
      blocks: parties.map((partie) => ({ name: partie.name, chars: partie.texte.length, status: "full", path: null, head: partie.tete ?? 0 })),
    }
  }

  describe("the Contexte of Tout le monde on Organisation (AC-4)", () => {
    const TETE = "## Context: everyone (contexte)\nOrganisation: Démo."
    const SUITE = [
      "Nous vendons des pompes.",
      "",
      "Pages, tables and procedures here:",
      "- contexte/conseil — Conseil — Nos conseils aux clients.",
      "- contexte/tarifs — Tarifs 2026 — Les tarifs.",
      "- contexte/qualifier — Qualifier un prospect — La procédure.",
      "Linked pages:",
      "- support/faq — FAQ support — Réponses types.",
    ].join("\n")
    const BLOCS: BlockView[] = [{ id: "bloc-1", ref: "b1", type: "paragraph", text: "Nous vendons des pompes.", data: {}, key: null, position: 1, revision: 1, provenance: {} }]

    async function monter(servi: Promise<{ data: DonneesDeLApercu } | { error: string }>, lecture: Promise<{ data: BlockView[] } | { error: string }> = Promise.resolve({ data: BLOCS })) {
      await act(async () => {
        render(<ContexteDeLEntreprise lecture={lecture} apercu={servi} prefixeDesPages="/n/" Lien={LienDeTest} ici="/admin/organization" hrefDuContexte="/n/contexte" />)
      })
      return within(screen.getByRole("region", { name: "Contexte · Tout le monde" }))
    }

    const lignesDe = (encart: ReturnType<typeof within>, titre: string) =>
      within(encart.getByRole("list", { name: titre }))
        .getAllByRole("listitem")
        .map((ligne) => [ligne.textContent, within(ligne).getByRole("link").getAttribute("href")])

    it("should show under the published blocks the lists its served text carries, each line leading to its content", async () => {
      const encart = await monter(Promise.resolve({ data: apercu([{ name: "code", texte: "ctx: XXXX-XXXX" }, { name: "contexte", texte: `${TETE}\n${SUITE}`, tete: TETE.length }]) }))
      const bloc = encart.getByText("Nous vendons des pompes.")
      const ranges = encart.getByRole("list", { name: "Rangés sous ce contexte" })
      expect(bloc.compareDocumentPosition(ranges)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(lignesDe(encart, "Rangés sous ce contexte")).toEqual([
        ["Conseil — Nos conseils aux clients.", "/n/contexte/conseil"],
        ["Tarifs 2026 — Les tarifs.", "/n/contexte/tarifs"],
        ["Qualifier un prospect — La procédure.", "/n/contexte/qualifier"],
      ])
      expect(lignesDe(encart, "Pages citées")).toEqual([["FAQ support — Réponses types.", "/n/support/faq"]])
      // Le corps servi n'est pas répété (les blocs le montrent), ni l'en-tête ni les faits de la partie.
      expect(encart.getAllByText("Nous vendons des pompes.")).toHaveLength(1)
      expect(encart.queryByText(/Organisation: Démo|## Context/)).toBeNull()
    })

    it("should show no list when the served text carries none, nor when the part is not served", async () => {
      let encart = await monter(Promise.resolve({ data: apercu([{ name: "contexte", texte: `${TETE}\nNous vendons des pompes.`, tete: TETE.length }]) }))
      expect(encart.queryByRole("list")).toBeNull()
      expect(encart.getByText("Nous vendons des pompes.")).toBeInTheDocument()
      cleanup()
      encart = await monter(Promise.resolve({ data: apercu([{ name: "code", texte: "ctx: XXXX-XXXX" }]) }))
      expect(encart.queryByRole("list")).toBeNull()
    })

    it("should keep the blocks and say the failed read of the lists with « Réessayer »", async () => {
      const encart = await monter(Promise.resolve({ error: ECHEC }))
      expect(encart.getByText("Nous vendons des pompes.")).toBeInTheDocument()
      expect(encart.getByRole("alert")).toHaveTextContent(`Les contenus liés n'ont pas pu être lus.${ECHEC}`)
      expect(encart.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/organization")
    })
  })

  describe("the parts of the « Contexte » view as read-only cards in French (AC-14)", () => {
    const REGLES = [
      "## How this workspace works",
      ...Array.from({ length: 12 }, (_, rang) => `- Rule ${rang + 1}.`),
    ]
    const PROCEDURES = [
      "## Procedures you can run, most used first (62)",
      ...Array.from({ length: 60 }, (_, rang) => `- ventes/p${String(rang).padStart(2, "0")}: Demandez la procédure ${rang}.`),
      "… and 2 more: find them with demo_find, type procedure.",
    ]
    const PARTIES = [
      { name: "code", texte: ["ctx: XXXX-XXXX", "Pass this ctx to every demo_ tool.", ...REGLES, "## This request", "No request given."].join("\n") },
      { name: "news", texte: ["## What's new since 2026-09-20", "- ventes/devis v3 (2026-09-27): Devis type", "- Connector mail activated (2026-09-26)"].join("\n") },
      { name: "procedures", texte: PROCEDURES.join("\n") },
      { name: "recent content", texte: ["## Recent content", "- ventes/tarifs (table, 2026-09-25): Tarifs 2026", "- ventes/faq (page, 2026-09-24): FAQ"].join("\n") },
    ]

    function monter() {
      render(
        <ContexteServi
          donnees={{ apercu: { data: apercu(PARTIES) }, contextes: {}, equipes: [] }}
          Lien={LienDeTest}
          prefixeDesPages="/n/"
          ici="/context"
        />,
      )
    }

    const partie = (nom: string) => screen.getByRole("region", { name: nom })
    /** La carte d'une partie, sous son titre. */
    function carte(nom: string) {
      const region = partie(nom)
      const titre = within(region).getByRole("heading", { level: 2, name: nom })
      const ilot = region.querySelector(".oto-island")
      expect(ilot).not.toBeNull()
      expect(titre.compareDocumentPosition(ilot as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(within(ilot as HTMLElement).queryByRole("textbox")).toBeNull()
      return within(ilot as HTMLElement)
    }
    const lignes = (element: HTMLElement) => within(element).getAllByRole("listitem").map((ligne) => [ligne.textContent, within(ligne).queryByRole("link")?.getAttribute("href") ?? null])

    it("should read « Nouveautés » with its date, a version and a connector", () => {
      monter()
      const nouveautes = carte("Nouveautés")
      expect(lignes(nouveautes.getByRole("list", { name: "Depuis le 20 septembre 2026" }))).toEqual([
        ["Devis type — version 3, publiée le 27 septembre 2026", "/n/ventes/devis"],
        ["Connecteur mail activé le 26 septembre 2026", null],
      ])
    })

    it("should read « Procédures utiles » with its count, each path a link, and the ones not listed", () => {
      monter()
      const procedures = carte("Procédures utiles")
      const liste = lignes(procedures.getByRole("list", { name: "62 procédures" }))
      expect(liste).toHaveLength(60)
      expect(liste[0]).toEqual(["ventes/p00 — Demandez la procédure 0.", "/n/ventes/p00"])
      expect(procedures.getByText("… et 2 autres, que l'assistant trouve par la recherche.")).toBeInTheDocument()
    })

    it("should read « Contenus récents » by title, kind and date", () => {
      monter()
      expect(lignes(carte("Contenus récents").getByRole("list"))).toEqual([
        ["Tarifs 2026 — tableau, 25 septembre 2026", "/n/ventes/tarifs"],
        ["FAQ — page, 24 septembre 2026", "/n/ventes/faq"],
      ])
    })

    it("should leave none of the served English headers in the page", () => {
      monter()
      for (const anglais of ["Procedures you can run", "What's new", "Recent content", "Nothing new", "How this workspace works", "Rule 1."]) {
        expect(document.body.textContent).not.toContain(anglais)
      }
    })
  })
})

describe("les listes d'index d'un Contexte (M71)", () => {
  // M71 (bug signalé par JB, 2026-09-28) : dans la vue « Contexte » de l'accueil, une partie de Contexte que la
  // personne peut écrire montre sa tête puis l'éditeur ; les listes d'index que `context` sert en plus des blocs du
  // Contexte (« Pages, tables and procedures here: », « Linked pages: », `server/context/blocks/contexts.ts`) n'y
  // étaient plus lues. Elles se lisent sous l'éditeur, chaque ligne menant à son contenu ; une partie en lecture
  // garde son texte servi entier. Les textes servis sont écrits en toutes lettres : ce sont ceux du contrat. E05-S13
  // (AC-15) : les listes se lisent en français (« Rangés sous ce contexte », « Pages citées »), chaque ligne par son
  // titre, puis son résumé ; une partie en lecture garde son corps tel que servi, ses listes en français.

  const TETE = "## Context: everyone (contexte)\nOrganisation: Démo. Domains: demo.fr."
  const CORPS = "Nous vendons des logiciels."
  const ENFANTS = ["Pages, tables and procedures here:", "- contexte/conseil — Conseil — Nos conseils aux clients.", "- contexte/tarifs — Tarifs 2026 — Les tarifs."]
  const LIEES = ["Linked pages:", "- support/faq — FAQ support — Réponses types."]

  /** Le rapport de l'aperçu pour la seule partie de Tout le monde, servie avec `suite` sous sa tête. */
  function apercu(suite: string): DonneesDuContexteServi["apercu"] {
    const text = `${TETE}\n${suite}`
    return { data: { text, budget: 20_000, blocks: [{ name: "contexte", chars: text.length, status: "full", path: "contexte", head: TETE.length }] } }
  }

  /** Le Contexte de Tout le monde, lu au niveau donné : 1 en lecture, 3 en gestion (l'éditeur). */
  function contextes(level: 1 | 3): DonneesDuContexteServi["contextes"] {
    return { contexte: { data: vueDuNoeud({ id: "n-contexte", path: "contexte", kind: "context", level, blocks: [bloc("b2000000-0000-4000-8000-000000000002", "paragraph", CORPS)] }) } }
  }

  function monterLaVue(suite: string, level: 1 | 3) {
    render(
      <ContexteServi
        donnees={{ apercu: apercu(suite), contextes: contextes(level), equipes: [] }}
        Lien={LienDeTest}
        prefixeDesPages="/n/"
        ici="/context"
      />,
    )
  }

  const partie = () => within(screen.getByRole("region", { name: "Contexte : Tout le monde" }))

  /** Chaque ligne d'une liste servie : son texte tel que servi, et l'adresse de son lien. */
  function lignesDe(titre: string) {
    return within(partie().getByRole("list", { name: titre }))
      .getAllByRole("listitem")
      .map((ligne) => [ligne.textContent, within(ligne).getByRole("link").getAttribute("href")])
  }

  describe("the index lists of a writable Contexte part (M71)", () => {
    it("should read its published children under the editor, each line a link to its content", () => {
      monterLaVue([CORPS, "", ...ENFANTS].join("\n"), 3)
      const champ = partie().getByRole("textbox", { name: `Modifier ce texte — ${CORPS}` })
      const liste = partie().getByRole("list", { name: "Rangés sous ce contexte" })
      expect(champ.compareDocumentPosition(liste)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      // Dans la carte de l'éditeur (AC-15).
      expect(liste.closest(".oto-island")).toBe(champ.closest(".oto-island"))
      expect(lignesDe("Rangés sous ce contexte")).toEqual([
        ["Conseil — Nos conseils aux clients.", "/n/contexte/conseil"],
        ["Tarifs 2026 — Les tarifs.", "/n/contexte/tarifs"],
      ])
      expect(partie().queryByText(/Pages, tables and procedures here/)).toBeNull()
      // Le corps du Contexte n'est pas répété : l'éditeur le porte.
      expect(partie().queryByText(CORPS, { selector: "pre" })).toBeNull()
    })

    it("should read its linked pages after its children, the cut pointer in French, and none when the lines belong to the body", () => {
      // Les deux pointeurs du service (E11-S03, AC-b2, AC-b4) : listes arrêtées, ou Contexte coupé par le plafond.
      const pointeurs = [
        'Only the first 20 entries are listed. Read the rest: demo_read {"path": "contexte"}.',
        'This context is cut: everything served together exceeds 35,000 characters. Read the rest: demo_read {"path": "contexte"}.',
      ]
      for (const pointeur of pointeurs) {
        monterLaVue([CORPS, "", ...ENFANTS, ...LIEES, pointeur].join("\n"), 3)
        expect(lignesDe("Pages citées")).toEqual([["FAQ support — Réponses types.", "/n/support/faq"]])
        expect(partie().getAllByRole("list").map((liste) => liste.getAttribute("aria-labelledby") && document.getElementById(liste.getAttribute("aria-labelledby") ?? "")?.textContent)).toEqual([
          "Rangés sous ce contexte",
          "Pages citées",
        ])
        expect(partie().queryByText(/Read the rest/)).toBeNull()
        expect(partie().getByText("La suite de ce contexte est lue à la demande.")).toBeInTheDocument()
        cleanup()
      }
      // Sans les listes du service, des lignes du corps qui leur ressemblent n'en sont pas : leur titre ne suit pas
      // une ligne vide.
      monterLaVue([CORPS, ...LIEES].join("\n"), 3)
      expect(partie().queryByRole("list", { name: "Pages citées" })).toBeNull()
    })

    it("should read the body of a part it can only read as served, and its lists in French", () => {
      monterLaVue([CORPS, "", ...ENFANTS].join("\n"), 1)
      expect(partie().getByText(/^Nous vendons/, { selector: "pre" }).textContent).toBe(CORPS)
      expect(partie().queryByRole("textbox")).toBeNull()
      expect(lignesDe("Rangés sous ce contexte")).toEqual([
        ["Conseil — Nos conseils aux clients.", "/n/contexte/conseil"],
        ["Tarifs 2026 — Les tarifs.", "/n/contexte/tarifs"],
      ])
    })
  })
})
