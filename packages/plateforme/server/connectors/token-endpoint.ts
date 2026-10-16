// Ce que partagent les échanges au point de jeton d'un tiers (`connecteurs-et-comptes.md` § Consentement d'une
// personne) : l'identifiant et le secret du client posés selon `clientAuth`, l'échéance lue dans la réponse. Lu par
// l'échange `oauth2_client_credentials` (`auth.ts`) et par le consentement `oauth2_user` (`oauth-user.ts`) ; sans ce
// module, chacun recopierait la pose du client et le calcul de l'échéance. Aucun secret n'en sort ailleurs que dans la
// requête au point de jeton.

/** L'en-tête HTTP Basic d'un identifiant et d'un secret. */
export const basicOf = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`

/**
 * Où vont l'identifiant et le secret du client : dans le corps (`body`, deux paires) ou en HTTP Basic (`basic`, un
 * en-tête) ; rend les paires du corps et les en-têtes de la requête.
 */
export function clientPlacement(clientAuth: "body" | "basic", id: string, secret: string): { pairs: [string, string][]; headers: Record<string, string> } {
  return clientAuth === "body"
    ? { pairs: [["client_id", id], ["client_secret", secret]], headers: {} }
    : { pairs: [], headers: { authorization: basicOf(id, secret) } }
}

/** L'échéance d'un jeton : `expires_in` de la réponse (secondes), sinon `expiresInDefault`, sinon aucune. */
export function expiryOf(answer: Record<string, unknown>, fallback: number | null, now: number): Date | null {
  const given = typeof answer.expires_in === "string" ? Number(answer.expires_in) : answer.expires_in
  const seconds = typeof given === "number" && Number.isFinite(given) && given > 0 ? given : fallback
  return seconds === null ? null : new Date(now + seconds * 1000)
}
