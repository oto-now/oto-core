/**
 * comments notify — envoie l'email groupé des commentaires (parcours 5.4) : à chaque personne qu'un commentaire
 * concerne et qui lit encore la page, un seul email par heure au plus, toutes pages de l'organisation confondues, qui
 * réunit ce qui est arrivé depuis son précédent email. L'hôte la lance chaque heure de sa tâche planifiée, sur une
 * connexion d'administration, par son relais SMTP (`mail.mjs`). Qui est prévenu, la fenêtre d'une heure et le modèle
 * sont dans `comments-mail.mjs` ; ici, la lecture de la base, l'envoi et son état (`comment_mails`,
 * `comment_mail_items`). Relancée, elle n'envoie rien en double ; un envoi en échec laisse ses commentaires au passage
 * suivant et s'écrit au journal de l'équipe plateforme (`admin_journal`), sans adresse. Rien du mot de passe de la base
 * ni du relais n'est jamais écrit. TLS sauf `sslmode` écrit dans l'URL (`ssl-option.mjs`).
 */
import postgres from 'postgres'
import { commentsDigestMail, dueBefore, isDue, linkOrigin, recipientsOf } from './comments-mail.mjs'
import { failureCode, relaySettings, smtpTransport } from './mail.mjs'
import { mask, urlPassword } from './masking.mjs'
import { sslOption } from './ssl-option.mjs'

/** La ligne du journal de l'équipe plateforme pour un envoi en échec. */
const NOTIFY = { method: 'cli', tool: 'comments', op: 'notify' }

/**
 * Les commentaires qui peuvent encore prévenir quelqu'un, du plus ancien au plus récent : ceux d'un fil ouvert, sur une
 * page hors corbeille (un commentaire supprimé n'a plus de ligne). Avec chacun, ce que `recipientsOf` lit : s'il ouvre
 * son fil, les auteurs qui le précèdent, et les responsables de l'équipe propriétaire de la page (le propriétaire
 * effectif, porté par la page ou par son ancêtre le plus proche, comme `platform.node_owner`, que cette connexion sans
 * personne ne peut pas appeler).
 * @param {import('postgres').Sql} sql
 */
function readComments(sql) {
  return sql`
    select c.id, c.org_id, c.author, c.mentions::text[] as mentions, c.text, c.via_assistant,
           t.created_by as thread_author, n.id as node_id, n.path, n.title,
           not exists (select 1 from platform.comments e where e.thread_id = c.thread_id and (e.created_at, e.id) < (c.created_at, c.id)) as first,
           coalesce((select array_agg(distinct e.author::text) from platform.comments e
                      where e.thread_id = c.thread_id and e.author is not null and (e.created_at, e.id) < (c.created_at, c.id)), '{}') as earlier_authors,
           coalesce((select array_agg(tm.user_id::text) from platform.team_members tm
                      where tm.role = 'lead'
                        and tm.team_id = (select a.owner_team_id from platform.nodes a
                                           where a.org_id = n.org_id and a.lpath operator(extensions.@>) n.lpath and a.owner_kind is not null
                                           order by extensions.nlevel(a.lpath) desc limit 1)), '{}') as team_leads
      from platform.comments c
      join platform.comment_threads t on t.id = c.thread_id and t.status = 'open'
      join platform.nodes n on n.id = t.node_id and n.org_id = t.org_id and n.deleted_at is null
     order by c.created_at, c.id`
}

/**
 * Ce qui reste à envoyer, par personne et par organisation : chaque commentaire lu, pour chacun de ses destinataires
 * (`recipientsOf`), sauf ceux qui l'ont déjà reçu (`comment_mail_items`).
 * @param {import('postgres').Sql} sql
 * @returns {Promise<Map<string, { orgId: string, userId: string, comments: any[] }>>}
 */
async function pendingByPerson(sql) {
  const comments = await readComments(sql)
  if (comments.length === 0) return new Map()
  const sent = await sql`select comment_id, user_id from platform.comment_mail_items where comment_id = any(${comments.map((comment) => comment.id)}::uuid[])`
  const already = new Set(sent.map((item) => `${item.comment_id}:${item.user_id}`))
  const pending = new Map()
  for (const comment of comments) {
    const recipients = recipientsOf({
      author: comment.author,
      mentions: comment.mentions,
      first: comment.first,
      threadAuthor: comment.thread_author,
      earlierAuthors: comment.earlier_authors,
      teamLeads: comment.team_leads,
    })
    for (const userId of recipients.filter((person) => !already.has(`${comment.id}:${person}`))) {
      const key = `${comment.org_id}:${userId}`
      const person = pending.get(key) ?? { orgId: comment.org_id, userId, comments: [] }
      person.comments.push(comment)
      pending.set(key, person)
    }
  }
  return pending
}

