// @vitest-environment node
import { execFileSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { describe, expect, it } from "vitest"
import { catchAll, hookMigrations, MANAGED, runCli } from "../../scripts/supabase-auth-settings.mjs"

// Tâche M17 : les réglages d'Auth d'un projet Supabase par l'API de gestion, sans réseau (`fetch`
// simulé, projets en mémoire). Seul le refus sans jeton lance le vrai script, qui s'arrête avant
// toute requête.

const script = path.resolve(__dirname, "../../scripts/supabase-auth-settings.mjs")
const migrationsDir = path.resolve(__dirname, "../../packages/plateforme/migrations")
const TARGET = "targettargettargetaa"
const SOURCE = "sourcesourcesourceaa"
/**
 * Les migrations du paquet qui créent `platform.hook_before_user_created`, lues dans son dossier :
 * `20260924110000` (E02-S01), puis la ligne de base d'E01-S09, sans retoucher ces tests.
 */
const HOOK_MIGRATIONS = hookMigrations(migrationsDir)
const SITE = "https://erp.example.test"
const REDIRECT = "https://erp.example.test/**"
const ARGS = ["--to", TARGET, "--site-url", SITE, "--redirect", REDIRECT]

type Config = Record<string, unknown>
type Call = { method: string; ref: string; path: string; body?: Config }

const hex = () => randomBytes(16).toString("hex")
// Construit à l'exécution : un jeton écrit en littéral serait un faux secret dans le dépôt.
const token = ["sbp", hex()].join("_")

/** Notre projet : chaque réglage géré à sa valeur, plus un SMTP, des limites de débit, des secrets. */
function ourProject(): Config {
  return {
    ...Object.fromEntries(MANAGED.filter((setting) => "value" in setting).map(({ key, value }) => [key, value])),
    smtp_host: "smtp.example.test",
    smtp_port: "587",
    smtp_user: "sender@example.test",
    smtp_admin_email: "no-reply@example.test",
    smtp_sender_name: "Plateforme",
    smtp_pass: hex(),
    smtp_max_frequency: 5,
    rate_limit_email_sent: 3000,
    rate_limit_verify: 3000,
    rate_limit_token_refresh: 5000,
    security_captcha_secret: hex(),
    site_url: "https://source.example.test",
    uri_allow_list: "https://source.example.test/**,https://*.source.example.test/**",
    external_google_enabled: false,
    external_google_client_id: null,
    external_google_secret: null,
    external_azure_enabled: false,
    external_azure_client_id: null,
    external_azure_secret: null,
  }
}

/** Un projet neuf, aux valeurs par défaut de Supabase. */
function freshProject(overrides: Config = {}): Config {
  return {
    disable_signup: false,
    hook_before_user_created_enabled: false,
    hook_before_user_created_uri: null,
    hook_before_user_created_secrets: null,
    mailer_autoconfirm: false,
    mailer_allow_unverified_email_sign_ins: false,
    mailer_otp_exp: 3600,
    mailer_subjects_confirmation: "Confirm Your Signup",
    mailer_templates_confirmation_content: "<h2>Confirm your signup</h2>",
    mailer_subjects_magic_link: "Your Magic Link",
    mailer_templates_magic_link_content: "<h2>Magic Link</h2>",
    jwt_exp: 3600,
    sessions_single_per_user: false,
    oauth_server_enabled: false,
    oauth_server_allow_dynamic_registration: false,
    oauth_server_authorization_path: null,
    smtp_host: null,
    smtp_port: null,
    smtp_user: null,
    smtp_admin_email: null,
    smtp_sender_name: null,
    smtp_pass: null,
    smtp_max_frequency: 60,
    rate_limit_email_sent: 2,
    rate_limit_verify: 30,
    rate_limit_token_refresh: 150,
    password_min_length: 6,
    site_url: "http://localhost:3000",
    uri_allow_list: "",
    external_google_enabled: false,
    external_google_client_id: null,
    external_google_secret: null,
    external_azure_enabled: false,
    external_azure_client_id: null,
    external_azure_secret: null,
    ...overrides,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/**
 * L'API de gestion simulée : `GET` et `PATCH` de `config/auth` sur des projets en mémoire (un `PATCH`
 * fusionne ses clés, comme l'API), `GET database/migrations` rend les versions `applied`. Avec
 * `patchStatus`, l'envoi échoue et répond `patchBody`.
 */
function managementApi(projects: Record<string, Config>, options: { applied?: string[]; patchStatus?: number; patchBody?: unknown } = {}) {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    const [, ref = "", route = ""] = /^https:\/\/api\.supabase\.com\/v1\/projects\/([a-z]{20})\/(.+)$/.exec(url) ?? []
    const method = init?.method ?? "GET"
    // `JSON.parse` rend `any` : le script n'envoie que l'objet des réglages qui changent.
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Config) : undefined
    calls.push({ method, ref, path: route, body })
    if (route === "database/migrations") return json((options.applied ?? HOOK_MIGRATIONS).map((version) => ({ version, name: "platform" })))
    if (!(ref in projects)) return json({ message: "Project not found" }, 404)
    if (method === "PATCH" && options.patchStatus) return json(options.patchBody ?? {}, options.patchStatus)
    if (method === "PATCH") Object.assign(projects[ref], body)
    return json(projects[ref])
  }
  return { fetch, calls }
}

async function run(argv: string[], api: ReturnType<typeof managementApi>) {
  const lines: string[] = []
  const out = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) }
  const code = await runCli(argv, { env: { SUPABASE_ACCESS_TOKEN: token }, fileTexts: [], fetch: api.fetch, migrationsDir, out })
  return { code, text: lines.join("\n") }
}

