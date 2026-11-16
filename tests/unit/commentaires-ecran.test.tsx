import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CommentThreadView, CommentView, NodeCommentsView } from "@otomata_tech/oto_platform/schemas"
import { BulleDeBloc } from "../../packages/plateforme/ui/noeud/commentaires/bulle-de-bloc"
import { EncartCommentaires } from "../../packages/plateforme/ui/noeud/commentaires/encart-commentaires"
import { FournisseurDeCommentaires } from "../../packages/plateforme/ui/noeud/commentaires/fournisseur-de-commentaires"
import { passageChoisi, plageDeLaCitation } from "../../packages/plateforme/ui/noeud/commentaires/passage"

// L'écran des commentaires d'une page (parcours 5.4) : l'encart, la carte d'un fil selon qui la lit, le champ et ses
// mentions, la bulle d'un bloc. `fetch` simulé pour l'API du paquet : chaque cas sert ses fils et lit ce qui est parti.

const CHEMIN = "ventes/relance"
const BLOC = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const BLOC_NEUF = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f71"

const fetchMock = vi.fn<typeof fetch>()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function commentaire(propres: Partial<CommentView> = {}): CommentView {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    author: "Camille Martin",
    mine: false,
    text: "Le délai est de 15 jours, pas de 30.",
    mentions: [],
    createdAt: "2026-11-10T09:00:00.000Z",
    editedAt: null,
    toAssistant: false,
    viaAssistant: false,
    ...propres,
  }
}

function fil(propres: Partial<CommentThreadView> = {}): CommentThreadView {
  return {
    id: "f1000000-0000-4000-8000-000000000001",
    status: "open",
    anchor: "intact",
    block: BLOC,
    quote: "30 jours après le rappel",
    section: "Étape 3 : relance ferme",
    canResolve: true,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: "2026-11-10T09:00:00.000Z",
    waitingAssistant: false,
    comments: [commentaire()],
    ...propres,
  }
}

function vue(threads: CommentThreadView[], propres: Partial<NodeCommentsView> = {}): NodeCommentsView {
  return {
    path: CHEMIN,
    threads,
    readers: [
      { id: "u1", name: "Camille Martin" },
      { id: "u2", name: "Sacha Durand" },
    ],
    mailEnabled: false,
    ...propres,
  }
}

/** Sert les fils lus, puis les réponses des écritures, dans l'ordre où elles partent. */
function servir(lus: NodeCommentsView | Response, ...ecritures: Response[]) {
  const suite = [...ecritures]
  fetchMock.mockImplementation(async (_adresse, init) => {
    if ((init?.method ?? "GET") === "GET") return lus instanceof Response ? lus.clone() : reponse(200, { data: lus })
    return suite.shift() ?? reponse(500, { error: { code: "internal" } })
  })
}

/** Les écritures parties : méthode, adresse, corps. */
function ecritures() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method !== "GET")
    .map(([adresse, init]) => ({ methode: init?.method, adresse: String(adresse), corps: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined }))
}

function rendre(document: ReactNode = null, blocsPublies: string[] = [BLOC]) {
  return render(
    <FournisseurDeCommentaires chemin={CHEMIN} revision={3} blocsPublies={blocsPublies}>
      {document}
      <EncartCommentaires />
    </FournisseurDeCommentaires>,
  )
}

