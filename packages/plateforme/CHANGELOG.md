# Changelog — @otomata_tech/oto_platform

Every published version of the package, newest first. Versions follow semantic versioning;
the package only adds (ADR-006), so a breaking change is a major version.

Format, checked by tests:
- a version is a heading `## <x.y.z> — <YYYY-MM-DD>`; changes not yet published sit under
  `## Unreleased`, which the release commit renames to the version before opening an empty
  `## Unreleased` above it;
- under a version, at most two lists: `### Assistants` (what an assistant connected to the
  platform can do; one sentence of 200 characters at most per entry) and `### Hosts` (what an
  application that installs the package must know or do; one line per point, led by what it
  concerns: `Install:`, `UI:`, `Schemas:`, `API:`, `MCP:`, `Server:`, `Migrations:`, `CLI:`;
  shown in Renovate pull requests).

Version 1.0.0 describes the whole package; each later version lists what it changes.

## Unreleased

### Assistants
- When the host declares its people, their names, emails, phones and addresses reach you as tokens such as `client#7k2m9q4x1b3nd`; copy a token exactly, never guess one.
- A token works in a path, a search, a request to `context` and the host's functions; a connector function refuses it: ask the user for the value itself.
- An email or phone of someone the host does not declare reaches you as `email#…` or `phone#…`: it names no one and cannot designate a person.
- A connector function that uploads a file takes the id of a transit file of yours, never its content; the file is consumed once the third party accepts it, and kept after a refusal.
- A connector function that engages or destroys is found, read and called as `<connector>_act.<function>`; called by its plain name, the refusal gives the served name.
- A connector that runs on the account each person connects (`oauth2_user`) uses yours without naming it; when it is missing or must be connected again, the refusal says so.
- Platform team: `admin_org create` takes `admin_email`, its first administrator (you join at once; another email is invited), and `admin_org add_admin` names one later.
- A connector account whose key the third party refused, or whose credits are spent, is marked: the refusal says since when and whom to ask, `context` says it, and the next success lifts it.
- Your own personal account serves first, unnamed, before your team's and the organisation's; another person's account shared with you serves only named, and the answer says whose it is.
- When no account serves, the refusal names the personal accounts shared with you and their owner: show them to the user and call again naming the one chosen.
- A sensitive connector function needs the sensitive level on its account, above write; the account of a person who left the organisation no longer serves.
- When the organisation withholds file contents, `read` with `file` is refused: the page still shows the file's name, size and type; ask the user to open the file.

### Hosts
- Server: security fix — build every link you send out of the request (sign-in link, password reset, identity provider return, OIDC issuer) on `trustedRequestOrigin(createAnonPlatformDb(), headers, { entryHosts })`, never on `rawRequestHost` or `requestOrigin`: behind a proxy that forwards `X-Forwarded-Host` as the client sent it, a link asked for someone else's email led back to whoever forged the header. It returns the called host only if it serves an organisation (`org_by_host`) or is one of your `entryHosts`, else `null`, logged: keep your neutral answer then, and send nothing.
- Server: pass as `entryHosts` the addresses that serve no organisation but send links (your common address; the reference host passes the host of `NEXT_PUBLIC_SITE_URL`). Without them, a link asked there is no longer sent. No new environment variable.
- Server: a link origin is `https://<host>`, without port; `http` and the port only on `localhost`, `*.localhost` and `127.0.0.1`. `X-Forwarded-Proto` is no longer read for a link. `requestOrigin` is unchanged and still serves the `Origin` check of mutations.
- Schemas: `linkOrigin(rawHost)`, the same origin without the trust check and without a database, for a middleware on Edge (its redirect only reaches whoever sent the request); `normalizeHost` lives there too and is still exported by `/server`.
- API: the link of an invitation email is built on the host that resolved the identity, in `https` off the local machine: `X-Forwarded-Proto: http` no longer lowers it.

