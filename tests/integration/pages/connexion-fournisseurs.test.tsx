// Boutons des fournisseurs et retour en erreur sur `/login` (E09-S03, AC1, AC5, AC8) : page serveur
// rendue avec `fournisseursActives` simulé ; en-têtes et lecture de la marque simulés comme dans
// `identite-pages.test.tsx` (adresse sans organisation : pas d'en-tête de marque).
import { Suspense, type ReactNode } from "react"
import { headers } from "next/headers"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAnonPlatformDb, PlatformError, resolveOrg, type PlatformDb } from "@otomata_tech/oto_platform/server"
import LoginPage from "@/app/(auth)/login/page"
import { fournisseursActives, type FournisseursActives } from "@/lib/supabase/fournisseurs"

vi.mock("@/lib/supabase/fournisseurs", () => ({ fournisseursActives: vi.fn() }))

vi.mock("@/lib/actions/auth", () => ({
  loginAction: vi.fn(),
  magicLinkAction: vi.fn(),
  connexionFournisseurAction: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: vi.fn() }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createAnonPlatformDb: vi.fn(),
  resolveOrg: vi.fn(),
}))

const GOOGLE = "Continuer avec Google"
const MICROSOFT = "Continuer avec Microsoft"
const RETOUR_REFUSE =
  "La connexion avec Google ou Microsoft n'a pas abouti. On entre sur invitation : utilisez l'adresse qui a reçu l'invitation, ou demandez une invitation à l'administrateur de votre organisation."

/** Rend un arbre qui contient des composants lisant une promesse (`use`). */
async function rendre(arbre: ReactNode) {
  await act(async () => {
    render(<Suspense fallback={null}>{arbre}</Suspense>)
  })
}

function page(searchParams: { error?: string } = {}) {
  return LoginPage({ searchParams: Promise.resolve(searchParams) })
}

function actifs(valeur: FournisseursActives) {
  vi.mocked(fournisseursActives).mockResolvedValue(valeur)
}

function formulaireInchange() {
  // L'adresse d'abord (2026-10-20) : la première étape, son champ et « Continuer ».
  expect(screen.getByLabelText("Adresse mail")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument()
}

/** `true` quand `b` suit `a` dans le document. */
function suit(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  vi.clearAllMocks()
  // `headers()` rend des en-têtes en lecture seule : des `Headers` ordinaires suffisent au rendu.
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "localhost:3000" }) as unknown as Awaited<ReturnType<typeof headers>>)
  // Les services qui liraient la base sont simulés : un client vide suffit.
  vi.mocked(createAnonPlatformDb).mockReturnValue({} as PlatformDb)
  vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at localhost."))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/login providers (AC1, AC8)", () => {
  it("should show « ou » then the Google button alone, under the form, when only Google is enabled", async () => {
    actifs({ google: true, azure: false })

    await rendre(await page())

    const ou = screen.getByText("ou")
    const google = screen.getByRole("button", { name: GOOGLE })
    expect(screen.queryByRole("button", { name: MICROSOFT })).toBeNull()
    expect(suit(screen.getByRole("button", { name: "Continuer" }), ou)).toBe(true)
    expect(suit(ou, google)).toBe(true)
    formulaireInchange()
  })

  it("should show neither « ou » nor a provider button when none is enabled, the form intact", async () => {
    actifs({ google: false, azure: false })

    await rendre(await page())

    expect(screen.queryByText("ou")).toBeNull()
    expect(screen.queryByRole("button", { name: GOOGLE })).toBeNull()
    expect(screen.queryByRole("button", { name: MICROSOFT })).toBeNull()
    formulaireInchange()
  })

  it("should render the form without waiting for the providers, then add their buttons", async () => {
    // La lecture des réglages passe par le réseau : lente, elle ne retient pas le formulaire.
    let repondre: (valeur: FournisseursActives) => void = () => {}
    vi.mocked(fournisseursActives).mockReturnValue(new Promise((resolve) => (repondre = resolve)))

    await rendre(await page())

    formulaireInchange()
    expect(screen.queryByRole("button", { name: GOOGLE })).toBeNull()

    await act(async () => repondre({ google: true, azure: false }))

    expect(screen.getByRole("button", { name: GOOGLE })).toBeInTheDocument()
  })
})

describe("/login back from a provider in error (AC5)", () => {
  it("should explain the refusal in an alert above the form", async () => {
    actifs({ google: true, azure: false })

    await rendre(await page({ error: "oauth" }))

    const alerte = screen.getByRole("alert")
    expect(alerte).toHaveTextContent(RETOUR_REFUSE)
    expect(suit(alerte, screen.getByLabelText("Adresse mail"))).toBe(true)
  })

  it("should say nothing for another error value", async () => {
    actifs({ google: true, azure: false })

    await rendre(await page({ error: "autre" }))

    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("should keep the refused link message of E02-S01 alone", async () => {
    actifs({ google: true, azure: false })

    await rendre(await page({ error: "auth_callback_error" }))

    const alertes = screen.getAllByRole("alert")
    expect(alertes).toHaveLength(1)
    expect(alertes[0]).toHaveTextContent("Ce lien de connexion a expiré ou a déjà servi.")
  })
})