const encart = () => screen.getByText("Commentaires").closest("details") as HTMLDetailsElement
const carte = (nom: string | RegExp) => screen.findByRole("article", { name: nom })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EncartCommentaires", () => {
  it("should open on arrival while a thread is open, with the count of open threads and both tabs counted", async () => {
    servir(vue([fil(), fil({ id: "f2", status: "resolved", block: null, anchor: "page", quote: null, section: null })]))
    rendre()
    await carte("Fil sur Étape 3 : relance ferme")
    expect(encart().open).toBe(true)
    expect(within(encart().querySelector("summary") as HTMLElement).getByText("1")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Ouverts 1" })).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("tab", { name: "Résolus 1" }))
    expect(await carte("Fil sur Sur la page")).toBeInTheDocument()
    expect(screen.queryByRole("article", { name: "Fil sur Étape 3 : relance ferme" })).not.toBeInTheDocument()
  })

  it("should stay closed on arrival without an open thread, still present, without a count of zero", async () => {
    servir(vue([fil({ status: "resolved" })]))
    rendre()
    // Les onglets sont là : la lecture est faite ; la pastille ne dit pas « 0 ».
    await waitFor(() => expect(encart().querySelector(".oto-tabs")).not.toBeNull())
    expect(within(encart().querySelector("summary") as HTMLElement).queryByText("0")).toBeNull()
    expect(encart().open).toBe(false)
  })

  it("should say how to start when the page has no thread, and open a thread on the whole page", async () => {
    servir(vue([]), reponse(201, { data: { thread: fil({ id: "f9", block: null, anchor: "page", quote: null, section: null, comments: [commentaire({ mine: true, text: "Une question" })] }) } }))
    rendre()
    expect(await screen.findByText("Aucun fil ouvert")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Commenter la page" }))
    const champ = await screen.findByRole("textbox", { name: "Votre commentaire…" })
    await waitFor(() => expect(document.activeElement).toBe(champ))
    fireEvent.change(champ, { target: { value: "Une question" } })
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }))
    const neuve = await carte("Fil sur Sur la page")
    expect(ecritures()).toEqual([{ methode: "POST", adresse: "/api/platform/comments", corps: { path: CHEMIN, text: "Une question" } }])
    await waitFor(() => expect(document.activeElement).toBe(neuve))
  })

  it("should say the reading failed and read again on « Réessayer »", async () => {
    servir(reponse(500, { error: { code: "internal", message: "boom" } }))
    rendre()
    const alerte = await screen.findByRole("alert")
    expect(alerte).toHaveTextContent("Chargement impossible")
    servir(vue([fil()]))
    fireEvent.click(within(alerte).getByRole("button", { name: "Réessayer" }))
    expect(await carte("Fil sur Étape 3 : relance ferme")).toBeInTheDocument()
  })
})

