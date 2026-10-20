# Security Patterns

> Tag : `security`
> Lire ce fichier pour toute story touchant à la sécurité, l'auth, les inputs utilisateur, ou les API.

## Principes

1. **Ne jamais faire confiance au client.** Toute donnée du navigateur est suspecte.
2. **Valider côté serveur en premier.** La validation client est du confort UX, pas de la sécurité.
3. **Principe du moindre privilège.** RLS, roles, permissions — accorder le minimum nécessaire.
4. **Défense en profondeur.** Plusieurs couches : middleware + action + RLS.

## Validation des inputs

```typescript
// TOUJOURS valider avec Zod dans les Server Actions
"use server"
export async function createItem(formData: FormData) {
  const parsed = createItemSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Données invalides" }
  // ...
}
```

**Règles :**
- Zod `.safeParse()` — jamais `.parse()` dans les actions (ne pas throw)
- Limiter les longueurs : `.max(255)` sur les strings, `.max(10000)` sur les textareas
- Valider les formats : `.email()`, `.url()`, `.uuid()`
- Whitelister les valeurs : `.enum(["admin", "user"])` plutôt que `.string()`
- Valider les fichiers : type MIME, taille max, extension
- **Un texte venu d'un client ne passe que par des lectures en temps linéaire.** Une expression régulière dont deux parties peuvent lire les mêmes caractères (`(.*?)[ \t]*$`, `` (`+)[\s\S]*?\1 ``, ` +$` sous `g`), ou dont un `.*` doit finir sur une ancre (U+2028 et U+2029 le font échouer, puis revenir en arrière), prend un temps quadratique ou pire, et fige la boucle d'événements de l'hôte pour tous (mesuré : de 0,4 à 1,2 s pour une ligne de 40 000 caractères, 11 s pour 4 001 caractères de code en ligne). Sur un texte du client (opération de `write`, bloc de l'API, argument d'outil, clé), une expression est ancrée et chaque caractère n'y a qu'une lecture ; sinon, un parcours à la main (`indexOf`, boucle). **Vérifiable :** chaque fonction qui analyse un texte du client a un test qui lui passe des textes hostiles de la plus grande taille qu'un client envoie et prouve un temps linéaire par le rapport des temps du texte entier et de son quart, jamais par une borne en millisecondes, que la charge de la machine fait échouer (`testing-strategy.md § Anti-patterns` ; `tests/unit/nodes-parse-tolerant.test.ts`, `readingRatio`). Un schéma Zod en est une : Zod v4 exécute `.regex()` même quand un `.max()` placé avant a échoué, et la borne ne protège le motif qu'avec `{ abort: true }` ; un email se lit `[^@\s]+@[^@\s]+`, jamais `.+@.+` (mesuré : 1 s à 64 000 caractères, des minutes à 1 000 000, la taille d'un appel, `MAX_ARGS_CHARS`). **Vérifiable :** un schéma dont le motif compte sur sa borne la pose à `abort: true`, et son test de textes hostiles passe la taille d'un appel (`tests/unit/admin-refs.test.ts`).
- **Un `.md` venu d'un autre outil passe par `splitFrontmatter` avant d'en tirer titre, résumé ou blocs** (`schemas/frontmatter.ts`) : un frontmatter YAML de tête (`---`, `clé: valeur`, `---`) n'est jamais du contenu, sinon ses lignes deviennent un paragraphe, puis le résumé de la page. Lecteurs : `readPageMarkdown` (import de l'écran, `upload.link`) et `set_markdown` de `write`. **Vérifiable :** chaque lecteur d'un `.md` a un cas de test avec un frontmatter (`tests/unit/markdown-aller-retour.test.ts`, `tests/unit/nodes-ops.test.ts`).

## XSS Prevention

**Interdit :**
```tsx
// JAMAIS — injection XSS directe
<div dangerouslySetInnerHTML={{ __html: userContent }} />
```

**Si absolument nécessaire :**
```tsx
import DOMPurify from "dompurify"
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />
```

**Règles :**
- React échappe automatiquement les variables dans JSX — ne pas contourner
- Pas de `dangerouslySetInnerHTML` sans DOMPurify
- Pas d'interpolation dans les `href` : `href={userInput}` peut exécuter `javascript:`
- Valider les URLs : `z.string().url().startsWith("https://")`
- Un lien envoyé hors de la requête (email, adresse de retour confiée à un fournisseur d'identité ou à l'émetteur) ne se bâtit jamais sur un en-tête de la requête non vérifié, parce qu'un proxy peut transmettre `x-forwarded-host` et `x-forwarded-proto` tels que le client les envoie : son origine vient de `trustedRequestOrigin` (l'hôte appelé s'il sert une organisation ou est une adresse d'entrée de l'hôte) ou de l'hôte qui a résolu l'identité (`linkOrigin`), en `https` hors du poste local ; sur `null`, rien ne part et la réponse reste neutre. L'email d'invitation repasse son origine par `webUrl` (`http:` ou `https:`, sans identifiants). `requestOrigin` ne sert qu'à comparer l'`Origin` d'une mutation

