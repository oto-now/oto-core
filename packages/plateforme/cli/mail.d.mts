// Types de `mail.mjs`, que le serveur du paquet importe (`server/mail.ts`) : un hôte compile le paquet sans `allowJs`,
// et sans ce fichier l'import y prend le type `any` implicite, refusé par `next build` (job `packed-host-build`).
export declare const RELAY_VARIABLES: readonly ["PLATFORM_SMTP_URL", "PLATFORM_MAIL_FROM"]

export declare function relaySettings(env: Readonly<Record<string, string | undefined>>): { url: string; from: string } | { missing: string[] } | { unreadable: true }

export declare function smtpTransport(
  url: string,
): { sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> } | null

export declare function failureCode(error: unknown): string

export declare function escapeHtml(text: string): string

export declare const MAIL_STYLES: { readonly body: string; readonly card: string; readonly button: string; readonly note: string }
