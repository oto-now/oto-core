import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { FILE_TYPES, fileTypeOf, ORG_QUOTA_BYTES, type BlockView } from "../../../packages/plateforme/schemas"
import { IMPORT } from "../../../packages/plateforme/ui/coque/libelles"
import { tailleLisible } from "../../../packages/plateforme/ui/format/nombres"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { accepteDe, limitesDe } from "../../../packages/plateforme/ui/noeud/editeur/envoi-de-fichier"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { FICHIERS } from "../../../packages/plateforme/ui/noeud/libelles-des-fichiers"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { bloc, ID, PAGE } from "../../helpers/noeud"

// Les fichiers joints à l'écran (E10-S02, lot b : AC-b1 à AC-b8) : l'éditeur sous sa file d'écriture, `fetch` simulé
// pour les routes `files`, `nodes` et `tables/import`, chaque appel gardé ; l'envoi au stockage par un
// `XMLHttpRequest` simulé, dont le test joue la progression, la réponse ou l'annulation. Les blocs lus passent par
// `RenduDUnBloc`, comme à l'écran de lecture.

type Appel = { methode: string; adresse: string; corps: Record<string, unknown> | null }

type Stockage = {
  /** `GET files` : le stockage est-il activé ? */
  actif?: boolean
  /** `GET files` : les types qu'ouvrent les lecteurs de l'hôte. */
  hote?: string[]
  /** Un refus de `POST files`. */
  refus?: { statut: number; code: string; details?: Record<string, unknown> }
  /** `GET files/<id>?check` : le stockage sert-il le fichier, ou le refus de la route (`not_found`) ? */
  disponible?: boolean | "not_found"
  /** Ce que sert la route de lecture. */
  octets?: string
}

const ID_FICHIER = "f1000000-0000-4000-8000-0000000000aa"
const IMAGE = bloc("f5000000-0000-4000-8000-000000000005", "image", null, { file_id: ID_FICHIER })

const reponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** `fetch` simulé : l'état du stockage, la demande et la confirmation d'un envoi, la route de lecture, les écritures d'une page et d'un tableau. */
function simulerLeStockage({ actif = true, hote = [], refus, disponible = true, octets = "" }: Stockage = {}) {
  const appels: Appel[] = []
  let insertions = 0
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (adresse, init) => {
      const methode = init?.method ?? "GET"
      const url = String(adresse)
      const corps = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null
      appels.push({ methode, adresse: url, corps })
      if (url === "/api/platform/files" && methode === "GET") return reponse(200, { data: { enabled: actif, hostTypes: hote } })
      if (url === "/api/platform/files") {
        if (refus) return reponse(refus.statut, { error: { code: refus.code, message: "refused", ...(refus.details ? { details: refus.details } : {}) } })
        return reponse(201, { data: { id: ID_FICHIER, upload: { url: "https://stockage.test/objet-signe", headers: { "content-type": String(corps?.mime) } } } })
      }
      if (url.endsWith("/complete")) {
        // La ligne confirmée : le nom et la taille demandés, le type de l'extension (HN-E10S02-25).
        const demande = appels.find((un) => un.adresse === "/api/platform/files" && un.methode === "POST")?.corps
        const nom = String(demande?.name)
        const type = fileTypeOf(nom)
        return reponse(200, { data: { id: ID_FICHIER, name: nom, size: demande?.size, mime: type ? FILE_TYPES[type] : "" } })
      }
      if (url.startsWith("/api/platform/files/") && url.endsWith("?check")) {
        if (disponible === "not_found") return reponse(404, { error: { code: "not_found", message: "Unknown file." } })
        return reponse(200, { data: { available: disponible } })
      }
      if (url.startsWith("/api/platform/files/")) return new Response(octets, { status: 200 })
      if (url.endsWith("/tables/import")) return reponse(200, { data: { path: corps?.table, created: 2, updated: 0, unchanged: 0, ignored: [] } })
      // Une écriture de la page : chaque insertion reçoit un `id` neuf, chaque remplacement garde le sien.
      const ops = Array.isArray(corps?.ops) ? (corps.ops as { op: string; block?: string }[]) : []
      const touched = ops.map(({ op, block }) => {
        if (op === "insert_after") {
          insertions += 1
          return { op, blocks: [{ id: `e${insertions}000000-0000-4000-8000-000000000001`, ref: `e${insertions}000000`, revision: 1 }] }
        }
        return { op, blocks: block ? [{ id: block, ref: block.slice(0, 8), revision: 4 }] : [] }
      })
      return reponse(200, { data: { path: corps?.path, revision: 4, status: "published", has_draft: true, touched, draft_stamp: "2026-09-29T10:00:00.000000+00:00" } })
    }),
  )
  return { appels, ecritures: () => appels.filter((un) => un.adresse === "/api/platform/nodes").map((un) => un.corps?.ops) }
}