describe("auth:settings without --apply", () => {
  it("should show every managed setting of the target, current and wanted, and nothing else, without writing", async () => {
    const target = freshProject({ uri_allow_list: "http://localhost:3000/**,**", sessions_single_per_user: true })
    const before = structuredClone(target)
    const api = managementApi({ [TARGET]: target })

    const { code, text } = await run(ARGS, api)

    expect(code).toBe(0)
    expect(api.calls.every((call) => call.method === "GET")).toBe(true)
    expect(target).toEqual(before)
    const shownKeys = [...text.matchAll(/^ {2}(?:à changer|déjà réglé|laissé) +(\S+) : /gm)].map((match) => match[1])
    expect(shownKeys).toEqual([...MANAGED.map(({ key }) => key), "site_url", "uri_allow_list", "external_google_enabled", "external_azure_enabled"])
    expect(shownKeys.filter((key) => /^rate_limit_|^smtp_max_frequency$|secret|_pass$|client_id/.test(key))).toEqual([])
    expect(text).toContain("  à changer   hook_before_user_created_enabled : false → true (fiche D1 B, E02-S01, H11)")
    expect(text).toContain("  déjà réglé  jwt_exp : 3600")
    // Une seule session par personne débrancherait les assistants à chaque connexion : le réglage est ramené à faux.
    expect(text).toContain("  à changer   sessions_single_per_user : true → false")
    expect(text).toContain("  déjà réglé  mailer_allow_unverified_email_sign_ins : false")
    expect(text).toContain("  laissé      smtp_host : null (copié de --from seulement)")
    expect(text).toContain(`  à changer   site_url : "http://localhost:3000" → "${SITE}"`)
    expect(text).toContain("Relancez avec --apply pour les écrire.")
    expect(text).toContain('Retirer des adresses de retour le motif attrape-tout "**" (E02-S01 N2).')
    expect(text).toContain(`https://${TARGET}.supabase.co/auth/v1/callback`)
  })
})

