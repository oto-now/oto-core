import type { ComponentProps, ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView, NodeKind, NodeView, ProcedureSummary } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement, EcranDeNoeud, ListeDesProcedures, ListeDesProceduresChargement, ProcedureDuNoeud } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { ouvrirLeChamp, texteDuBloc } from "../../helpers/champ-du-bloc"
import { avecCle, bloc, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran d'une procédure (E05-S04 ; M59, fiche D104) : celui d'une page, lecture et éditeur ; un bloc `call`
// déjà écrit s'y lit et s'y écrit comme un texte ; restent l'aide du résumé et les refus de publication du
// service ; puis la liste `/procedures`. `fetch` simulé pour `POST /api/platform/nodes`, relecture espionnée.

const TABLE = "ventes/suivi_prospects"
const CHEMIN = "ventes/qualifier_prospects"
const TAMPON = "2026-09-24T09:00:00.000000+00:00"
const rafraichir = vi.fn()
let api: ReturnType<typeof simulerLAPI>

/** Un `id` de bloc lisible : sa référence courte (les 8 premiers caractères) porte son rang. */
const idDe = (rang: number) => `${String(rang).padStart(2, "0")}000000-0000-4000-8000-0000000000${String(rang).padStart(2, "0")}`
const refDe = (rang: number) => idDe(rang).slice(0, 8)
const appel = (rang: number, fonction: string, args: Record<string, unknown>) => bloc(idDe(rang), "call", null, { function: fonction, args })
const etapes = (rang: number, items: string[], start?: number) => bloc(idDe(rang), "list", null, { items, ordered: true, ...(start ? { start } : {}) })

/** `ventes/qualifier_prospects` de la Démo (E01-S06) : 14 blocs dont 4 `call`, étapes 1-2, 3, 4-5, 6, 7. */
const PROCEDURE: BlockView[] = [
  avecCle(bloc(idDe(1), "heading", "Quand l'utiliser", { level: 1 }), "quand"),
  bloc(idDe(2), "paragraph", "Quand des fiches de prospects sont incomplètes."),
  avecCle(bloc(idDe(3), "heading", "Étapes", { level: 1 }), "etapes"),
  etapes(4, ["Annonce ce que tu vas faire.", "Lis le contrat du tableau :"]),
  appel(5, "table.schema", { table: TABLE }),
  etapes(6, ["Réserve des lignes à traiter :"], 3),
  appel(7, "table.claim", { table: TABLE, worker: "<ton prénom>", limit: 3 }),
  etapes(8, ["Cherche le contact et sa source.", "Écris ce que tu as trouvé :"], 4),
  appel(9, "table.write", { table: TABLE, rows: [{ key: "<ref>", set: { contact: { value: "<nom>" } } }] }),
  etapes(10, ["Remets chaque ligne en revue :"], 6),
  appel(11, "table.release", { table: TABLE, key: "<ref>", worker: "<ton prénom>", state: "à revoir" }),
  etapes(12, ["Résume en trois lignes ce qui a été complété."], 7),
  avecCle(bloc(idDe(13), "heading", "Règles", { level: 1 }), "regles"),
  bloc(idDe(14), "list", null, { items: ["Ne jamais inventer un contact ni un email."] }),
]

function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

const hrefDuChemin = (chemin: string) => `/n/${chemin}`

const brouillon = (blocks: BlockView[] = PROCEDURE): NodeView["draft"] => ({ baseRevision: 4, savedAt: "2026-09-24T09:00:00Z", draftStamp: TAMPON, blocks, title: null, summary: null, kind: null, meta: null })

const procedure = (surcharge: Partial<NodeView> = {}) =>
  vueDuNoeud({ id: "noeud-qualifier", path: CHEMIN, kind: "procedure", title: "Qualifier les prospects à traiter", summary: "Qualifie les prospects à traiter.", blocks: PROCEDURE, ...surcharge })

function ecran(props: Partial<ComponentProps<typeof EcranDeNoeud>> = {}) {
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <EcranDeNoeud
        chemin={CHEMIN}
        noeud={{ data: procedure() }}
        arbre={{ data: { tree: [], truncated: false } }}
        equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
        handle="lea"
        nomOrganisation="Démo"
        versionPubliee={false}
        Lien={LienDeTest}
        hrefDuChemin={hrefDuChemin}
        prefixeDesPages="/n/"
        {...props}
      />
    </ContexteDeRafraichissement.Provider>,
  )
}

