# Fiche — security-patterns

Texte complet : `.method/conventions/security-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- Une action valide par `.safeParse()`, jamais `.parse()` ; chaînes bornées (`.max(255)`, `.max(10000)` pour un texte long), formats vérifiés (`.email()`, `.url()`, `.uuid()`), valeurs fermées en `.enum` ; un fichier : type MIME, taille, extension. § Validation des inputs
- Un texte du client ne passe que par des lectures en temps linéaire : expression ancrée où chaque caractère n'a qu'une lecture, sinon un parcours à la main ; son test passe des textes hostiles à la taille maximale et prouve le temps linéaire par le rapport des temps du texte entier et de son quart, jamais par une borne en millisecondes. § Validation des inputs
- Un motif Zod qui compte sur sa borne la pose en `{ abort: true }` ; un email se lit `[^@\s]+@[^@\s]+`, jamais `.+@.+`. § Validation des inputs
- Un `.md` venu d'un autre outil passe par `splitFrontmatter` avant d'en tirer titre, résumé ou blocs : un frontmatter YAML n'est jamais du contenu. § Validation des inputs
- Aucun `dangerouslySetInnerHTML` sans DOMPurify ; aucun `href` tiré d'une saisie non validée (URL exigée en `https://`). § XSS Prevention
- Un lien envoyé hors de la requête (email, retour d'un fournisseur ou de l'émetteur) ne se bâtit jamais sur un en-tête non vérifié : `trustedRequestOrigin`, ou `linkOrigin` de l'hôte qui a résolu l'identité, en `https` hors du poste local. § XSS Prevention
- Aucun jeton CSRF dans une Server Action : derrière un proxy, `serverActions.allowedOrigins` explicite et sans joker ; un Route Handler vérifie l'origine ou une signature. § CSRF Protection
- Le débit se limite sur un store partagé, par le dernier segment de `x-forwarded-for` ; une `Map` de module seulement en dev, commentée ; connexion 5/min/IP, inscription 3/h/IP, réinitialisation 3/h/email. § Rate Limiting
- Une création facturable ou irréversible accepte une `idempotency_key` portée par un `UNIQUE` en base. § Idempotence et mutations concurrentes
- Une écriture se filtre sur la version lue (`updated_at`) ; « 0 ligne modifiée » est un conflit à remonter, jamais un succès. § Idempotence et mutations concurrentes
- Dans `server/`, une écriture gardée sans ligne après un droit positif lève `conflict` (`stale_revision` pour une garde de révision), précédée d'un `console.error("[platform] <service>: …")` que son test espionne. § Idempotence et mutations concurrentes
- Un objet fusionné puis écrit entier se filtre sur le tampon lu avec la base de sa fusion, sinon refus `stale_revision` journalisé ; son test joue la course (`meanwhile`). § Idempotence et mutations concurrentes
- Aucune clé secrète dans une variable `NEXT_PUBLIC_` ; `.env.example` sans valeurs ; un client SMTP exige TLS (`requireTLS` ou `smtps://`). § Environment Variables & Secrets
- Un script n'écrit ni ne supprime une organisation qu'il n'a pas créée : sa marque se vérifie avant la première écriture (code 1), et la fonction qui supprime la revérifie ; un test joue le refus sur une organisation sans marque. § Outillage à clé service
- Un script qui tient la connexion et la clé éprouve la clé par une lecture d'Auth avant sa première écriture ; une personne sans compte Auth ne l'arrête pas (`getUserById` tient le 404). § Outillage à clé service
- En mode OIDC, le script Démo ne tient ni clé ni compte : `--user` (uuid contrôlé avant toute connexion) nomme la personne E2E, sans sonde d'Auth ; hors de ce mode, `--user` est refusé. § Outillage à clé service
- Le service décide chaque droit et pose chaque filtre avant sa requête (`server/access.ts`), le refus dit à qui demander ; « aucune ligne rendue » n'est jamais un refus ; un test par service, sur une base qui rend des lignes interdites. § Droits dans le service
- Une fonction PostgreSQL prend des paramètres, jamais du SQL concaténé (`EXECUTE 'SELECT … ' || nom`). § SQL Injection Prevention
- Un message d'erreur ne révèle pas si un email existe ; aucune donnée sensible dans les claims d'un JWT. § Auth Security Checklist
- En-têtes de sécurité dans `next.config.ts` : `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ; les deux routes HTML d'ADR-017 sont exclues de `X-Frame-Options` et de la `Referrer-Policy` globale, et posent leurs propres en-têtes. § Headers de sécurité
