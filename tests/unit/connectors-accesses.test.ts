// @vitest-environment node
// Un connecteur à plusieurs accès (`connecteurs-et-comptes.md` § Plusieurs accès), sans réseau ni base : la déclaration
// et ses refus, nommés accès par accès ; les propriétaires et le formulaire de chaque accès ; l'accès qu'une saisie
// nomme et celui qu'un compte retient ; le moteur, qui signe chaque appel par l'accès du compte (le compte de service
// par une assertion échangée, le consentement par le jeton de la personne) et refuse un compte sans accès déclaré avant
// tout envoi. La clé du compte de service vient des cas communs ; les jetons sont tirés à l'exécution.
import { randomBytes } from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { credentialValue, jwtBearerCases } from "@otomata_tech/connectors/jwt-bearer-cases"
import { declaredConnector } from "../../packages/plateforme/server/catalog/connector-source"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { accountAccess, requestedAccess } from "../../packages/plateforme/server/connectors/accesses"
import { admittedOwnerKinds, formOwnerKinds } from "../../packages/plateforme/server/connectors/account-owners"
import { connectorAccountForms } from "../../packages/plateforme/server/connectors/account-secret"
import { accessChoices, connectAccess, refusalFromPlan, type ConnectionPlan } from "../../packages/plateforme/server/connectors/connect-link"
import type { AccountCredential } from "../../packages/plateforme/server/connectors/auth"
import { isPersonalConnector } from "../../packages/plateforme/server/connectors/consent-accounts"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorAccess, ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { authorizationAddress } from "../../packages/plateforme/server/connectors/oauth-user"
import { PlatformError } from "../../packages/plateforme/server/errors"
import {
  describedConnector,
  KEY_OR_SIGN_IN,
  keyOrSignInConnector,
  memoryConsent,
  memoryTokens,
  SERVICE_ACCOUNT_TOKEN_URL,
  TEST_APPLICATION,
  TWO_ACCESSES,
  twoAccessConnector,
} from "../factories/described-connector"