describe("CarteDeFil", () => {
  it("should resolve the whole thread for who can, move it to « Résolus » and give the focus to the list", async () => {
    servir(vue([fil()]), reponse(200, { data: { thread: fil({ status: "resolved", resolvedBy: "Camille Martin", resolvedAt: "2026-11-11T09:00:00.000Z" }) } }))
    rendre()
    await carte("Fil sur Étape 3 : relance ferme")
    fireEvent.click(screen.getByRole("button", { name: "Résoudre le fil" }))
    await waitFor(() => expect(screen.getByRole("tab", { name: "Résolus 1" })).toBeInTheDocument())
    expect(ecritures()).toEqual([{ methode: "PATCH", adresse: "/api/platform/comment-threads/f1000000-0000-4000-8000-000000000001", corps: { status: "resolved" } }])
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("group", { name: "Fils ouverts" })))
    fireEvent.click(screen.getByRole("tab", { name: "Résolus 1" }))
    expect(within(await carte("Fil sur Étape 3 : relance ferme")).getByRole("button", { name: "Rouvrir le fil" })).toBeInTheDocument()
  })

  it("should keep the check inert for who cannot resolve, say why, and send nothing when clicked", async () => {
    servir(vue([fil({ canResolve: false })]))
    rendre()
    const coche = within(await carte("Fil sur Étape 3 : relance ferme")).getByRole("button", { name: "Résoudre le fil" })
    expect(coche).toHaveAttribute("aria-disabled", "true")
    fireEvent.focus(coche)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Résoudre ou rouvrir ce fil revient à son auteur ou à un rédacteur de la page")
    fireEvent.click(coche)
    expect(ecritures()).toEqual([])
  })

  it("should offer the pencil and the bin on one's own comments only, and edit in place", async () => {
    const mien = commentaire({ id: "c2", author: "Sacha Durand", mine: true, text: "Je regarde." })
    servir(vue([fil({ comments: [commentaire(), mien] })]), reponse(200, { data: { thread: fil({ comments: [commentaire(), { ...mien, text: "Je corrige.", editedAt: "2026-11-11T10:00:00.000Z" }] }) } }))
    rendre()
    const lue = await carte("Fil sur Étape 3 : relance ferme")
    expect(within(lue).getAllByRole("button", { name: "Modifier mon commentaire" })).toHaveLength(1)
    expect(within(lue).queryByRole("button", { name: "Supprimer le fil et ses réponses" })).not.toBeInTheDocument()
    expect(within(lue).getByRole("button", { name: "Supprimer ma réponse" })).toBeInTheDocument()
    fireEvent.click(within(lue).getByRole("button", { name: "Modifier mon commentaire" }))
    const champ = within(lue).getByRole("textbox", { name: "Modifier le commentaire…" })
    expect(champ).toHaveValue("Je regarde.")
    fireEvent.change(champ, { target: { value: "Je corrige." } })
    fireEvent.click(within(lue).getByRole("button", { name: "Enregistrer" }))
    // Le champ refermé, le texte se relit dans la carte (le champ portait le même texte).
    await waitFor(() => expect(within(lue).queryByRole("textbox")).not.toBeInTheDocument())
    expect(within(lue).getByText("Je corrige.")).toBeInTheDocument()
    expect(ecritures()).toEqual([{ methode: "PATCH", adresse: "/api/platform/comments/c2", corps: { text: "Je corrige." } }])
    expect(within(lue).getByText(/· modifié/)).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(within(lue).getByRole("button", { name: "Modifier mon commentaire" })))
  })

  it("should ask in the card before deleting a thread with its replies, then remove it", async () => {
    const premier = commentaire({ mine: true })
    servir(vue([fil({ comments: [premier, commentaire({ id: "c2" }), commentaire({ id: "c3" })] })]), reponse(200, { data: { comment: premier.id, thread: null } }))
    rendre()
    const lue = await carte("Fil sur Étape 3 : relance ferme")
    fireEvent.click(within(lue).getByRole("button", { name: "Supprimer le fil et ses réponses" }))
    const question = within(lue).getByRole("group", { name: "Supprimer ce fil et ses 2 réponses ? C'est définitif." })
    expect(ecritures()).toEqual([])
    fireEvent.click(within(question).getByRole("button", { name: "Supprimer" }))
    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument())
    expect(ecritures()).toEqual([{ methode: "DELETE", adresse: `/api/platform/comments/${premier.id}`, corps: undefined }])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("group", { name: "Fils ouverts" })))
  })

  it("should show what happened to the passage, a former member, the assistant's signature, mentions, and the waiting label above « Répondre »", async () => {
    servir(
      vue([
        fil({
          anchor: "changed",
          waitingAssistant: true,
          comments: [
            commentaire({ author: null, text: "@assistant corrige le délai, @Sacha Durand relis.", toAssistant: true, mentions: [{ id: "u2", name: "Sacha Durand" }] }),
            commentaire({ id: "c2", author: "Sacha Durand", viaAssistant: true, text: "Fait." }),
          ],
        }),
        fil({ id: "f2", anchor: "deleted", block: null, section: null }),
      ]),
    )
    rendre()
    const lue = await carte("Fil sur Étape 3 : relance ferme")
    expect(within(lue).getByText("passage modifié depuis")).toBeInTheDocument()
    expect(within(lue).getByText("Ancien membre")).toBeInTheDocument()
    expect(within(lue).getByText("Assistant de Sacha Durand")).toBeInTheDocument()
    expect([...lue.querySelectorAll(".oto-mention")].map((mention) => mention.textContent)).toEqual(["@assistant", "@Sacha Durand"])
    const attente = within(lue).getByText("en attente d'un assistant")
    const repondre = within(lue).getByRole("button", { name: "Répondre" })
    expect(attente.compareDocumentPosition(repondre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.focus(attente.closest("[tabindex]") as HTMLElement)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rien ne se passe tant que personne n'ouvre de conversation.")
    expect(within(await carte("Fil sur Sur la page")).getByText("passage supprimé")).toBeInTheDocument()
  })

  it("should keep the reply and say what to do when the service refuses it", async () => {
    servir(vue([fil()]), reponse(409, { error: { code: "conflict", message: "resolved" } }))
    rendre()
    const lue = await carte("Fil sur Étape 3 : relance ferme")
    fireEvent.click(within(lue).getByRole("button", { name: "Répondre" }))
    const champ = within(lue).getByRole("textbox", { name: "Répondre…" })
    fireEvent.change(champ, { target: { value: "D'accord." } })
    fireEvent.click(within(lue).getByRole("button", { name: "Envoyer" }))
    expect(await within(lue).findByRole("alert")).toHaveTextContent("Ce fil est résolu : rouvrez-le pour y répondre.")
    expect(champ).toHaveValue("D'accord.")
  })
})