/** L'envoi au stockage (`XMLHttpRequest`) : gardé à l'envoi ; le test joue sa progression, sa réponse ou son annulation. */
class EnvoiSimule {
  static envois: EnvoiSimule[] = []
  upload: { onprogress: ((evenement: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  methode = ""
  adresse = ""
  entetes: Record<string, string> = {}
  corps: unknown = null
  abort = vi.fn(() => this.onabort?.())
  open(methode: string, adresse: string) {
    this.methode = methode
    this.adresse = adresse
  }
  setRequestHeader(nom: string, valeur: string) {
    this.entetes[nom] = valeur
  }
  send(corps: unknown) {
    this.corps = corps
    EnvoiSimule.envois.push(this)
  }
  progresser(charge: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: charge, total })
  }
  repondre(status: number) {
    this.status = status
    this.onload?.()
  }
}

const rafraichir = vi.fn()

function Editeur({ blocs = PAGE }: { blocs?: BlockView[] }) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
      <button type="button">Ailleurs</button>
    </ContexteDeRafraichissement.Provider>
  )
}

/** Un bloc lu, comme à l'écran de lecture. */
const lu = (servi: { type: string; text: string | null; data: Record<string, unknown> }) => <RenduDUnBloc bloc={servi} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} />

const champDuTexte = () => screen.getByRole("textbox", { name: "Modifier ce texte — Objet de la relance" })

function rangeeDe(element: Element): HTMLElement {
  const rangee = element.closest("[data-cle]")
  if (!(rangee instanceof HTMLElement)) throw new Error("rangée attendue")
  return rangee
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "plan.png", { type: "image/png" })

/** Une image collée : le presse-papiers porte le fichier, aucun texte. */
const coller = (champ: HTMLElement, fichier: File) => fireEvent.paste(champ, { clipboardData: { files: [fichier], getData: () => "" } })

/** Un fichier glissé du système puis lâché : `true` si le survol l'accepte (`dragover` empêché). */
function deposer(cible: HTMLElement, fichier: File): boolean {
  const dataTransfer = { types: ["Files"], files: [fichier] }
  const accepte = !fireEvent.dragOver(cible, { dataTransfer })
  fireEvent.drop(cible, { dataTransfer })
  return accepte
}

const annonce = (texte: string) => screen.getAllByRole("status").some((region) => region.textContent?.includes(texte))

beforeAll(() => {
  simulerLesDialogues()
  // jsdom (26) ne lit pas un `Blob` en octets ni en texte ; le navigateur, si : la lecture passe par un `FileReader`, que jsdom a.
  const lire = (blob: Blob, comme: "texte" | "octets") =>
    new Promise<string | ArrayBuffer>((resolve, reject) => {
      const lecteur = new FileReader()
      lecteur.onload = () => (lecteur.result === null ? reject(new Error("unreadable")) : resolve(lecteur.result))
      lecteur.onerror = () => reject(lecteur.error ?? new Error("unreadable"))
      if (comme === "texte") lecteur.readAsText(blob)
      else lecteur.readAsArrayBuffer(blob)
    })
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = async function arrayBuffer(this: Blob) {
      const octets = await lire(this, "octets")
      if (!(octets instanceof ArrayBuffer)) throw new Error("not an ArrayBuffer")
      return octets
    }
  }
  if (typeof Blob.prototype.text !== "function") {
    Blob.prototype.text = async function text(this: Blob) {
      return String(await lire(this, "texte"))
    }
  }
})