type Montage = { blocs: BlockView[]; genre?: NodeKind; tampon?: string | null }

/**
 * L'éditeur d'E05-S02 sous sa file d'écriture, comme l'écran le monte au niveau écriture ; « Ailleurs »,
 * hors de l'éditeur : le focus qui y va quitte le bloc (E05-S08).
 */
function editeur({ blocs, genre, tampon = null }: Montage) {
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin={CHEMIN} revisionPubliee={4} tampon={tampon}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" genre={genre} />
      </FileDOperations>
      <button type="button">Ailleurs</button>
    </ContexteDeRafraichissement.Provider>,
  )
}

const bouton = (nom: string) => screen.getByRole("button", { name: nom })
const options = (nom: string) => libellesDesChoix(screen.getByRole("combobox", { name: nom }))

/** Le menu d'un bloc, ouvert par sa poignée (E05-S10, AC-a2, AC-a10). */
function menuDu(mots: string) {
  fireEvent.click(bouton(`Actions sur ce bloc — ${mots}`))
  return within(screen.getByRole("menu"))
}

/** Les styles offerts par le menu ouvert, dans leur ordre. */
const styles = (menu: ReturnType<typeof menuDu>) => menu.queryAllByRole("menuitemradio").map((choix) => choix.textContent)

/** Le menu ouvert se ferme par Échap, le focus rendu à la poignée. */
const fermerLeMenu = () => fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

/** Le champ du bloc nommé, une fois rendu, ouvert : un bloc qu'on ne touche pas se lit (1.1.3). */
async function champ(nom: string): Promise<HTMLTextAreaElement> {
  await screen.findByRole("textbox", { name: nom })
  return ouvrirLeChamp(nom)
}

/** Un tour de boucle : la sortie d'un champ se décide au tour suivant (E05-S08). */
const unTour = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  api = simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Le texte d'un appel déjà écrit, tel que l'écran le lit et l'écrit (M59, HN-M59-1). */
const LU = {
  schema: 'Appel de table.schema : { "table": "ventes/suivi_prospects" }',
  claim: 'Appel de table.claim : { "table": "ventes/suivi_prospects", "worker": "<ton prénom>", "limit": 3 }',
  write: 'Appel de table.write : { "table": "ventes/suivi_prospects", "rows": [ { "key": "<ref>", "set": { "contact": { "value": "<nom>" } } } ] }',
  release: 'Appel de table.release : { "table": "ventes/suivi_prospects", "key": "<ref>", "worker": "<ton prénom>", "state": "à revoir" }',
}

/** Les entrées du menu ouvert, choix de style compris, dans leur ordre ; Échap le ferme. */
function entreesDuMenu(): string[] {
  const menu = screen.getByRole("menu")
  const entrees = Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'), (entree) => entree.textContent ?? "")
  fermerLeMenu()
  return entrees
}

