import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ContexteDeLHote, ContexteDeRafraichissement, SectionsDuRail } from "@otomata_tech/oto_platform/ui"
import { OP_TEXT_MAX, PAGE_MAX, type BlockView, type TableHeader, type TreeNode } from "../../../packages/plateforme/schemas"
import { ImportDeFichier, type CibleDImport } from "../../../packages/plateforme/ui/coque/import-de-fichier"
import { IMPORT } from "../../../packages/plateforme/ui/coque/libelles"
import { nombreLisible } from "../../../packages/plateforme/ui/format/nombres"
import { MARKDOWN_DANS_L_EDITEUR, MENU_DU_BLOC } from "../../../packages/plateforme/ui/noeud/libelles"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe } from "../../helpers/liste-de-choix"
import { bloc, ID, PAGE } from "../../helpers/noeud"

// Le dialogue « Importer un fichier… » (E10-S01, AC-a3, AC-b1 à AC-b5) et le collage dans l'éditeur (AC-a1, AC-a2) :
// `fetch` simulé, chaque corps envoyé gardé. Le fichier est lu par le navigateur : seules partent des requêtes JSON
// (`uploads-patterns.md § Côté composant`). La zone de dépôt est un champ de fichier nommé par son étiquette.

type Envoye = { adresse: string; type: string | null; corps: Record<string, unknown> | null }

const reponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** `fetch` simulé : une page ou un lot écrits, sauf les appels refusés (rang : 1 pour le premier). */
function simulerLesEnvois(refus: Record<number, { statut: number; code: string; details?: Record<string, unknown> }> = {}) {
  const envoyes: Envoye[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (adresse, init) => {
      // Le corps que l'écran envoie, relu tel quel : l'écran n'envoie que du JSON ; une lecture n'en a pas.
      const corps = init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>)
      envoyes.push({ adresse: String(adresse), type: new Headers(init?.headers).get("content-type"), corps })
      if (!corps) return reponse(200, { data: { path: "ventes/modele_relance", title: "Modèle de relance", revision: 4, draft: null } })
      const refuse = refus[envoyes.length]
      if (refuse) return reponse(refuse.statut, { error: { code: refuse.code, message: "refused", ...(refuse.details ? { details: refuse.details } : {}) } })
      if (String(adresse).endsWith("/tables/import")) return reponse(200, { data: { path: corps.table, created: 1, updated: 0, unchanged: 0, ignored: [] } })
      const touched = [{ op: "insert_after", blocks: [{ id: "e1000000-0000-4000-8000-000000000001", ref: "e1000000", revision: 1 }] }]
      return reponse(200, { data: { path: corps.path, revision: 4, status: "published", has_draft: true, touched, draft_stamp: "2026-09-29T10:00:00.000000+00:00", kept_as_text: 2 } })
    }),
  )
  return envoyes
}

const termine = vi.fn()
const fermer = vi.fn()
const SOUS: CibleDImport = { genre: "sous", parent: "ventes", nom: "Ventes", adresses: (segment) => [`ventes/${segment}`, `ventes/${segment}_2`] }
const PROSPECTS: TableHeader = {
  columns: [
    { name: "nom", type: "text" },
    { name: "montant", type: "number" },
    { name: "statut", type: "enum", options: ["à traiter", "fait"] },
  ],
  key: "nom",
  lifecycle: { column: "statut", states: ["à traiter", "fait"], working: "fait" },
  closed: false,
  proof: false,
}
const TABLEAU: CibleDImport = { genre: "tableau", chemin: "ventes/prospects", nom: "Prospects", entete: PROSPECTS }

function ouvrir(cible: CibleDImport) {
  render(<ImportDeFichier cible={cible} fermer={fermer} termine={termine} />)
}

/** Un fichier choisi par la zone de dépôt, son champ de fichier, comme au clavier. */
async function choisirLeFichier(contenu: BlobPart, nom: string) {
  const champ = screen.getByLabelText(new RegExp(IMPORT.zone))
  fireEvent.change(champ, { target: { files: [new File([contenu], nom)] } })
  // Le navigateur lit le fichier hors du rendu : l'annonce de la lecture se tait quand il est lu.
  await waitFor(() => expect(screen.queryByText(IMPORT.lecture)).toBeNull())
}

const csv = (lignes: string[]) => lignes.join("\n")
const bouton = (nom: string | RegExp) => screen.getByRole("button", { name: nom })
const liste = (nom: string) => screen.getByRole("combobox", { name: nom })

