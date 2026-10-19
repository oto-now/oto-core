// L'hôte appelé, comparable à `org_domains.host`, et l'origine d'un lien bâti sur lui : sans base ni en-tête lu, pour
// que la face server (`trustedRequestOrigin`) et le middleware de l'hôte, qui tourne sur Edge sans la face server,
// appliquent la même règle. Le protocole ne vient jamais de `x-forwarded-proto`, qu'un proxy peut transmettre du client
// (`security-patterns.md § XSS Prevention`).
import { HOST_PATTERN } from "./admin"

/**
 * Nom d'hôte comparable à `org_domains.host` : minuscules, sans port, sans point final. `null`
 * pour une valeur vide ou une adresse IPv6 littérale (aucune organisation n'y est servie).
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase()
  if (!value || value.startsWith("[")) return null
  const host = value.split(":")[0].replace(/\.$/, "")
  return host || null
}

const PORT = /^\d{1,5}$/

/** Une adresse du poste de développement : `localhost`, un de ses sous-domaines (`demo.localhost`), `127.0.0.1`. */
export function isLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1"
}

/**
 * L'origine d'un lien vers l'hôte appelé (`rawRequestHost`, port compris) : `https://<hôte normalisé>`, sans port ; sur le
 * poste local seulement, `http://<hôte>` et son port. `null` pour un hôte vide ou qui n'est pas un nom d'hôte (le motif
 * d'`org_domains.host`). Ne dit pas si l'hôte est de confiance : `trustedRequestOrigin` le vérifie.
 */
export function linkOrigin(rawHost: string | null | undefined): string | null {
  const host = normalizeHost(rawHost)
  if (!host || !HOST_PATTERN.test(host)) return null
  if (!isLocalHost(host)) return `https://${host}`
  const port = (rawHost ?? "").trim().split(":")[1]
  return port && PORT.test(port) ? `http://${host}:${port}` : `http://${host}`
}