beforeEach(() => {
  rafraichir.mockReset()
  EnvoiSimule.envois = []
  vi.stubGlobal("XMLHttpRequest", EnvoiSimule)
  URL.createObjectURL = vi.fn(() => "blob:apercu")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EditeurDeBlocs — an image (AC-b1)", () => {
  it("should show a local block with the preview and the progress of a pasted image, write the image by its file only after the confirmation, then serve it and revoke the preview", async () => {
    const { appels, ecritures } = simulerLeStockage()
    render(<Editeur />)
    // Le collage va au `<textarea>` : le champ s'ouvre d'abord (1.1.3).
    const champ = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    await act(async () => {
      coller(champ, png())
    })
    await waitFor(() => expect(EnvoiSimule.envois).toHaveLength(1))
    const [envoi] = EnvoiSimule.envois
    expect([envoi.methode, envoi.adresse, envoi.entetes, envoi.corps instanceof File]).toEqual(["PUT", "https://stockage.test/objet-signe", { "content-type": "image/png" }, true])
    expect(appels.find((un) => un.adresse === "/api/platform/files" && un.methode === "POST")?.corps).toEqual({ node: "ventes/modele_relance", name: "plan.png", mime: "image/png", size: 4 })
    expect(document.querySelector('img[src="blob:apercu"]')).not.toBeNull()
    act(() => envoi.progresser(2, 4))
    expect(screen.getByRole("progressbar", { name: (nom) => nom.startsWith(FICHIERS.envoi("plan.png")) })).toHaveAttribute("value", "0.5")
    expect(ecritures()).toEqual([])
    await act(async () => envoi.repondre(200))
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(ecritures()).toEqual([[{ op: "insert_after", block: ID.objet, input: { type: "image", data: { file_id: ID_FICHIER } } }]])
    expect(document.querySelector(`img[src="/api/platform/files/${ID_FICHIER}"]`)).not.toBeNull()
    expect(document.querySelector('img[src="blob:apercu"]')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:apercu")
  })

  it("should take the text alternative in the block, keep « Sans description » while it is empty, and send it when the focus leaves", async () => {
    const { ecritures } = simulerLeStockage()
    render(<Editeur blocs={[...PAGE, IMAGE]} />)
    const alternatif = screen.getByRole("textbox", { name: FICHIERS.decrire })
    expect(alternatif).toHaveAccessibleDescription(FICHIERS.sansDescription)
    act(() => alternatif.focus())
    fireEvent.change(alternatif, { target: { value: "Plan du rez-de-chaussée" } })
    expect([screen.queryByText(FICHIERS.sansDescription), alternatif.getAttribute("aria-describedby")]).toEqual([null, null])
    act(() => screen.getByRole("button", { name: "Ailleurs" }).focus())
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(ecritures()).toEqual([[{ op: "replace_block", block: IMAGE.id, revision: 3, input: { type: "image", data: { file_id: ID_FICHIER, alt: "Plan du rez-de-chaussée" } } }]])
  })

  it("should offer « Image » and « Fichier » in « Insérer » once the « + » is approached, say types and limits before the choice (AC-b4), and join the chosen image without a choice", async () => {
    simulerLeStockage()
    render(<Editeur />)
    const plus = screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" })
    act(() => plus.focus())
    fireEvent.click(plus)
    await screen.findByRole("menuitem", { name: FICHIERS.image })
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((ligne) => ligne.textContent).slice(-5)).toEqual(["Tableau simple", "Séparateur", FICHIERS.image, FICHIERS.fichier, "Iframe"])
    fireEvent.click(screen.getByRole("menuitem", { name: FICHIERS.image }))
    const dialogue = screen.getByRole("dialog", { name: FICHIERS.titreImage })
    expect(dialogue).toHaveTextContent(limitesDe("image", []))
    const champ = within(dialogue).getByLabelText(new RegExp(IMPORT.zone))
    expect([champ.getAttribute("type"), champ.getAttribute("accept")]).toEqual(["file", accepteDe("image", [])])
    await act(async () => {
      fireEvent.change(champ, { target: { files: [png()] } })
    })
    await waitFor(() => expect(EnvoiSimule.envois).toHaveLength(1))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("should offer « Image » and « Fichier » at the end of the list of « / » too, and open the same choice, the Texte emptied of its slash", async () => {
    simulerLeStockage()
    render(<Editeur />)
    const plus = screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" })
    act(() => plus.focus())
    fireEvent.click(plus)
    await screen.findByRole("menuitem", { name: FICHIERS.image })
    fireEvent.click(screen.getByRole("menuitem", { name: "Texte" }))
    const texte = screen.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })
    await waitFor(() => expect(document.activeElement).toBe(texte))
    fireEvent.change(texte, { target: { value: "/" } })
    const liste = screen.getByRole("listbox", { name: "Blocs à insérer" })
    expect(within(liste).getAllByRole("option").map((option) => option.textContent).slice(-3)).toEqual([FICHIERS.image, FICHIERS.fichier, "Iframe"])
    fireEvent.change(texte, { target: { value: "/fich" } })
    fireEvent.keyDown(texte, { key: "Enter" })
    expect(screen.getByRole("dialog", { name: FICHIERS.titreFichier })).toBeInTheDocument()
    expect(texte).toHaveValue("")
  })
})