## CSRF Protection

**Il n'y a pas de token CSRF dans les Server Actions.** Next.js compare l'en-tête `Origin` au
`Host` et rejette la requête en cas d'écart ; le cookie de session est en `SameSite=Lax`.
C'est tout. Croire à une protection cryptographique fait manquer les deux vrais risques :

- **Derrière un reverse proxy** qui réécrit `Host`, la comparaison tombe. `serverActions.allowedOrigins` doit alors être déclaré explicitement dans `next.config.ts`, et ne jamais contenir de wildcard.
- **Rejeu** : l'identifiant d'une Server Action reste invocable tant qu'il est déployé. La protection Origin ne couvre ni le rejeu ni le débit — toute action mutative sensible porte sa propre clé d'idempotence (voir plus bas).

Les Route Handlers ne bénéficient d'aucune de ces protections : vérification manuelle de
l'origine ou signature obligatoire.

```typescript
// API route (webhook) — vérifier l'origin si nécessaire
export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  if (origin && !allowedOrigins.includes(origin)) {
    return new Response("Forbidden", { status: 403 })
  }
  // ...
}
```

## Rate Limiting

**Un compteur en mémoire ne limite rien sur Vercel** : chaque invocation peut être une isolate
neuve, le compteur repart de zéro. Le rate limiting exige un store partagé.

```typescript
import { headers } from "next/headers"

// `x-forwarded-for` est une liste que le client peut préfixer de valeurs bidon.
// Le proxy ajoute la vraie IP en DERNIER : prendre le dernier segment, jamais le premier.
async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for") ?? ""
  return forwarded.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? "unknown"
}

export async function loginAction(formData: FormData) {
  const { success } = await ratelimit.limit(`login:${await clientIp()}`) // Upstash / @vercel/kv
  if (!success) return { error: "Trop de tentatives. Réessayez dans 1 minute." }
  // ...
}
```

**Cibles :** login 5/min/IP · signup 3/h/IP · password reset 3/h/email.

**Vérifiable :** un rate limiter fondé sur une `Map` ou une variable de module est acceptable
uniquement en dev et porte un commentaire le disant. En production, le store est externe.

## Idempotence et mutations concurrentes

Deux trous que ni Zod ni RLS ne couvrent :

- **Double soumission.** `useTransition` ne déduplique pas : un double-clic exécute l'action deux fois. Toute action qui crée une ressource facturable ou non réversible accepte une `idempotency_key` (uuid généré côté client) portée par une contrainte `UNIQUE` en base.
- **Lost update.** Un `SELECT` puis `UPDATE` dans une action écrase la modification d'un tiers arrivée entre les deux. Filtrer sur la version lue — `.eq("updated_at", expectedUpdatedAt)` — et traiter « 0 ligne modifiée » comme un conflit à remonter à l'utilisateur, jamais comme un succès.
- **Conflit journalisé.** Dans `server/`, une écriture gardée qui ne rend aucune ligne après une décision de droit positive lève `conflict` (jamais `forbidden` ni `not_found`) et le journalise d'abord : `console.error("[platform] <service>: …")`, la cible nommée par son identifiant. Les portes API et MCP ne journalisent pas une `PlatformError` : sans ce log, la course ne laisse aucune trace au serveur. **Vérifiable :** chaque `conflict` levé sur une écriture sans ligne est précédé de son `console.error`, et le test qui joue sa course espionne ce log.
  Exception : une garde de révision (`revision`, `updated_at`) dont le refus dit « relire puis réessayer » lève `stale_revision` (`moveNode`) ; le `console.error` reste dû et son test l'espionne.
- **Objet entier calculé sur une lecture.** Un service qui fusionne un patch sur un objet lu puis écrit l'objet entier (en-tête d'un tableau dans `node_drafts.meta`) garde l'écriture par la version de la base de sa fusion. Quand cette base est « aucun brouillon » et que le service ouvre le brouillon avant d'écrire, le tampon relu après l'ouverture ne garde plus cette base : la relecture doit encore la montrer (aucun `meta` en attente), sinon refus (`stale_revision`), journalisé d'abord. **Vérifiable :** toute écriture d'un objet fusionné dans `server/` est filtrée sur le tampon lu avec la base de la fusion, ou refuse quand la relecture montre une autre base ; son test joue la course (`meanwhile`) et espionne le log (`tests/unit/tables-header-patch.test.ts`).
- API sensible : 60 / minute / user

## Environment Variables & Secrets

