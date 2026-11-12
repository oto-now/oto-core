// Types de `comments-mail.mjs`, dont le serveur du paquet importe la règle des destinataires
// (`server/comments/followed.ts`) : un hôte compile le paquet sans `allowJs`, et sans ce fichier l'import y prend le
// type `any` implicite, refusé par `next build` (job `packed-host-build`).
export declare const MAIL_WINDOW_MS: number
export declare const WINDOW_SLACK_MS: number
export declare const EXCERPT_CHARS: number

export type NotifiedComment = {
  author: string | null
  mentions: readonly string[]
  first: boolean
  threadAuthor: string | null
  earlierAuthors: readonly string[]
  teamLeads: readonly string[]
}

export declare function recipientsOf(comment: NotifiedComment): string[]

export declare function isDue(lastSentAt: Date | null, now: Date): boolean
export declare function dueBefore(now: Date): Date
export declare function linkOrigin(hosts: readonly string[]): string | null
export declare function excerpt(text: string): string
export declare function digestSubject(count: number): string

export type DigestLine = { title: string; path: string; author: string | null; viaAssistant: boolean; text: string }

export declare function commentsDigestMail(input: {
  to: string
  orgName: string
  logoUrl: unknown
  origin: string
  lines: readonly DigestLine[]
}): { to: string; subject: string; text: string; html: string }