/**
 * Ce que l'envoi lit de plus, en trois requêtes pour toutes les personnes : les membres (email, nom d'annuaire comme
 * `platform.member_directory`, dernier email), qui lit encore quelle page (`platform.node_level_of`, le niveau que la
 * RLS des commentaires applique : 1 au moins), et chaque organisation (nom, logo, adresses).
 * @param {import('postgres').Sql} sql
 * @param {{ orgId: string, userId: string, comments: any[] }[]} people
 */
async function readFacts(sql, people) {
  const orgIds = [...new Set(people.map((person) => person.orgId))]
  const authors = people.flatMap((person) => person.comments.map((comment) => comment.author)).filter((author) => author !== null)
  const personIds = [...new Set([...people.map((person) => person.userId), ...authors])]
  const pairs = [...new Set(people.flatMap((person) => person.comments.map((comment) => `${comment.node_id}:${person.userId}`)))].map((pair) => pair.split(':'))
  const [members, reading, orgs] = await Promise.all([
    sql`
      select m.org_id, m.user_id, m.email, coalesce(nullif(m.profile ->> 'name', ''), nullif(m.name, ''), split_part(m.email, '@', 1)) as name,
             s.sent_at, s.sent_at::text as sent_at_text
        from platform.members m
        left join platform.comment_mails s on s.org_id = m.org_id and s.user_id = m.user_id
       where m.org_id = any(${orgIds}::uuid[]) and m.user_id = any(${personIds}::uuid[])`,
    sql`
      select p.node_id, p.user_id
        from unnest(${pairs.map(([nodeId]) => nodeId)}::uuid[], ${pairs.map(([, userId]) => userId)}::uuid[]) as p(node_id, user_id)
        join platform.nodes n on n.id = p.node_id
       where platform.node_level_of(p.user_id, n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1`,
    sql`
      select o.id, o.slug, o.name, o.brand ->> 'logo_url' as logo_url,
             coalesce((select array_agg(d.host) from platform.org_domains d where d.org_id = o.id), '{}') as hosts
        from platform.orgs o where o.id = any(${orgIds}::uuid[])`,
  ])
  return {
    members: new Map(members.map((member) => [`${member.org_id}:${member.user_id}`, member])),
    reads: new Set(reading.map((row) => `${row.node_id}:${row.user_id}`)),
    orgs: new Map(orgs.map((org) => [org.id, org])),
  }
}

/**
 * Prend l'heure d'une personne : `comment_mails` passe à `now` si son dernier email laisse partir le suivant
 * (`dueBefore`), en une instruction. Sans ligne rendue, un autre passage vient de la servir, ou elle n'est plus membre :
 * rien ne part. C'est ce qui tient « un par heure » entre deux commandes lancées ensemble.
 */
async function claimHour(sql, { orgId, userId }, now) {
  const claimed = await sql`
    insert into platform.comment_mails as s (org_id, user_id, sent_at)
    select m.org_id, m.user_id, ${now}::timestamptz from platform.members m where m.org_id = ${orgId} and m.user_id = ${userId}
    on conflict (org_id, user_id) do update set sent_at = excluded.sent_at where s.sent_at <= ${dueBefore(now)}::timestamptz
    returning user_id`
  return claimed.length > 0
}

/**
 * Un envoi en échec : l'heure de la personne revient à ce qu'elle était (ses commentaires partiront au passage
 * suivant, aucun n'est marqué), et l'échec s'écrit au journal de l'équipe plateforme, la personne par son identifiant,
 * l'erreur par son seul code (`failureCode`) : ni adresse, ni message du relais.
 */
async function recordFailure(sql, { person, previous, now, error, started }) {
  const { orgId, userId } = person
  if (previous === null) await sql`delete from platform.comment_mails where org_id = ${orgId} and user_id = ${userId} and sent_at = ${now}::timestamptz`
  else await sql`update platform.comment_mails set sent_at = ${previous}::text::timestamptz where org_id = ${orgId} and user_id = ${userId} and sent_at = ${now}::timestamptz`
  const line = { org_id: orgId, ...NOTIFY, target: `user:${userId}`, is_error: true, error: failureCode(error), duration_ms: Date.now() - started }
  await sql`insert into platform.admin_journal ${sql(line)}`
}

/**
 * Marque les commentaires envoyés à une personne. Un commentaire supprimé entre-temps, ou une personne qui n'est plus
 * membre, n'écrit aucune ligne (lecture jointe, jamais une clé refusée) ; un commentaire déjà marqué reste tel quel.
 */
function markSent(sql, { orgId, userId }, commentIds, now) {
  return sql`
    insert into platform.comment_mail_items (comment_id, user_id, org_id, sent_at)
    select c.id, m.user_id, c.org_id, ${now}::timestamptz
      from platform.comments c join platform.members m on m.org_id = c.org_id and m.user_id = ${userId}
     where c.org_id = ${orgId} and c.id = any(${commentIds}::uuid[])
    on conflict do nothing`
}

