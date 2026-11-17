// Les partages d'une équipe (`GET teams/<slug>/shares`, fonction `team.shares`) : ce qu'elle partage hors d'elle, ce
// que d'autres équipes partagent avec elle, et les liens de ses contenus que ses membres ne peuvent pas ouvrir. Une vue
// calculée des règles d'accès, réservée à ses membres et aux administrateurs. Sans ce module, le service, la porte et
// le dialogue « Les partages de … » décriraient chacun leur forme.
import * as z from "zod/v4"
import type { NodeKind } from "./nodes"

/** Le niveau qu'une règle de partage donne : lecture, écriture ou gestion (une fermeture n'est pas un partage). */
export type ShareLevel = "read" | "write" | "manage"

/** Liens cassés rendus au plus ; `brokenTotal` dit combien il y en a. */
export const BROKEN_LINKS_MAX = 20

/** Avec qui un contenu est partagé : une équipe ou une personne par son nom, ou toute l'organisation. */
export type ShareSubject = { kind: "team" | "user" | "org"; name: string; level: ShareLevel }

export type TeamShares = {
  team: { slug: string; name: string }
  /** Les contenus de l'équipe partagés hors d'elle, par chemin, que l'appelant lit. */
  opened: { path: string; title: string; kind: NodeKind; subjects: ShareSubject[] }[]
  /**
   * Ce que d'autres équipes partagent avec celle-ci, par équipe : la vue invité d'un simple membre de l'équipe, les
   * points d'entrée comptés avec ce qu'ils portent (un partage avec toute l'organisation compris), bornée à ce que
   * l'appelant lit.
   */
  received: { team: { slug: string; name: string }; entries: { path: string; title: string; kind: NodeKind; under: number }[] }[]
  /**
   * Les liens des contenus publiés de l'équipe, que l'appelant lit, vers un contenu qu'un simple membre de l'équipe
   * ne peut pas ouvrir ; de la cible, le chemin tel que la source l'écrit, et son titre pour qui la lit seulement.
   */
  brokenLinks: { from: { path: string; title: string }; to: { path: string; title: string | null } }[]
  brokenTotal: number
}

/** Les arguments de `team.shares` : l'équipe par son dossier, facultative quand la personne n'en a qu'une. */
export const teamSharesArgsSchema = z.strictObject({
  team: z.string().trim().min(1).max(100).optional().describe("Slug or name of the team, e.g. ventes (default: your team, when you belong to one team only)."),
})

export type TeamSharesArgs = z.infer<typeof teamSharesArgsSchema>
