// Faits de l'organisation dans `context` : nom et domaines de travail (H32). Repris de la maquette
// (`mcp-test/src/proto/services/context.ts` l. 115-119) ; retiré : les sections du guide (→ nœuds Contexte,
// E03-S08). E05-S12 (D109) : plus de bloc « Organisation », une ligne de faits en tête de la partie Tout le monde.
// E05-S13 (AC-2, HN-E05S13-1) : les domaines quittent la ligne de faits ; la description de `context` les garde.
import { webUrl } from "../../../schemas/oauth"
import type { IdentityOrg } from "../../identity"

/**
 * Domaines de travail en une ligne (N6) : `settings.domains` est une chaîne libre ; un tableau de
 * chaînes, qui arrive sérialisé par `org_by_host`, est joint par « , ». Vide ou absent → `null`.
 * Lu par la description de `context` (`mcp/tools.ts`).
 */
export function workDomains(org: Pick<IdentityOrg, "domains">): string | null {
  const raw = org.domains?.trim() ?? ""
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed.map((item) => item.trim()).filter(Boolean).join(", ") || null
      }
    } catch {
      // Pas un tableau JSON : la chaîne est gardée telle quelle.
    }
  }
  return raw || null
}

/** La ligne de faits de la partie Tout le monde (E05-S12, AC-1, D109) : le nom seul (E05-S13, AC-2). */
export function orgFacts(org: IdentityOrg): string {
  return `Organisation: ${org.name}.`
}

/**
 * L'adresse d'Oto, servie en fin de `context` (21/10) : sans elle, l'assistant ne pouvait donner à la personne le lien
 * d'une page. L'origine de la requête MCP, lue par `webUrl` (`http:` ou `https:`, sans identifiants) ; illisible : `null`,
 * la ligne est omise. Les pages s'ouvrent à `/n/<chemin>`, comme l'adresse que rendent le dépôt et la file de revue.
 */
export function orgAddress(origin: string | undefined): string | null {
  const url = webUrl(origin)
  if (!url) return null
  const base = new URL(url).origin
  return `This Oto is at ${base}. A page opens at ${base}/n/<path>: give the user that link when you point to a page.`
}
