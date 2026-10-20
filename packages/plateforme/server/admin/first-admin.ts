// Administrateur nommé par l'équipe plateforme (décision du 2026-10-14, `docs/conception/administration-et-cellule.md`) :
// `createOrg` nomme le premier à la création, `addAdmin` (`admin_org add_admin`) en nomme un pour une organisation
// existante. Une règle, deux cas : l'adresse de l'appelant, comparée sans casse à celle de son identité vérifiée, le
// fait membre `admin` tout de suite, sans invitation ni email (`claim_org_admin`) ; une autre adresse reçoit une
// invitation `admin` par `inviteMember`, le service et l'email de l'écran Équipes. Sans ce module, le créateur d'une
// organisation n'en était pas membre et devait s'inviter lui-même pour l'administrer depuis l'application.
import { addAdminSchema, linkOrigin } from "../../schemas"
import type { PlatformDb } from "../db"
import { memberDirectory, sameEmail } from "../directory"
import { fromDatabaseError, inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { inviteMember } from "../invitations"
import { limitedTx } from "../limits"
import { updateMember } from "../members"
import { reachableHost } from "../organisations"
import type { Tx } from "../sql"
import { requireStaffAdmin, type StaffCaller } from "./context"
import { orgHosts } from "./hosts"

/** La place d'administrateur prise : membre ajouté (`joined`), membre promu, ou déjà administrateur (`unchanged`). */
export type AdminSeat = "joined" | "promoted" | "unchanged"

/** Le premier administrateur d'une création, décidé avant elle : l'appelant lui-même, ou une adresse invitée depuis `link`. */
export type FirstAdminPlan = { email: string; self: true } | { email: string; self: false; link: string }

/** Un administrateur nommé : sa place, ou son invitation (lien de l'invitation et fin de validité). */
export type AdminNamed =
  | { email: string; self: boolean; outcome: AdminSeat }
  | { email: string; self: false; outcome: "invited"; link: string; expiresAt: string }

const SEATS: readonly string[] = ["joined", "promoted", "unchanged"] satisfies AdminSeat[]

/**
 * L'origine du lien d'une invitation : une adresse de l'organisation (`reachableHost`, la plus proche de celle du MCP
 * admin appelé), bâtie par `linkOrigin` : `https` sans port, `http` et le port de l'adresse appelée sur le poste local
 * seulement. Le protocole de l'adresse appelée n'est pas lu : `requestOrigin` le prend de `x-forwarded-proto`, qu'un
 * proxy peut transmettre du client. L'invité revient ainsi sur l'adresse de son organisation, comme depuis son écran
 * Équipes (N2 d'E02-S01). Sans adresse, aucune invitation : `invalid_arguments`, avant toute écriture.
 */
export function invitationLink(origin: string, hosts: readonly string[], refusal: string): string {
  const called = new URL(origin)
  const host = reachableHost(hosts, called.hostname)
  if (!host) throw new PlatformError("invalid_arguments", refusal)
  const link = linkOrigin(called.port ? `${host}:${called.port}` : host)
  // Une adresse d'`org_domains` suit le motif d'un nom d'hôte : sans origine, la base porte une adresse illisible.
  if (!link) throw new PlatformError("internal", `invitationLink: address ${host} is not a host name.`)
  return link
}

/**
 * Le premier administrateur d'une création (`createOrg`), décidé avant d'écrire : l'appelant si `email` est le sien,
 * sinon une invitation, qui exige une adresse parmi `hosts`.
 */
export function firstAdminPlan(staff: StaffCaller, email: string, context: { slug: string; hosts: readonly string[]; origin: string }): FirstAdminPlan {
  if (sameEmail(staff.email, email)) return { email, self: true }
  const refusal = `Inviting ${email} needs an address of ${context.slug} to sign in at: pass host, or name yourself with admin_email.`
  return { email, self: false, link: invitationLink(context.origin, context.hosts, refusal) }
}

/** `claim_org_admin` dans la transaction `sql` : l'appelant de l'équipe plateforme membre `admin` de `orgId`. */
export async function claimOrgAdmin(sql: Tx, orgId: string): Promise<AdminSeat> {
  const [row] = await sql<{ seat: string }[]>`select platform.claim_org_admin(${orgId}) as seat`
  if (row && SEATS.includes(row.seat)) return row.seat as AdminSeat
  console.error("[platform] claimOrgAdmin: unexpected result")
  throw new PlatformError("internal", "Internal error.")
}

/**
 * L'invitation `admin` de `email` à l'organisation de l'identité, par `inviteMember` (droits, plafond, email de l'écran
 * Équipes, invitation retirée si l'email ne part pas), le lien ramenant à `link`.
 */
export async function inviteAdmin(db: PlatformDb, identity: Identity, email: string, link: string): Promise<AdminNamed> {
  const { invitation } = await inviteMember(db, identity, { email, role: "admin" }, { redirectTo: `${link}/auth/confirm?next=/` })
  return { email: invitation.email, self: false, outcome: "invited", link, expiresAt: invitation.expiresAt }
}

/**
 * Nomme un administrateur de l'organisation de l'identité (`admin_org add_admin`), réservé au membre de l'équipe
 * plateforme qui l'administre (`requireStaffAdmin`, comme `add_host`), décidé avant toute lecture ; l'appelant est la
 * personne de l'identité (`identity.user`, celle du jeton vérifié). Un membre présent
 * passe `admin` (`updateMember`, le geste de l'écran Équipes ; l'appelant par `claim_org_admin`) ; un administrateur
 * présent ne change pas ; l'appelant absent devient membre `admin` sous la limite `members_max`, que l'équipe
 * plateforme passe en le journalisant ; une autre adresse est invitée `admin`.
 */
export async function addAdmin(db: PlatformDb, identity: Identity, input: unknown, { origin }: { origin: string }): Promise<AdminNamed> {
  const parsed = addAdminSchema.pick({ admin_email: true }).safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireStaffAdmin(identity, "add_admin")
  const email = parsed.data.admin_email
  const self = sameEmail(identity.user.email, email)
  const directory = await memberDirectory(db, identity.org.id)
  const person = directory.find((entry) => (self ? entry.userId === identity.user.id : sameEmail(entry.email, email)))
  if (person?.role === "admin") return { email, self, outcome: "unchanged" }
  if (self) {
    const claim = (sql: Tx) => claimOrgAdmin(sql, identity.org.id)
    const seat = person
      ? await inTransaction(db, "addAdmin: claim_org_admin", claim)
      : await limitedTx(db, identity, "members_max", claim).catch((error: { code?: string }) => {
          throw fromDatabaseError(error, "addAdmin: claim_org_admin")
        })
    return { email, self, outcome: seat }
  }
  if (person) {
    await updateMember(db, identity, person.userId, { role: "admin" })
    return { email, self, outcome: "promoted" }
  }
  const refusal = `Inviting ${email} needs an address of ${identity.org.slug} to sign in at: add one with admin_org {"op": "add_host"} first.`
  return inviteAdmin(db, identity, email, invitationLink(origin, await orgHosts(db, identity.org.id), refusal))
}