describe("ChampDeCommentaire", () => {
  async function ouvrirUneReponse(lus: NodeCommentsView) {
    servir(lus)
    rendre()
    const lue = await carte("Fil sur Étape 3 : relance ferme")
    fireEvent.click(within(lue).getByRole("button", { name: "Répondre" }))
    return within(lue).getByRole("textbox", { name: "Répondre…" }) as HTMLTextAreaElement
  }

  it("should propose the assistant first then the readers on « @ », filter as one types, and insert the choice from the keyboard", async () => {
    const champ = await ouvrirUneReponse(vue([fil()]))
    fireEvent.change(champ, { target: { value: "Bonjour @" } })
    expect(within(screen.getByRole("listbox", { name: "Personnes à mentionner" })).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "@assistantle prochain assistant qui passe sur cette page",
      "@Camille Martinlit cette page",
      "@Sacha Durandlit cette page",
    ])
    fireEvent.change(champ, { target: { value: "Bonjour @sa" } })
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["@Sacha Durandlit cette page"])
    fireEvent.keyDown(champ, { key: "Enter" })
    expect(champ).toHaveValue("Bonjour @Sacha Durand ")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    fireEvent.change(champ, { target: { value: "@" } })
    fireEvent.keyDown(champ, { key: "ArrowDown" })
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(champ, { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("should say that the thread will wait for an assistant as soon as the text carries @assistant, and announce no email without a mail relay", async () => {
    const champ = await ouvrirUneReponse(vue([fil()]))
    expect(screen.queryByText(/aucun ne tourne en permanence/)).not.toBeInTheDocument()
    fireEvent.change(champ, { target: { value: "@assistant corrige, @Sacha Durand relis" } })
    expect(screen.getByText(/aucun ne tourne en permanence/)).toHaveTextContent("le prochain assistant d'une personne qui peut modifier cette page")
    expect(screen.queryByText(/recevra un email/)).not.toBeInTheDocument()
  })

  it("should announce the grouped email when a person is mentioned and the host has a mail relay", async () => {
    const champ = await ouvrirUneReponse(vue([fil()], { mailEnabled: true }))
    fireEvent.change(champ, { target: { value: "@Sacha Durand tu confirmes ?" } })
    expect(screen.getByText("Sacha Durand recevra un email, regroupé avec les autres commentaires : un par heure au plus.")).toBeInTheDocument()
  })
})

describe("BulleDeBloc", () => {
  const page = (
    <>
      <div data-bloc={BLOC}>
        <p>Sans réponse 30 jours après le rappel, appeler le client.</p>
        <BulleDeBloc bloc={BLOC} mots="Sans réponse 30 jours" />
      </div>
      <div data-bloc={BLOC_NEUF}>
        <p>Un bloc jamais publié.</p>
        <BulleDeBloc bloc={BLOC_NEUF} mots="Un bloc jamais publié" />
      </div>
    </>
  )

  it("should open a new thread on a published block, post it with its block, and show no bubble on a block never published", async () => {
    servir(vue([]), reponse(201, { data: { thread: fil({ quote: null, comments: [commentaire({ mine: true, text: "À revoir" })] }) } }))
    rendre(page)
    await screen.findByText(/Aucun fil ouvert/)
    expect(screen.queryByRole("button", { name: /Un bloc jamais publié/ })).not.toBeInTheDocument()
    const bulle = screen.getByRole("button", { name: "Commenter ce bloc — Sans réponse 30 jours" })
    fireEvent.focus(bulle)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/^Commenter ce bloc/)
    fireEvent.click(bulle)
    expect(encart().open).toBe(true)
    fireEvent.change(await screen.findByRole("textbox", { name: "Votre commentaire…" }), { target: { value: "À revoir" } })
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }))
    await carte("Fil sur Étape 3 : relance ferme")
    expect(ecritures()).toEqual([{ methode: "POST", adresse: "/api/platform/comments", corps: { path: CHEMIN, block: BLOC, text: "À revoir" } }])
    expect(screen.getByRole("button", { name: "1 fil ouvert sur ce bloc — Sans réponse 30 jours" })).toBeInTheDocument()
  })

  it("should give the focus back to the bubble when the new thread is abandoned", async () => {
    servir(vue([]))
    rendre(page)
    await screen.findByText(/Aucun fil ouvert/)
    const bulle = screen.getByRole("button", { name: "Commenter ce bloc — Sans réponse 30 jours" })
    fireEvent.click(bulle)
    await screen.findByRole("textbox", { name: "Votre commentaire…" })
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    await waitFor(() => expect(document.activeElement).toBe(bulle))
  })

  it("should keep the count of the open threads of a block and open the first one, its card focused", async () => {
    servir(vue([fil({ status: "resolved", id: "f0" }), fil(), fil({ id: "f2", quote: null })]))
    rendre(page)
    const pastille = await screen.findByRole("button", { name: "2 fils ouverts sur ce bloc — Sans réponse 30 jours" })
    fireEvent.click(encart().querySelector("summary") as HTMLElement)
    fireEvent.click(pastille)
    const ouvertes = await screen.findAllByRole("article", { name: "Fil sur Étape 3 : relance ferme" })
    await waitFor(() => expect(document.activeElement).toBe(ouvertes[0]))
    expect(pastille).toHaveAttribute("data-actif")
  })
})