beforeAll(() => {
  simulerLesDialogues()
  // jsdom (26) ne lit pas un `Blob` en octets ; le navigateur, si : la lecture passe par un `FileReader`, que jsdom a.
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const lecteur = new FileReader()
        lecteur.onload = () => (lecteur.result instanceof ArrayBuffer ? resolve(lecteur.result) : reject(new Error("not an ArrayBuffer")))
        lecteur.onerror = () => reject(lecteur.error ?? new Error("unreadable"))
        lecteur.readAsArrayBuffer(this)
      })
    }
  }
})

beforeEach(() => {
  termine.mockReset()
  fermer.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ImportDeFichier — a CSV (AC-b1 to AC-b4)", () => {
  it("should say its limits before the choice, through a drop zone that is a file field reachable by keyboard", () => {
    ouvrir(SOUS)
    const champ = screen.getByLabelText(new RegExp(IMPORT.zone))
    expect([champ.tagName, champ.getAttribute("type")]).toEqual(["INPUT", "file"])
    expect(document.body.textContent).toContain(IMPORT.limites(nombreLisible(5_000), nombreLisible(100), nombreLisible(5)))
  })

  it("should read a Windows-1252 file, find its separator, infer the types and the key, preview its lines, and let a type change", async () => {
    const envoyes = simulerLesEnvois()
    ouvrir(SOUS)
    // « Café » en Windows-1252 : é est l'octet 0xE9, qu'UTF-8 refuse.
    const octets = Uint8Array.from([...new TextEncoder().encode("Nom;Montant;Inscrit\nCaf"), 0xe9, ...new TextEncoder().encode(";12,5;29/09/2026\nThé;3;2026-09-30")])
    await choisirLeFichier(octets, "clients.csv")
    expect([liste(IMPORT.encodage).textContent, liste(IMPORT.separateur).textContent, liste(IMPORT.cle).textContent]).toEqual(["Windows-1252", "Point-virgule", "nom"])
    expect([liste(IMPORT.type("montant")).textContent, liste(IMPORT.type("inscrit")).textContent]).toEqual(["Nombre", "Date"])
    const apercu = screen.getByRole("table", { name: IMPORT.apercu(2, "2") })
    expect(within(apercu).getByText("Café")).toBeTruthy()
    choisirDansLaListe(liste(IMPORT.type("montant")), "Texte")
    expect(liste(IMPORT.type("montant")).textContent).toBe("Texte")
    expect(envoyes).toEqual([])
  })

  it("should list the first ten problems then « et N autres », and send nothing", async () => {
    const envoyes = simulerLesEnvois()
    ouvrir(TABLEAU)
    await choisirLeFichier(csv(["Nom,Montant,Statut,Inconnue", ...Array.from({ length: 12 }, (_, rang) => `P${rang},abc,fait,x`)]), "prospects.csv")
    expect(screen.getByText(IMPORT.ignorees("Statut, Inconnue"))).toBeTruthy()
    const alerte = screen.getAllByRole("alert").find((un) => un.textContent?.includes(IMPORT.problemes))
    expect(alerte?.textContent).toContain(IMPORT.cellule(2, "montant", "abc", IMPORT.attendus.number))
    expect(alerte?.textContent).toContain(`${IMPORT.etAutres(2)}.`)
    expect(bouton(IMPORT.importer).getAttribute("aria-disabled")).toBe("true")
    expect(envoyes).toEqual([])
  })

  it("should create the table with the first lot of 500 lines, each header that differs from its name kept as the column label, send the next lot, and send only JSON", async () => {
    const envoyes = simulerLesEnvois({ 1: { statut: 409, code: "conflict" } })
    ouvrir(SOUS)
    await choisirLeFichier(csv(["Nom; Montant estimé ;ville", ...Array.from({ length: 501 }, (_, rang) => `P${rang};${rang};Lyon`)]), "Prospects 2026.csv")
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    await waitFor(() => expect(termine).toHaveBeenCalledWith({ chemin: "ventes/prospects_2026_2", conserves: 0 }))
    // Chaque lot porte ses lignes : le corps est relu sans type.
    expect(envoyes.map(({ adresse, type, corps }) => [adresse, type, corps?.table, (corps?.rows as unknown[]).length, corps?.create !== undefined])).toEqual([
      ["/api/platform/tables/import", "application/json", "ventes/prospects_2026", 500, true],
      ["/api/platform/tables/import", "application/json", "ventes/prospects_2026_2", 500, true],
      ["/api/platform/tables/import", "application/json", "ventes/prospects_2026_2", 1, false],
    ])
    expect(envoyes[1].corps).toMatchObject({
      file_name: "Prospects 2026.csv",
      columns: ["nom", "montant_estime", "ville"],
      create: { title: "Prospects 2026", summary: `Importé de Prospects 2026.csv (${nombreLisible(501)} lignes)`, header: { key: "nom" } },
    })
    // Le libellé (#228) : l'en-tête rogné quand il diffère du nom tiré ; « ville », identique, n'en prend pas.
    expect((envoyes[1].corps?.create as { header: { columns: unknown } }).header.columns).toEqual([
      { name: "nom", label: "Nom", type: "text" },
      { name: "montant_estime", label: "Montant estimé", type: "number" },
      { name: "ville", type: "text" },
    ])
  })

  it("should stop on a refused lot, say how many lines were written, and resume at that lot", async () => {
    const envoyes = simulerLesEnvois({ 2: { statut: 409, code: "conflict" } })
    ouvrir(TABLEAU)
    await choisirLeFichier(csv(["nom;montant", ...Array.from({ length: 1_001 }, (_, rang) => `P${rang};${rang}`)]), "prospects.csv")
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    // Les nombres portent l'espace fine insécable de `fr-FR` : le texte se lit tel quel, sans la normalisation des requêtes.
    await waitFor(() => expect(document.body.textContent).toContain(IMPORT.ecrites(nombreLisible(500), nombreLisible(1_001))))
    await act(async () => {
      fireEvent.click(bouton(IMPORT.reprendre))
    })
    await waitFor(() => expect(termine).toHaveBeenCalledWith({ chemin: "ventes/prospects", conserves: 0 }))
    // La première clé de chaque lot envoyé : le corps est relu sans type.
    expect(envoyes.map(({ corps }) => (corps?.rows as string[][])[0]?.[0])).toEqual(["P0", "P500", "P500", "P1000"])
  })

  it("should resume a first lot refused after the table was created into that table, without creating another (HN-E10S01-21)", async () => {
    const envoyes = simulerLesEnvois({ 1: { statut: 409, code: "conflict", details: { created: "ventes/prospects" } } })
    ouvrir(SOUS)
    await choisirLeFichier(csv(["Nom;Montant", "P1;1", "P2;2"]), "prospects.csv")
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    await waitFor(() => expect(bouton(IMPORT.reprendre)).toBeTruthy())
    await act(async () => {
      fireEvent.click(bouton(IMPORT.reprendre))
    })
    await waitFor(() => expect(termine).toHaveBeenCalledWith({ chemin: "ventes/prospects", conserves: 0 }))
    expect(envoyes.map(({ corps }) => [corps?.table, corps?.create !== undefined])).toEqual([
      ["ventes/prospects", true],
      ["ventes/prospects", false],
    ])
  })
})