/**
 * Le service : un passage. Pour chaque personne qui a des commentaires à recevoir, lisibles par elle aujourd'hui, et
 * dont l'heure est passée : un email, puis ses commentaires marqués. Rend le compte du passage ; un échec d'envoi est
 * compté et nommé sur `printError`, jamais levé. `send` : l'envoi par le relais, ou un transport de capture.
 * @param {{ sql: import('postgres').Sql, send: (mail: { to: string, subject: string, text: string, html: string }) => Promise<unknown>,
 *   now: Date, printError: (line: string) => void }} deps
 * @returns {Promise<{ mails: number, comments: number, failures: number }>}
 */
export async function notifyComments({ sql, send, now, printError }) {
  const report = { mails: 0, comments: 0, failures: 0 }
  const people = [...(await pendingByPerson(sql)).values()]
  if (people.length === 0) return report
  const { members, reads, orgs } = await readFacts(sql, people)
  const withoutAddress = new Set()
  for (const person of people) {
    const member = members.get(`${person.orgId}:${person.userId}`)
    const org = orgs.get(person.orgId)
    const readable = person.comments.filter((comment) => reads.has(`${comment.node_id}:${person.userId}`))
    if (!member?.email || !org || readable.length === 0 || !isDue(member.sent_at, now)) continue
    const origin = linkOrigin(org.hosts)
    if (origin === null) {
      withoutAddress.add(org.slug)
      continue
    }
    const lines = readable.map((comment) => ({
      title: comment.title,
      path: comment.path,
      author: comment.author === null ? null : (members.get(`${person.orgId}:${comment.author}`)?.name ?? null),
      viaAssistant: comment.via_assistant,
      text: comment.text,
    }))
    const started = Date.now()
    if (!(await claimHour(sql, person, now))) continue
    try {
      await send(commentsDigestMail({ to: member.email, orgName: org.name, logoUrl: org.logo_url, origin, lines }))
    } catch (error) {
      await recordFailure(sql, { person, previous: member.sent_at_text, now, error, started })
      report.failures += 1
      printError(`comments notify : envoi en échec pour une personne de ${org.slug} (${failureCode(error)}) ; ses commentaires partiront au passage suivant.`)
      continue
    }
    await markSent(sql, person, readable.map((comment) => comment.id), now)
    report.mails += 1
    report.comments += readable.length
  }
  for (const slug of withoutAddress) printError(`comments notify : l'organisation ${slug} n'a aucune adresse (org_domains) : ses commentaires attendent.`)
  return report
}

const UNREADABLE_RELAY = "comments notify : PLATFORM_SMTP_URL n'est pas une adresse smtp:// ou smtps:// lisible"

/**
 * La commande. `connect` : le client postgres.js ; `transport` : le relais ; `now` : l'heure du passage (tous trois
 * remplacés par les tests). Rend le code de sortie : 0 passage fait, ou hôte sans relais (dit, rien n'est marqué) ;
 * 1 un envoi en échec, relais illisible, base injoignable.
 * @param {{ dbUrl: string, env: Record<string, string | undefined>, print: (line: string) => void, printError: (line: string) => void,
 *   connect?: typeof postgres, transport?: { sendMail(message: object): Promise<unknown> }, now?: Date }} options
 */
export async function commentsNotifyCommand({ dbUrl, env, print, printError, connect = postgres, transport, now = new Date() }) {
  const relay = relaySettings(env)
  if ('missing' in relay) {
    print(`comments notify : aucun relais d'envoi (${relay.missing.join(', ')} absente(s) de l'environnement) : aucun email envoyé, rien n'est marqué comme envoyé.`)
    return 0
  }
  const smtp = 'unreadable' in relay ? null : (transport ?? smtpTransport(relay.url))
  if ('unreadable' in relay || !smtp) {
    printError(UNREADABLE_RELAY)
    return 1
  }
  const secrets = [urlPassword(dbUrl), urlPassword(relay.url)]
  const sql = connect(dbUrl, { max: 1, ...sslOption(dbUrl), connection: { application_name: 'oto-platform comments notify' } })
  try {
    const report = await notifyComments({ sql, send: (mail) => smtp.sendMail({ ...mail, from: relay.from }), now, printError })
    print(`comments notify : ${report.mails} email(s) envoyé(s), ${report.comments} commentaire(s), ${report.failures} échec(s).`)
    return report.failures > 0 ? 1 : 0
  } catch (error) {
    printError(mask(`comments notify : ${error?.message ?? error}`, secrets))
    return 1
  } finally {
    await sql.end({ timeout: 5 }).catch((error) => printError(mask(`comments notify : connexion mal fermée : ${error?.message ?? error}`, secrets)))
  }
}
