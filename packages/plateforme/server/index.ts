// Face server : services, seule porte d'écriture vers la base.
export {
  ACCESS_LEVELS,
  ACCOUNT_LEVELS,
  accountLevel,
  describeOwner,
  isOrgAdmin,
  nodeLevel,
  nodeOwner,
  requireAccountLevel,
  requireNodeLevel,
  reservedTo,
  unknownPath,
} from "./access"
export type { AccessAction, AccessLevel, AccountLevel, NodeAction, NodeOwner, Owner } from "./access"
export { cellStatus } from "./cell"
export type { CellStatus } from "./cell"
export { createAnonPlatformDb, createPlatformDb, PlatformConfigError, PLATFORM_SCHEMA } from "./db"
export type { PlatformDb } from "./db"
// E01-S10 : l'appelant vérifié que l'hôte passe à `createPlatformDb`, et son nom tiré de la session.
export { callerName } from "./sql"
export type { Caller } from "./sql"
export type { Database } from "./database"
export { fromDatabaseError, HTTP_STATUS, isPlatformError, PLATFORM_ERROR_CODES, PlatformError } from "./errors"
export type { PlatformErrorCode } from "./errors"
export { FLAGS, isEnabled, listFlags, setFlag } from "./flags"
// E12-S02 (ADR-022) : les capacités d'une organisation, dont l'hôte enregistre la source ; l'état pour les écrans.
export { orgLimitsView, orgUsage, registerOrgLimits } from "./limits"
export { readOpenEntry, setOpenEntry } from "./open-entry"
// Les données servies aux assistants (`pseudonymisation.md` § Les quatre primitives) : le contenu des fichiers joints
// servi ou retenu, par l'hôte.
export { registerDataPolicy } from "./data-policy"
export { registerSensitiveEntities } from "./pseudonym/declaration"
export type { SensitiveEntity, SensitiveKind, SensitiveOptions, SensitiveOrg, SensitiveValues } from "./pseudonym/declaration"
export type { EntityFields } from "./pseudonym/outputs"
export { invalidateSensitiveEntities, pseudonymize } from "./pseudonym/service"
export type { DataPolicy, FileContentsPolicy } from "./data-policy"
// Les lecteurs de fichiers (`lecture-des-fichiers.md` § Le registre des lecteurs) : l'hôte inscrit les siens, qui ouvrent
// au dépôt les types qu'ils lisent ; les bornes communes, que son lecteur tient (décompression).
export { defineReader, registerReaders } from "./files/readers/registry"
export { READER_LIMITS, ReaderStatusError } from "./files/readers/types"
export type { Reader, ReaderDocument, ReaderInput, ReaderPart, ReaderStatus, ReaderStatusCode, ReaderType } from "./files/readers/types"
export type { OrgLimitsSource, OrgUsage } from "./limits"
export {
  identityInOrg,
  normalizeHost,
  orgContact,
  rawRequestHost,
  requestHost,
  servedHost,
  type ServedHost,
  requestOrigin,
  resolveIdentity,
  resolveOrg,
  trustedRequestOrigin,
} from "./identity"
export type { Identity, IdentityOrg, IdentityTeam, MemberProfile, TrustedOriginOptions } from "./identity"
export { acceptInvitations, invitationOptions, inviteMember, listInvitations, revokeInvitation } from "./invitations"
export type { InvitationOptions } from "./invitations"
export { brandSettings, readBrand, updateBrand } from "./brand"
export type { Brand, BrandSettings } from "./brand"
export { listPrompts } from "./prompts"
export type { ProcedurePrompt } from "./prompts"
export { CONSENT_PATH, consentDecision, consentPath, consentRequest } from "./oauth"
export { listMembers, listPlatformAccess, removeMember, revokePlatformAccess, updateMember } from "./members"
export { addTeamMember, createTeam, deleteTeam, listTeams, removeTeamMember, teamSlug, updateTeam } from "./teams"
export { listNodeRules, listRuledNodes, removeRule, setNodeRule } from "./rules"
export { connectAddress, lastConnections } from "./connect"
export type { ConnectAddress, LastConnection } from "./connect"
export { closestExisting, findNode, parentPath, ROOT_PATH } from "./nodes/lookup"
export type { NodeRow } from "./nodes/lookup"
export { loadBlocks } from "./nodes/store"
export { loadNode, readNode } from "./nodes/read"
export { writeNode } from "./nodes/write"
export type { WriteOrigin } from "./nodes/write"
export { publishNode } from "./nodes/publish"
export type { PublishResult } from "./nodes/publish"
export { visibleTree } from "./nodes/tree"
export { parseMarkdown } from "./nodes/markdown-parse"
export { displayRefs, positionBetween, resolveBlockRef, sectionSizes } from "./nodes/document"
export type { DocBlock } from "./nodes/document"
export { applyOps } from "./nodes/ops"
export { diffBlocks, planDraftWrites } from "./nodes/diff"
export { extractLinks } from "./nodes/links"
export type { ExtractedLink, NotLink } from "./nodes/links"
export { cutPages, decodeCursor, encodeCursor } from "./nodes/read-format"
export { getConversation, listConversations } from "./journal-read"
// E05-S12 (lot B) : les activités de l'accueil (le journal par gestes) et ses procédures utiles.
export { listActivities } from "./activities"
export { usefulProcedures } from "./context/blocks/procedures"
// 1.4.13 : la carte « Reprendre » de l'accueil, et la vue d'une page que l'hôte enregistre.
export { homeContents } from "./home-contents"
export { recordNodeView } from "./node-views"
export { describeTeamDeletion } from "./teams"
export type { TeamDeletion } from "./teams"
export { setTeamMemberRole } from "./teams"
export { requireStaff, resolveAdminOrg } from "./admin/context"
export type { StaffCaller } from "./admin/context"
export { createOrg, getOrg, listOrgOverviews, listOrgs, updateOrg } from "./admin/orgs"
export { addAdmin } from "./admin/first-admin"
export type { AdminNamed, AdminSeat, FirstAdminPlan } from "./admin/first-admin"
export type { AdminOrg, FirstAdminOutcome, OrgChange, OrgDraft, OrgOverview, OrgSheet } from "./admin/orgs"
export type { OrgCreationHook } from "./admin/org-creation"
// E12-S01 (ADR-023) : l'inscription libre, que l'hôte active par l'option `signup` de `handlePlateforme`.
export { signUp } from "./admin/signup"
// Les organisations de la personne, pour la bascule du menu de l'entreprise (décision du 2026-10-01).
export { listMyOrganisations, listOrganisationsOfPerson } from "./organisations"
export type { SignupOptions, SignupResult } from "./admin/signup"
export { addHost, removeHost } from "./admin/hosts"
export { grantAccess, revokeAccess } from "./admin/grants"
export { moveNode } from "./nodes/move"
export { movedNotice } from "./nodes/lookup"
export { resolveTargets } from "./nodes/link-resolution"
export type { LinkTarget, TargetResolution } from "./nodes/link-resolution"
export type { LinkView } from "./nodes/link-lines"
export { contextReference, resolveReferences } from "./nodes/references"
export type { ResolvedReference } from "./nodes/references"
export { checkProcedure, listProcedures } from "./procedures"
export { checkProcedureBlocks } from "./procedures-check"
export { previewContext } from "./context"
export type { BlockReport } from "./context/engine"
// E08-S09 : l'usage et les retours (`isOrgAdmin` est déjà exporté plus haut, E01-S07c).
export { usageSummary } from "./usage"
export { listFeedback } from "./feedback"
// E05-S13 (AC-9) : les retours à l'équipe plateforme seule, règle lue par la page et le layout de l'hôte.
export { handlesFeedback } from "./feedback"
// Tableau de bord (E08-S03) : services de connecteurs d'E04-S01, qui lui laissait ces exports, impact
// d'une désactivation et comptes de l'organisation ; les comptes personnels de qui regarde, pour l'écran ouvert aux membres.
export { activateConnector, deactivateConnector, deactivationImpact, listConnectorsForOrg } from "./connectors/activations"
export { createAccount, disableAccount, listOrgAccounts, listOwnAccounts } from "./connectors/accounts"
// Le secret et les réglages d'un compte réel, posés par qui le gère (écran Connecteurs, outillage), jamais rendus ; le
// formulaire de chaque connecteur déclaré, que l'écran Connecteurs reçoit de sa page.
export { connectorAccountForms, setAccountSecret } from "./connectors/account-secret"
// Moteur des connecteurs décrits : l'hôte déclare les connecteurs qu'il utilise, partagés ou propres, au montage de ses
// routes ; la sonde d'un compte, pour qui le gère.
export { registerConnectors } from "./connectors/declaration"
export type { ConnectorOptions } from "./connectors/declaration"
export type { ServerOnlyOption } from "./connectors/server-only"
export type {
  ConnectorAccountIdentity,
  ConnectorAsyncJob,
  ConnectorCostSettle,
  ConnectorCostWeights,
  ConnectorDefinition,
  ConnectorFunctionCost,
  ConnectorFunctionDefinition,
  ConnectorProbeBalance,
  HostCredentialContext,
  HostCredentialReader,
  HostedLinkProvider,
  OAuthApplication,
} from "./connectors/definition"
// Le consentement d'une personne à un connecteur `oauth2_user` : son départ pour la personne connectée (l'adresse
// d'autorisation où l'envoyer), et l'adresse de retour à déclarer chez le tiers, servie par la porte du paquet.
export { CONNECTOR_CONSENT_CALLBACK_PATH, connectorConsentRedirectUri, startConnectorConsent } from "./connectors/consent"
// Le branchement hébergé d'un compte à un connecteur à `accountIdentity` : son départ pour la personne connectée
// (l'adresse où l'envoyer), et l'adresse de retour que le paquet donne au tiers par le port `hostedLinks`.
export { HOSTED_LINK_CALLBACK_PATH, hostedLinkReturnUrl, startHostedLink } from "./connectors/hosted-link"
// Ce que coûte un appel d'une fonction décrite, en fonctions pures : pire cas, quantité à régler, relève d'un travail
// asynchrone ; le paquet ne réserve ni ne règle rien.
export { collectionOf, ConnectorCostError, costOf, settledQuantity } from "./connectors/cost"
export type { ConnectorCollection, ConnectorCostQuantity, ConnectorSettlement } from "./connectors/cost"
export { probeAccount } from "./connectors/probe"
export type { AccountHealth, ProbedBalance } from "./connectors/probe"
// Une fonction du catalogue lancée par le serveur de l'hôte, sous la personne connectée : contrôles et journal de
// `<p>_call`, `method` `api` au journal.
export { callFunction, HOST_CALL_JOURNAL } from "./function-call"
export type { FunctionCallInput, FunctionCallOptions, FunctionCallResult } from "./function-call"
export type { CallAccount, CallTeam } from "./calls"
// Les travaux en tâche de fond des fonctions longues : l'exécutant, qu'appelle le déclencheur que l'hôte déclare
// (`registerConnectors`, `backgroundRunner: "process"` : un processus à part du serveur web, qui boucle sur lui).
export { runJobs } from "./jobs/runner"
export type { RunJobsOptions, RunJobsReport } from "./jobs/runner"
export type { BackgroundRunner } from "./jobs/trigger"
export { CatalogRegistrationError, defineErpFunction, registerFunctions, registerWidgetViews } from "./catalog/erp"
export type { ErpFunction, ErpFunctionContext } from "./catalog/erp"
// E07-S03 : la grille, son résumé et la file de revue d'un tableau, la décision de la revue, les blocs
// `reference` rendus en place.
export { tableGridRows, tableGridSummary, tableReviewQueue } from "./tables/screen"
export { decideReview } from "./tables/review"
export { resolveReferencesForScreen } from "./nodes/references-screen"
// E05-S04 : la fiche que la personne écrit (« Ma fiche »).
export { updateProfile } from "./members"
// E05-S11 (lot a) : la page « Profil », la couleur effective d'une personne.
export { readProfile } from "./members"
export { preferredTheme } from "./language"
// MCP admin (E08-S06) : propriétaire d'un nœud, journal admin, références et comptes par libellé, règles d'un compte.
export { describeTransfer, transferOwner } from "./admin/nodes"
export type { Transfer, TransferPlan } from "./admin/nodes"
export { listAdminLog } from "./admin/journal"
export type { AdminLogEntry, AdminLogFilters, AdminLogPage } from "./admin/journal"
export { findAccount, resolveRef } from "./admin/context"
export type { ResolvedRef } from "./admin/context"
export { listAccountRules, removeAccountRule, setAccountRule } from "./rules"
export { listAccountShareJournal } from "./account-share-journal"
export type { AccountRulesView } from "./rules"
// E05-S10 (partie e) : ordre des frères, corbeille, duplication, aperçu d'un déplacement, accès général,
// liens d'un nœud ; (partie d, ADR-013) liens publics et leur lecture hors session.
export { placeNode } from "./nodes/order"
export { listTrash, purgeTrash, restoreNode, trashNode, TRASH_DAYS } from "./nodes/trash"
export { duplicateNode } from "./nodes/duplicate"
export { moveImpact } from "./nodes/move-impact"
export { setGeneralAccess } from "./general-access"
export { nodeLinks } from "./nodes/node-links"
export { listShares, nodeShare, readPublicNode, revokeShare, shareNode } from "./shares"
// E11-S21 : les données de l'image de partage d'une adresse, lues sans session (organisation, lien public).
export { shareImageData } from "./share-image"
// E10-S02 (lot c) : « Voir » un fichier joint, dans l'organisation et par un lien public (visionneuse de la page de l'hôte).
export { fileView, publicFileView } from "./files/view"
// E10-S02 (lot f, ADR-018) : le formulaire de dépôt d'un ticket (page de l'hôte, AC-f15).
export { uploadForm } from "./uploads"
