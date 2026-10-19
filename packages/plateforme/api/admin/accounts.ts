// `POST admin/accounts`, `POST admin/accounts/<id>/disable` et `POST admin/accounts/<id>/secret` du tableau de bord
// (E08-S03, AC6, AC7, AC10 ; comptes à plusieurs champs) : créer un compte, désactiver un compte, poser le secret et
// les réglages d'un compte réel ; `GET admin/accounts/<id>/share-journal` : le journal des partages d'un compte, pour
// qui le gère (partage des comptes) ; `POST admin/account-rules` et `DELETE admin/account-rules/<id>` : poser ou
// remplacer, puis retirer, le partage d'un compte, pour qui le gère (l'écran Connecteurs ouvert aux membres : le
// propriétaire d'un compte personnel y partage le sien). Adaptateur mince : la validation, les droits et l'écriture sont
// dans `createAccount`, `disableAccount`, `setAccountSecret`, `listAccountShareJournal`, `setAccountRule` et
// `removeAccountRule` ; la route n'ajoute qu'une règle, un compte d'organisation ou d'équipe seulement à la création
// (N11). Le secret arrive sous la clé `secret` du corps, que le journal masque entière ; la réponse ne le rend jamais.
import { createAccountSchema, setAccountRuleSchema } from "../../schemas"
import { listAccountShareJournal } from "../../server/account-share-journal"
import { setAccountSecret } from "../../server/connectors/account-secret"
import { createAccount, disableAccount } from "../../server/connectors/accounts"
import { PlatformError } from "../../server/errors"
import { clip, MAX_TARGET_CHARS } from "../../server/journal"
import { removeAccountRule, setAccountRule } from "../../server/rules"
import type { Route } from "../handler"
import { idOrNull } from "../ids"

/** Un compte personnel se crée par son propriétaire, jamais depuis le tableau de bord (E04-S01 N15, N11). */
const PERSONAL_REFUSED = "A personal account is created by its owner, not from the dashboard: use owner_kind org or team."

function isPersonal(body: unknown): boolean {
  return typeof body === "object" && body !== null && "owner_kind" in body && body.owner_kind === "user"
}

export const accountCreationRoute: Route = {
  params: 1,
  fixed: { 0: "accounts" },
  // Sur un refus, le libellé du corps, tel qu'envoyé : par `clip`, car une moitié de paire de
  // substitution ferait refuser par PostgREST la ligne du refus (`supabase-patterns.md § Error Handling`).
  target: ({ body }) => {
    const parsed = createAccountSchema.safeParse(body)
    return parsed.success ? clip(parsed.data.label, MAX_TARGET_CHARS) : null
  },
  async handle({ db, identity, body }) {
    if (isPersonal(body)) throw new PlatformError("invalid_arguments", PERSONAL_REFUSED)
    const account = await createAccount(db, identity, body)
    return { status: 200, data: { account }, journal: { target: account.label, teamId: account.owner.teamId } }
  },
}

export const accountDisablingRoute: Route = {
  params: 3,
  fixed: { 0: "accounts", 2: "disable" },
  target: ({ params }) => idOrNull(params[1]),
  async handle({ db, identity, params }) {
    const account = await disableAccount(db, identity, { account_id: params[1] })
    return { status: 200, data: { account }, journal: { target: account.id, teamId: account.owner.teamId } }
  },
}

export const accountSecretRoute: Route = {
  params: 3,
  fixed: { 0: "accounts", 2: "secret" },
  target: ({ params }) => idOrNull(params[1]),
  async handle({ db, identity, params, body }) {
    const account = await setAccountSecret(db, identity, { account_id: params[1], input: body })
    return { status: 200, data: { account }, journal: { target: account.id, teamId: account.owner.teamId } }
  },
}

export const accountShareJournalRoute: Route = {
  params: 3,
  fixed: { 0: "accounts", 2: "share-journal" },
  async handle({ db, identity, params }) {
    const journal = await listAccountShareJournal(db, identity, params[1])
    return { status: 200, data: journal }
  },
}

/**
 * Pose ou remplace la règle d'un sujet (une équipe, une personne, toute l'organisation) sur un compte : le corps est celui
 * de `setAccountRuleSchema`, comme `POST rules` pour un nœud. 201 pour une règle nouvelle, 200 pour un niveau remplacé.
 */
export const accountRuleSettingRoute: Route = {
  params: 1,
  fixed: { 0: "account-rules" },
  target: ({ body }) => {
    const parsed = setAccountRuleSchema.safeParse(body)
    return parsed.success ? parsed.data.accountId : null
  },
  async handle({ db, identity, body }) {
    const { data, target, teamId } = await setAccountRule(db, identity, body)
    return { status: data.created ? 201 : 200, data: { rule: data }, journal: { target, teamId } }
  },
}

/** Retire une règle d'un compte, par son identifiant, comme `DELETE rules/<id>` pour un nœud. */
export const accountRuleRemovalRoute: Route = {
  params: 2,
  fixed: { 0: "account-rules" },
  target: ({ params }) => idOrNull(params[1]),
  async handle({ db, identity, params }) {
    const { data, target, teamId } = await removeAccountRule(db, identity, params[1])
    return { status: 200, data: { rule: data }, journal: { target, teamId } }
  },
}