describe("auth:settings --apply", () => {
  it("should send a single PATCH with only the managed settings that change, then read them back", async () => {
    const target = freshProject({
      jwt_exp: 7200,
      mailer_allow_unverified_email_sign_ins: true,
      external_google_client_id: "google-client",
      external_google_secret: hex(),
    })
    const api = managementApi({ [SOURCE]: ourProject(), [TARGET]: target })

    const { code, text } = await run([...ARGS, "--from", SOURCE, "--apply"], api)

    expect(code).toBe(0)
    const patches = api.calls.filter((call) => call.method === "PATCH")
    expect(patches).toHaveLength(1)
    expect(patches[0].ref).toBe(TARGET)
    const changed = [
      "hook_before_user_created_enabled",
      "hook_before_user_created_uri",
      "mailer_allow_unverified_email_sign_ins",
      "mailer_otp_exp",
      "mailer_subjects_confirmation",
      "mailer_templates_confirmation_content",
      "mailer_subjects_magic_link",
      "mailer_templates_magic_link_content",
      "jwt_exp",
      "oauth_server_enabled",
      "oauth_server_allow_dynamic_registration",
      "oauth_server_authorization_path",
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "smtp_admin_email",
      "smtp_sender_name",
      "site_url",
      "uri_allow_list",
      "external_google_enabled",
    ]
    expect(Object.keys(patches[0].body ?? {}).sort()).toEqual([...changed].sort())
    expect(patches[0].body).toMatchObject({
      hook_before_user_created_uri: "pg-functions://postgres/platform/hook_before_user_created",
      mailer_allow_unverified_email_sign_ins: false,
      jwt_exp: 3600,
      oauth_server_authorization_path: "/oauth/consent",
      smtp_port: "587",
      external_google_enabled: true,
    })
    expect(api.calls.at(-1)).toMatchObject({ method: "GET", ref: TARGET, path: "config/auth" })
    expect(text).toContain(`${changed.length} réglage(s) écrit(s), relu(s) et confirmé(s).`)
  })

  it("should take the site address and the redirect patterns from the parameters only, never from the reference project", async () => {
    const target = freshProject({ uri_allow_list: "http://localhost:3000/**" })
    const api = managementApi({ [SOURCE]: ourProject(), [TARGET]: target })

    expect((await run([...ARGS, "--from", SOURCE, "--apply"], api)).code).toBe(0)

    expect(target.site_url).toBe(SITE)
    expect(target.uri_allow_list).toBe(`http://localhost:3000/**,${REDIRECT}`)
    expect(JSON.stringify(api.calls.filter((call) => call.method === "PATCH"))).not.toContain("source.example.test")
  })

  it("should write nothing while the package migration that creates the hook function is missing on the target", async () => {
    const target = freshProject()
    const before = structuredClone(target)
    const api = managementApi({ [TARGET]: target }, { applied: ["20260101000000"] })

    const { code, text } = await run([...ARGS, "--apply"], api)

    // Le dossier du paquet porte une migration qui crée la fonction, sous une forme que le script lit.
    expect(HOOK_MIGRATIONS).not.toEqual([])
    expect(code).toBe(1)
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false)
    expect(target).toEqual(before)
    expect(text).toContain(`aucune migration du paquet qui crée sa fonction (${HOOK_MIGRATIONS.join(", ")}) n'est appliquée sur ${TARGET}`)
  })

  it("should print neither the token nor a secret of either project, even when the write is refused", async () => {
    const source = ourProject()
    const target = freshProject({
      smtp_pass: hex(),
      external_azure_client_id: "azure-client",
      external_azure_secret: hex(),
      hook_before_user_created_secrets: `v1,${hex()}`,
    })
    const api = managementApi(
      { [SOURCE]: source, [TARGET]: target },
      { patchStatus: 500, patchBody: { message: `refused ${token} ${String(target.smtp_pass)}` } },
    )

    const { code, text } = await run([...ARGS, "--from", SOURCE, "--apply"], api)

    expect(code).toBe(1)
    const secrets = {
      token,
      sourceSmtpPass: source.smtp_pass,
      sourceCaptchaSecret: source.security_captcha_secret,
      targetSmtpPass: target.smtp_pass,
      targetAzureSecret: target.external_azure_secret,
      targetHookSecret: target.hook_before_user_created_secrets,
    }
    expect(Object.entries(secrets).filter(([, value]) => typeof value === "string" && text.includes(value)).map(([name]) => name)).toEqual([])
  })
})

describe("auth:settings arguments and token", () => {
  it("should refuse without a token, say how to get one, and exit 1 before any request", () => {
    let result: { status: number; stdout: string; stderr: string }
    try {
      // Vide dans l'environnement du processus, elle masque `.env.local` (`resolveVariables`).
      const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "" }
      result = { status: 0, stdout: execFileSync(process.execPath, [script, ...ARGS], { encoding: "utf8", stdio: "pipe", env }), stderr: "" }
    } catch (error) {
      // execFileSync lève sur un code non nul ; l'erreur porte status, stdout et stderr du processus.
      result = error as { status: number; stdout: string; stderr: string }
    }

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Variables manquantes : SUPABASE_ACCESS_TOKEN")
    expect(result.stderr).toContain("Account → Access Tokens")
    expect(result.stdout).toBe("")
  })

  it.each(["**", "https://*/**", "http://*:3000/**", "https://*.com/**", "https://**.fr/**", `${SITE},https://evil.example/**`])(
    "should refuse the redirect pattern %s before any request (E02-S01 N2)",
    async (pattern) => {
      const api = managementApi({})

      const { code, text } = await run(["--to", TARGET, "--site-url", SITE, "--redirect", pattern], api)

      expect(code).toBe(1)
      expect(api.calls).toEqual([])
      expect(text).toContain("--redirect refusé")
    },
  )

  it.each(["http://*.localhost:3000/**", "https://*.example.test/**", `${SITE}/auth/confirm`])(
    "should take %s for an address of the application, not a catch-all",
    (pattern) => {
      expect(catchAll(pattern)).toBe(false)
    },
  )
})
