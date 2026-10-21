// @vitest-environment node
import path from "path"
import { describe, expect, it } from "vitest"
import { LOCAL_PORT, localDatabaseName, localUrls } from "../../scripts/lib/test-db-local.mjs"

// Fumée de la base de test locale (M62) : une base par checkout, deux connexions sans mot de passe, et,
// en mode local, les suites de Supabase privées de leurs variables, comme dans le job `bare-postgres`.

const root = path.resolve(__dirname, "../..")
const localMode = process.env.PLATFORM_ADMIN_DATABASE_URL === localUrls(root).admin

describe("local test database", () => {
  it("should name one database per checkout, from its folder", () => {
    expect(localDatabaseName("/apps/oto-platform")).toBe("test_oto_platform")
    expect(localDatabaseName("/tmp/oto-core-export-a5d1")).toBe("test_oto_core_export_a5d1")
  })

  it("should reach the server as platform_app and the tests as postgres, without any password", () => {
    const urls = localUrls("/apps/oto-platform")
    const app = new URL(urls.app)
    const admin = new URL(urls.admin)
    expect([app.username, app.password, app.hostname, app.port, app.pathname]).toEqual(["platform_app", "", "127.0.0.1", String(LOCAL_PORT), "/test_oto_platform"])
    expect([admin.username, admin.password, admin.searchParams.get("sslmode")]).toEqual(["postgres", "", "disable"])
  })

  it.runIf(localMode)("should hide the Supabase variables from the suites in local mode", () => {
    const supabase = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL"]
    expect(supabase.filter((key) => process.env[key])).toEqual([])
    expect(process.env.PLATFORM_DATABASE_URL).toBe(localUrls(root).app)
  })
})