describe("EditeurDeBlocs — a file (AC-b2)", () => {
  it("should take a dropped PDF as a drop, never a block move (AC-b4), and show its card once confirmed: name, readable size, « Voir » in a new tab, « Télécharger »", async () => {
    const { ecritures } = simulerLeStockage()
    render(<Editeur />)
    const pdf = new File([new Uint8Array(12_800)], "rapport.pdf", { type: "application/pdf" })
    let accepte = false
    await act(async () => {
      accepte = deposer(rangeeDe(champDuTexte()), pdf)
    })
    expect(accepte).toBe(true)
    await waitFor(() => expect(EnvoiSimule.envois).toHaveLength(1))
    await act(async () => EnvoiSimule.envois[0].repondre(200))
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(ecritures()).toEqual([[{ op: "insert_after", block: ID.objet, input: { type: "file", data: { file_id: ID_FICHIER, name: "rapport.pdf", size: 12_800, mime: "application/pdf" } } }]])
    const voir = await screen.findByRole("link", { name: FICHIERS.voirNom("rapport.pdf") })
    expect([voir.getAttribute("href"), voir.getAttribute("target"), voir.getAttribute("rel")]).toEqual([`/api/platform/files/${ID_FICHIER}?disposition=inline`, "_blank", "noopener noreferrer"])
    expect(screen.getByRole("link", { name: FICHIERS.telechargerNom("rapport.pdf") })).toHaveAttribute("href", `/api/platform/files/${ID_FICHIER}`)
    expect(screen.getByText(tailleLisible(12_800))).toBeInTheDocument()
  })

  it("should offer « Voir » for html, md, pdf, txt and csv files only, and never render nor run a file in the page", async () => {
    simulerLeStockage()
    const noms = ["page.html", "notes.md", "rapport.pdf", "lisez.txt", "ventes.csv", "devis.docx", "archive.zip"]
    const cartes = noms.map((nom, rang) => ({ type: "file", text: null, data: { file_id: `f${rang}000000-0000-4000-8000-000000000001`, name: nom, size: 10, mime: "x" } }))
    const { container } = render(<>{cartes.map((carte) => <div key={String(carte.data.name)}>{lu(carte)}</div>)}</>)
    await waitFor(() => expect(screen.getAllByRole("link", { name: /^Télécharger / })).toHaveLength(7))
    expect(screen.getAllByRole("link", { name: /^Voir / }).map((lien) => lien.getAttribute("aria-label"))).toEqual(noms.slice(0, 5).map((nom) => FICHIERS.voirNom(nom)))
    // Un `html` ou un `md` s'ouvre dans la visionneuse, à l'adresse de la page où l'on est (lot c).
    expect(screen.getByRole("link", { name: FICHIERS.voirNom("page.html") })).toHaveAttribute("href", "?view=f0000000-0000-4000-8000-000000000001")
    expect(container.querySelector("iframe, object, embed, script")).toBeNull()
  })
})