describe("ImportDeFichier — a markdown file (AC-a3)", () => {
  it("should create a draft page from its # title and first paragraph, its body in tolerant insert_after operations, at the next address when one is taken", async () => {
    const envoyes = simulerLesEnvois({ 1: { statut: 409, code: "conflict" } })
    ouvrir(SOUS)
    await choisirLeFichier("# Réunion du lundi\n\nOn a **décidé** de relancer.\n\n## Suite\n- Appeler", "Compte rendu.md")
    expect(screen.getByText("Réunion du lundi")).toBeTruthy()
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    await waitFor(() => expect(termine).toHaveBeenCalledWith({ chemin: "ventes/compte_rendu_2", conserves: 2 }))
    expect(envoyes.map(({ corps }) => corps?.path)).toEqual(["ventes/compte_rendu", "ventes/compte_rendu_2"])
    expect(envoyes[1].corps).toEqual({
      path: "ventes/compte_rendu_2",
      title: "Réunion du lundi",
      summary: "On a décidé de relancer.",
      kind: "page",
      ops: [{ op: "insert_after", text: "On a **décidé** de relancer.\n\n## Suite\n- Appeler" }],
      tolerant: true,
    })
  })

  it("should not close while the page is being sent, by Escape, the backdrop, Close or Cancel, then close once it is sent", async () => {
    let repondre: (reponse: Response) => void = () => undefined
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (repondre = resolve))))
    ouvrir(SOUS)
    await choisirLeFichier("# Réunion\n\nUn paragraphe.", "reunion.md")
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    const dialogue = screen.getByRole("dialog")
    fireEvent(dialogue, new Event("cancel"))
    fireEvent.click(dialogue)
    fireEvent.click(bouton("Fermer"))
    fireEvent.click(bouton(IMPORT.annuler))
    expect(fermer).not.toHaveBeenCalled()
    await act(async () => {
      repondre(reponse(403, { error: { code: "forbidden", message: "refused" } }))
    })
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    fireEvent(dialogue, new Event("cancel"))
    expect(fermer).toHaveBeenCalledTimes(1)
  })

  it("should refuse an empty file, and a file longer than a page, before sending anything", async () => {
    const envoyes = simulerLesEnvois()
    ouvrir(SOUS)
    await choisirLeFichier("  \n", "vide.md")
    expect(screen.getByRole("alert").textContent).toBe(IMPORT.vide)
    await choisirLeFichier("a".repeat(PAGE_MAX + 1), "long.md")
    expect(screen.getByRole("alert").textContent).toBe(IMPORT.pageTropLongue(nombreLisible(PAGE_MAX)))
    expect(envoyes).toEqual([])
  })
})

