/**
 * Section `commentaires` de la Démo (parcours 5.4, contrat `DemoSection` d'E01-S05) : deux fils du compte E2E sur
 * la grille tarifaire (posée et publiée par la section `contenu`). Un fil ouvert sur le paragraphe des études, qui en
 * cite un passage ; un fil résolu sur la page entière, avec une réponse.
 *
 * Ce que ça empêche : un contrôle visuel de l'encart « Commentaires » sans fil à lire (ni pastille sur un bloc, ni
 * citation surlignée, ni onglet « Résolus »). Données fictives (ADR-010). Rejouable : un fil dont le premier
 * commentaire est déjà sur la page est laissé tel quel, avec les réponses qu'on y a ajoutées depuis.
 */
import { findNode, maybeOne, must, one } from './publication.mjs'

/**
 * Les champs du contexte d'E01-S05 que cette section lit.
 * @typedef {object} DemoContext
 * @property {import('postgres').Sql} sql  connexion d'administration (`PLATFORM_ADMIN_DATABASE_URL`)
 * @property {{ id: string } | null} org  posé par la section `identite`
 * @property {{ id: string, email: string } | null} e2eUser  posé par la section `identite`
 * @property {(line: string) => void} report
 */

const PAGE = 'conseil/grille_tarifaire'

/** Le passage cité : une sous-chaîne du paragraphe des études de la grille (`scripts/lib/pilot-qualification.mjs`). */
const CITATION = 'Par participant supplémentaire : 250 € HT'

const FIL_OUVERT = { texte: 'Ce tarif vaut-il encore pour les études signées en 2027 ?' }
const FIL_RESOLU = { texte: 'Préciser que le suivi annuel se facture par opération.', reponse: 'Précisé dans la section Accompagnement.' }

/** Le fil de la page dont le premier commentaire porte ce texte, s'il est déjà semé. */
async function filSeme({ sql, org }, nodeId, texte) {
  return maybeOne(
    sql`select t.id from platform.comment_threads t
         where t.org_id = ${org.id} and t.node_id = ${nodeId}
           and exists (select 1 from platform.comments c where c.thread_id = t.id and c.text = ${texte})
         limit 1`,
    'lecture des fils de démonstration',
  )
}

async function commenter({ sql, org, e2eUser }, threadId, texte) {
  await must(sql`insert into platform.comments ${sql({ org_id: org.id, thread_id: threadId, author: e2eUser.id, text: texte })}`, "insertion d'un commentaire de démonstration")
}

/** Le bloc publié de la grille qui porte le passage cité : son identifiant et sa révision, que le fil garde. */
async function blocCite({ sql }, nodeId) {
  const bloc = await maybeOne(
    sql`select id, revision from platform.blocks
         where node_id = ${nodeId} and state = 'published' and type = 'paragraph' and strpos(text, ${CITATION}) > 0
         order by position limit 1`,
    'lecture du bloc cité de la grille',
  )
  if (!bloc) throw new Error(`passage « ${CITATION} » absent de ${PAGE} publié (posé par la section contenu)`)
  return bloc
}

/** @type {{ name: string, run: (ctx: DemoContext) => Promise<void> }} */
export const section = {
  name: 'commentaires',
  async run(ctx) {
    if (!ctx.org || !ctx.e2eUser) throw new Error('commentaires : organisation ou compte E2E absents (posés par la section identite)')
    const { sql, org, e2eUser } = ctx
    const page = await findNode(ctx, PAGE)
    if (!page) throw new Error(`${PAGE} absent (posé par la section contenu)`)
    let semes = 0

    if (!(await filSeme(ctx, page.id, FIL_OUVERT.texte))) {
      const bloc = await blocCite(ctx, page.id)
      const fil = await one(
        sql`insert into platform.comment_threads ${sql({ org_id: org.id, node_id: page.id, block_id: bloc.id, quote: CITATION, block_revision: bloc.revision, created_by: e2eUser.id })} returning id`,
        'insertion du fil ouvert de démonstration',
      )
      await commenter(ctx, fil.id, FIL_OUVERT.texte)
      semes += 1
    }

    if (!(await filSeme(ctx, page.id, FIL_RESOLU.texte))) {
      const fil = await one(
        sql`insert into platform.comment_threads ${sql({ org_id: org.id, node_id: page.id, status: 'resolved', resolved_by: e2eUser.id, resolved_at: new Date(), created_by: e2eUser.id })} returning id`,
        'insertion du fil résolu de démonstration',
      )
      await commenter(ctx, fil.id, FIL_RESOLU.texte)
      await commenter(ctx, fil.id, FIL_RESOLU.reponse)
      semes += 1
    }

    ctx.report(`commentaires : ${semes} fil(s) semé(s) sur ${PAGE}, ${2 - semes} déjà présent(s) (un ouvert sur un passage cité, un résolu sur la page)`)
  },
}