describe("EditeurDeBlocs — width and enlargement (AC-b3)", () => {
  it("should write the width chosen in the block menu, « Pleine » by default", async () => {
    const { ecritures } = simulerLeStockage()
    render(<Editeur blocs={[...PAGE, { ...IMAGE, data: { file_id: ID_FICHIER, alt: "Plan" } }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Actions sur ce bloc — Plan" }))
    const menu = within(screen.getByRole("menu"))
    expect(["Petite", "Moyenne", "Pleine"].map((largeur) => menu.getByRole("menuitemradio", { name: largeur }).getAttribute("aria-checked"))).toEqual(["false", "false", "true"])
    fireEvent.click(menu.getByRole("menuitemradio", { name: "Petite" }))
    // La largeur part comme un texte tapé, après le différé de 1 200 ms.
    await waitFor(() => expect(ecritures()).toHaveLength(1), { timeout: 3_000 })
    expect(ecritures()).toEqual([[{ op: "replace_block", block: IMAGE.id, revision: 3, input: { type: "image", data: { file_id: ID_FICHIER, alt: "Plan", width: "small" } } }]])
  })

  it("should open an image in the design system dialog on a click, and close it on Escape, the focus back on the image", () => {
    simulerLeStockage()
    render(lu({ type: "image", text: null, data: { file_id: ID_FICHIER, alt: "Plan" } }))
    // Le bouton se nomme par son geste, le texte alternatif une seule fois.
    const image = screen.getByRole("button", { name: FICHIERS.agrandir("Plan") })
    act(() => image.focus())
    fireEvent.click(image)
    const dialogue = screen.getByRole("dialog", { name: "Plan" })
    expect(within(dialogue).getByRole("img", { name: "Plan" })).toHaveAttribute("src", `/api/platform/files/${ID_FICHIER}`)
    // Échap : l'événement `cancel` du dialogue natif.
    fireEvent(dialogue, new Event("cancel"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(image)
  })
})

describe("EditeurDeBlocs — a type of the host (lecteurs de fichiers, lot 1b)", () => {
  const dxf = () => new File([new Uint8Array(64)], "plan.dxf", { type: "" })

  it("should join a dropped .dxf when a host reader registers it, and offer it in « Fichier »", async () => {
    const { appels } = simulerLeStockage({ hote: ["dxf"] })
    render(<Editeur />)
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), dxf())
    })
    await waitFor(() => expect(EnvoiSimule.envois).toHaveLength(1))
    expect(appels.find((un) => un.adresse === "/api/platform/files" && un.methode === "POST")?.corps).toEqual({ node: "ventes/modele_relance", name: "plan.dxf", mime: "", size: 64 })
    const plus = screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" })
    act(() => plus.focus())
    fireEvent.click(plus)
    fireEvent.click(await screen.findByRole("menuitem", { name: FICHIERS.fichier }))
    const dialogue = screen.getByRole("dialog", { name: FICHIERS.titreFichier })
    expect(dialogue).toHaveTextContent(limitesDe("fichier", ["dxf"]))
    expect(within(dialogue).getByLabelText(new RegExp(IMPORT.zone)).getAttribute("accept")).toBe(accepteDe("fichier", ["dxf"]))
  })

  it("should refuse a dropped .dxf under the block when no host reader registers it, without asking the service", async () => {
    const { appels } = simulerLeStockage()
    render(<Editeur />)
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), dxf())
    })
    expect(await screen.findByText(FICHIERS.typeRefuse(Object.keys(FILE_TYPES).join(", ")))).toBeInTheDocument()
    expect([EnvoiSimule.envois, appels.filter((un) => un.methode === "POST")]).toEqual([[], []])
  })
})