const rafraichir = vi.fn()

describe("SectionsDuRail — the notice of a .md imported from the rail (AC-a2, accessibility-patterns.md § Régions dynamiques)", () => {
  const naviguer = vi.fn()
  const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })
  const ARBRE = [noeud("guide", "page", "Guide", [noeud("contexte", "context", "Contexte"), noeud("conseil", "page", "Conseil")])]
  const rail = (chemin: string) => (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <ContexteDeLHote.Provider value={{ Lien: (props) => <a {...props} />, chemin, naviguer, deconnecter: vi.fn() }}>
        <SectionsDuRail arbre={ARBRE} equipes={[]} handle="claire" prefixe="/n/" />
      </ContexteDeLHote.Provider>
    </ContexteDeRafraichissement.Provider>
  )
  const annonces = () => screen.getAllByRole("status").map((region) => region.textContent)

  it("should write it in a status region mounted empty once the page opens, and drop it when another address opens, for good", async () => {
    simulerLesEnvois()
    const { rerender } = render(rail("/n/conseil"))
    expect(annonces()).not.toContain(IMPORT.conserves(2))
    fireEvent.click(screen.getByRole("button", { name: "Ajouter dans Conseil" }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: IMPORT.entree }))
    await choisirLeFichier("# Réunion\n\n```call\nx {\n```", "Compte rendu.md")
    await act(async () => {
      fireEvent.click(bouton(IMPORT.importer))
    })
    await waitFor(() => expect(naviguer).toHaveBeenCalledWith("/n/conseil/compte_rendu"))

    rerender(rail("/n/conseil/compte_rendu"))
    expect(annonces()).toContain(IMPORT.conserves(2))
    expect(screen.getByRole("note")).toHaveTextContent(IMPORT.conserves(2))
    rerender(rail("/n/conseil"))
    expect(annonces()).not.toContain(IMPORT.conserves(2))
    expect(screen.queryByRole("note")).toBeNull()
    // Un retour arrière sur la page importée ne rend pas l'encart : l'état est parti avec l'adresse.
    rerender(rail("/n/conseil/compte_rendu"))
    expect([annonces().includes(IMPORT.conserves(2)), screen.queryByRole("note")]).toEqual([false, null])
  })
})

function Editeur({ blocs = PAGE, children }: { blocs?: BlockView[]; children?: ReactNode }) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
      {children}
    </ContexteDeRafraichissement.Provider>
  )
}

// Le collage va au `<textarea>` : le champ du bloc s'ouvre d'abord (1.1.3), un champ déjà ouvert est rendu tel quel.
const champDuTexte = () => ouvrirLeChamp("Modifier ce texte — Objet de la relance")
const coller = (champ: HTMLElement, texte: string) => fireEvent.paste(champ, { clipboardData: { getData: (type: string) => (type === "text/plain" ? texte : "<b>html</b>") } })