```bash
# .env.local — JAMAIS commité
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...           # Public, OK côté client
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # PRIVÉ — jamais côté client
STRIPE_SECRET_KEY=sk_live_...      # PRIVÉ
WEBHOOK_SECRET=whsec_...           # PRIVÉ

# Variables accessibles côté client (ATTENTION)
NEXT_PUBLIC_SUPABASE_URL=...       # OK — données publiques uniquement
NEXT_PUBLIC_SUPABASE_ANON_KEY=...  # OK — protégé par RLS
```

**Règles :**
- `NEXT_PUBLIC_` = visible dans le bundle client. N'y mettre QUE des données publiques
- Jamais de clé secrète dans `NEXT_PUBLIC_`
- `.env.local` dans `.gitignore` (déjà configuré)
- `.env.example` avec les noms de variables sans valeurs
- Un client SMTP exige TLS (`requireTLS`, ou `smtps://`) : sans lui, un STARTTLS retiré sur le chemin livre en clair le mot de passe du relais
- En prod : variables dans le dashboard Vercel/hosting, pas dans des fichiers

## Outillage à clé service

Un script de `scripts/` atteint `platform` par la connexion d'administration
(`PLATFORM_ADMIN_DATABASE_URL`, rôle `postgres` : elle passe outre la RLS et porte les droits DDL) ; la
clé secrète ne lui sert plus qu'aux comptes, par l'API d'administration d'Auth. Il peut
réécrire ou supprimer les données d'un client. **Il n'écrit ni ne supprime une organisation qu'il
n'a pas créée** : il la reconnaît à une marque posée à sa création (`orgs.settings.demo` pour le script Démo, `guardOrg`
de `scripts/demo-seed.mjs`) et refuse toute autre organisation existante, en la nommant, avant sa
première écriture (code 1). La marque se lit « créée par le script, ou déclarée de démonstration par
son admin » : la policy `orgs_update_admin` ne laisse que l'admin écrire `settings` (`is_org_admin` depuis
`20261019150000` ; aucune session ne supprime plus une organisation depuis `20261019140000`). **Vérifiable :** toute
écriture ou suppression d'`orgs` par un script passe d'abord par ce contrôle, et un test
d'intégration joue le refus sur une organisation jetable sans marque, lignes identiques après.

