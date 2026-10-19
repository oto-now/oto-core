// @vitest-environment node
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const script = path.resolve(__dirname, "../../scripts/check-migrations.mjs")

let dir: string

function check(sql: string) {
  const file = path.join(dir, `fixture-${Math.random().toString(36).slice(2)}.sql`)
  fs.writeFileSync(file, sql)
  try {
    const stdout = execFileSync(process.execPath, [script, "--file", file], { encoding: "utf8", stdio: "pipe" })
    return { status: 0, stdout }
  } catch (error) {
    // execFileSync lève sur un code non nul ; l'erreur porte status et stdout du processus.
    const failed = error as { status: number; stdout: string }
    return { status: failed.status, stdout: failed.stdout }
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-migrations-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("check-migrations", () => {
  it("should reject a table created in public", () => {
    const result = check("create table public.items (id uuid primary key);\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 table-outside-platform/)
  })

  it("should reject a dropped column", () => {
    const result = check("alter table platform.orgs drop column name;\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 drop-column/)
  })

  it("should reject a dropped table", () => {
    const result = check("drop table platform.orgs;\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 drop/)
  })

  it("should reject a rename", () => {
    const result = check("alter table platform.orgs rename column name to title;\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 rename/)
  })

  it("should reject set not null", () => {
    const result = check("alter table platform.orgs alter column name set not null;\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 set-not-null/)
  })

  // Une colonne qui devient facultative admet toute ligne qu'elle admettait (le fichier en transit, sans nœud).
  it("should accept drop not null, and still reject a dropped default or column in the same statement", () => {
    expect(check("alter table platform.files alter column node_id drop not null;\n")).toMatchObject({ status: 0 })
    const mixed = check("alter table platform.files alter column node_id drop not null, alter column name drop default, drop column mime;\n")
    expect(mixed.status).toBe(1)
    expect(mixed.stdout.match(/\.sql:1 (drop|drop-column)$/gm)).toEqual([".sql:1 drop", ".sql:1 drop-column"])
  })

  it("should reject a column type change", () => {
    const result = check("alter table platform.orgs alter column name type varchar(80);\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 alter-column-type/)
  })

  // `anon` a l'usage du schéma `platform` depuis E02-S01 : une fonction qui garde l'`EXECUTE` par
  // défaut de `public` serait appelable sans session.
  it("should reject a platform function whose EXECUTE is not revoked from public", () => {
    const result = check(
      [
        "create or replace function platform.visible() returns int language sql as $$ select 1 $$;",
        "grant execute on function platform.visible() to authenticated;",
        "",
      ].join("\n"),
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 function-execute-not-revoked/)
  })

  it("should reject a revoke that names anon but not public", () => {
    const result = check(
      [
        "create function platform.visible(p uuid) returns int language sql as $$ select 1 $$;",
        "revoke execute on function platform.visible(uuid) from anon;",
        "",
      ].join("\n"),
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 function-execute-not-revoked/)
  })

  it("should accept functions revoked from public in a list, and a trigger function without revoke", () => {
    const result = check(
      [
        "create function platform.first(p uuid, q text) returns table (id uuid) language sql as $$ select p $$;",
        "create function platform.second() returns int language sql as $$ select 1 $$;",
        "revoke execute on function platform.first(uuid, text), platform.second() from public, anon;",
        "grant execute on function platform.first(uuid, text) to authenticated;",
        "create function platform.guard() returns trigger language plpgsql as $$ begin return new; end $$;",
        "",
      ].join("\n"),
    )
    expect(result.stdout).toContain("1 fichier(s) conforme(s)")
    expect(result.status).toBe(0)
  })

  it("should accept a compliant file with comments and drop-before-recreate", () => {
    const result = check(
      [
        "-- Migration : fixture",
        "create schema if not exists platform;",
        "create extension if not exists ltree with schema extensions;",
        "create table platform.items (id uuid primary key, label text not null default 'drop; rename');",
        "create index idx_items_label on platform.items (label);",
        "alter table platform.items enable row level security;",
        "drop policy if exists items_select_all on platform.items;",
        "create policy items_select_all on platform.items for select to authenticated using (true);",
        "-- ROLLBACK:",
        "-- drop table if exists platform.items;",
        "",
      ].join("\n"),
    )
    expect(result.stdout).toContain("1 fichier(s) conforme(s)")
    expect(result.status).toBe(0)
  })

  // E01-S06 (AC2, N16) : une contrainte CHECK remplacée par une autre du même nom, dans la même
  // instruction et sans `if exists`, est admise ; tout autre retrait de contrainte reste refusé.
  it("should accept a check constraint replaced by one of the same name in the same statement", () => {
    const result = check(
      "alter table platform.nodes drop constraint nodes_kind_check, add constraint nodes_kind_check check (kind in ('page', 'procedure', 'context', 'table'));\n",
    )
    expect(result.stdout).toContain("1 fichier(s) conforme(s)")
    expect(result.status).toBe(0)
  })

  // M26 (fiche D42 B) : une clé étrangère remplacée de même, par une clé du même nom ; sous un autre nom,
  // le retrait reste refusé.
  it("should accept a foreign key replaced by one of the same name in the same statement, and refuse it under another name", () => {
    const replaced = (added: string) =>
      check(
        `alter table platform.accounts drop constraint accounts_owner_team_id_fkey,\n  add constraint ${added} foreign key (owner_team_id) references platform.teams (id) deferrable initially deferred;\n`,
      )
    expect(replaced("accounts_owner_team_id_fkey").status).toBe(0)
    const renamed = replaced("accounts_team_fkey")
    expect(renamed.status).toBe(1)
    expect(renamed.stdout).toMatch(/\.sql:1 drop\n/)
  })

  it("should reject a dropped constraint alone", () => {
    const result = check("alter table platform.nodes drop constraint a;\n")
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/\.sql:1 drop\n/)
  })

  // E01-S09 (AC14) : la ligne de base s'installe sur un Postgres sans Supabase ; une migration
  // nouvelle ne remet ni clé ni lecture vers `auth.users`, ni extension que le Postgres managé de
  // Scaleway refuse. Les trois fonctions propres à Supabase lisent son schéma d'Auth.
  it("should refuse a key to auth.users, a read of auth.users outside the three Supabase functions and an extension outside pg_trgm, unaccent and ltree, naming each (AC14)", () => {
    const result = check(
      [
        "create table platform.items (id uuid primary key, owner uuid references auth.users (id));",
        "create function platform.who(p uuid) returns text language sql as $$ select email from auth.users where id = p $$;",
        "revoke execute on function platform.who(uuid) from public;",
        "update platform.items set owner = null where owner not in (select id from auth.users);",
        "create extension if not exists moddatetime with schema extensions;",
        "create or replace function platform.oauth_pending_resource(p text) returns text language sql as $$ select resource from auth.oauth_authorizations join auth.users on true $$;",
        "revoke execute on function platform.oauth_pending_resource(text) from public;",
        "create extension if not exists unaccent with schema extensions;",
        "",
      ].join("\n"),
    )
    expect(result.status).toBe(1)
    expect(result.stdout.split("\n").filter(Boolean).map((line) => line.replace(/^.*\.sql:/, ""))).toEqual([
      "1 auth-users-foreign-key",
      "2 auth-users-read",
      "4 auth-users-read",
      "5 extension-not-allowed",
    ])
  })

  // Un rôle non superutilisateur ne pose le paramètre d'une bibliothèque que si elle est chargée dans la session :
  // sans l'appel qui la charge, `supabase db push` refuse la fonction sur un projet Supabase (42501).
  it("should refuse a function that sets a pg_trgm parameter before any statement loads the library, and accept it after one", () => {
    const fn = [
      "create function platform.near(p text) returns text language sql",
      `  set search_path to '' set "pg_trgm.similarity_threshold" to '0.3'`,
      "  as $$ select p $$;",
      "revoke execute on function platform.near(text) from public;",
      "",
    ].join("\n")
    const load = "do $$ begin perform extensions.similarity('a', 'a'); end $$;\n"
    const refused = check(fn)
    expect(refused.status).toBe(1)
    expect(refused.stdout).toMatch(/\.sql:1 pg-trgm-parameter-before-load/)
    expect(check(load + fn).status).toBe(0)
    // L'appel placé après la fonction arrive trop tard.
    expect(check(fn + load).stdout).toMatch(/\.sql:1 pg-trgm-parameter-before-load/)
  })

  // Les deux fichiers publiés qui posent le paramètre sans charger la bibliothèque sont exemptés de la règle : la
  // CLI applique tous les fichiers en attente sur une session, et le premier d'entre eux la charge pour eux.
  it("should ship, before every other migration, one that loads the pg_trgm library", () => {
    const migrations = path.resolve(__dirname, "../../packages/plateforme/migrations")
    const [first] = fs.readdirSync(migrations).filter((file) => /^\d{14}_.*\.sql$/.test(file)).sort()
    expect(first).toBe("20260928090000_platform_pg_trgm.sql")
    expect(fs.readFileSync(path.join(migrations, first), "utf8")).toMatch(/^DO \$\$ begin perform extensions\.similarity\('a', 'a'\); end \$\$;$/m)
  })

  it("should accept every migration shipped by the package", () => {
    const stdout = execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" })
    expect(stdout).toContain("conforme(s)")
  })
})