describe("EditeurDeBlocs — limits and refusals (AC-b4)", () => {
  it("should show a refusal of the service in the local block, translated by its code, and keep it removable", async () => {
    const { ecritures } = simulerLeStockage({ refus: { statut: 413, code: "too_large", details: { reason: "quota" } } })
    render(<Editeur />)
    const champ = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    await act(async () => {
      coller(champ, png())
    })
    expect(await screen.findByText(FICHIERS.quota(tailleLisible(ORG_QUOTA_BYTES)))).toHaveAttribute("role", "alert")
    fireEvent.click(screen.getByRole("button", { name: FICHIERS.retirerNom("plan.png") }))
    expect(screen.queryByText("plan.png")).toBeNull()
    expect([EnvoiSimule.envois, ecritures()]).toEqual([[], []])
  })

  it("should interrupt the upload on « Annuler » and remove the local block, neither confirming nor writing", async () => {
    const { appels, ecritures } = simulerLeStockage()
    render(<Editeur />)
    const champ = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    await act(async () => {
      coller(champ, png())
    })
    await waitFor(() => expect(EnvoiSimule.envois).toHaveLength(1))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: FICHIERS.annulerNom("plan.png") }))
    })
    expect(EnvoiSimule.envois[0].abort).toHaveBeenCalled()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect([appels.some((un) => un.adresse.endsWith("/complete")), ecritures()]).toEqual([false, []])
  })
})

describe("EditeurDeBlocs — the choice on a dropped .md or .csv (AC-b5)", () => {
  const md = () => new File(["# Titre\n\nTexte."], "notes.md", { type: "" })

  it("should open the choice on a dropped .md, the focus on « Insérer le contenu », write nothing on Escape, and insert the content in tolerant mode when chosen", async () => {
    const { ecritures } = simulerLeStockage()
    render(<Editeur />)
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), md())
    })
    const choix = await screen.findByRole("dialog", { name: FICHIERS.choix("notes.md") })
    expect(document.activeElement).toBe(within(choix).getByRole("button", { name: FICHIERS.insererLeContenu }))
    expect(within(choix).getByRole("button", { name: FICHIERS.joindre })).toBeInTheDocument()
    fireEvent(choix, new Event("cancel"))
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), md())
    })
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: FICHIERS.insererLeContenu }))
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(ecritures()).toEqual([[{ op: "insert_after", text: "# Titre\n\nTexte.", block: ID.objet }]])
    expect(EnvoiSimule.envois).toEqual([])
  })

  it("should import a dropped .csv as a table under the page on « Importer en tableau », then cite it after the block", async () => {
    const { appels, ecritures } = simulerLeStockage()
    render(<Editeur />)
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), new File(["Nom;Montant\nP1;1\nP2;2"], "prospects.csv", { type: "text/csv" }))
    })
    fireEvent.click(within(await screen.findByRole("dialog", { name: FICHIERS.choix("prospects.csv") })).getByRole("button", { name: FICHIERS.importerEnTableau }))
    await screen.findByRole("table", { name: IMPORT.apercu(2, "2") })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: IMPORT.importer }))
    })
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(appels.filter((un) => un.adresse.endsWith("/tables/import")).map((un) => un.corps?.table)).toEqual(["ventes/modele_relance/prospects"])
    expect(ecritures()).toEqual([[{ op: "insert_after", block: ID.objet, input: { type: "reference", data: { path: "ventes/modele_relance/prospects" } } }]])
  })

  it("should insert a dropped .md by the E10-S01 import alone, without a choice, when files are disabled", async () => {
    const { ecritures } = simulerLeStockage({ actif: false })
    render(<Editeur />)
    await act(async () => {
      deposer(rangeeDe(champDuTexte()), md())
    })
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("EditeurDeBlocs — a joined CSV (AC-b6)", () => {
  it("should read its bytes by the read route on « Convertir en tableau », open the E10-S01 import on them, and cite the table after the file block", async () => {
    const CSV = bloc("f6000000-0000-4000-8000-000000000006", "file", null, { file_id: ID_FICHIER, name: "ventes.csv", size: 22, mime: "text/csv" })
    const { appels, ecritures } = simulerLeStockage({ octets: "Nom;Montant\nP1;1\nP2;2" })
    render(<Editeur blocs={[...PAGE, CSV]} />)
    fireEvent.click(screen.getByRole("button", { name: "Actions sur ce bloc — ventes.csv" }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: FICHIERS.convertir }))
    })
    await screen.findByRole("table", { name: IMPORT.apercu(2, "2") })
    expect(appels.some((un) => un.adresse === `/api/platform/files/${ID_FICHIER}`)).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: IMPORT.importer }))
    })
    await waitFor(() => expect(ecritures()).toHaveLength(1))
    expect(ecritures()).toEqual([[{ op: "insert_after", block: CSV.id, input: { type: "reference", data: { path: "ventes/modele_relance/ventes" } } }]])
  })
})