- Migrations: apply `20261019140000_platform_suppressions.sql` (security fix). `authenticated`, hence `platform_server`, can no longer delete from `orgs`, `accounts` and `connector_activations`, which no service deletes under a session; their DELETE policies are neutralised (`false`). An organisation and its accounts are deleted by `oto-platform org delete` only. Nothing else to do: no `db prepare`, no code change; a host that deleted these rows under a person's session sees 42501.
- CLI: `oto-platform org delete --db-url <url> --org <slug> [--yes --by <email>] [--without-storage]` deletes an organisation: its storage objects (under `<org_id>/`), then every row of `platform` in one transaction; its `admin_journal` rows stay with `args`, `target`, `error`, `ctx` emptied, plus an « organisation deleted » line in the name of `--by` (a platform team member). Without `--yes` it only counts. Needs the five `PLATFORM_STORAGE_*` variables, or `--without-storage`. Nothing to do otherwise; no migration.
- Behaviour change: `setAccountRule` refuses a rule whose subject is the owner of the personal account it targets (`invalid_arguments`, `details.reason: "owner_subject"`, HTTP 400 on `POST admin/account-rules`, the same refusal through admin MCP `add_account_rule`), before any write and without a share journal line: such a rule would change nothing, the owner managing the account before any rule. Rules of that kind already in a database stay, without effect, listed and removable; no migration.
- Behaviour change: the owner of a personal account manages it before any rule — naming her, one of her teams or the organisation — on every surface, admin MCP included (`accountLevelOf`). Sharing one's account to one's own team serves the other members at the shared level and no longer takes management away from the owner (she can still share, remove the share and read the journal); a rule naming the owner, even written by tooling, no longer lowers her level. The sharing form stays after a share. No migration, no route.
- UI: the Connectors screen opens to members. `EcranConnecteurs` takes `DonneesDeMesComptes` (a member's own personal accounts, no catalog, no creation) besides `DonneesDesConnecteurs`; under each personal account the person manages, its shares, removable, a form that shares it with the organisation or a team, and the share journal.
- UI: `DonneesDesConnecteurs.partages` is required (a type error until set): the rules of each account `partageable(account)` selects, read by `listAccountRules`. Update your page, or copy the reference host's `src/app/(dashboard)/admin/connectors/page.tsx`: administrator view by `isOrgAdmin`, otherwise `listOwnAccounts`, no more `reserveAuxAdministrateurs`.
- UI: the rail and the palette show « Connecteurs » to every member (`ecransPermis`): until your page serves members, they reach its refusal.
- API: `POST /api/platform/admin/account-rules` (body `setAccountRuleSchema`; 201 new, 200 replaced) and `DELETE /api/platform/admin/account-rules/<id>` share and unshare an account, for whoever manages it; served by `handlePlateforme`, nothing to mount.
- Server: `listOwnAccounts(db, identity)` returns the caller's own personal accounts, as `listOrgAccounts` shapes them. No migration.
- Install: security fix — re-run `oto-platform db prepare` on each database before applying the migration below, then `migrations sync` and push. It creates the `platform_server` role (`nologin`, member of `authenticated`) and grants it to `platform_app`; the migration refuses to apply without it, naming the command. No new environment variable.
- Migrations: apply `20261019130000_platform_role_serveur.sql` (security fix). Facts the server alone asserts are written under `platform_server` only: `link_hosted_account`, `mark_account`, `join_org`, `signup_org`, `purge_transit_files`, `pseudonym_org`, `declare_connector` and the new `mark_files_ready` are no longer executable by `authenticated` or `anon`; `update(status)` on `files` is revoked; on `accounts`, `authenticated` updates no column (status, reason, settings, secret, token and granted scopes go to `platform_server`) and inserts only `org_id`, `connector`, owner, `label` and `mode`. A host that exposes the `platform` schema to its own clients sees these writes refused (42501).
- Migrations: the deadlines the server sets (`files.expires_at` of a transit file, `upload_tickets.expires_at`, `connector_consents.expires_at`) are kept on the database clock by `platform.expires_at_clock`: any other value is refused (42501) instead of trusted.
- Server: `PlatformDb.tx(fn, session?)` takes an optional `"server"` (type `TxSession`) that runs the transaction as `platform_server` with the caller's claims; `inTransaction` passes it on. A test double of `PlatformDb` that ignores it keeps compiling. `withServerSession` is the matching export of `server/sql.ts`.
- Server: an organisation manager can no longer move an account to another owner by updating it: ownership and identity columns of `accounts` are fixed at creation.
- Server: `registerSensitiveEntities([{ kind, list(org), read(org, id), tokens? }])` (types `SensitiveKind`, `SensitiveEntity`, `SensitiveValues`, `SensitiveOrg`) pseudonymizes your declared people in everything the MCP serves (tool results and refusals, prompts, admin MCP), and in the journal, admin journal and feedback at write. A malformed declaration throws `TypeError`. A token in an assistant's arguments is resolved (paths, `find` query, `context` phrase, table `q` and row keys, entity arguments), compared as the assistant read the text (`replace_text`'s `find`, `table.*` filters), or refused (`unknown_pseudonym`, `one_way_pseudonym`, `pseudonym_not_accepted` toward a connector). A token is written `<kind>#<body>`; a sequence of that shape whose kind is neither declared nor reserved is plain text (a URL anchor), so pick a kind your texts never write before a `#`. A last name alone is masked when it has 3 letters or more and is neither a common word nor a common first name (lists in `server/pseudonym/words/`: Grammalecte's lexicon, MPL 2.0, and Insee's first names, Licence Ouverte 2.0); « Martin » or « Brun » alone stays in clear, as a first name alone.
- Server: emails and phones that no declared person carries are served as one-way tokens (`email#…`, `phone#…`, the same for the same value), in every organisation of a host that declares, one without entities included; a foreign national number without its country code stays in clear.
- Server: set `PLATFORM_PSEUDONYM_KEY` (32 bytes, base64) before declaring; missing, malformed or changed (each organisation keeps a witness), every MCP call of the organisation fails `internal`, nothing is served in clear. So does a `list` that throws, a token collision or more than 50,000 entities.
- Server: call `invalidateSensitiveEntities(db, org)` after every write of a declared person; otherwise a kept dictionary serves the old list for up to 5 minutes. `pseudonymize(db, org, payload)` before handing a `callFunction` result to an assistant.
- Server: `output.entityFields` on `defineErpFunction` (type `EntityFields`: `{ kind, at?, id, fields }`, dotted paths in `data`) names the fields that carry a declared person's name (a fiche's `nom`, `prenoms`): served to an assistant, each becomes the person's token and its value leaves your text; a person the dictionary does not know is `[withheld]`; `callFunction` stays in clear. `registerFunctions` refuses a malformed declaration.
- Server: `entityArguments` on `defineErpFunction` (dotted argument path → declared kind): the token an assistant passes there reaches `run` as the entity id; a token of another kind, or among other words, is refused (`invalid_arguments`); elsewhere your arguments receive the token as is.
- Server: `tokens: "reference"` on a kind uses each entity's `reference` (`[0-9a-z][0-9a-z-]{0,23}`, unique, opaque) as the token body instead of the HMAC; a missing, duplicated or revealing reference fails the dictionary.
- Migrations: apply `20261019110000_platform_pseudonymes.sql` and `20261019120000_platform_pseudonymes_lecture.sql`: `platform.pseudonym_orgs` (salt, key witness and generation per organisation; members read their organisations' rows, no session writes), set through `platform.pseudonym_org` and `platform.invalidate_pseudonyms`.
- Install: raise this package together with the `connectors` pin, in the same commit, as soon as that pin brings a description that declares `cost.weights` or `async.noDeadline` (the first is a batch enrichment billed in credits): an older package refuses the whole declaration on these unknown keys.
- Server: a connector cost per item may weigh values instead of `times`, `cost.weights: { field, values }` (type `ConnectorCostWeights`; the `connectors` factory output from its commit that adds it): each element of `items` counts the sum of the weights of the values its list `field` holds. `registerConnectors` refuses weights beside `times` or off `per: "item"`, a weight that is not an integer of 1 or more, an empty table, a `field` that is not a required list of each element (`minItems` 1 or more, `uniqueItems: true`), and allowed values (`items.enum`) other than the weighted ones. `costOf` sums the weights and throws `ConnectorCostError` on a value without weight.
- Server: `async.noDeadline: true` on `ConnectorAsyncJob`, exclusive of `withinMs`, says the vendor sets no deadline; a settled cost then needs no `withinMs`. `collectionOf` returns `noDeadline` (always a boolean), and `settledQuantity` returns `exceeded` (always a boolean): true for a quantity read above the worst case, settled as read and to be reported. The refusal messages of `cost` and `async` name the new keys.
- Install: raise this package to 3fe2fa6 or later together with the `connectors` pin, in the same commit, as soon as that pin brings a description that declares `call.files` (the first is the document upload of the accounting firm connector, in its version 1.1.0): an older package ignores `request.files`, sends the JSON body without the file, and the third party refuses it.
- Server: a connector function may send transit files, `request.files` on `ConnectorRequest` (part name → argument holding the id of a transit file of the caller; the `connectors` factory output for `call.files`, from its commit that adds it). `registerConnectors` refuses an empty map, a method other than `POST`, `PUT`, `PATCH`, a paginated function, a file argument not declared `type: string`, placed elsewhere or encoded, a part that is also a body entry or constant. The engine reads the file under the caller's identity (`not_found`, nothing sent, for any other), sends `multipart/form-data` and consumes the file after a successful call only. The guarded transport now throws on a body it cannot send (anything but text or bytes) instead of sending it empty. No migration, no route, no screen change; an older package ignores `request.files` and sends the JSON body without the file.
- Server: a connector function may declare what a call costs and an asynchronous job, the `connectors` factory output from its commit that adds them: `cost` on `ConnectorFunctionDefinition` (type `ConnectorFunctionCost`) takes `per: "item"` with `items`, `times`, and `unit` and `settle: { path }` (type `ConnectorCostSettle`) besides `per: "request" | "page"`; `async: { collect, jobId: { from, to }, withinMs? }` (type `ConnectorAsyncJob`). `registerConnectors` checks both like the factory and now refuses a malformed `cost` it used to ignore: unknown `per` or key, `items`/`times` not required list arguments with `minItems` 1 or more, or on a request or page cost, `unit` missing with `item` or `settle`, `settle` path malformed, `item` or `settle` on a paginated function; `async.collect` not another read function of the connector whose only required argument is `jobId.to`, `withinMs` not an integer from 1000 to 86400000 beyond the submission's timeout, or missing when the cost is settled. The engine reserves, settles and collects nothing. New pure exports: `costOf(fn, args)` (worst case `{ quantity, unit }`), `settledQuantity(fn, args, answers)` (`{ quantity, unit, from }`), `collectionOf(fn, answer)` (`{ function, args, withinMs }`), `ConnectorCostError`, types `ConnectorCostQuantity`, `ConnectorSettlement`, `ConnectorCollection`. A definition with `{ per: "request" }` or `{ per: "page" }` is unchanged. No migration, no route, no screen change.
- Server: a connector function may declare its own timeout, `timeoutMs` on `ConnectorFunctionDefinition` (the `connectors` factory output for a function's `timeout_s`, from its commit that adds it), used for each request of the function, every page and the probe included, instead of the connector's, shorter or longer; without it, the connector's as before. `registerConnectors` refuses a function `timeoutMs` that is not an integer from 1000 to 300000, or that equals the connector's. Token endpoints keep the connector's. No new export, no migration, no route, no screen change.
- Server: a probe may read the balance of a paid account, `probe.balance: { path, min, unit }` on `ConnectorDefinition` (the `connectors` factory output from its milestone 3 commit; types `ConnectorProbeBalance`, and `cost` on `ConnectorFunctionDefinition`). `registerConnectors` refuses a balance probe whose function declares a `cost`, or a malformed balance (dotted path, `min` a number of zero or more, non-empty `unit`, no other key). A definition without `balance` is unchanged.
- Server: `probeAccount` adds `balance: { value, unit, min }` (type `ProbedBalance`; `value` is `null` when absent or not a JSON number) once the third party answered a balance probe, and says not healthy under `min`, absent or unreadable. Its answer sets the account mark by the balance instead of lifting it: `quota_exhausted` under `min`, none at or above; on an unreadable balance a `quota_exhausted` mark stays and a `credential_rejected` one is lifted. Still outside `call`: no journal line, no quota. A probe without balance behaves as before. No migration, no route, no screen change.
- MCP: `admin_org create` requires `admin_email`, the first administrator: the caller's own email (no case) makes them a member with the admin role in the creation transaction, without email, in OIDC and Supabase modes; another email gets an admin invitation once created, by the invitation service and email of the Équipes screen, linking to an address of the organisation. Its summary says which; its next line no longer says to invite from Équipes. The creator's `creation` platform access stays.
- MCP: `admin_org add_admin` (`org`, `admin_email`) names an administrator of an existing organisation by the same rule, reserved like `add_host` to platform team members who administer it; a member is promoted, an administrator left as is. `admin_email` is a new property of the served schema.
- Server: `createOrg(db, staff, input, { orgCreation?, origin })` takes the origin of the admin MCP called (`handleAdminMcp` passes it) and returns `firstAdmin`; `addAdmin(db, identity, staff, input, { origin })` is new. A direct call of `createOrg` without `admin_email` is now refused (`invalid_arguments`).
- Migrations: apply `20261014090000_platform_premier_administrateur.sql` (two functions, `claim_org_admin` for `authenticated`, `seat_org_admin` internal, and `signup_org` rewritten on it, same signature; additive).
- MCP: in OIDC mode, a token is also accepted when its `aud` is the resource the metadata announce for the called address (`<origin>/api/mcp`, `<origin>/api/mcp-admin`), besides `PLATFORM_OIDC_AUDIENCE`. An issuer that puts the requested resource in `aud` (Logto) now serves the admin MCP and every organisation address, each declared at the issuer as an API resource; a token issued for another address is still refused.
- Install: the reference host's `src/middleware.ts` builds its redirects on `X-Forwarded-Host` (else `Host`) and `X-Forwarded-Proto`: under `next start` behind a proxy it sent browsers to `https://localhost:<port>`. Copy the new `publicUrl` into your middleware.
- Server: `registerConnectors` runs `oauth2_user`, a person's consent (authorization code, PKCE S256): pass your OAuth application as `registerConnectors(definitions, { oauthApplications: { <connector>: { clientId, clientSecret } } })`, read by you, never by the package. `startConnectorConsent(db, identity, { connector, return_to? }, { origin })` (or `POST /api/platform/connector-consent`) returns the authorization `url` for the signed-in person; declare `<origin>/api/platform/connector-consent/callback` (`connectorConsentRedirectUri`) at the third party for each address. On return the tokens are kept encrypted on that person's own account, renewed at expiry and once after a 401 (rotated refresh token kept); a refused renewal marks the account to connect again (`status_reason`). The person's calls take it without naming it; it is shared like any personal account (`setAccountRule`), whoever receives it naming it in `account`; it is not created by hand nor given a secret (`invalid_arguments`).
- Server: `registerConnectors` accepts the current `connectors` factory output for `oauth2_user` (Google, Microsoft): access levels (`accessLevels`, `full` required, `scopeImplies`, `scopes` on each function, instead of `auth.scopes`) and an identity read at a full address (`identity: { url, path, scopes }`, a GET with the access token, https, fixed, no redirect followed). Levels are not applied yet: every function is served and the consent asks the scopes of `full` plus the identity's. A connector without levels is unchanged.
- Server: `pagination.requestParam` names the function's argument that carries the cursor, as the factory requires (it was read as the name sent to the API, refusing Gmail, Drive and Calendar, whose `page_token` goes as `pageToken`).
- UI: the Connecteurs screen shows « Connecter mon compte » for each `oauth2_user` connector (`ConnectorAccountForm.consent`), « Reconnecter » under an account to connect again, and the outcome of a return when the page passes `consentement={issueDuConsentement(searchParams)}` (the reference host's `admin/connectors/page.tsx` does); it no longer offers to create such an account by hand.
- Migrations: apply `20261016090000_platform_consentement.sql` (`connector_consents`, `accounts.granted_scopes`; additive).
- Server: a credential field marked `holder: "host"` is yours, for all your organisations: pass a reader, `registerConnectors(definitions, { hostCredentials: { <connector>: () => ({ <field>: … }) } })`, called at each call, never stored; it has no account row, no form field, and an account refuses it (`invalid_arguments`). Missing, the call and the link are refused by name (`not_enabled`).
- Server: a connector with `accountIdentity` (`{ name, label, pattern }`, cited by `baseUrl` after the host, never an argument) runs on an account linked at the third party (`accounts.linked_id`). Pass your port, built with your key: `hostedLinks: { <connector>: HostedLinkProvider }` (`createLink`, `listAccounts`, `probe`, exported type). `startHostedLink(db, identity, { connector, return_to? }, { origin })` (or `POST /api/platform/hosted-link`) returns the `url` to send the browser to; the package serves the return, `GET /api/platform/hosted-link/callback?request=<id>` (`hostedLinkReturnUrl`), and comes back to `return_to` with `?hosted=connected&account=…` or `?hosted=failed&reason=<reason>`. `linked_id` is never set by hand (`createAccount`, `setAccountSecret`: `invalid_arguments`).
- Server: the person's own linked account serves her calls unnamed, like a consent account; shared, it serves the others only named (`account`).
- Server: a connector error row or a function refusal with an HTTP status may carry `marksAccount` (`credential_rejected`, `quota_exhausted`) and `body` (`{ path, equals }`, read on the JSON answer, also under a 2xx), the form of the `connectors` factory: the first row that applies wins; a marking row answers with the code of its mark and marks the account (`accounts.health.mark`), the first successful call lifts it. `registerConnectors` refuses a mark on a 403 or 429 alone, a 2xx without `body`, a marking row `retryable`, a `body` row after a plain row of its status. A mark that cannot be written leaves the call with the third party's answer: a success stays a success (journaled `account_mark_lift_failed`), a marking refusal is returned without the mark sentence (journaled `account_mark_failed`), both logged. A host moves `@otomata_tech/connectors` past 75c91df only with this version of the package or a newer one: an earlier package reads an `errors` row with `body` as a row without condition, so at meta_ads every 400 would become `authorization_expired`.
- Server: `PLATFORM_ERROR_CODES` gains `credential_rejected` and `quota_exhausted` (502, as `upstream_error`); a host that maps every code adds them.
- Schemas: `AccountView.mark` (`{ reason, at }` or `null`) and the types `AccountMark`, `AccountMarkReason`.
- UI: the Connecteurs screen shows the mark of an account and its date (« clé refusée le … », « crédits épuisés le … »).
- Migrations: apply `20261017150000_platform_etat_des_comptes.sql` (`platform.mark_account`, the only writer of `accounts.health`; `authenticated` loses INSERT and UPDATE on `health`; additive).
- Server: each function of a connector declares `act` (true when it engages or destroys; never true for `read`, always for `sensitive`); a definition without it is refused (`CatalogRegistrationError`).
- Server: a function whose `act` is true is served as `<connector>_act.<function>` (its `connector` unchanged; the journal writes that name); a connector named `…_act`, or whose `<connector>_act` namespace another source serves, is refused. Procedures that call such a function by its plain name must use the served name.
- UI: the Connecteurs screen shows « Connecter mon compte » for each `accountIdentity` connector whose port you gave (`ConnectorAccountForm.hosted.ready`), « Reconnecter » under an account in error, and reads `?hosted=` in `issueDuConsentement`; it no longer offers a secret nor a creation by hand for such a connector. `ConnexionParConsentement` takes `ressource`.
- Migrations: apply `20261017090000_platform_comptes_rattaches.sql` (`accounts.linked_id`, `linked_at`, `hosted_link_requests`, four `security definer` functions; account inserts move to column grants; additive).
- Server: `callFunction(db, identity, { function, arguments?, confirm?, team?, account? }, { origin, accessToken?, userAgent?, defer? })` runs a catalogue function from your server under the signed-in person, with the checks of `<p>_call` (activation, arguments, team, account level, secret); a refusal is thrown as is (`PlatformError`), and a sensitive function without `confirm: true` returns `status: "needs_confirmation"` and its summary, running nothing. It returns `FunctionCallResult` and writes the journal line of a `call`, with `method` `api` and tool `call` (no `ctx`, not counted in assistant usage).
- Server: account levels have their own scale, `ACCOUNT_LEVELS` (none 0, read 1, write 2, sensitive 3, manage 4; type `AccountLevel`), returned by `accountLevel`, `accountLevels` and `requireAccountLevel`: manage on an account is 4, no longer 3; node levels are unchanged. A team member's default on a team account is sensitive.
- Server: for every connector, the caller's own personal account is resolved before the running team's and the organisation's; another person's only when named, and never once its owner has left the organisation (`not_enabled`). A refusal for lack of account carries `details.shared_accounts` (`id`, `label`, `owner`).
- Server: `runCall` and `callFunction` return `account.owner` (`{ kind: "org" | "team", description }` or `{ kind: "user", userId, name, yours }`); the journal line of a call served by someone else's account carries `args._lent_by` (their user id).
- Server: `setAccountRule` takes `subject: { kind: "org" }` and the level `sensitive`; `listAccountRules` returns the organisation rule apart (`general`); `listAccountShareJournal(db, identity, accountId)` is new, reserved to whoever manages the account.
- Schemas: `AccountView.viewerLevel` (required), `ACCOUNT_LEVEL_NAMES`, `AccountLevelName`, `AccountRuleSubject`, `AccountShareEventView`; `setAccountRuleSchema` accepts the org subject and `sensitive`.
- API: `GET admin/accounts/<id>/share-journal` serves the share journal of an account to whoever manages it.
- UI: the Connecteurs screen shows « Journal des partages de … » under each account the viewer manages.
- MCP: `admin_connector add_account_rule` accepts the level `sensitive`; its defaults text says a sensitive function needs it.
- Migrations: apply `20261018090000_platform_partage_des_comptes.sql` (`access_rules` admits an org subject and `sensitive` on an account; account rules at `write` become `sensitive`, keeping what they opened; table `account_share_events` written by a trigger on `access_rules`; `forget_user` scrubs it).
- API: transit files, files with no node that pass between a person and a connector: `POST transit-files` `{ name, mime, size }` (the types and quota of an attached file, 50 MB for every type, text included; returns `{ id, upload, expiresAt }`, one hour), `POST transit-files/<id>/complete` `{}` and `GET transit-files/<id>` (302). Only their author reads them: any other person, an administrator and the platform team included, gets `not_found`. Expired ones are purged at the next transit upload of the organisation. Their journal lines carry only the id, the size and the MIME type, never the file name, and a refusal by its code alone (a route's new `journalArgs`).
- Schemas: `transitFileRequestSchema` and the types `TransitFileUpload`, `TransitFile`.
- Migrations: apply `20261019090000_platform_fichiers_en_transit.sql` before mounting the new package, otherwise every attached-file upload fails: the file quota is now read by `org_files_bytes`. It makes `files.node_id` nullable, adds `files.expires_at`, has the four `files` policies hide a transit file from anyone but its author, and adds the `security definer` functions `org_files_bytes` and `purge_transit_files` for `authenticated`; additive.
- Server: an argument property marked `.meta({ personal: true })` (Zod, `defineErpFunction`) or `personal: true` (JSON Schema of a described connector; Ajv now accepts the keyword) is never journaled: `[personal]` in `args`, its value taken out of `target` and `error` wherever a third party copied it, through the MCP gate and `callFunction`. No marker, no change.
- Server: `registerConnectors(definitions, { serverOnly: { <connector>: "all" | [<served name>, …] } })` and `defineErpFunction({ serverOnly: true })` reserve functions to your server: unknown to assistants (`find`, `read`, `context`, procedures; `call` answers `not_found` as for an absent function), run by `callFunction`. An undeclared connector, an empty list or a name the connector does not serve throws `CatalogRegistrationError`; a non-boolean `serverOnly` too.
- Server: `registerDataPolicy({ fileContents: "metadata" | "served" | (org) => … })` (types `DataPolicy`, `FileContentsPolicy`) withholds attached file contents from assistants: `read {file}` answers `forbidden`, reason `file_contents_withheld`, before reading the object; name, size and type stay in the page. Default `served`. A policy function that throws or returns another value fails the read (`internal`).
- API: under a route's `journalArgs`, a body value the list leaves out is also taken out of the line's `target`.
- Migrations: apply `20261019100000_platform_retention.sql`: `platform.purge_expired(journal_days, feedback_days)`, for the admin connection only.
- CLI: `oto-platform journal purge --db-url <url> [--journal-days <days>] [--feedback-days <days>]` deletes `journal` and `admin_journal` rows older than `--journal-days` and `feedback` tickets older than `--feedback-days` (1 to 36500), for all your organisations; run it from your scheduled job. Without a duration, nothing is purged.

## 1.5.0 — 2026-10-06

### Assistants
- A function's contract read with `<p>_read` now says « origin connecteur » for a connector function (it said `service_connecteurs`).
- `<p>_call` can refuse with `rate_limited` (retry later) or `upstream_error` (the third party refused or is down).
- The live connectors your host declares are found, read and called like the others; `<p>_read` shows their JSON Schema as is, and `all_pages` reads their following pages.

### Hosts
- Install: upgrade to 1.5.0, run `oto-platform migrations sync` and apply `20261006090000_platform_connecteurs.sql` and `20261007090000_platform_connecteurs_declares.sql` before deploying (a table, three foreign keys and two functions; additive). The first fails, naming it, on a connector name that breaks the connector name rule. The package now depends on `ajv` 8.20.0.
- Migrations: `platform.connectors` lists the connectors (`mail`, `notion`, and every name your tables already cite); `accounts`, `connector_activations` and `sim_outbox` reference it, so an unknown connector is now refused (`23503`). The package adds a connector you declare at its first activation or account (`platform.declare_connector`): you write no SQL.
- Server: `registerConnectors(definitions)` declares the live connectors you use, shared (the definitions generated by the `connectors` repository) or your own in the same form (`ConnectorDefinition`); call it where you call `registerFunctions`, before it. The package ships none: `notion.search_workspace` is gone until you declare Notion. What it runs is listed below (accounts with several fields).
- Server: `probeAccount(db, identity, { account_id })` plays the probe of a declared connector on an account (manage level) and returns `{ healthy: true }` or `{ healthy: false, reason }`; no screen calls it yet.
- Install: `PLATFORM_VAULT_KEY` (32 bytes in base64, `openssl rand -base64 32`, server only) as soon as a live connector account is used. Read when used: without it the host starts, and setting or reading a secret throws `PlatformConfigError`.
- CLI: `oto-platform accounts secret --db-url <url> --account <id>` sets the secret of a live account, read from standard input, encrypted with `PLATFORM_VAULT_KEY`; nothing of it is printed (input below).
- Server: `createAccount` takes `mode: "reel"` for a live connector (one you declare) and refuses a simulated one (`invalid_arguments`); a simulated connector (`mail`) still takes simulated accounts only.
- Server: `PLATFORM_ERROR_CODES` gains `rate_limited` (429) and `upstream_error` (502); a host that maps every code adds them.
- MCP: `admin_connector` lists a live connector as `(live)` and creates a live account with `mode: "reel"`.
- Install: apply `20261008090000_platform_comptes_a_champs.sql` too (six columns of `accounts` and one function; additive).
- Server: an account keeps every credential field its connector declares, encrypted together, and its settings (region, subdomain, address) in clear. `registerConnectors` now runs `api_key` in a header or in the query (the key never logged), `bearer`, `basic` and `oauth2_client_credentials` (token exchanged, kept encrypted on the account row, renewed at its expiry and once after a 401), `settings`, `baseUrls` and `{setting}` templates; `oauth2_user` throws `CatalogRegistrationError`, naming it. An address built from an entered setting is called over https only, never to an internal host (checked at each connection), without following redirects. `ConnectorDefinition` takes the same shape as the `connectors` factory output.
- Server: `setAccountSecret(db, identity, { account_id, input: { secret?, settings? } })` replaces `{ account_id, secret }`: fields and settings checked against the declaration, merged into what is set (absent kept, `null` or empty erased), `stale_revision` on a concurrent entry. `connectorAccountForms()` gives each declared connector's account form.
- API: `POST /api/platform/admin/accounts/<id>/secret` sets the secret and settings of a live account (manage level), never answered back; its journal line masks the secret.
- UI: `EcranConnecteurs` takes `donnees.formulaires?` (`connectorAccountForms()`): « Créer un compte » creates a live account of a declared connector with its fields and settings, and each live account row offers « Secret et réglages », secret fields masked and never shown again. `AccountView` gains `secret?` (fields set, date) and `settings?`.
- CLI: `oto-platform accounts secret` reads a JSON object of fields on standard input and takes `--setting name=value`; a raw token is refused.
- Server: the vault writes format v2 (key id, account and column bound); v1 secrets stay readable.

## 1.4.11 — 2026-10-20

### Assistants
- A link to a page that moved or was renamed reaches you at the page's current path; your next write of the page records that path.
- Never put a procedure under a procedure: its sub-steps are pages under it, linked from its steps. `node.check` reports a procedure under a procedure.

### Hosts
- Install: upgrade to 1.4.11; no migration, no new variable, no import to change. Published from 1.4.10, without what main carries for 1.5.0.
- UI: the rail's width is set by hand, by dragging its right edge or with the arrow keys on it (a double click restores 232 px), between 200 px and 40 % of the window, and kept in the browser; the tree scrolls horizontally instead of cutting long names; the line of the open page is scrolled into view at each navigation.
- UI: the « + » of a procedure in the rail no longer offers a procedure.
- MCP: the served rules, the `write.procedure` contract, the platform guide and the description of `node.check` change; refresh the tool list in your hosts.

## 1.4.10 — 2026-10-19

### Assistants
- Call `<p>_context` first with the user's request, then again with `since_ctx` for each new request: it routes the new phrase without reloading the whole context.
- A procedure may now hold 12,000 characters (8,000 before).
- Without a matching procedure, `<p>_context` proposes a function only when it shares at least two words with the request.
- `<p>_find` shows the next matches after the first three, one line each, so you can read a better one.
- `<p>_find` now ranks like `<p>_context`: the procedure that `<p>_context` serves for a request comes first in `<p>_find` for the same words.
- With a request, `<p>_context` lists the pages and tables close to it; at its size limit, useful procedures are named by their titles rather than dropped.

### Hosts
- Install: upgrade to 1.4.10; no migration, no new variable, no import to change. Published from 1.4.9, without what main carries for 1.5.0.
- Schemas: `PROCEDURE_MAX_CHARS` (12,000) moves to `schemas`, read by the publication check and by the procedure screen's refusal.
- MCP: the description of `<p>_context` and the served rule say to call it again with `since_ctx` for each new request, instead of « once per conversation »; refresh the tool list in your hosts.
- UI: the « + » and the handle of a toggle face its summary line, like a Texte; they sat 5 px lower than its chevron.
- UI: under 1,024 px the rail is a drawer opened by « Menu », with its words; the icon-only rail (56 px, between 768 and 1,024 px) is gone. The « Menu » button sits on the first line of the screen header (breadcrumb or title) instead of a row of its own.
- MCP: `<p>_context` shares its 35,000-character budget by priority (rules and routing, served procedure, close contents, useful procedures, then Contextes, then news and recent content), the text keeping its order; the useful procedures block is titled « Procedures you can run, most used first » and falls back to titles only; a new block « Pages and tables close to the request » follows the served procedure when a phrase is given. `<p>_find` ranks nodes by the routing score of `<p>_context` (title and summary), or its search score when better.
- MCP: `<p>_find` lists the next matches after the first three, one line each (path, kind, score, title, start of summary), and serves them as `others`; refresh the tool list in your hosts.

## 1.4.9 — 2026-10-15

### Hosts
- Install: upgrade to 1.4.9; no migration, no new variable, no import to change. Published from 1.4.8, without what main carries for 1.5.0.
- UI: a title moved in the editor (dragged, Alt+↑/↓, « Monter », « Descendre ») takes its section with it, subtitles included, in one write with one « Annuler ».
- UI: dragging a block follows the pointer, several rows at once, and passes a folded section whole; it used to step one row at a time and stuck above a folded section.
- UI: the selection rectangle also starts from the empty space around the editor (the column, the page margins), not only from the block area.
- UI: in the rail, the bottom quarter of a Contexte line puts the dragged line just after it, first of its section; a team whose only line was its Contexte had no place beside it.
- UI: the chevron of an empty fold (a title without a section, a toggle without a body) is drawn at half opacity.

## 1.4.8 — 2026-10-15

### Hosts
- Install: upgrade to 1.4.8; no migration, no new variable, no import to change. Published from 1.4.7, without what main carries for 1.5.0.
- UI: each team section of the rail has a « ⋯ »: « Les personnes de … » opens the people dialog of the Équipes screen in place, and « Supprimer l'équipe… » its deletion, for who administers (`SectionsDuRail` takes `administre?`, `RailApplication` passes it).
- API: `GET /api/platform/teams/<slug>` reads a team for that menu: the team, the people of the organisation, `compose` and `admin`; any member of the organisation may read it, the gestures keep their own rights.
- UI: Backspace in the mark of a sub-item of a list, or at the start of its text, outdents the line like Shift+Tab; it used to rewrite the line with one more dash and send the caret to the end.

## 1.4.7 — 2026-10-15

### Assistants
- Every heading now folds its section on screen, open by default; write headings plainly (`## Title`), the `<!-- toggle -->` marker is no longer needed and is dropped when read.

### Hosts
- Install: upgrade to 1.4.7; no migration, no new variable, no import to change. Published from 1.4.6, without what main carries for 1.5.0.
- UI: every title folds its section from a chevron, open by default; what a person folds is kept in their browser (`localStorage` key `oto-plis`, replacing `oto-plis-ouverts`); the « Repliable » checkbox and the `collapsible` data of a heading are gone. A toggle block still opens folded.
- UI: large, medium and small titles now differ: 24, 20 and 17 px, in reading and in the editor.
- UI: each entry of the « + » and « / » block lists has its icon.
- UI: a click on a link of a Texte block at rest follows the link again (since 1.4.3 it opened the link panel); lists were not affected.

## 1.4.6 — 2026-10-14

### Hosts
- Install: upgrade to 1.4.6; no migration, no new variable, no import to change. Published from 1.4.5, without what main carries for 1.5.0.
- UI: the embed block is named « Iframe » in the block editor (« Intégration » before), and its address dialog also takes the `<iframe …>` code a site gives (« Embed », « Intégrer ») : only its `src` address is kept, `&amp;` read as `&`; the block, its markdown and its data do not change.

## 1.4.5 — 2026-10-14

### Assistants
- A heading line ending with `<!-- toggle -->` (`## Annexes <!-- toggle -->`) folds its section on screen for people; you always read it whole, marker included.

### Hosts
- Install: upgrade to 1.4.5; no migration, no new variable, no import to change. Published from 1.4.4, without what main carries for 1.5.0.
- UI: while typing in the block editor, a labelled link shows as `[[Title]]` (a web link as `[Title]`), brackets in `--mute`, title underlined in `--link`, its path or address kept aside and written back on save: the block no longer jumps when its field takes the focus. Copy and cut put the full source in `text/plain`. No prop, no migration.
- UI: the block editor writes three titles, « Grand titre », « Moyen titre », « Petit titre » (levels 1 to 3; `#`, `##`, `###` typed in a Texte), and a title's handle menu has a « Repliable » checkbox: its chevron folds its section. The toggle block is renamed « Menu dépliant » and drawn like Notion's (chevron on the left, no tinted box). Folds start closed, on the page, the public page and in the editor; what a person opens is kept in their browser (`localStorage` key `oto-plis-ouverts`, block ids).
- Schemas: a heading's `data` takes `collapsible: true`, rendered and read as the `<!-- toggle -->` marker (`COLLAPSIBLE_MARKER`, `isCollapsible` in `schemas/blocks.ts`); no migration.

## 1.4.4 — 2026-10-14

### Hosts
- Install: upgrade to 1.4.4; no migration, no new variable, no import to change. Published from 1.4.3, without what main carries for 1.5.0.
- Server: `next build` of a host no longer fails with « Cannot access … before initialization » at « Collecting page data »: 1.4.3 closed an import cycle through the function catalog, now broken and guarded by a test.

## 1.4.3 — 2026-10-14

### Assistants
- A page can show the page of another site: the block `embed` is written as a fence ```embed with the https address, then {"height": "small" | "medium" | "large"}.
- `node.import_tree` points the paths named in the call blocks of an imported procedure to the arrival, and keeps a procedure whose publication is refused as a draft, listed in `drafts`.
- The rules served by `<p>_context` now point to the references (`read path functions`, `read path help`, `write.procedure`, `write.table`, `table.schema`) and name the costly pitfalls.
- `<p>_read path help` serves the platform guide, the same everywhere: pages and blocks, tables, procedures, paths, import and export, known pitfalls; one section at a time.
- Without a procedure for a request, `<p>_context` proposes the functions that may do it and the closest section of the guide.
- `node.tree` lists a root and everything under it that you can read; `node.check` finds broken links, refused calls, cells naming a missing path, tools of another organisation.
- `node.import_tree` also rewrites table cells naming an imported path and source tool names, places a node next to a held path, gives whole refusals and runs `node.check` at the end.
- Publishing a procedure warns, without refusing, about a missing « When to use it » part and tools named with a prefix.
- A result under a stale ctx says whether the call ran or was refused, nothing written.

### Hosts
- Install: upgrade to 1.4.3, run `oto-platform migrations sync` and apply `20261014120000_platform_bloc_integration.sql` before deploying (the block type `embed` and its shape; additive). Published from 1.4.2, without what main carries for 1.5.0.
- Migrations: `20261014120000_platform_bloc_integration.sql` sets `blocks_type_check` and `blocks_shape_check` again, `embed` added; no table, column nor function.
- UI: « Intégration » in the « + » and « / » of the editor opens the address of the page to show; the frame is an `iframe` with `sandbox`, at the height chosen in its menu, and a link opens the page in a new tab. A host that sends a `Content-Security-Policy` with `frame-src` or `child-src` must admit the sites its pages embed.
- UI: the list of « / » offers the same blocks as the « + », « Image » and « Fichier » included when files are enabled; both show all their entries without a scroll bar; the prompt of an empty page cites « / » and « @ ».
- Migrations: apply `20261014130000_platform_chemin_help.sql` too: it adds `help` to `teams_slug_reserved` (the platform guide is read at this path); rename a team whose slug is `help` before.
- Server: `read` serves `help` before any node; `write` refuses this path, and no team takes this slug. A node already at `help` is no longer read by `read`.
- Server: « Path … is not available » now says its possible causes, never which one: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved.
- UI: a text block with links no longer leaves a gap under its rendering at rest: its raw text, longer, takes its height only while edited.
- UI: dragging a node in the rail between two rows shows a straight bar with a dot where it lands, instead of an edge following the rounded row.

## 1.4.2 — 2026-10-13

### Assistants
- `node.export_tree` exports one or several roots with everything under them to a signed address valid one hour: a faithful JSON for another Oto platform, or a zip of .md and .csv.
- `node.import_tree` imports such an address, a zip of .md and .csv, a single .md or .csv, or a file attached to a page, in two passes with links following; `continue_from` resumes a long import.
- A JSON export carries the attached files of its pages: the import copies them to the arrival pages.

### Hosts
- Install: upgrade to 1.4.2; no migration, no new variable, no import to change. Published from 1.4.1, without what main carries for 1.5.0.
- Server: `node.export_tree` writes its file in your storage bucket under `<org id>/exports/`; once its one-hour address expired, the next export, import or trash pass of the organisation lists that prefix and removes it. Your storage keys need the right to list the bucket (`s3:ListBucket`); without it, a server log line says so and the exports stay.

## 1.4.1 — 2026-10-13

### Hosts
- Install: upgrade to 1.4.1; no migration, no new variable, no import to change. Published from 1.4.0, without what main carries for 1.5.0.
- UI: with many members, « Équipes & accès » no longer crushes its tab bar nor lets the entry setting fall out of its card: the tab bar keeps its height and an island that lets its content out takes its height, the page scrolling instead.
- UI: « Les personnes de <équipe> » opens twice as wide (`Dialog size="xl"`, 1040 px), its rows 4 px apart; the lead of a row takes the size of what it holds, so a 24 px avatar no longer runs under the name.

## 1.4.0 — 2026-10-03

### Hosts
- Install: upgrade to 1.4.0, run `oto-platform migrations sync` and apply `20261003090000_v1_4_0.sql` before deploying (a new table and four functions; additive). No new variable.
- Server: entry without invitation. An administrator opens the organisation to the accounts whose verified email is of a domain they name (`readOpenEntry`, `setOpenEntry`, `PATCH /api/platform/admin/open-entry`; at least one domain). Such a person becomes a member, without a team, at the first screen or assistant call, inside `resolveIdentity`. A removed member stays out until an accepted invitation; the platform team served by an access does not become a member. Closed by default.
- Server: with the entry open and `members_max` reached, `resolveIdentity` throws `forbidden` with `details.reason: "limit"`. Treat it as `not_member` where you catch `not_member` (the reference host does, in `src/lib/plateforme/session.ts`); the MCP door serves it by itself.
- UI: `EcranEquipes` takes `entreeSansInvitation?` (what `readOpenEntry` gives, for an administrator) and shows the setting under the members. Absent, nothing shows.
- CLI: `oto-platform widgets build` on Windows now generates the classes of the host's views (the styles module was compared with the system separator and never matched).
- UI: the account menu of the rail offers « Mode sombre » / « Mode clair » when the host lends `apparence: { mode, basculer }` through `ContexteDeLHote`. The mode stays the host's (its `.dark` class); absent, no entry.
- MCP: `handleMcpPost`, `handleResourceMetadata` and `consentRequest` take `host`, one function of the host (`ServedHost`, from `/server`) that gives the address to serve instead of the called one: a preview gives its declared address, a single-organisation ERP the address of its organisation. `null`: no organisation (404); a throw: 503. The token is still checked first and membership at each call; the 401 and `resource` keep the called origin. Without `host`, nothing changes.
- MCP: `handleMcpPost(request, { verifyToken, defer, widgets: true })` turns on a result widget in Claude and ChatGPT on `call` and `read` (a table, a record, a page read whole). Without `widgets`, the MCP serves exactly what it served before. Off by default until the hosts are measured.
- Install: the package ships its widget bundle, generated (`mcp/widgets/generated.ts`, about 1 MB); nothing to build, no variable.
- Server: `registerWidgetViews(WIDGET_BUNDLE)` registers the host's widget bundle, served instead of the package's; `defineErpFunction({ view: "<name>" })` renders the function's result with that host view. Call it before `registerFunctions`, which refuses a view missing from the bundle (`CatalogRegistrationError`).
- CLI: `oto-platform widgets build --views <folder> --out <file>` builds one bundle, the package's views and the host's (one `.tsx` per view, default export an `ErpView` from `@otomata_tech/oto_platform/widgets`). It needs `vite`, `@vitejs/plugin-react`, `vite-plugin-singlefile`, `@tailwindcss/postcss`, `tailwindcss` and `@modelcontextprotocol/ext-apps` in the host's devDependencies, optional peers of the package; a host without ERP view installs none of them.
- MCP: with widgets on, a table offers its next rows and a view of the ERP may call a function of the catalog, through the host, under the conversation's `ctx`, never with `confirm`; a suggested next function is sent to the assistant as a message.

## 1.3.8 — 2026-10-01

### Assistants
- `<p>_context` may be called once at the start of a conversation when your user's preferences ask for it; pass `phrase` only for a request about the organisation's work.

### Hosts
- Install: upgrade to 1.3.8; no migration, no new variable, no import to change.
- Server: the preference sentence of the connect screen (`preferenceSentence`) now asks the assistant to load the context once per conversation, so that the person's instructions apply to a request that is not work, and to keep the other tools for work. People who pasted the former sentence replace it.
- Host: a connector is an Auth session of the person. Sign out with `supabase.auth.signOut({ scope: "local" })`: without a scope, Supabase revokes every session of the person and their assistants ask for a new authorisation within the hour. Keep « single session per user » off in the Supabase project (`sessions_single_per_user`); `pnpm auth:settings` now sets it to false.

## 1.3.7 — 2026-10-01

### Hosts
- Install: upgrade to 1.3.7; no migration, no new variable, no import to change.
- UI: the waiting screen after a signup no longer shows the link to the new address while it waits: the address does not answer yet, and the link led to the browser error the screen avoids. The link comes with « Réessayer », after two minutes without an answer; the address stays readable as text in its step.

## 1.3.6 — 2026-10-01

### Hosts
- Install: upgrade to 1.3.6; no migration, no new variable. One line to change: pass the request's host to `listMyOrganisations`.
- Server: `listMyOrganisations(db, identity, requestHost?)` takes the address of the request and gives, for an organisation with several addresses, the one the person can reach from there: the closest to the request's (same parent domain), then one that is not a development address (`localhost`, `*.localhost`), then alphabetical order. It gave the first by alphabetical order, so the switcher could lead to `demo.localhost` from a public address. Pass the request's host from your layout (the reference host passes `session.host`); without it, a development address still comes last.
- UI: after the creation, `FormulaireDInscription` shows « Votre espace se prépare »: three steps (organisation created, address reserved, secure go-live in progress), a bar that only completes when the address answers, a short text that changes every seven seconds about what the person will find, then « C'est prêt » and the departure. After two minutes without an answer it says so and offers « Réessayer »; the link to the address stays throughout. Reduced motion: the bar stands still and the texts do not rotate. Nothing to change at the host.

## 1.3.5 — 2026-10-01

### Hosts
- Install: upgrade to 1.3.5; no migration, no new variable, no import to change.
- UI: `FormulaireDInscription` shows the future address under the name after a pause of typing, and has one button, « Créer l'organisation », that creates at the first click. The preview is the existing call of `POST /api/platform/signup` without `confirm`: it runs `admit` at each pause, with `acceptedTerms` as the box stands; a refusal there stays silent, except an address or prefix already taken.
- UI: after the creation, the form stays, says the organisation is created and leaves for its address once it answers (probed every three seconds, two minutes at most), with a link to it; a new subdomain whose certificate is not issued yet no longer ends on a browser error. A host whose `connect-src` forbids the organisation's address keeps the link only.

## 1.3.4 — 2026-10-01

### Hosts
- Install: upgrade to 1.3.4; no migration, no new variable, no import to change.
- UI: `FormulaireDInscription` judges the name when its field is left or Enter is pressed, no longer at each keystroke: the address and prefix fields showed at the first character and hid at the second. A one-character name says it is too short. Nothing to change at the host.

## 1.3.3 — 2026-10-01

### Hosts
- Install: upgrade to 1.3.3; no migration, no new variable, no import to change.
- UI: `FormulaireDInscription` asks for the organisation name only. The address (slug) and the tool prefix are derived from it without a field on screen; the address preview before confirmation stays. The two fields come back only when needed: address or prefix already taken (`conflict`), or a name that yields no valid address or prefix (all digits, non-Latin characters). Nothing to change at the host.

## 1.3.2 — 2026-10-01

### Assistants
- A refusal of invalid arguments says what was wrong again (the allowed values, the unknown key, the expected type), instead of « Invalid input ».

### Hosts
- Install: upgrade to 1.3.2; no migration, no new variable, no import to change.
- Server: the three doors (`handlePlateforme`, `handleMcpPost`, `handleAdminMcp`) install Zod's English messages at each request. A host's production bundle dropped them (`zod` declares `sideEffects: false`), so every refusal from Zod read « Invalid input », at the API and at the MCP alike. Nothing to change in the host.

## 1.3.1 — 2026-10-01

### Assistants
- `node.write_many` refuses an unknown key inside an operation of a page, as `write` does, instead of running the operation without it.
- A changed context no longer refuses a call: the call runs, and its result starts with « context has changed », the new ctx and the changed contexts.

### Hosts
- Install: upgrade to 1.3.1; no migration, no new variable, no import to change.
- MCP: a stale `ctx` is no longer refused `ctx_stale` when the changed contexts can be said: the call runs under a new ctx, given first in the result text and in `new_ctx`; the description of `context` and the served texts say not to repeat the call. Still refused: a ctx issued before 1.1.0, or a failure while reading the change.

## 1.3.0 — 2026-10-01

### Assistants
- `write` refuses an unknown key inside an operation and names it with the accepted ones (« ops.1: unknown key « content » »), instead of running the operation without it.

### Hosts
- Install: upgrade to 1.3.0, a minor version to review by hand; two migrations, one of them dated before the baseline; no new variable. A host that passes neither `organisations` nor `inscription` to the rail sees no new screen.
- Migrations: copy `20260928090000_platform_pg_trgm.sql` and `20261001180000_v1_3_0.sql` (`oto-platform migrations sync`, then `migrations check`). The first is dated before the baseline: an installed host applies both once with `supabase db push --include-all` (without it the CLI refuses a file older than its history); it changes nothing there. It loads the `pg_trgm` library in the session, so a new host on Supabase installs every migration with `supabase db push` alone, over a direct or session-mode connection. The second: `signup_org` no longer refuses a person who already belongs to an organisation.
- CLI: `migrations check` refuses a migration that creates a function setting a `pg_trgm` parameter before a statement of the same file loads the library (`pg-trgm-parameter-before-load`); start such a file with `DO $$ begin perform extensions.similarity('a', 'a'); end $$;`.
- MCP: the operations of `write.ops` are strict at the MCP door, as the served schema says (`additionalProperties: false`); the API body of the screens is unchanged.
- API: `POST /api/platform/signup` no longer answers `already_member`: a person creates as many organisations as they want. The package sets no bound; a host that wants one (one free organisation per account) refuses in its `admit`, counting on its side.
- Server: `listMyOrganisations(db, identity)` gives the organisations the person is a member of, by name: `{ id, name, host, current }` (`PersonOrganisation`; `host`: one address of the organisation, `null` without any).
- UI: `RailApplication` takes `organisations?` (that list): from two reachable organisations, the company menu at the top of the rail carries the switcher; choosing one leaves for its address, where the session resumes. The reference host's dashboard layout passes it. `AdressesDuRail.inscription?` (a path of the host, the page that mounts `FormulaireDInscription`) adds « Créer une organisation » under the switcher, for everyone; absent, nothing shows.
- Server: the platform team, with an open platform access to the organisation, passes the counted limits (`members_max`, `teams_max`, `connectors_max`); the write leaves a journal line (`tool` « limit passed », `target` the limit, `args` `{ max, used }`), and `orgLimitsView` greys nothing for it. The file quota is unchanged.

## 1.2.1 — 2026-10-01

### Assistants
- `find` says how many blocks of a page match when it shows only three of them (« 3 of 4 matching blocks shown »), and gives `blocks_total` in its data.
- A tool refuses an unknown top-level argument and names the accepted ones, instead of ignoring it: `text` passed to `write` no longer creates an empty page.
- A section operation on a page without section says where to start: `add_section`, or `set_markdown` for the whole body.

### Hosts
- Install: upgrade to 1.2.1; one migration; no new variable, no import to change.
- Migrations: copy `20261001150000_v1_2_1.sql` (`oto-platform migrations sync`, then `migrations check`) and apply it: `search_content` dropped and recreated with one more returned column, `block_total`; same arguments and grants; no table, no column.
- MCP: `parseInput` refuses an unknown top-level key on the six tools, as the served schemas say (`additionalProperties: false`); a host or a client that sent extra keys now gets `invalid_arguments`.

## 1.2.0 — 2026-10-01

### Hosts
- Install: upgrade to 1.2.0, a minor version to review by hand; one migration; no new variable. A host that registers no limits and passes no `signup` sees no change (no limit, the 10 GB file quota, entry by invitation only).
- Migrations: copy `20261001090000_v1_2_0.sql` (`oto-platform migrations sync`, then `migrations check`) and apply it: functions only (`signup_org`, the internal `org_skeleton`, `create_org` rewritten on it with the same signature and result, `org_usage` granted to `anon`); no table, no column.
- Server: organisation limits (ADR-022). `registerOrgLimits({ read, raiseUrl? })` registers the host's source once, like `registerFunctions`: import it at the top of every route that mounts a door (`/api/platform/[...route]`, `/api/mcp`, `/api/mcp-admin`) and of every page that shows a limited gesture (teams, connectors); a route that does not import it serves without limits. `read({ id, slug })` may be async and returns `OrgLimits` (`orgLimitsSchema`, every key optional: `members_max`, `teams_max` (0 allowed), `connectors_max`, `storage_bytes`, `account_owner_kinds`, `accounts_per_owner_max`) or `null`; it is called by each limited service call and by `orgLimitsView`. `raiseUrl` is an `https://` address or a path of the host (`/admin/billing`), resolved on the organisation's own address. Without a source, nothing changes, the file quota stays 10 GB.
- Server: `inviteMember` (members plus pending invitations), `createTeam` (API and `admin_team`) and `activateConnector` (an already active connector never counts) refuse beyond their limit with `forbidden`, `details: { reason: "limit", limit, max }`, under an advisory lock per organisation; the file quota (`requestFileUpload`, `upload.link`, duplication) is `storage_bytes`, refused with `too_large`, `details: { reason: "quota", max }`. A source that throws or returns invalid limits refuses with `internal` (never « no limit »). Lowering a limit removes nothing. `account_owner_kinds` and `accounts_per_owner_max` are read and validated, checked by no service yet.
- Server: `orgLimitsView(db, identity)` gives the screens `{ members, teams, connectors: { max, used } | null, raiseUrl }`, with a session; no database read when no counted limit is set.
- Server: `orgUsage(orgId)` reads `{ members, pendingInvitations }` of an organisation without a session (a scheduled task, a payment webhook), through `org_usage` granted to `anon`; `null` for an unknown organisation, `invalid_arguments` for an id that is not a uuid.
- UI: `EcranEquipes` (`limites?`) and `EcranConnecteurs` (`donnees.limites?`) grey the gesture at its limit (« Limite atteinte : 1 équipe sur 1. ») and give an administrator the link « Relever la limite » to `<raiseUrl>?capacity=<name>`; the reference host passes `orgLimitsView` to both.
- API: free signup (ADR-023), off unless the host passes `signup: { orgCreation, admit? }` to `handlePlateforme`. `POST /api/platform/signup` (`{ name, org, prefix, confirm? }`, `signupSchema`) is served without an organisation by the address, with a session: without `confirm`, the host's addresses (`orgCreation.addresses`) and nothing written (200); with it, the organisation, its tree, its addresses and its first member `admin`, no team, then `orgCreation.created` (201), and a `POST signup` line in the new organisation's journal. Refusals: `email_required`, `already_member` (the person already belongs to an organisation), `signup_refused` (the text of `admit`, in `details.text`), `conflict` on a taken slug, prefix or address. In OIDC mode the person's identity is created by the signup. In Supabase mode, account creation without invitation is the host's Auth setting (`hook_before_user_created` refuses it).
- UI: `FormulaireDInscription`, the signup island to mount in `EcranDAuthentification` on the host's page for a signed-in person without organisation; it leaves for the new organisation's address. With `conditions={{ libelle, url }}`, a required box links to the host's terms and the body carries `accepted_terms: true`; `admit` receives `acceptedTerms` to refuse without it and keep the proof. Without `conditions`, no box.
- UI: `AdressesDuRail.abonnement?` adds « Abonnement » to the company settings (administrators, breadcrumb, palette); absent, nothing shows. `/ui` also exports `Badge`, `Island`, `IslandHead`, `IslandBody`, `IslandFoot`, `SegmentedControl`, `Dialog`, `ConfirmDialog`, `Table` and `Column`, `Skeleton`, `SkeletonText`, `EmptyState`, `Checkbox`, `EnTeteDAdministration` (screen `abonnement`), for a host's own admin screens.

## 1.1.7 — 2026-09-30

### Hosts
- Install: upgrade to 1.1.7; no migration, no new variable, no import to change. In `next.config.ts`, add `experimental: { optimizePackageImports: ["@otomata_tech/oto_platform/ui"] }` (the subpath exactly: the package name alone does not cover `/ui`). Next then rewrites each import of the `/ui` entry to the module of the named export; without it, a layout or page that imports from `/ui` loads the client code of every screen (block editor, zod): 337 kB of JavaScript on `/login` (page and layouts), 151 kB with it; 322 kB on the dashboard shell, 219 kB with it. The « First Load JS » column of `next build` does not count layouts and hides it.
- UI: the `/ui` entry stays a file of re-exports only, which that rewrite requires (checked by a test).

### Hosts
- Install: upgrade to 1.1.6; no migration, no new variable. `app/opengraph-image.tsx` and `app/p/[jeton]/share-image/[[...chemin]]/route.tsx` import `ImageDePartage` and `TAILLE_DE_PARTAGE` from `@otomata_tech/oto_platform/share` instead of `/ui`; the root layout and the public page import `metadonneesDePartage` from it too. Imported from `/ui` by `app/opengraph-image.tsx`, the image put the client code of the whole `/ui` entry (block editor, zod) in the JavaScript loaded by every page: 104 kB shared by all pages in 1.1.4, 314 kB in 1.1.5, 104 kB again with `/share`.
- UI: new entry `@otomata_tech/oto_platform/share` (`ImageDePartage`, `TAILLE_DE_PARTAGE`, `metadonneesDePartage`), with no client module; `/ui` still exports the three.

## 1.1.5 — 2026-09-30

### Hosts
- Install: upgrade to 1.1.5; no migration, no new variable. For link previews (Slack, WhatsApp, LinkedIn, mail), add `app/opengraph-image.tsx` (`new ImageResponse(<ImageDePartage donnees={await shareImageData(requestHost(await headers()))} />, { ...TAILLE_DE_PARTAGE })`, `size = TAILLE_DE_PARTAGE`, `contentType = "image/png"`) and `app/p/[jeton]/share-image/[[...chemin]]/route.tsx` (`GET`, the same with `{ token: jeton, path: chemin?.join("/") ?? null }`); let `/opengraph-image` through the auth middleware; the root layout's `generateMetadata` spreads `metadonneesDePartage({ organisation, origine })` (request origin, organisation of the address), the public page's spreads `metadonneesDePartage({ organisation, page })`. The reference host (`src/`) shows each file. The rail's `GET nodes/tree` needs no route: the catch-all `/api/platform/[...route]` already serves `GET`.
- Server: `shareImageData(host, link?)` reads a share image's data without a session: the organisation of the address (name, theme, logo fetched by `fetchSource` as a PNG or JPEG `data:` URL, else `null`) and, with a public link, the title and summary `readPublicNode` serves; no node is read without a link; never throws (unknown organisation: `org: null`; unknown, revoked or out-of-scope link: `page: null`; a failure is logged `[platform] share image:`).
- Schemas: `ShareImageData`, the type `shareImageData` returns and `ImageDePartage` draws.
- UI: `ImageDePartage` draws a 1200 × 630 light share image as inline-styled JSX for `ImageResponse` (`next/og`, called by the host; the package does not import it): the theme's colour, the logo or the initial, the organisation's name; for a public link, its title and summary cut at a word; « Oto » and its mark without an organisation. `TAILLE_DE_PARTAGE` is its size. Default font of `ImageResponse` (Noto Sans).
- UI: `metadonneesDePartage({ organisation, origine?, page? })` gives `openGraph` (`site_name` = organisation, `og:url`, `og:description`) and `twitter.card = summary_large_image`, plus `metadataBase` from a `http(s)` origin; with `page` (`titre`, `resume`, `adresse`, `image`), the public link's title, cut summary and image (1200 × 630, `alt`). A private page (`/n/<path>`) sets none: its title never reaches a preview.
- API: `GET /api/platform/nodes/tree` answers `{ tree, truncated }`, the visible tree of the session's person (`visibleTree`, as the dashboard layout passes to the rail); a read, no journal line; 401 without a session.
- UI: `RailApplication` keeps its tree up to date without reloading the page: it re-reads it alone (`GET nodes/tree`) when the current path changes, when the tab is visible again or the window takes the focus (5 s at least after the last read), and after each page re-read; one read at a time; a failed read keeps the tree shown, and three in a row say it under the sections; a new tree served by the layout replaces it. Teams and the company name still come from the layout.
- UI: `useRafraichir()` still calls the host's re-read (`ContexteDeRafraichissement`) once, then asks the mounted rail to re-read its tree; `SectionsDuRail` mounted alone in an ERP sidebar does not re-read.
- UI: a checklist box in the editor shows the pointer cursor (the default one when read-only).
- UI: after a file is dropped on the upload form (`/upload/<token>`), the form says where it went, offers « Ouvrir la page », and opens the page that holds it 1.5 s later through the host navigation (`ContexteDeLHote`): `/n/<path>`, or the viewer `?view=<id>` of an attached `html` or `md` file. A refused drop opens nothing.
- UI: reading screens (node reader, public page, attached `.md` viewer) keep their text in a centered reading column whatever the width of a table; a simple table or a markdown table kept as text widens symmetrically up to the reading body, then scrolls in its own frame, a named region reachable with the keyboard; a markdown table kept as text now scrolls instead of being cut; the editor keeps its full width.

## 1.1.4 — 2026-09-30

### Assistants
- An HTML file sent by `upload.link` to Supabase Storage is stored, instead of failing with « the file storage kept NaN bytes ».

### Hosts
- Install: upgrade to 1.1.4; nothing else to do (no migration, no new variable).
- API: an HTML file uploads on Supabase Storage: `POST /api/platform/files/<id>/complete` no longer answers `conflict` « does not match its request (size) ». Its CDN compresses the size check of a file read back as `text/plain`; the storage adapter now reads the size uncompressed (`accept-encoding: identity`, else `content-range` of `bytes=0-0`).
- API: a size mismatch on `complete` says both sizes (« <n> bytes announced, <m> bytes stored ») and is logged (`[platform] files: size mismatch`) before the row and the object are deleted; a storage that gives no size answers `internal` and keeps the pending row and the object, so a later confirmation can pass.
- UI: in the editor, a diagram block out of focus reads as on the reading screen: the drawing, then its code folded under « Voir le code »; a click on the drawing, Tab or the keyboard opens the code field, and leaving it draws it again (formerly the code showed above the drawing).

## 1.1.3 — 2026-09-30

### Assistants
- A file sent by `upload.link` that the storage fails to keep says why (not reached, refused with its HTTP status, other size); a page created for it is removed, so a new link can create it.
- `upload.link` refuses a markdown file that is an HTML page, or served by `source_url` as `text/html`, instead of writing the page source as text.
- When curl cannot reach the platform (a proxy answers 403), `upload.link` says the fallback: `write` for a markdown file, `table.import` for a CSV, the form link otherwise.
- A column of dates can be the key of a table, named by `key` or proposed on import; a column of decimal numbers is never proposed as the key.
- Writing to someone else's personal space is refused with your account, organisation and own space; a title sent to your own space says to write at `private/<handle>/<page>`.
- A tool answering "context has changed" now gives a new ctx and the changed contexts as `context` serves them: the call is retried with that ctx, without calling `context` again.
- Publishing a context no longer invalidates the author's own ctx.
- `context` takes `since_ctx`: the routing of the phrase, the contexts changed since that ctx, and a ctx; it tests a phrase without reloading the context.
- Without a served procedure, `context` says the score that serves steps (the organisation's threshold and gap) and, for each candidate, the words of the request found in its title or summary.
- A request to change a text (not to delete) that no procedure matches gets the steps: `find` the exact words, then `write`. « Qu'est-ce que je lui réponds ? » is no longer a data question.
- `read` with `section`, or of a page served as its outline, no longer repeats the outline in the structured data.
- `read {"path": "functions"}` lists every function you can run, by connector, with its class.
- `find` gives the section of each block found and, to a writer, the `write` call with the revision.
- `table.rows` takes `match: "any"`: the rows with at least one word of `q`, most words first.
- A `write` that publishes is written whole or not at all: a refused publication leaves no draft and no new page, and a column removal to confirm gives the whole call to make again.
- A published `write` answers in one line: the revision, then what the write did.
- `call node.move` moves or renames a page, a procedure, a table or a folder with the pages under it; the old paths still lead to it, and the move shows in the home activity.
- `call node.write_many` writes up to 50 pages in one call, in order, one result line per page, and says which pages were written when it stops on an error.
- `write` takes `{op: set_markdown, text}` to replace the whole body from markdown; a YAML front matter is left out.
- `replace_text` works on the whole page or one `block`; `count` replaces that many occurrences, and a result that would outgrow its section or page is refused first.
- A new title's path is cut after its last whole word, and the answer says to call `node.move` to choose the path.
- A markdown file with a YAML front matter imported or sent by `upload.link` takes its title and summary from it, and the front matter is left out of the page.
- `add_section` after another section no longer fails with an internal error when the database rounds positions.

### Hosts
- Install: upgrade to 1.1.3, then copy and apply `20260930150000_v1_1_3.sql` (`oto-platform migrations sync`): policy `ctx_update_own` and `update (contexts)` on `platform.ctx` for `authenticated`; no table, column or index; part 2: `functions` joins the reserved team slugs (`teams_slug_reserved` recreated): a team whose slug is already `functions` makes it fail, give it another slug first.
- API: `table.rows` refuses a cursor from another query naming `match` among what changed.
- MCP: two functions join the `call` catalogue (`node.move`, `node.write_many`), and `write` gains the op `set_markdown` and the field `count`; its description changes: refresh the tool list in each host and replay the golden queries of `write`.
- Server: team slugs, CSV column names and path segments longer than their bound are now cut after their last whole word.
- MCP: `context` gains the optional `since_ctx`, `table.rows` the optional `match`; the refusal `ctx_stale` changes text; the descriptions of `context`, `read` and `find` change: replay their golden queries.
- API: `/api/platform/uploads/<token>` answers any other method the host mounts with `forbidden` (403, plain text) instead of the 401 of the session routes; the link is not used up.
- API: a file stored by the one-time upload link fails with a `conflict` that says what the storage did; a page the link created for it is removed; the server log still names the object left pending.
- MCP: the description of `upload.link` gains one sentence (the fallback when curl cannot reach the platform), and `table.import` says which columns can be proposed as the key: replay their golden queries.
- API: a table header accepts a `date` column as its key (`POST /api/platform/tables/import`, `write` of a table header), and the import screen offers it as a key.
- UI: on the « Contexte » view (`/context`), « À quoi sert cette page » sits in the column of the view's parts, aligned and as wide as they are, instead of against the left edge on a wide window.
- API: an HTML file uploads on a storage that rewrites its type (Supabase Storage reads it back as `text/plain`): `POST /api/platform/files/<id>/complete` and the one-time upload link check the object's size only, no longer answering `conflict` « does not match its request ».
- UI: a page with an image (attached or `https`) no longer fails on the server (« Application error », since 1.1.0) when read through its public link (`/p/<token>`), by a reader without write access (`/n/<path>`) or in the viewer of a `.md` file: the block rendering called a function of a `"use client"` module, which the server cannot call.
- UI: the block editor stays responsive on long pages: only the touched block mounts its text field (the others render as read-only text with the same look, keyboard-reachable), a keystroke re-renders only its own row, block menus are built when opened, and field heights are no longer measured one block at a time (CSS `field-sizing`, else one batched pass); ↑ at the start and ↓ at the end of a block move to the neighbouring block.
- UI: a mermaid block is drawn in the browser (page `/n/<path>`, public page `/p/<token>`, viewer of a `.md` file) instead of shown as text: its text stays as the server-rendered fallback and under « Voir le code », and a text mermaid cannot read says « Diagramme invalide » without breaking the page. The package gains the `mermaid` dependency (11.17.2), loaded on demand by the browser only: a page without a diagram downloads nothing more.
- UI: in the editor, « Diagramme » joins the styles and the « + » / « / » choices: a mermaid block is written in a field drawn as code, and drawn below it when the field is not focused; a code block becomes a diagram and back, keeping its text; an empty diagram is not sent.
- UI: a code block (and a diagram's text) reads as code: a dark background in the rail's tint, light and dark themes alike, with rounded corners, in the page and in the editor (`--code-bg`, `--code-fg`, `--code-mute`, `--code-bd` in `oto.css`).
- UI: the company menu (top of the rail) no longer shows Usage and Retours, even to the platform team, nor the « Suivi de l'entreprise » and « Réglages de l'entreprise » subtitles; both screens still open from the palette or their address, without a trail.
- UI: in the editor, a toggle is drawn as it reads (the same pill, chevron and panel): its summary and body read as rendered text until focused (their border shows on hover), and its chevron folds and unfolds the body on screen only (the fold is not saved).

## 1.1.2 — 2026-09-30

### Assistants
- `context` shows up to three candidate procedures with their title and summary, and the assistant picks the one that fits the request, searching or asking only when none does.
- A procedure `context` serves comes with the other candidates: when the request is about one of them instead, the assistant reads that one rather than following the served steps.
- What's new lists each content once, at its latest version.
- « Procedures you can run » gives the 15 most used procedures with their summary and the next ones by title only, so every procedure stays listed in fewer characters.

### Hosts
- Install: upgrade to 1.1.2; nothing else to do (no migration, no export added, changed or removed).
- API: `GET /api/platform/search/recent` (optional `exclude=<path>`) serves the caller's recent contents, which the editor's « @ » list shows before anything is typed; served by `handlePlateforme`, nothing to mount.
- UI: a bare web address in a text shows its scheme, host and the end of its path, the middle cut by an ellipsis, instead of its domain alone; the host shown, in its tooltip and accessible name too, is the one the browser opens (a backslash or a user name cannot disguise it, an international domain shows in punycode), never its user name or password.
- UI: the « Contexte » view (`/context`) explains under its title what the context is, how it is served and in which order it is built; « Rangés sous ce contexte » and « Pages citées » sit in the foldable panel of a Context screen, open.
- UI: a link to a Context and its line in a page's side panels show the Context's name as elsewhere on screen (« Contexte · SAV »), not its stored title; a hand-written label is kept.
- UI: a page's side panels cut a long title with an ellipsis and no longer show summaries; a page stays centred at 110 to 150 % browser zoom without horizontal scroll; « Partager sur le web » opens anchored to its button, at most 70 % of the window high.
- UI: `/connect` separates the steps of the connection guide; « Ce que les assistants… » now reads « Ce que votre Claude/ChatGPT/Mistral… »; a data table's « Importer un fichier… » moves to its header buttons, dropping a `.csv` on the table still works.
- UI: in the editor, a simple table has a tinted header and cell borders on hover or focus only; table, file and image blocks follow the design system; an image keeps its proportions; a block's handle menu fits its entries; bold, italic, code and strikethrough render at rest; editing a link shows no spell-check underline; a left click opens a link, a right click (or Menu, Shift+F10) edits it; « @ » lists your recent contents, the page being edited excepted, before anything is typed.
- UI: the editor selects whole blocks: ⌘A (Ctrl+A) a second time in a field, Escape then Shift+↑↓, Shift/Ctrl/⌘+click on the handles, a rectangle drawn from the margin, a drag that leaves its block; Delete, ⌘X and ⌥↑↓ act on the selection in one write with a single « Annuler », ⌘Z outside a field undoes it; ⌘C copies its markdown, the same as the `.md` export.
- API: a `POST /api/platform/nodes` from the screens takes as many operations as a page holds blocks (1,000), so a selection is deleted or moved in one write; `write` from an assistant keeps its 50 operations per call.

## 1.1.1 — 2026-09-30

### Hosts
- Install: 1.1.0 did not build in a host that installs the package from npm (an import cycle in `schemas/`, `next build` failing with « Cannot access … before initialization » on the page that imports `publicFilesRoute`): upgrade to 1.1.1. From 1.1.0, nothing else to do (no migration, no export changed); from 1.0.0, go straight to 1.1.1 and follow the steps of 1.1.0 below (renamed addresses, migration `20260930100000_v1_1_0.sql`).
- Migrations: known issue: on a Supabase project where `pg_trgm` already exists, `supabase db push` of the V1 baseline stops on `permission denied to set parameter "pg_trgm.similarity_threshold"` (42501); workaround in `migrations/README.md` (« Installer sur un hôte neuf », « Défaut connu »).

## 1.1.0 — 2026-09-30

### Assistants
- Without a clear match, `context` offers every shown candidate as a choice for a question, a « comment » question or a polite request; it answers or explains first and runs nothing unpicked.
- `context` matches a procedure on each phrasing its summary lists, weighs rare words above common ones, and forgives a typo in the request through the organisation's lexicon.
- Content in the trash no longer takes a place among `find` and `context` results before their cut: a live match ranked lower now shows instead.
- `write` reads GFM tables, `---` dividers, `<details>` toggles, lists nested three levels deep and headings down to `######`; `read` and `context` serve them back in the same form.
- Page text shows ~~strikethrough~~, backslash escapes, `<br>`, a mark inside a mark of another character and `<https://…>` links; `\[[path]]` is not a link.
- Publishing a procedure refuses a `call` fence inside a table cell, a toggle or a sub-item, as in a paragraph; a step stays a top-level item of the numbered list.
- `call table.import` files a CSV into a new table (`create`) or an existing one: 40,000 characters per call, each piece starting with the header line, rows merged on the key.
- The `write.table` contract says a CSV the user gives you becomes a table through `table.import`, and a markdown file a page whose first # heading is the title.
- A ctx expires only when a Context served to your conversation changes, and the refusal names which; `feedback` accepts an expired ctx.
- `context` serves each block whole, up to 35,000 characters in all; beyond, the cut is said, with the `read` call that gives the rest.
- `write`: `move_block` takes `section` to move a block to the end of that section; `append` continues the list that ends the section.
- `call table.write` takes `create_only: true`: a key that already exists is refused (conflict) with the row as it is, and nothing is written for it.
- `table.rows` finds rows by words: each word of `q`, in any order, without case or accents, in any searchable cell, e.g. "mairie valbrune".
- `table.schema` gives the table's revision; `table.rows` with `provenance: true` shows the MCP client (`host`) and the `worker` behind each value.
- A column with `allow_verified_empty: false` needs a real value; a table whose review has `agents_may_decide: true` lets you set approve or reject.
- Proof is per table: a new value needs `{value, comment | link}` only where the header says `proof: true`, as `table.schema` tells.
- `write` publishes by default and says « Next write: base_revision N. »; pass `publish: false` to keep an unpublished draft, e.g. until the last call of a long procedure.
- Whoever can write a node publishes it, a table's header included; a published title moves the path at that level, and the old path still leads to the node.
- `call node.discard_draft` drops a node's pending draft, such as a refused table header, back to its published revision; a refused header says to do so.
- `call node.trash` moves a node to the trash (manage level, restorable 30 days on screen); `call table.delete_rows` deletes rows by key for good, naming those in review.
- `call table.import` with `create` needs the write level on the parent, no longer manage.
- `read` of a page shows an attached image as `![alt](<link>)` and a file as `[name (size, type)](<link>)`; `write` keeps both forms, only for files already attached to that page.
- `read` with `file` = the id from a file link serves the text of an attached html, md, txt or csv file alone, in its own fence; long files come in parts.
- `call upload.link` gives a one-time link (15 minutes, 1 MB) to put a file on your disk in a page, or a `.md` or a CSV in a page or a table: send it with the curl command it returns.
- Without a shell, `upload.link` takes `source_url`, a public https address the server downloads; otherwise give the person `form_url`, a one-time upload form.
- `find` finds an attached file by its name.

### Hosts
- Migrations: run `oto-platform migrations sync`, then apply `20260930100000_v1_1_0.sql`, the one additive migration of this version: `platform.lexicon_fix` (no client role executes it), `route_candidates` (two more columns, `s_phrase` and `lexical_title`) and `search_content` recreated; `ensure_private_space`, which at application sets every missing member handle and creates the « Privé » space and its Context of each member who had none; `blocks_type_check` and `blocks_shape_check` widened (block types `simple_table`, `divider`, `toggle`, `file`; nested list items; heading levels 1 to 5; `image` with `file_id`, `width`), every existing row staying valid; the column `platform.ctx.contexts` (every conversation open at the upgrade calls `context` once more); `discard_draft` (security definer, granted to `authenticated`); the tables `platform.files` and `platform.upload_tickets`, `public_file_by_token` and `consume_upload_ticket` (granted to `anon` only); `duplicate_subtree`, `block_search_text` and `forget_user` recreated. A database that applied one of its six development files follows `migrations/README.md` (« Hôtes qui avaient appliqué une migration de la 1.1.0 »).
- Install: attached files are optional: set all five of `PLATFORM_STORAGE_ENDPOINT`, `PLATFORM_STORAGE_BUCKET`, `PLATFORM_STORAGE_REGION`, `PLATFORM_STORAGE_ACCESS_KEY_ID`, `PLATFORM_STORAGE_SECRET_ACCESS_KEY` (S3 access keys, never `service_role`), or none: without them, files are disabled and everything else works.
- Install: the bucket is private, its CORS allows `PUT` and `GET` from each address of the application with the `content-type` header; a host CSP allows the bucket's origin in `img-src` and `connect-src`, and `frame-src 'self'` (package README).
- Install: pinned dependency `aws4fetch` 1.0.20 (S3 signing, no AWS SDK).
- Install: exclude `api/platform/files/<id>/html` and `api/platform/public/<token>/files/<id>/html` from a global `X-Frame-Options`, `Referrer-Policy` or CSP (ADR-017): source `/((?!api/platform/(?:public/[^/]+/)?files/[^/]+/html/?$).*)` in the reference `next.config.ts`.
- Install: addresses are in English, without alias or redirect, and an old one answers 404 (ADR-020): rename the route folders `/equipes` to `/teams`, `/profil` to `/profile`, `/corbeille` to `/trash`, `/plateforme` to `/platform`, `/aucune-organisation` to `/no-organization`, `/auth/confirmer` to `/auth/confirm`, `/admin/organisation` to `/admin/organization`, `/admin/connecteurs` to `/admin/connectors`, `/admin/retours` to `/admin/feedback`, and every address the host gives the screens or passes to `redirect()`.
- Install: drop the pages `/admin/acces`, `/admin/marque` and `/admin/drapeaux` and the `/plateforme/invitations` redirect of `next.config.ts`; `/journal` keeps its name.
- Install: mount the screens' API on `app/api/platform/[...route]/route.ts` (`PLATFORM_API_PREFIX`, exported by `./schemas`); `/api/plateforme/*` now answers 404, so every screen mutation fails until the route moves.
- Install: add `/auth/confirm` to the Supabase Auth redirect URLs (`pnpm auth:settings --redirect`, then remove the `/auth/confirmer` one) and to the middleware's public routes; an invitation sent before this version leads to a 404: send it again.
- API: `GET nodes/export?path=` (the `.md` of a published node) and `GET tables/export?path=` (the `.csv` of a table, 5,000 rows at most) answer `{filename, content}` and are reads, never journaled; `POST tables/import` writes one lot of 500 CSV rows at most, creating the table for who can write its parent.
- API: the body of `POST nodes` takes `tolerant: true` (paste and file import: nothing refused, `kept_as_text` counts what stayed text); `write` over MCP stays strict.
- API: default changed: `write` and `POST nodes` publish by default; `publish: false` keeps a draft; publishing a node or a table header needs the write level, no longer manage.
- API: `GET public/<token>` and `readPublicNode` return `language`, the organisation's, which sets the separator of a public table's CSV.
- API: `GET files`, `POST files`, `POST files/<id>/complete`, `GET files/<id>` (302 to a 60 s presigned URL; `?check`, `?disposition=inline`), `GET files/<id>/markdown`, `GET files/<id>/html`; outside any session `GET public/<token>/files/<id>` (with `/markdown`, `/html`) and `POST uploads/<token>`, never behind CORS.
- API: `POST nodes/duplicate` copies the attached files, counted in the 10 GB quota; the trash purge deletes the files of purged nodes and their objects.
- MCP: six tools, unchanged, but the descriptions of `write` (its `publish` field, `move_block` into a section), `read` (optional field `file`) and `call` change: refresh the tool list in each host after upgrading; `table.import`, `node.discard_draft`, `node.trash`, `table.delete_rows` and `upload.link` join the `call` catalogue; the table functions, described through `read`, need nothing.
- MCP: the `not_enabled` refusal links `<origin>/admin/connectors` and `node.trash` points to `<origin>/trash`: the host serves both routes; the tool list and schemas are unchanged.
- Server: routing scores change for every organisation; an `orgs.settings.routing` threshold keeps its 0 to 1 scale, not its calibration: replay your routing phrases after upgrading.
- Server: `context` returns up to 35,000 characters (20,000 before), each block whole; `previewContext` and the « Contexte » view follow.
- Server: the header attribute `proof` defaults to false: an existing table no longer requires proof until `header: {"proof": true}` is published through `write`; the review queue shows « sans preuve » only then.
- Server: the `node.` namespace belongs to the package's native `node` connector: `registerFunctions` refuses an ERP function named `node.*`.
- Server: the journal line of a `table.delete_rows` run carries `_outcome` (`deleted`, `review`) among its arguments, shown by the journal screen and `admin_journal`.
- Schemas: `./schemas` exports the CSV functions (`parseCsv`, `columnNameOf`, `inferTable`, `checkImport`, `toCsv`…), `pageMarkdown`, `readPageMarkdown`, `tableImportArgsSchema`, `tableImportBodySchema` and the import bounds (`IMPORT_*`).
- Schemas: `./schemas` exports `queryWords`; `tableHeaderSchema` gains `proof`, `tableColumnSchema` `allow_verified_empty`, `tableReviewSchema` `agents_may_decide`.
- Schemas: `./schemas` exports `rowCells`, `keyValue` (moved from the server) and `PUBLIC_TABLE_ROWS_MAX`.
- Schemas: URL keys renamed in place, an old name ignored like any unknown parameter: `equipesSearchSchema.tab` (`members`, `teams`); `equipesListesSchema` `filter`, `sort` (`team`, `people`), `order`; `journalFiltersSchema` `period`, `team`, `person`, `errors`, `cursor`, `calls`; `feedbackListQuerySchema` `state`, `period`, `cursor`; `usageQuerySchema` `period`, `team`; `proceduresSearchSchema.team`; `tableScreenParamsSchema.sort`; `nodeVersionParamSchema` takes `published`.
- UI: `EcranDAccueilProps` loses `hrefDesGuides`; `DonneesDeLAccueil.adresse` is a whole `AdresseDeConnexion` (url, nom, nomCli, phrase), no longer a string.
- UI: the `prompts` prop of `EcranConnexion` takes the useful procedures (`usefulProcedures(db, identity, 3)`), no longer `listPrompts`; `/connect` shows the connection guide, then « Vos connexions ».
- UI: « Brancher mon Claude, ChatGPT ou Mistral » replaces « Brancher un assistant » in the account menu, the palette, the home card and `/connect`; the home card no longer shows the server address.
- UI: the home page no longer reads `?onglet=`; give the rail `adresses.contexte` (`/context`) and mount `EcranDuContexte` on that route (example: `src/app/(dashboard)/context/page.tsx`).
- UI: `ContexteServi` and `EcranDAccueil` lose `hrefDuProfil`; `EcranDAccueil` loses `onglet` and `hrefDOnglet`; `ONGLETS_DE_L_ACCUEIL` and `OngletDeLAccueil` are no longer exported.
- UI: headings render one level lower: a heading of level N is an `h(N+1)`, at most `h6` (`h(N+2)` under `baliseDeTitre="h3"`); level 2 and 3 headings already written become `h3` and `h4`.
- UI: pages show the new blocks (simple table scrolling inside its block, divider, toggle closed by default, nested lists); in the editor, a block's « + » and `/` in an empty text open a choice in two groups (« Texte », « Insérer »), and a simple table, a divider and a toggle are written on screen.
- UI: the rail's « ⋯ » offers « Télécharger en .md » (page, procedure, Contexte) and « Télécharger en .csv » (table); « Importer un fichier… » in the rail's « + », or a file dropped on a rail line, imports a `.md` as a page or a `.csv` as a table; to who writes a table, its screen offers « Importer un fichier… » above the table and takes a dropped `.csv`.
- UI: the editor draws one marker per list item, on its first line, and edits a link in a « Lien » panel; nothing for the host to do.
- UI: a node created from the rail is published at once; the draft banner, « Voir la version publiée » and « La publication revient… » are gone; the home feed says « a supprimé des lignes dans …, dont N à revoir ».
- UI: a table's header offers « Réglages » to who writes it (proof required, review decided by the assistant, closed), published through the page's queue; nothing for the host to do.
- UI: `TableauDuNoeud` takes `assistant?`, the most recent family of `lastConnections`, read by the host for a table without rows (example: `src/app/(dashboard)/n/[...chemin]/page.tsx`); an empty table names that assistant.
- UI: `EcranDeNoeud` always lays a page, a procedure or a Contexte out in two columns, « Cité dans », « Cite » and « Sous-pages » folded on the right; a node's header and the public page offer « Télécharger en .csv/.md ».
- UI: pass `fileView` (`/n/…`) or `publicFileView` (`/p/<token>/…`, with `routeDesFichiers={publicFilesRoute(<token>)}`) for `?view=<id>` to show the viewer of an attached `html` or `md` file.
- UI: add the page `/upload/<token>` under the session: it passes `uploadForm(db, identity, token)` to `EcranDeDepot` (example: `src/app/(dashboard)/upload/[token]/page.tsx`); its form posts to `POST uploads/<token>/form`.
- UI: a grid's `f=` clause is `<column>:<contains|eq|gte|lte|empty|not_empty>:<value>`, a boolean `true|false`, and the « Filtrer » form sends `column`, `contains`, `eq`, `min`, `max`, `presence` (`empty`, `not_empty`); an older clause is dropped and said; `Operation` takes these names, `CHAMP_DE_L_OPERATION` maps them to the form fields.
- UI: the brand form returns to `?saved=1` (the host reads it for `enregistre`), a consent to redo carries `?error=decision`; anchors are `news`, `recent-content`, `everyone-context`, `private-context`, `context-<slug>` and `part-<n>`.
- CLI: `pnpm org:export` and `pnpm org:import` need the five storage variables when the organisation has attached files, and carry their bytes in `<file>.files/`.

## 1.0.0 — 2026-09-28

### Assistants
- Six tools named with your organisation's prefix: `context`, `find`, `read`, `write`, `call`, `feedback`; the list only ever grows.
- Call `context` first with the user's request: it returns the ctx code every other tool requires and starts with « How this workspace works » (tools, spaces, drafts, confirmation).
- `context` always says the reply language (« Reply in French unless the user writes in another language. »), from the profile, then the organisation, then French.
- A ctx expires when a Context (rules, tone) is published: the refusal says to call `context` again. Every result carries the same content as text and as structured content.
- `context` serves the steps of the procedure that clearly matches the request, or candidates with an instruction; it only weighs procedures the person can read.
- `context` serves the person's Contextes (everyone, private, teams), each opened by a facts line, with the contents filed under it; then what's new, useful procedures and recent content.
- `find` searches titles, summaries, content and table rows, says where each match is, forgives a typo as a last resort, and lists matching catalogue functions.
- `read` serves a node: whole page, one section, its outline, changes since a revision, the draft, links in and out; long pages come in parts.
- `write` creates and edits pages, procedures and tables by section or by block on a shared draft, and publishes with `publish: true`; a stale revision is refused.
- A published title moves the node to a path that follows it, the first free one if taken: `write` says « Renamed: now at <path> », and the old path stays an alias.
- Personal spaces live under `private/<handle>`; an old `perso/…` path still serves its node and says where it moved.
- A block written by a newer platform version shows as a comment line in `read` and `context`; `write` refuses with `conflict` any operation that would lose it.
- Links are written `[[path]]`; a `reference` block shows a line of another node; after a move or a rename, the old path still leads to the node, with a moved to line.
- Publishing a procedure checks every call block first and returns every problem at once; `read` serves the `write.procedure` and `write.table` contracts.
- `call` runs catalogue functions (native ones, `table.*`, the ERP's business functions); a sensitive one first returns a summary and runs only with `confirm: true`.
- Each `call` report names the team and the connector account used, and says when the account is simulated; in this version the `mail` connector is simulated.
- `table.schema`, `table.rows` and `table.aggregate` read a table; `table.write` needs a comment or a link as proof of a new value; `table.claim` and `table.release` share its work queue.
- `read` with path `journal` shows your conversations of the last 24 hours or 7 days and their calls; secret values are masked.
- `feedback` files a ticket numbered per organisation (FB-0001), linked to the ctx; the same report sent again within 10 minutes returns the same ticket.
- Published procedures you can read are offered as prompts, up to 20 in path order; each prompt sends the procedure's title.
- Content in the trash is hidden from `find`, `read`, `context` and prompts until it is restored.
- The admin connector, for the platform team only: `admin_context`, `admin_org`, `admin_team`, `admin_node`, `admin_connector`, `admin_journal`, `admin_feedback`, `admin_cell`.
- Each team part names all its leads; team parts come in name order; connector lines sit in the part of the team that has the account.
- A call with no team named runs under your only team with that account; if several could, it is refused with `ambiguous_team`.

### Hosts
- Install: `pnpm add @otomata_tech/oto_platform@1.0.0`, an exact version; peer dependencies `next` 15, `react` and `react-dom` 19, `@supabase/supabase-js` 2, `@phosphor-icons/react` 2, `zod` ^3.25, `react-hook-form` ^7.55, `@hookform/resolvers` 5.
- Install: pinned dependencies of the package: `@modelcontextprotocol/sdk` 1.26.0, `mcp-handler` 1.1.0, `jose` 6.2.12, `nodemailer` 10.0.10 (Node 20 or later), `postgres` 3.4.9.
- Install: the package ships TypeScript sources: add it to `transpilePackages` in `next.config.ts`; with pnpm 12, add it to `minimumReleaseAgeExclude` to receive each version as soon as it is published.
- Install: Renovate: extend `github>otomata-tech/oto-pkg//renovate/preset` in `renovate.json`; the version stays pinned, minors and patches merge when CI passes, a major waits for review under the label `oto-platform-major`.
- Install: `PLATFORM_DATABASE_URL`, server side only, is required by every request: the package's own Postgres connection, role `platform_app` (created by `oto-platform db prepare`), on Supabase the transaction pooler (port 6543); TLS off the local machine. No service key in the application.
- Install: identity issuer, one per host: Supabase Auth by default (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, asymmetric JWT keys), or an OpenID Connect issuer (Logto, Keycloak) with `PLATFORM_OIDC_ISSUER`, written exactly as in `iss`, and `PLATFORM_OIDC_AUDIENCE`, the MCP address.
- Install: with an OIDC issuer, invitations are emailed by the platform through `PLATFORM_SMTP_URL` and `PLATFORM_MAIL_FROM` (TLS required; a missing variable refuses the invitation), consent happens at the issuer, and the reference host signs in with `PLATFORM_OIDC_CLIENT_ID`, `PLATFORM_OIDC_CLIENT_SECRET` and `PLATFORM_SESSION_SECRET`.
- Install: `NEXT_PUBLIC_SITE_URL` is read by the cell health check; the reference application's `src/app/` is the model of every route and page to mount.
- UI: in `globals.css`, after `@import "tailwindcss";`, add `@source` on `node_modules/@otomata_tech/oto_platform/ui` and `@import "@otomata_tech/oto_platform/ui/styles.css"`: the design system ported from oto-frontend, eight themes, Inter and JetBrains Mono (SIL OFL 1.1).
- UI: mount `CoquilleOto` once, in the authenticated layout, with `preferredTheme(identity)` (the person's colour, else the organisation's); night follows the host's `.dark` class; pages inside it use the package screens and Oto classes, not the host's own tokens.
- UI: lend the screens your router from a client component: `ContexteDeLHote` (link, current path, navigation, logout) and `ContexteDeRafraichissement` (`() => router.refresh()`); without the latter a screen reloads the whole document.
- UI: three ways to mount the screens, one shell visible at a time: the whole shell (`Desk`, `RailApplication`, `Content`), the rail pieces in the ERP's own sidebar (`EntrepriseDuRail`, `RechercheDuRail`, `SectionsDuRail`, `PiedDuRail`), or one screen inside an ERP page.
- UI: screens, each with its loading state: `EcranDAccueil` (`/`, tabs « Activités » and « Contexte » through `onglet` and `hrefDOnglet`; `DonneesDeLAccueil` takes `activites` from `listActivities` and `procedures` from `usefulProcedures`, shown as « Procédures les plus utilisées »), `EcranDeNoeud` and `TableauDuNoeud` (`/n/[...chemin]`), `EcranEquipes` (`/equipes`, « Équipes & accès »), `EcranDuJournal` (`/journal`), `EcranConnexion` (`/connect`, connect an assistant), `EcranProfil` (`/profil`, every member), `EcranDeLaCorbeille` (`/corbeille`, restores under the nearest ancestor).
- UI: the rail's addresses (`AdressesDuRail`): `profil` and `corbeille` open from the account menu (Profil, Brancher un assistant, Corbeille, Déconnexion), `connecteurs` sits at the bottom of the rail for administrators; an absent address removes its entry.
- UI: administration screens under `/admin/*`, reserved to administrators (`reserveAuxAdministrateurs`): `EcranOrganisation` (organisation, brand, language and the « Contexte · Tout le monde » island), `EcranConnecteurs`, `EcranUsage`, `EcranRetours`; redirect `/admin/marque` and `/admin/drapeaux` to `/admin/organisation`, and `/admin/acces` to `/equipes?onglet=acces` (308).
- UI: authentication screens under `<CoquilleOto pleinePage>`: `EcranDAuthentification` with `IlotDAuthentification`, `AucuneOrganisation` (`/aucune-organisation`), `Consentement` (the OAuth consent page, `/oauth/consent`).
- UI: mount the public share page on `/p/<token>`, outside the session (`readPublicNode`): read-only, `noindex, nofollow` in header and tag, in no sitemap; a link serves only the last published version of what its author reads at that moment, a table as a read-only grid of 500 rows at most; the organisation settings list public links and revoke them.
- UI: on the « Contexte » tab, read the Contexte of every preview part by `cheminDuContexte`, served or not, and skip a `not_found`: a writable draft Contexte then shows its editor.
- UI: every choice list of the screens is a popover `Select` (keyboard per the select-only combobox pattern) over a hidden input; without JavaScript a GET filter keeps its served value.
- UI: a procedure is edited and read like a page on screen (text only, call blocks shown as text); assistants still receive it through `context`, prompts and the publication check.
- UI: mount `FaviconDuTheme` once in the root layout (tab icon in the organisation's theme) and keep a static `app/icon.svg`; under a Content Security Policy, `img-src` must allow `data:`.
- UI: design-system primitives (`Alert`, `Button`, `Field`, `Input`, `DropdownMenu`, `Rail`, `RailItem`, `RailSection`, `RailTree`) are exported for host pages under `CoquilleOto`; `ErreurDeLecture` renders a read failure.
- Schemas: shared Zod schemas (`zod/v4`) of forms, API and tools, and pure block rendering (`renderBlocks`, `splitSections`), usable by every face, `ui/` included.
- API: mount `handlePlateforme` on `app/api/plateforme/[...route]/route.ts` (`GET`, `POST`, `PATCH`, `DELETE`) with `{ accessToken, host: rawRequestHost(request.headers), defer: (task) => after(task) }`: the same-origin door of every screen mutation, each one journaled.
- API: `PATCH profile` (`first_name`, `last_name`, `theme`), `PATCH brand` (`language`: `fr`, `en` or `null`, kept when absent); `POST nodes/move` takes the first free path when `new_path` is taken and returns it in `data.path`.
- API: rail gestures and sharing: `POST nodes/position`, `POST nodes/duplicate`, `GET nodes/impact`, `POST nodes/access` (the whole organisation at a level, ADR-014), `GET nodes/links`, `GET|POST trash`, `POST trash/restore` (30 days), `GET|POST shares`, `DELETE shares/<id>`, `GET public/<token>` outside any session.
- API: answers are `{ data }` or `{ error: { code, message, details? } }` with the HTTP status; a race lost between the decision and the write answers 409 `conflict`, a stale revision 409 `stale_revision`, a token refused 401 `unauthorized`.
- MCP: mount `app/api/mcp/route.ts`: `POST` calls `handleMcpPost(request, { verifyToken: makeVerifyToken(), defer: (task) => after(task) })`, `GET` and `DELETE` return `mcpMethodNotAllowed()`, with `maxDuration = 60` and `dynamic = "force-dynamic"`; the route checks the token itself.
- MCP: mount `handleAdminMcp` on `app/api/mcp-admin/route.ts` the same way (401 outside the platform team); its optional `orgCreation` hook (`OrgCreationHook`) adds addresses once an organisation is created.
- MCP: mount `handleResourceMetadata` (`GET`) and `metadataOptions` (`OPTIONS`) on `app/.well-known/oauth-protected-resource/[[...path]]/route.ts` (RFC 9728); keep `/api` and `/.well-known` public in the middleware.
- MCP: on Supabase Auth, enable its OAuth 2.1 server with dynamic registration and set « Authorization Path » to `/oauth/consent`, a page that renders `Consentement` and decides with `consentRequest` and `consentDecision`; let its `POST` through the middleware without a session.
- Server: build the client with `createPlatformDb({ caller })`, the verified caller of the session: `{ userId, email, name }` on Supabase Auth (`callerName(user)`), `{ issuer, issuerKind: "oidc", subject, email, name }` with an OIDC issuer; each operation runs in one transaction (`db.tx`).
- Server: `resolveIdentity(db, host, { email })` gives the organisation of the request address, the person, role, teams and platform access (`readProfile` and `preferredTheme` read the person's profile and colour); services decide rights before each request and throw `PlatformError` with a named code.
- Server: ERP business functions: `defineErpFunction` and `registerFunctions([...])` in `src/lib/fonctions-metier.ts`, imported first in the three routes above; they run under the caller's token (`ctx.accessToken`); a bad list throws `CatalogRegistrationError` at route load.
- Server: call `acceptInvitations` at every sign-in return; `createAnonPlatformDb()` serves the only anonymous reads, the brand of an address (pages without a session such as `/login`) and a public share link; flags are declared in `FLAGS` (empty in 1.0.0) and read with `isEnabled(org, name)`.
- Migrations: the SQL touches only the `platform` schema and only adds; every table is under row level security, which keeps the boundary between organisations while services decide levels and roles.
- Migrations: a new host applies, after `db prepare`, the V1 baseline `20260928100000_platform_base_v1.sql` and the migrations after it, in order; a host that applied the former chain follows `migrations/README.md` (« Hôtes déjà installés ») once.
- Migrations: extensions `pg_trgm`, `unaccent` and `ltree` in schema `extensions`; no reference to `auth.users` and no `moddatetime`: the schema installs on Supabase and on a bare Postgres.
- Migrations: on Supabase, declare `platform.hook_before_user_created` as the Auth hook « Before User Created » (only invited people sign up, Google and Microsoft included) and remove `platform` from the Data API exposed schemas.
- Migrations: rows your tooling inserts in `members` and `platform_staff` carry `email` (lower case) and `name`; call `platform.forget_user(<id>)` before deleting an account at the issuer.
- CLI: `oto-platform migrations sync|check`: `sync --to supabase/migrations` copies the package migrations missing from the application and never overwrites a changed copy; `check` refuses anything outside `platform`, any removal, a function without `revoke execute … from public`, a tie to `auth.users` or another extension. Run `sync` after every upgrade, `check` in CI.
- CLI: `oto-platform db prepare --db-url <url>`, once before the migrations: on a bare Postgres it creates the roles `anon` and `authenticated`, the `auth` schema (`uid()`, `jwt()`, `role()`) and the three extensions; on any host the login role `platform_app` (password from `PLATFORM_APP_PASSWORD`); TLS unless the URL sets `sslmode`.
- CLI: `oto-platform --help` gives usage and exit codes (0 success, 1 refusal, 2 wrong usage); from a clone of the repository, `pnpm auth:settings`, `pnpm data-api:close` and `pnpm platform:staff` set a Supabase project's Auth, close its Data API and manage the platform team.
- `CONTEXT_INDEX` (schemas): titles and line form of a Contexte's index lists served by `context`; the home Contexte view shows them as links under the editor of a Contexte the person can write.
- Teams: several leads per team (`team_members.role`), `PATCH teams/:id/members/:userId` { role }, `setTeamMemberRole`; the Teams & access screen keeps members and teams only (`/admin/acces` redirects). The default team is gone from screens and services (`TeamView.leadUserId`, `MemberView.defaultTeamId`, `Identity.member.defaultTeamId` removed; columns emptied by migration `20260929090000`, dropped in 1.1).
- Organisation screen: one name, no work domains; its Contexte insert lists the contents filed under it. Usage is hidden; feedback is for the platform team only (`handlesFeedback`); Journal sits in the settings menu; the node header no longer has « Déplacer ».