describe("EditeurDeBlocs — a paste (AC-a1, AC-a2)", () => {
  beforeEach(() => rafraichir.mockReset())

  it("should insert a paste of several lines after the whole block in tolerant mode, then reread the draft and say what was kept as text", async () => {
    const envoyes = simulerLesEnvois()
    render(<Editeur />)
    const champ = champDuTexte()
    await act(async () => {
      coller(champ, "# Titre\n\n```call\nx {\n```")
    })
    await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    expect(envoyes.map(({ corps }) => corps)).toEqual([{ path: "ventes/modele_relance", base_revision: 4, publish: false, ops: [{ op: "insert_after", text: "# Titre\n\n```call\nx {\n```", block: ID.objet }], tolerant: true }])
    expect(screen.getAllByRole("status").some((region) => region.textContent?.includes(IMPORT.conserves(2)))).toBe(true)
  })

  it("should leave a one-line paste, and a paste after Ctrl+Shift+V, as text at the cursor", () => {
    const envoyes = simulerLesEnvois()
    render(<Editeur />)
    expect(coller(champDuTexte(), "une ligne")).toBe(true)
    fireEvent.keyDown(champDuTexte(), { key: "V", ctrlKey: true, shiftKey: true })
    expect(coller(champDuTexte(), "deux\nlignes")).toBe(true)
    expect(envoyes).toEqual([])
  })

  it("should refuse a paste of more than 40,000 characters and send nothing", () => {
    const envoyes = simulerLesEnvois()
    render(<Editeur />)
    expect(coller(champDuTexte(), "a\n".repeat(OP_TEXT_MAX / 2 + 1))).toBe(false)
    expect(document.body.textContent).toContain(MARKDOWN_DANS_L_EDITEUR.tropLong(nombreLisible(OP_TEXT_MAX)))
    expect(envoyes).toEqual([])
  })
})

describe("EditeurDeBlocs — convert a simple table (AC-b7)", () => {
  beforeEach(() => rafraichir.mockReset())

  it("should create the table under the page, its values converted from the page, then replace the block by its reference and reread the draft", async () => {
    const envoyes = simulerLesEnvois()
    const tableau = bloc("f6000000-0000-4000-8000-000000000006", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["Atelier", "12,5"], ["Forge", "3"]] })
    render(<Editeur blocs={[...PAGE, tableau]} />)
    fireEvent.click(screen.getByRole("button", { name: /^Actions sur ce bloc — Nom/ }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: MENU_DU_BLOC.convertir }))
    })
    await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    expect(envoyes.map(({ adresse, corps }) => [adresse, corps])).toEqual([
      ["/api/platform/nodes?path=ventes%2Fmodele_relance", null],
      [
        "/api/platform/tables/import",
        {
          table: "ventes/modele_relance/objet",
          converted_from: "ventes/modele_relance",
          create: {
            title: "Objet",
            summary: MARKDOWN_DANS_L_EDITEUR.convertiDepuis("Modèle de relance", "2"),
            header: { columns: [{ name: "nom", type: "text" }, { name: "montant", type: "number" }], key: "nom" },
          },
          columns: ["nom", "montant"],
          rows: [["Atelier", "12,5"], ["Forge", "3"]],
        },
      ],
      ["/api/platform/nodes", { path: "ventes/modele_relance", base_revision: 4, publish: false, ops: [{ op: "replace_block", block: tableau.id, input: { type: "reference", text: null, data: { path: "ventes/modele_relance/objet" } } }] }],
    ])
  })

  it("should fill the table its first conversion created when converting again, without creating another (HN-E10S01-21)", async () => {
    // Le deuxième appel, le premier lot, est refusé après la création du tableau.
    const envoyes = simulerLesEnvois({ 2: { statut: 409, code: "conflict", details: { created: "ventes/modele_relance/objet" } } })
    const tableau = bloc("f6000000-0000-4000-8000-000000000006", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["Atelier", "12,5"]] })
    render(<Editeur blocs={[...PAGE, tableau]} />)
    const convertir = async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Actions sur ce bloc — Nom/ }))
      await act(async () => {
        fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: MENU_DU_BLOC.convertir }))
      })
    }
    await convertir()
    await waitFor(() => expect(envoyes).toHaveLength(2))
    expect(rafraichir).not.toHaveBeenCalled()
    await convertir()
    await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    expect(envoyes.map(({ adresse, corps }) => [adresse, corps?.table ?? corps?.path ?? null, corps?.create !== undefined])).toEqual([
      ["/api/platform/nodes?path=ventes%2Fmodele_relance", null, false],
      ["/api/platform/tables/import", "ventes/modele_relance/objet", true],
      ["/api/platform/nodes?path=ventes%2Fmodele_relance", null, false],
      ["/api/platform/tables/import", "ventes/modele_relance/objet", false],
      ["/api/platform/nodes", "ventes/modele_relance", false],
    ])
  })
})