describe("EditeurDeBlocs — files disabled (AC-b7)", () => {
  it("should hide « Image » and « Fichier » from the « + », say it on an image paste, and still show https images", async () => {
    const { appels } = simulerLeStockage({ actif: false })
    const EXTERNE = bloc("f7000000-0000-4000-8000-000000000007", "image", null, { src: "https://exemple.test/plan.png", alt: "Plan" })
    render(<Editeur blocs={[...PAGE, EXTERNE]} />)
    const plus = screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" })
    act(() => plus.focus())
    await waitFor(() => expect(appels.some((un) => un.adresse === "/api/platform/files" && un.methode === "GET")).toBe(true))
    fireEvent.click(plus)
    const menu = within(screen.getByRole("menu"))
    expect([menu.queryByRole("menuitem", { name: FICHIERS.image }), menu.queryByRole("menuitem", { name: FICHIERS.fichier })]).toEqual([null, null])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    const champ = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    await act(async () => {
      coller(champ, png())
    })
    await waitFor(() => expect(annonce(FICHIERS.desactives)).toBe(true))
    expect(screen.getByRole("img", { name: "Plan" })).toHaveAttribute("src", "https://exemple.test/plan.png")
    expect(EnvoiSimule.envois).toEqual([])
  })
})

describe("RenduDUnBloc — an unavailable file (AC-b8)", () => {
  it("should say « Fichier indisponible » for an image the storage no longer serves and for a card whose check says it unavailable, without breaking the page", async () => {
    const { appels } = simulerLeStockage({ disponible: false })
    render(
      <>
        {lu({ type: "image", text: null, data: { file_id: ID_FICHIER, alt: "Plan" } })}
        {lu({ type: "file", text: null, data: { file_id: ID_FICHIER, name: "rapport.pdf", size: 1200, mime: "application/pdf" } })}
        <p>Suite de la page</p>
      </>,
    )
    fireEvent.error(screen.getByRole("img", { name: "Plan" }))
    await waitFor(() => expect(screen.getAllByText(FICHIERS.indisponible)).toHaveLength(2))
    expect(screen.queryByRole("link", { name: FICHIERS.telechargerNom("rapport.pdf") })).toBeNull()
    expect([screen.getByText("rapport.pdf"), screen.getByText("Suite de la page")].every((element) => element.isConnected)).toBe(true)
    // La carte lit la réponse JSON de sa route, jamais la redirection vers le stockage (HN-E10S02-43).
    expect(appels.filter((un) => un.adresse.startsWith("/api/platform/files/")).map((un) => [un.methode, un.adresse])).toEqual([["GET", `/api/platform/files/${ID_FICHIER}?check`]])
  })

  it("should say « Fichier indisponible » for a card whose check answers not_found (a file no longer readable)", async () => {
    simulerLeStockage({ disponible: "not_found" })
    render(lu({ type: "file", text: null, data: { file_id: ID_FICHIER, name: "rapport.pdf", size: 1200, mime: "application/pdf" } }))
    expect(await screen.findByText(FICHIERS.indisponible)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: FICHIERS.telechargerNom("rapport.pdf") })).toBeNull()
  })
})
