// La page `/connect` (E02-S04, FR-CONN-04, `mcp-patterns.md § 9`) : pour l'organisation de l'adresse,
// ce qu'il faut coller dans quel assistant, et la dernière connexion de chacun, lue au journal. Sans ce
// module, la page lirait le journal elle-même, hors de la seule porte des services (H03).
//
// Repris d'oto-frontend (`lib/utils/mcp-url.ts`) : pas de `/` double devant le chemin du serveur.
// Retiré : l'adresse unique tirée d'une variable d'environnement et « l'entreprise vient du jeton »
// (architecture § 10 : l'organisation vient de l'adresse, ADR-004).
import type { PlatformDb } from "./db"
import { inTransaction } from "./errors"
import type { Identity } from "./identity"
import { MCP_RESOURCE_PATH } from "./oauth"

/** Ce que la page fait copier, pour l'organisation de l'adresse. */
export type ConnectAddress = {
  /** L'adresse du serveur MCP de l'organisation (`https://acme.oto.cx/api/mcp`, ADR-004). */
  url: string
  /** Nom affiché de l'organisation ; le connecteur, lui, se nomme `cliName`, celui que le guide fait copier et que la phrase cite (HN-E02S04-1). */
  name: string
  /** Nom du serveur pour Claude Code : le préfixe, en ASCII (`mcp-patterns.md § 3`). */
  cliName: string
  /** Phrase des préférences personnelles de claude.ai : `context` chargé une fois par conversation, pour que les consignes de la personne s'appliquent aussi à une demande qui n'est pas du travail (`mcp-patterns.md § 9`) ; ses préférences vivent dans son Contexte privé, « Mes instructions » à l'écran. */
  preferenceSentence: string
}

/** La dernière connexion d'une famille d'assistants : sa signature et sa date, les plus récentes. */
export type LastConnection = { family: string; signature: string; at: string }

/**
 * Lignes `initialize` lues au plus : la personne a peu d'assistants, et chacun s'annonce à chaque
 * session ; une famille muette depuis plus de 200 connexions des autres ne se montre plus.
 */
const LAST_CONNECTIONS_ROWS = 200

/** Adresse, noms et phrase de la page ; `origin` : l'origine appelée par le navigateur (fonction pure). */
export function connectAddress(identity: Identity, origin: string): ConnectAddress {
  const { name, prefix } = identity.org
  return {
    url: `${origin.replace(/\/+$/, "")}${MCP_RESOURCE_PATH}`,
    name,
    cliName: prefix,
    // Le connecteur se nomme du préfixe, celui que le guide fait copier : la phrase nomme le même.
    preferenceSentence: `Au début de chaque conversation, appelle une fois l'outil de contexte du connecteur « ${prefix} » : il porte mes consignes. Mes préférences sont dans mes instructions Oto. Utilise ensuite ses autres outils seulement quand la demande concerne mon travail (mes pages, mes procédures, mes données).`,
  }
}

/**
 * Famille d'un assistant d'après la signature `client_name@version` de son `initialize` (H29, table
 * de HN-E02S04-2, empreintes du banc E03) ; une signature inconnue forme sa propre famille, nommée par
 * la partie avant `@`.
 */
function hostFamily(signature: string): string {
  const at = signature.lastIndexOf("@")
  const client = at === -1 ? signature : signature.slice(0, at)
  if (client === "claude-ai" || client.startsWith("Anthropic/")) return "claude.ai"
  if (client === "claude-code") return "Claude Code"
  if (client === "openai-mcp") return "ChatGPT"
  if (client === "?" || client === "") return "Client non identifié"
  return client
}

/**
 * Les dernières connexions de la personne dans l'organisation de l'adresse : ses propres lignes
 * `initialize` (H74), filtrées par la requête sur l'organisation et la personne de l'identité, jamais
 * par la RLS (H123 : sous l'isolation d'E01-S08, la base rend aussi les lignes des autres membres).
 * Une ligne par famille, la plus récente, de la plus récente à la plus ancienne. Chaque ligne passe par
 * `to_json` dans la requête qui porte l'ordre : `ts` en texte ISO, comme PostgREST le rendait.
 */
export async function lastConnections(db: PlatformDb, identity: Identity): Promise<LastConnection[]> {
  const rows = await inTransaction(db, "lastConnections: journal", (sql) => sql<{ row: { host: string | null; ts: string } }[]>`
    select (select to_json(r) from (select j.host, j.ts) r) as row
      from platform.journal j
     where j.org_id = ${identity.org.id} and j.user_id = ${identity.user.id} and j.method = 'initialize'
     order by j.ts desc
     limit ${LAST_CONNECTIONS_ROWS}`)
  const latest = new Map<string, LastConnection>()
  for (const { row } of rows) {
    // Une ligne sans signature compte comme un client qui ne s'est pas nommé (`?@?`, H29).
    const signature = row.host ?? "?"
    const family = hostFamily(signature)
    if (!latest.has(family)) latest.set(family, { family, signature, at: row.ts })
  }
  return [...latest.values()]
}