describe("écran d'une procédure, celui d'une page (M59)", () => {
  it("should read a procedure like a page: its h2 titles, its numbered steps, each call where it is as a line of text, and no procedure island; in the editor, its steps numbered next to their fields", async () => {
    const { container } = ecran()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Qualifier les prospects à traiter")
    for (const titre of ["Quand l'utiliser", "Étapes", "Règles"]) expect(screen.getByRole("heading", { level: 2, name: titre })).toBeInTheDocument()
    // Les blocs dans leur ordre, chacun ancré par sa référence : un appel reste à sa place, entre les étapes.
    const refs = new Set(PROCEDURE.map((un) => un.ref))
    const rendus = Array.from(container.querySelectorAll("[id]")).filter((element) => refs.has(element.id))
    expect(rendus.map((element) => element.id)).toEqual(PROCEDURE.map((un) => un.ref))
    const appels = new Set(PROCEDURE.filter((un) => un.type === "call").map((un) => un.ref))
    const lu = (element: Element) =>
      element.tagName === "OL"
        ? `étapes ${Array.from(element.children, (_, rang) => Number(element.getAttribute("start") ?? 1) + rang).join(", ")}`
        : appels.has(element.id)
          ? `${element.tagName} ${element.textContent}`
          : undefined
    expect(rendus.map(lu).filter(Boolean)).toEqual([
      "étapes 1, 2",
      `P ${LU.schema}`,
      "étapes 3",
      `P ${LU.claim}`,
      "étapes 4, 5",
      `P ${LU.write}`,
      "étapes 6",
      `P ${LU.release}`,
      "étapes 7",
    ])
    // Ni légende d'appel, ni contrôle du brouillon, ni « Tester une phrase ».
    expect(container.querySelector("figure")).toBeNull()
    expect(screen.queryByText(/^Appel · |Contrôle du brouillon|Tester une phrase/)).toBeNull()
    cleanup()

    // Au niveau écriture, l'éditeur : les étapes gardent leurs numéros à côté de leurs champs (E05-S08, AC8).
    ecran({ noeud: { data: procedure({ level: 2, draft: brouillon() }) } })
    const etapes4et5 = await screen.findByRole("textbox", { name: "Modifier cette liste numérotée — Cherche le contact et" })
    expect(within(etapes4et5.closest<HTMLElement>("[id]") ?? document.body).getAllByText(/^\d+\.$/).map((numero) => numero.textContent)).toEqual(["4.", "5."])
  })

  it("should render nothing for the obsolete ProcedureDuNoeud, whatever its host passes", () => {
    const { container } = render(
      <ProcedureDuNoeud
        chemin={CHEMIN}
        phrase="Qualifie les prospects à traiter"
        controle={{ data: [{ kind: "too_long", message: "Too long." }] }}
        blocs={PROCEDURE}
        apercu={{ data: { text: "ctx: XXXX-XXXX", served: null, candidates: [] } }}
        Lien={LienDeTest}
        hrefDuChemin={hrefDuChemin}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("should offer on a procedure exactly the editing controls of a page, none for a call", async () => {
    const texte = bloc(idDe(30), "paragraph", "Lis le contrat du tableau.")
    const controles = async (genre: NodeKind) => {
      editeur({ blocs: [texte, etapes(32, ["un", "deux"])], genre })
      // Le « + » ouvre le choix du bloc (E10-S06, AC-a1) : un Texte.
      fireEvent.click(bouton("Ajouter un bloc après — Lis le contrat du"))
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Texte" }))
      await champ("Modifier ce texte — bloc vide")
      const formes = styles(menuDu("bloc vide"))
      const duBlocVide = entreesDuMenu()
      menuDu("un deux")
      const deLaListe = entreesDuMenu()
      const champs = screen.getAllByRole("textbox").map((element) => element.getAttribute("aria-label"))
      cleanup()
      return { formes, duBlocVide, deLaListe, champs }
    }
    const surUnePage = await controles("page")
    const surUneProcedure = await controles("procedure")
    expect(surUneProcedure).toEqual(surUnePage)
    expect(surUneProcedure.formes).toEqual(["Texte", "Grand titre", "Moyen titre", "Petit titre", "Liste à puces", "Liste numérotée", "Liste à cocher", "Citation", "Code", "Diagramme", "Menu dépliant"])
    expect([...surUneProcedure.duBlocVide, ...surUneProcedure.deLaListe].filter((entree) => /appel/i.test(entree))).toEqual([])
    expect(surUneProcedure.champs).toEqual(["Modifier ce texte — Lis le contrat du", "Modifier ce texte — bloc vide", "Modifier cette liste numérotée — un deux"])
  })
})

describe("un appel déjà écrit, sur l'écran d'une page (M59)", () => {
  const claim = avecCle(appel(20, "table.claim", { table: TABLE, worker: "<ton prénom>", limit: 3 }), "reserver")
  const schema = appel(21, "table.schema", {})

  it("should read a call as its function and arguments in plain text, markup not read, never run", () => {
    const envois = vi.fn()
    vi.stubGlobal("fetch", envois)
    const brut = appel(22, "mail.create_draft", { subject: "<b>Relance</b>", body: "**gras** _ici_ [[ventes/contexte]]" })
    const { container } = ecran({ chemin: "ventes/contexte", noeud: { data: vueDuNoeud({ path: "ventes/contexte", kind: "context", blocks: [claim, schema, brut] }) } })
    // Une référence peut commencer par un chiffre : l'ancre se lit par son attribut, jamais par `#`.
    const ancre = (ref: string) => container.querySelector(`[id="${ref}"]`)
    expect(ancre(claim.ref)?.textContent).toBe(LU.claim)
    expect(ancre(schema.ref)?.textContent).toBe("Appel de table.schema")
    expect(ancre(brut.ref)?.textContent).toBe('Appel de mail.create_draft : { "subject": "<b>Relance</b>", "body": "**gras** _ici_ [[ventes/contexte]]" }')
    expect(container.querySelector("b, strong, em, script, a[href='/n/ventes/contexte']")).toBeNull()
    expect(envois).not.toHaveBeenCalled()
  })

  it("should keep a call as it is while it is not changed, write it as a text once changed, and delete it from its menu", async () => {
    const lie = appel(23, "mail.create_draft", { body: "[[ventes/contexte]]" })
    const texteLie = bloc(idDe(24), "paragraph", "Voir [[ventes/contexte]].")
    editeur({ blocs: [claim, schema, lie, texteLie], genre: "procedure" })
    await screen.findByRole("textbox", { name: "Modifier ce texte — table.claim" })
    expect(texteDuBloc("Modifier ce texte — table.claim")).toBe(LU.claim)
    expect(texteDuBloc("Modifier ce texte — table.schema")).toBe("Appel de table.schema")
    // Ses arguments se lisent en texte brut : un appel ne rend pas ses liens au repos ; un texte, les siens (E05-S11, AC-26).
    expect([...document.querySelectorAll(".oto-block-rendu")].map((rendu) => rendu.closest("[id]")?.id)).toEqual([texteLie.ref])
    // Ouvert, puis quitté ou enregistré sans changement : rien ne part, le bloc reste un appel en base.
    ouvrirLeChamp("Modifier ce texte — table.claim")
    act(() => bouton("Ailleurs").focus())
    await unTour()
    // Quitté, le champ s'est démonté (1.1.3) : il se rouvre pour être enregistré, puis réécrit.
    const champClaim = ouvrirLeChamp("Modifier ce texte — table.claim")
    fireEvent.keyDown(champClaim, { key: "s", ctrlKey: true })
    await unTour()
    expect(api.fetchMock).not.toHaveBeenCalled()

    // Réécrit, il part en Texte, sur le même bloc, sa clé gardée.
    fireEvent.change(champClaim, { target: { value: "Réserve trois prospects du tableau de suivi." } })
    fireEvent.keyDown(champClaim, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([
      { op: "replace_block", block: claim.id, revision: 3, input: { type: "paragraph", text: "Réserve trois prospects du tableau de suivi.", data: {}, key: "reserver" } },
    ])

    fireEvent.click(menuDu("table.schema").getByRole("menuitem", { name: /^Supprimer/ }))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops).toEqual([{ op: "delete_block", block: schema.id, revision: 3 }])
  })
})

describe("titre et résumé d'une procédure (AC5)", () => {
  // M59 (fiche D104) : une procédure a l'aide d'une page, aucune propre à elle.
  // Le titre d'un Contexte est composé, jamais écrit en place (E05-S11, AC-17). Le résumé ne s'écrit à l'écran que pour
  // une procédure (E11-S05, AC-f1, HN-E11S05-15).
  it.each(["procedure", "page", "context"] as const)("should give a %s its title in place, except a Contexte's, and « Résumé » without help for a procedure only (E05-S10, AC-a1)", (kind) => {
    ecran({ noeud: { data: procedure({ kind, level: 2, draft: brouillon() }) } })
    expect(screen.queryByRole("button", { name: "Modifier le titre et le résumé" })).toBeNull()
    if (kind === "context") expect(screen.queryByRole("textbox", { name: "Titre" })).toBeNull()
    else expect(screen.getByRole("textbox", { name: "Titre" })).toHaveValue("Qualifier les prospects à traiter")
    if (kind === "procedure") expect(screen.getByRole("textbox", { name: "Résumé" })).toHaveAccessibleDescription("")
    else expect(screen.queryByRole("textbox", { name: "Résumé" })).toBeNull()
  })
})

const REFUS_DE_SORTIE = {
  kind: "invalid_value",
  section: "Étapes",
  block: 4,
  step: 6,
  block_id: idDe(11),
  function: "table.release",
  element: "state",
  message: "Section Étapes, block 4 (step 6): table.release, state: value en cours is not allowed.",
}

/** La publication suivante est refusée par le contrôle d'E03-S06 : `invalid_arguments` et `details.refusals`. */
function refuserLaPublication(refusals: unknown[]) {
  api.fetchMock.mockImplementationOnce(
    async () =>
      new Response(JSON.stringify({ error: { code: "invalid_arguments", message: "Publication refused.", details: { refusals } } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  )
}

describe("publication refusée, par emplacement (AC7)", () => {
  it("should say how many problems block the publication, each by its place, its function or argument and its kind, lead to its block, fold the service text, and keep the draft", async () => {
    editeur({ blocs: PROCEDURE, genre: "procedure", tampon: TAMPON })
    // La publication part seule (E05-S10, AC-a6) : un texte écrit, puis la page quittée.
    const texte = await champ("Modifier ce texte — Quand des fiches de")
    fireEvent.change(texte, { target: { value: "Quand des fiches de prospects sont incomplètes ou anciennes." } })
    fireEvent.keyDown(texte, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    refuserLaPublication([REFUS_DE_SORTIE])
    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(await screen.findByText("La publication est refusée : 1 problème à corriger.")).toHaveAttribute("role", "alert")
    const ligne = screen.getByText("Section « Étapes », bloc 4, étape 6 · table.release, argument « state » · valeur refusée").closest("li")
    // « Aller au bloc » mène à l'ancre du bloc fautif, sa référence parmi les blocs du brouillon.
    expect(within(ligne ?? document.body).getByRole("link", { name: /^Aller au bloc/ })).toHaveAttribute("href", `#${refDe(11)}`)
    expect(within(ligne ?? document.body).getByText(REFUS_DE_SORTIE.message).closest("details")).toHaveTextContent(/^Détail technique/)

    const refus: [Record<string, unknown>, string][] = [
      [{ kind: "too_long" }, `Procédure · procédure de plus de ${new Intl.NumberFormat("fr-FR").format(12_000)} caractères : déplacez les informations de référence dans une page et liez-la`],
      [{ kind: "invalid_block", block: 1 }, "Avant le premier titre, bloc 1 · bloc d'appel mal formé"],
      [{ kind: "unknown_function", section: "Étapes", block: 2, step: 2, function: "mail.send" }, "Section « Étapes », bloc 2, étape 2 · mail.send · fonction inconnue"],
      [{ kind: "function_not_active", section: "Étapes", block: 4, step: 5, function: "mail.create_draft" }, "Section « Étapes », bloc 4, étape 5 · mail.create_draft · fonction non activée pour l'organisation"],
      [{ kind: "unknown_key", section: "Règles", block: 1, function: "table.rows", element: "colonne" }, "Section « Règles », bloc 1 · table.rows, argument « colonne » · argument inconnu"],
      [{ kind: "missing_argument", section: "Étapes", block: 1, step: 2, function: "table.schema", element: "table" }, "Section « Étapes », bloc 1, étape 2 · table.schema, argument « table » · argument requis absent"],
      [{ kind: "invalid_value", section: "Étapes", block: 3, step: 4, function: "table.write" }, "Section « Étapes », bloc 3, étape 4 · table.write · valeur refusée"],
      [{ kind: "check_failed", section: "Étapes", block_id: idDe(9), function: "table.write" }, "Section « Étapes », bloc de code · table.write · contrôle de la fonction refusé"],
      [{ kind: "not_yet_known" }, "Procédure · problème à corriger"],
    ]
    refuserLaPublication(refus.map(([un], rang) => ({ ...un, message: `Problem ${rang + 1}.` })))
    // Une publication refusée repart à la sortie suivante de la page.
    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(await screen.findByText("La publication est refusée : 9 problèmes à corriger.")).toHaveAttribute("role", "alert")
    const lignes = within(screen.getByRole("group", { name: "Publication" })).getAllByRole("listitem")
    expect(lignes.map((element) => element.querySelector("p")?.textContent)).toEqual(refus.map(([, attendue]) => attendue))
    expect(within(lignes[7]).getByRole("link", { name: /^Aller au bloc/ })).toHaveAttribute("href", `#${refDe(9)}`)
    expect(within(lignes[0]).queryByRole("link")).toBeNull()

    // Rien n'est publié : le brouillon reste, la page n'est pas relue.
    // Le texte, puis les deux publications refusées : rien d'autre n'est parti.
    expect(api.fetchMock).toHaveBeenCalledTimes(3)
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

const VENTES = "7b1c0f3e-2a4d-4c6b-9e8f-0a1b2c3d4e5f"
const SUPPORT = "8c2d1e4f-3b5a-4d7c-8f9e-1b2c3d4e5f6a"

const resume = (path: string, surcharge: Partial<ProcedureSummary> = {}): ProcedureSummary => ({
  path,
  title: `Titre de ${path}`,
  summary: "Résumé.",
  status: "published",
  revision: 4,
  updatedAt: "2026-09-24T09:00:00Z",
  ownerTeam: null,
  hasDraft: false,
  ...surcharge,
})

const LISTE: ProcedureSummary[] = [
  resume("guide/accueil", { status: "draft", revision: 0, hasDraft: true }),
  resume("private/lea/ma_relance"),
  resume("support/traiter_un_ticket", { revision: 2, hasDraft: true, ownerTeam: { id: SUPPORT, name: "Support" } }),
  resume(CHEMIN, { ownerTeam: { id: VENTES, name: "Ventes" } }),
]

describe("liste des procédures (AC9)", () => {
  const hrefDeLaListe = ({ team }: { team?: string }) => (team ? `/procedures?team=${team}` : "/procedures")
  const monter = (props: Partial<ComponentProps<typeof ListeDesProcedures>> = {}) =>
    render(
      <ListeDesProcedures
        resultat={{ data: LISTE }}
        equipes={{ data: [{ id: VENTES, name: "Ventes" }, { id: SUPPORT, name: "Support" }] }}
        filtre={{}}
        Lien={LienDeTest}
        hrefDuChemin={hrefDuChemin}
        hrefDeLaListe={hrefDeLaListe}
        {...props}
      />,
    )
  const lignes = () =>
    within(screen.getByRole("table", { name: "Procédures" }))
      .getAllByRole("row")
      .slice(1)
      .map((ligne) => within(ligne).getAllByRole("cell").map((cellule) => cellule.textContent))

  it("should list the procedures in the order served, with their team and state in words, filter them by team through a GET form, and say both empty lists", () => {
    monter()
    const tableau = screen.getByRole("table", { name: "Procédures" })
    // La table du design system (M31), plus les classes de `classes.ts`.
    expect(tableau).toHaveClass("oto-table")
    expect(within(tableau).getAllByRole("columnheader").map((entete) => [entete.textContent, entete.getAttribute("scope")])).toEqual([
      ["Titre", "col"],
      ["Chemin", "col"],
      ["Équipe", "col"],
      ["État", "col"],
    ])
    expect(lignes()).toEqual([
      ["Titre de guide/accueil", "guide/accueil", "Organisation", "Non publiée"],
      // Une procédure d'un espace personnel n'a pas d'équipe, et n'est pas celle de l'organisation (HN-E05S04-21).
      ["Titre de private/lea/ma_relance", "private/lea/ma_relance", "Privé", "Publiée · rév. 4"],
      ["Titre de support/traiter_un_ticket", "support/traiter_un_ticket", "Support", "Publiée · rév. 2 · modifications en attente"],
      [`Titre de ${CHEMIN}`, CHEMIN, "Ventes", "Publiée · rév. 4"],
    ])
    expect(screen.getByRole("link", { name: `Titre de ${CHEMIN}` })).toHaveAttribute("href", `/n/${CHEMIN}`)
    const filtre = screen.getByRole("combobox", { name: "Équipe" })
    expect(filtre.closest("form")?.querySelector("input[type='hidden'][name='team']")).toHaveValue("")
    expect(filtre.closest("form")).toHaveAttribute("method", "get")
    expect(filtre.closest("form")).toHaveAttribute("action", "/procedures")
    expect(options("Équipe")).toEqual(["Toutes les équipes", "Ventes", "Support"])
    cleanup()

    monter({ filtre: { team: VENTES } })
    expect(screen.getByRole("combobox", { name: "Équipe" })).toHaveValue(VENTES)
    expect(lignes()).toEqual([[`Titre de ${CHEMIN}`, CHEMIN, "Ventes", "Publiée · rév. 4"]])
    cleanup()

    monter({ resultat: { data: [] } })
    expect(screen.getByText("Aucune procédure ne vous est encore partagée.")).toBeInTheDocument()
    cleanup()
    monter({ resultat: { data: [LISTE[0]] }, filtre: { team: SUPPORT } })
    expect(screen.getByText("Aucune procédure pour cette équipe.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Retirer le filtre" })).toHaveAttribute("href", "/procedures")
  })

  it("should render the loading state", () => {
    render(<ListeDesProceduresChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des procédures…")
  })

  it.each([
    ["the procedures", { resultat: { error: "Une erreur est survenue. Réessayez." } }],
    ["the teams of the filter", { equipes: { error: "Une erreur est survenue. Réessayez." } }],
  ] as const)("should say a failed read of %s with « Réessayer » on the same address", (_lecture, enPanne) => {
    monter({ filtre: { team: VENTES }, ...enPanne })
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `/procedures?team=${VENTES}`)
  })
})