describe("passageChoisi", () => {
  function selectionner(debut: Node, de: number, fin: Node, a: number) {
    const plage = document.createRange()
    plage.setStart(debut, de)
    plage.setEnd(fin, a)
    const selection = window.getSelection() as Selection
    selection.removeAllRanges()
    selection.addRange(plage)
  }

  it("should quote a selection held in one text node, and open on the block without a quote when it crosses bold text or another block", () => {
    render(
      <>
        <p data-bloc={BLOC}>
          Sans réponse <strong>30 jours</strong> après le rappel.
        </p>
        <p data-bloc={BLOC_NEUF}>Autre bloc.</p>
      </>,
    )
    const bloc = document.querySelector(`[data-bloc="${BLOC}"]`) as HTMLElement
    const [avant, , apres] = [...bloc.childNodes]
    const publies = new Set([BLOC])
    selectionner(apres, 1, apres, 16)
    expect(passageChoisi(publies)).toMatchObject({ bloc: BLOC, citation: "après le rappel" })
    selectionner(avant, 0, apres, 6)
    expect(passageChoisi(publies)).toMatchObject({ bloc: BLOC, citation: null })
    selectionner(avant, 0, (document.querySelector(`[data-bloc="${BLOC_NEUF}"]`) as HTMLElement).firstChild as Node, 5)
    expect(passageChoisi(publies)).toBeNull()
    expect(plageDeLaCitation(bloc, "après  le rappel")?.toString()).toBe("après le rappel")
    expect(plageDeLaCitation(bloc, "Sans réponse 30 jours")).toBeNull()
  })
})