Quand la marque est portée par la ligne (slug, `settings`, adresse d'un compte Auth), la fonction
qui envoie une suppression la revérifie d'elle-même, avant sa requête ou dans sa requête, même
quand une sélection l'a déjà écartée : `resetOrg`, et `deleteOrgs`, `deleteUsers` et `forgetStaff` de
`scripts/test-cleanup.mjs`. **Vérifiable :** son test lui passe directement une ligne sans marque et
prouve que rien n'est supprimé (ligne identique, ou refus rendu avant toute requête).

Un script qui tient les deux accès éprouve la clé avant sa première écriture, par une lecture de
l'API d'administration d'Auth (`listUsers({ page: 1, perPage: 1 })`, `prepareOrg` de
`scripts/demo-seed.mjs`) : refusée seulement ensuite, elle l'arrêterait sur une organisation déjà
marquée ou supprimée (`--reset`), sans rien de resemé. Un script dont la lecture des comptes précède déjà sa première écriture (`test-cleanup`,
`targetPeople` de l'import, `findUser` de `platform-staff`) n'a pas d'autre sonde. **Vérifiable :** pour
un script dont la première écriture précède sa propre lecture des comptes (`prepareOrg`), le test de
l'étape qui précède la première écriture lui passe une clé refusée et prouve qu'aucune écriture n'est
partie (`tests/unit/demo-seed.test.ts`).

En mode OIDC (`PLATFORM_OIDC_ISSUER` posée), le script Démo ne tient ni clé ni compte : seules la
connexion d'administration et `E2E_USER_EMAIL` sont exigées, `--user` nomme la personne E2E par son
identifiant interne, contrôlé en `uuid` avant toute connexion, et `prepareOrg` n'a pas de sonde ;
hors de ce mode, `--user` est refusé (code 1), comme dans `platform:staff`. **Vérifiable :**
`tests/integration/demo-seed-oidc.test.ts` joue le semis sans clé et les deux refus de la ligne de
commande.

Une personne de `platform` peut n'avoir aucun compte Auth : fixtures portables des tests,
compte supprimé du tableau de bord. Un script la lit dans les copies de `platform` (`members`,
`platform_staff`) et ne s'arrête pas sur un compte absent ; un ménage la date par un repère
qui suit son passage (les organisations qu'elle sert : `staleStaff` de `scripts/test-cleanup.mjs`),
jamais par une date que la fixture écrit (`added_at`, que la base admin des fixtures pose au 1er
septembre). **Vérifiable :** `rg -n "getUserById" scripts` ne trouve que des appels qui tiennent le
compte absent (404, `org-export.mjs`), et le test de fumée de `platform:staff` joue `list` pendant
qu'une personne sans compte est de l'équipe plateforme.

## Droits dans le service

Un service décide chaque droit et pose chaque filtre avant sa requête, avec `server/access.ts` ;
la RLS est une seconde barrière, réduite à l'isolation par organisation et aux invariants (`supabase-patterns.md § RLS Patterns`), aucun test de service ne passe grâce à elle. Exception, les gestes d'administration
(`20261019150000` pour les suppressions, `20261020190000` pour les ajouts et modifications, `20261021090000` pour les
nœuds) : la policy y reprend le rôle ou le niveau que le service exige, ni plus dur ni plus large, sur son `using` comme
sur son `with check`, pour qu'un membre simple ne les fasse pas avec son seul jeton (liste fermée `ROLE_REQUIRED` de
`tests/unit/rls-policies.test.ts`, chaque policy avec son service ; refus et passages joués par
`tests/integration/role-dans-les-policies.test.ts`, `tests/integration/role-dans-les-ajouts-et-modifications.test.ts` et
`tests/integration/role-dans-les-noeuds.test.ts`). Quand une seule policy couvre des gestes de niveaux différents, ou
que la règle dépend de l'ancienne valeur, un déclencheur sous `authenticated` et `platform_server` juge le geste sur
l'avant et l'après (`nodes_gesture_guard` : le niveau lu sur la ligne d'avant, jamais sur celle qu'écrit le geste). Une fonction `security definer` qui écrit à la place
de la personne (invitation acceptée, entrée ouverte, première organisation) ne passe pas par la policy. Un refus précède la
requête et porte le message « à qui demander » ; « aucune ligne rendue » n'est jamais lu
comme un refus. **Vérifiable :** un test par service, avec une base qui rend des lignes interdites, prouve que le
service les filtre, et qu'il refuse une écriture interdite sans envoyer la requête ; retirer du
service ce filtre ou ce refus fait échouer ce test (ADR-012 § 3).

**Porte sans session qui écrit.** Il n'y en a qu'une : `POST /api/platform/uploads/<jeton>`
(ADR-018, E10-S02 lot f). Le ticket prouve **qui** et **où**, jamais le droit : l'appartenance et chaque
droit se relisent à l'envoi, comme sous une session. **Vérifiable :** un test retire le droit entre
le lien et l'envoi, et l'envoi échoue sans rien écrire. Une autre route sans jeton de l'émetteur qui
écrit est un défaut de revue.

## SQL Injection Prevention

Supabase paramétrise automatiquement les requêtes via son SDK :
```typescript
// SAFE — Supabase paramétrise
const { data } = await supabase
  .from("items")
  .select("*")
  .eq("user_id", userId)

// DANGER — RPC avec SQL brut
const { data } = await supabase
  .rpc("search_items", { search_term: userInput })
// → La fonction PostgreSQL DOIT utiliser des paramètres, pas de concaténation
```

**Règles dans les fonctions PostgreSQL :**
```sql
-- SAFE : paramètre
CREATE FUNCTION search_items(search_term text)
RETURNS SETOF items AS $$
  SELECT * FROM items WHERE name ILIKE '%' || search_term || '%';
$$ LANGUAGE sql SECURITY DEFINER;

-- DANGER : concaténation dynamique
-- NE JAMAIS FAIRE : EXECUTE 'SELECT * FROM ' || table_name;
```

## Auth Security Checklist

- [ ] Middleware vérifie le token sur toutes les routes protégées
- [ ] Chaque Server Action revérifie l'auth (ne pas se fier au middleware seul)
- [ ] Les mots de passe suivent la politique de Supabase Auth du projet (6 caractères minimum par défaut, sans composition imposée) ; le schéma Zod de `src/lib/schemas/auth.ts` reflète la valeur réglée dans le dashboard, sans la doubler
- [ ] Les messages d'erreur ne révèlent pas si un email existe ("Identifiants invalides", pas "Email non trouvé")
- [ ] Les tokens de reset expirent (1h max)
- [ ] Les sessions expirent après inactivité
- [ ] Pas de données sensibles dans les JWT custom claims
- [ ] Les cookies auth sont `httpOnly`, `secure`, `sameSite`

## Headers de sécurité

Configurer dans `next.config.ts` :
```typescript
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
]
```

Exception : les deux routes HTML d'ADR-017 (`/api/platform/files/<id>/html`, `/api/platform/public/<jeton>/files/<id>/html`) sont exclues de `X-Frame-Options` et de la `Referrer-Policy` globale : l'iframe de la visionneuse les charge, et elles posent leurs propres en-têtes (`server/files/html.ts`).