const token = () => `t_${randomBytes(12).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const { serviceAccount: SERVICE, signIn: SIGN_IN } = TWO_ACCESSES

const leveled = jwtBearerCases.find((c) => c.name === "assertion_at_default_level")
if (!leveled) throw new Error("the common case assertion_at_default_level is missing")

/** Les deux accès du connecteur de test, l'un changé par `change`. */
function withAccess(name: string, change: (access: ConnectorAccess) => object): ConnectorDefinition {
  const base = twoAccessConnector()
  if (!base.accesses) throw new Error("no accesses")
  return { ...base, accesses: base.accesses.map((access) => (access.name === name ? (change(access) as ConnectorAccess) : access)) }
}

/** Le verdict de la déclaration : `declared`, ou le message du refus. */
function verdict(definition: ConnectorDefinition, application = true): string {
  try {
    registerConnectors([definition], application ? { oauthApplications: { crm: TEST_APPLICATION } } : {})
    return "declared"
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
}

/** `fetch` simulé : réponses dans l'ordre ; chaque requête gardée. */
function stub(...answers: Response[]) {
  const send = vi.fn<Fetch>(async () => answers.shift() ?? json({}))
  vi.stubGlobal("fetch", send)
  return () => send.mock.calls.map(([url, init]) => ({ url, authorization: new Headers(init.headers).get("authorization"), body: init.body }))
}

/** `crm.get_company` sur un compte qui retient `access` (absent : aucun). */
function getCompany(credential: AccountCredential, access?: string) {
  const fn = declaredConnector("crm")?.functions.find((candidate) => candidate.name === "crm.get_company")
  if (!fn) throw new Error("crm.get_company is not declared")
  return fn.run({ credential, account: { id: "account-1", label: "Crm Ventes", ...(access ? { access } : {}) } } as never, {} as never)
}

/** Le refus, levé d'emblée ou rendu par la promesse, de `work`. */
async function refusal(work: () => unknown): Promise<PlatformError> {
  const error = await Promise.resolve()
    .then(work)
    .then(
      () => null,
      (reason: unknown) => reason,
    )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("a connector with several accesses: declaration", () => {
  it("should declare each access, seen as a connector with a single access, its functions served once", () => {
    expect(verdict(twoAccessConnector())).toBe("declared")
    const declared = declaredConnector("crm")
    expect(declared?.accesses.map((access) => [access.name, access.label, access.auth.kind, access.definition.modes, access.application !== null])).toEqual([
      [SERVICE, "Service account of the organization", "service_account", ["byo_org"], false],
      [SIGN_IN, "Sign-in of a person", "user_consent", ["byo_user"], true],
    ])
    expect(declared?.accesses.every((access) => access.probe?.fn.name === "crm.get_company")).toBe(true)
    expect(declared?.functions.map((fn) => fn.name)).toEqual(["crm.get_company", "crm.list_contacts", "crm.get_contact", "crm.rename_contact", "crm.untag_contact", "crm_act.post_entry"])
    expect(isPersonalConnector("crm")).toBe(true)
  })

  it("should refuse by name accesses beside auth, fewer than two, unnamed, unlabelled, named twice, or with a hosted account identity", () => {
    const base = twoAccessConnector()
    if (!base.accesses) throw new Error("no accesses")
    const [service, signIn] = base.accesses
    const single = describedConnector()
    const verdicts = [
      { ...base, auth: single.auth } as unknown as ConnectorDefinition,
      { ...base, accesses: [service] },
      withAccess(SERVICE, (access) => ({ ...access, name: "Service" })),
      withAccess(SERVICE, (access) => ({ ...access, label: " " })),
      { ...base, accesses: [service, { ...signIn, name: SERVICE }] },
      { ...base, accountIdentity: { name: "account_id", label: "Account", pattern: "^[a-z]+$" } },
    ].map((definition) => verdict(definition, false))
    expect(verdicts).toEqual([
      "crm: accesses replaces auth, credential and modes: declare one or the other, never both.",
      "crm: accesses must list at least two accesses; a connector with one declares auth, credential and modes.",
      "crm: each access needs a name in lowercase ASCII letters, digits and _, starting with a letter.",
      "crm: access service_account needs a label of 1 to 80 characters.",
      "crm: access service_account is declared twice.",
      "crm: accountIdentity is served for a connector with a single access only, not with accesses.",
    ])
    expect(declaredConnector("crm")).toBeNull()
  })

  it("should judge each access like a connector with a single access, and name the access that is refused", () => {
    const verdicts = [
      withAccess(SERVICE, (access) => ({ ...access, modes: ["byo_team"] })),
      withAccess(SIGN_IN, (access) => ({ ...access, credential: [{ name: "api_key", label: "API key", secret: true }] })),
      withAccess(SERVICE, (access) => ({ ...access, auth: { ...access.auth, key: "other" } })),
      withAccess(SERVICE, (access) => ({ ...access, auth: { kind: "oauth2_jwt_bearer", tokenUrl: SERVICE_ACCOUNT_TOKEN_URL, key: "service_account_key", scopes: ["contacts.read"] } })),
      withAccess(SERVICE, (access) => ({ ...access, auth: { ...access.auth, accessLevels: { read: { scopes: ["contacts.read"] } } } })),
      withAccess(SERVICE, (access) => ({ ...access, auth: { kind: "none" } })),
      withAccess(SERVICE, (access) => ({ ...access, auth: { kind: "none" }, credential: [] })),
    ].map((definition) => verdict(definition))
    expect(verdicts).toEqual([
      'Access service_account of crm: crm: mode "byo_team" is unknown: platform, byo_user, byo_org.',
      "Access sign_in of crm: crm: credential must be empty with oauth2_user: the tokens of a consent are not fields, and the OAuth application is the host's.",
      "Access service_account of crm: crm: auth oauth2_jwt_bearer: key must name the one credential field, secret (the JSON key file).",
      "Access service_account of crm: crm: access levels (accessLevels) go in every access or in none: sign_in declares them, auth oauth2_jwt_bearer declares none.",
      "Access service_account of crm: crm: auth oauth2_jwt_bearer: accessLevels needs the level full.",
      // Sans clé, un accès s'appelle sans compte : ni champ du secret, ni place parmi plusieurs accès.
      "Access service_account of crm: crm: auth none takes no credential: it is called without an account.",
      "crm: auth none is called without an account: it cannot be one of several accesses.",
    ])
  })

  it("should take the OAuth application of a connector whose consent is one of its accesses, and refuse it for a connector without consent", () => {
    expect(verdict(twoAccessConnector())).toBe("declared")
    const noConsent = withAccess(SIGN_IN, (access) => ({ ...access, name: "second_service", auth: (twoAccessConnector().accesses ?? [])[0].auth, credential: [{ name: "service_account_key", label: "Key", secret: true }], modes: ["byo_org"] }))
    expect(verdict(noConsent)).toBe("OAuth application for crm: no oauth2_user connector of this name is declared.")
  })
})

describe("a connector with several accesses: owners, forms and the access of an account", () => {
  it("should give one form per access: a key to enter for the service account, Connect my account for the sign-in", () => {
    verdict(twoAccessConnector())
    const forms = connectorAccountForms().filter((form) => form.connector === "crm")
    expect(forms).toEqual([
      {
        connector: "crm",
        label: "Crm",
        access: { name: SERVICE, label: "Service account of the organization" },
        consent: false,
        ownerKinds: ["org", "team"],
        probe: { available: true, balance: false },
        fields: [{ name: "service_account_key", label: "Service account key (JSON)", secret: true }],
        settings: [],
      },
      {
        connector: "crm",
        label: "Crm",
        access: { name: SIGN_IN, label: "Sign-in of a person" },
        consent: true,
        ownerKinds: ["user"],
        probe: { available: true, balance: false },
        fields: [],
        settings: [],
      },
    ])
    const [service, signIn] = declaredConnector("crm")?.accesses ?? []
    expect([formOwnerKinds(service.definition), admittedOwnerKinds(service.definition), formOwnerKinds(signIn.definition), admittedOwnerKinds(signIn.definition)]).toEqual([
      ["org", "team"],
      ["org", "team"],
      ["user"],
      ["user"],
    ])
  })

  it("should keep the form of a connector with a single access as it was, without access", () => {
    registerConnectors([describedConnector()])
    const forms = connectorAccountForms()
    expect([forms.length, "access" in forms[0]]).toEqual([1, false])
  })

  it("should require a declared access for a connector with several, and refuse one for a connector with a single access, never a default", async () => {
    verdict(twoAccessConnector())
    const declared = declaredConnector("crm")
    if (!declared) throw new Error("crm is not declared")
    expect(requestedAccess(declared, SIGN_IN).name).toBe(SIGN_IN)
    const missing = await refusal(() => requestedAccess(declared, undefined))
    const unknown = await refusal(() => requestedAccess(declared, "other"))
    expect([missing.code, missing.details?.reason, missing.message]).toEqual([
      "invalid_arguments",
      "access",
      "Crm opens by several accesses: name one (service_account (Service account of the organization), sign_in (Sign-in of a person)).",
    ])
    expect(unknown.message).toBe("Crm has no access other (service_account (Service account of the organization), sign_in (Sign-in of a person)).")
    registerConnectors([describedConnector()])
    const single = declaredConnector("crm")
    if (!single) throw new Error("crm is not declared")
    expect(requestedAccess(single, undefined).name).toBeNull()
    expect((await refusal(() => requestedAccess(single, SERVICE))).message).toBe("Crm opens by a single access: access is not given.")
  })

  it("should open an account by the access it retains, and refuse one without access, or with one the declaration no longer has", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    verdict(twoAccessConnector())
    const declared = declaredConnector("crm")
    if (!declared) throw new Error("crm is not declared")
    expect(accountAccess(declared, { label: "Crm Ventes", access: SERVICE }).name).toBe(SERVICE)
    const none = await refusal(() => accountAccess(declared, { label: "Crm Ventes" }))
    const gone = await refusal(() => accountAccess(declared, { label: "Crm Ventes", access: "legacy" }))
    expect([none.code, none.details, none.message]).toEqual([
      "not_enabled",
      { reason: "access" },
      "Account « Crm Ventes » does not say by which access it opens, and Crm opens by several (service_account (Service account of the organization), sign_in (Sign-in of a person)). Connect another account of Crm.",
    ])
    expect(gone.message).toBe("Account « Crm Ventes » opens by access legacy, which Crm no longer declares. Connect another account of Crm.")
  })
})

describe("a connector with several accesses: the engine", () => {
  it("should sign a call of a service account by an assertion exchanged at its token address, at its default level", async () => {
    verdict(twoAccessConnector())
    const access = token()
    const sent = stub(json({ access_token: access, expires_in: 3600 }), json({ scopes: ["contacts.read"] }))
    const tokens = memoryTokens()
    await getCompany({ fields: { service_account_key: credentialValue(leveled) }, settings: {}, tokens }, SERVICE)
    const [exchange, call] = sent()
    const assertion = new URLSearchParams(String(exchange.body)).get("assertion") ?? ""
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8")) as { scope: string; aud: string }
    expect([exchange.url, claims.aud, claims.scope]).toEqual([SERVICE_ACCOUNT_TOKEN_URL, SERVICE_ACCOUNT_TOKEN_URL, "offline_access contacts.read"])
    expect([call.url, call.authorization, tokens.written.map((written) => written.token)]).toEqual(["https://crm.example.test/v2/me", `Bearer ${access}`, [access]])
  })

  it("should sign a call of a person's account by the access token of their consent, with no exchange", async () => {
    verdict(twoAccessConnector())
    const access = token()
    const sent = stub(json({ scopes: ["contacts.read"] }))
    const credential = { fields: {}, settings: {}, tokens: memoryTokens({ token: access, expiresAt: new Date(Date.now() + 600_000) }), consent: memoryConsent(token()) }
    await getCompany(credential, SIGN_IN)
    expect(sent().map((request) => [request.url, request.authorization])).toEqual([["https://crm.example.test/v2/me", `Bearer ${access}`]])
  })

  it("should set the resource of the sign-in access, declared in its auth, at its authorization and its renewal", async () => {
    const resource = "https://api.crm.example.test"
    verdict(withAccess(SIGN_IN, (access) => ({ ...access, auth: { ...access.auth, resource } })))
    const signIn = declaredConnector("crm")?.accesses.find((access) => access.name === SIGN_IN)
    if (signIn?.auth.kind !== "user_consent") throw new Error("not a consent")
    const address = new URL(authorizationAddress(signIn.auth, { clientId: "client-test", redirectUri: "https://acme.test/cb", state: "s", codeChallenge: "c" }))
    expect(address.searchParams.get("resource")).toBe(resource)
    const refresh = token()
    const sent = stub(json({ access_token: "a1", refresh_token: refresh, expires_in: 3600 }), json({ scopes: ["contacts.read"] }))
    const credential = { fields: {}, settings: {}, tokens: memoryTokens({ token: "expiring", expiresAt: new Date(Date.now() + 30_000) }), consent: memoryConsent(refresh) }
    await getCompany(credential, SIGN_IN)
    expect(new URLSearchParams(String(sent()[0].body)).get("resource")).toBe(resource)
  })

  it("should refuse before anything is sent a call on an account without access, or with an undeclared one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    verdict(twoAccessConnector())
    const sent = stub()
    const credential = { fields: { service_account_key: credentialValue(leveled) }, settings: {}, tokens: memoryTokens() }
    const none = await refusal(() => getCompany(credential))
    const gone = await refusal(() => getCompany(credential, "legacy"))
    expect([none.code, none.details, gone.code, gone.details, sent()]).toEqual(["not_enabled", { reason: "access" }, "not_enabled", { reason: "access" }, []])
  })

  it("should refuse an access given to an account of a connector with a single access", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    registerConnectors([describedConnector()])
    const sent = stub()
    const error = await refusal(() => getCompany({ fields: { api_key: token() }, settings: {}, tokens: memoryTokens() }, SERVICE))
    expect([error.code, error.message, sent()]).toEqual(["not_enabled", "Account « Crm Ventes » opens by access service_account, which Crm no longer declares. Connect another account of Crm.", []])
  })
})

describe("a connector with several accesses, without access levels", () => {
  it("should declare accesses with no levels at all, each opening the whole connector, and refuse levels in some accesses only", () => {
    expect(verdict(keyOrSignInConnector())).toBe("declared")
    const declared = declaredConnector("crm")
    expect(declared?.accesses.map((access) => [access.name, access.auth.kind, access.definition.modes])).toEqual([
      [KEY_OR_SIGN_IN.signIn, "user_consent", ["byo_user"]],
      [KEY_OR_SIGN_IN.key, "header", ["platform", "byo_org"]],
    ])
    const signIn = (twoAccessConnector().accesses ?? []).find((access) => access.name === SIGN_IN)
    if (!signIn) throw new Error("no sign-in access")
    const base = keyOrSignInConnector()
    if (!base.accesses) throw new Error("no accesses")
    const mixed = { ...base, accesses: base.accesses.map((access) => (access.name === KEY_OR_SIGN_IN.signIn ? { ...access, auth: signIn.auth } : access)) }
    expect(verdict(mixed)).toBe("Access key of crm: crm: access levels (accessLevels) go in every access or in none: oauth declares them, auth bearer declares none.")
  })

  it("should sign each call by the access of its account: the key of the organization, or the token of the person", async () => {
    verdict(keyOrSignInConnector())
    const key = token()
    const sent = stub(json({ scopes: ["contacts.read"] }), json({ scopes: ["contacts.read"] }))
    await getCompany({ fields: { api_key: key }, settings: {}, tokens: memoryTokens() }, KEY_OR_SIGN_IN.key)
    const access = token()
    await getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: access, expiresAt: new Date(Date.now() + 600_000) }), consent: memoryConsent(token()) }, KEY_OR_SIGN_IN.signIn)
    expect(sent().map((request) => request.authorization)).toEqual([`Bearer ${key}`, `Bearer ${access}`])
  })

  it("should sign by the access the account retains, never by another secret the account would carry", async () => {
    verdict(keyOrSignInConnector())
    const [key, access] = [token(), token()]
    const sent = stub(json({ scopes: ["contacts.read"] }), json({ scopes: ["contacts.read"] }))
    const both = () => ({ fields: { api_key: key }, settings: {}, tokens: memoryTokens({ token: access, expiresAt: new Date(Date.now() + 600_000) }), consent: memoryConsent(token()) })
    await getCompany(both(), KEY_OR_SIGN_IN.key)
    await getCompany(both(), KEY_OR_SIGN_IN.signIn)
    expect(sent().map((request) => request.authorization)).toEqual([`Bearer ${key}`, `Bearer ${access}`])
  })
})

describe("a connector with several accesses: the choice of access", () => {
  it("should offer each access with its gesture: oauth for the sign-in, key for the key", () => {
    verdict(keyOrSignInConnector())
    expect(accessChoices("crm")).toEqual([
      { name: KEY_OR_SIGN_IN.signIn, label: "Sign-in of a person", gesture: "oauth" },
      { name: KEY_OR_SIGN_IN.key, label: "Key of the organization", gesture: "key" },
    ])
    expect(accessChoices("crm", KEY_OR_SIGN_IN.signIn).map((access) => access.name)).toEqual([KEY_OR_SIGN_IN.key])
    registerConnectors([describedConnector()])
    expect(accessChoices("crm")).toEqual([])
  })

  it("should name the other accesses in a refusal without account, never in one that keeps its account's access", () => {
    verdict(keyOrSignInConnector())
    const plan: ConnectionPlan = {
      connector: "crm",
      label: "Crm",
      access: connectAccess("crm"),
      space: { kind: "user" },
      gesture: "oauth",
      byCaller: true,
      administrators: [],
      administratorNames: "",
      entersKey: false,
      url: "https://acme.example.test/connect/crm?space=me&access=oauth",
      team: null,
    }
    const none = refusalFromPlan(plan, "Acme", { reason: "no_account", said: "No Crm account of yours is connected." })
    expect([none.message, none.details]).toEqual([
      "No Crm account of yours is connected. Crm also opens by another access, key (Key of the organization), which the link offers too. Ask the user to authorize Crm, then call again: open https://acme.example.test/connect/crm?space=me&access=oauth",
      { reason: "no_account", gesture: "oauth", connector: "crm", access: KEY_OR_SIGN_IN.signIn, space: "me", url: plan.url },
    ])
    const again = refusalFromPlan(plan, "Acme", { reason: "reconnect", said: "Your Crm consent expired." })
    expect(again.message).not.toContain("also opens by")
  })
})
