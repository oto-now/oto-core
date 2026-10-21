// Face schemas : Zod pur, partagé par toutes les faces, ui/ compris (H02). Aucun client de base,
// aucun import de server/, api/, mcp/ ni de l'hôte (frontière ESLint, AC31).
// Les listes `INVITATION_ROLES` et `INVITATION_STATES` restent internes tant qu'aucun écran ne les
// lit (E05-S03) ; leurs types suffisent aux faces.
export { inviteSchema, invitationIdSchema, listInvitationsQuerySchema } from "./invitations"
export type { Invite, InviteInput, InvitationRole, InvitationState } from "./invitations"
export { brandInputSchema, OTO_THEMES, THEME_LABELS, themeSchema } from "./brand"
export type { BrandInput, Theme } from "./brand"
// E11-S21 : l'image de partage d'une adresse, lue par `server/`, dessinée par `ui/`.
export type { ShareImageData } from "./share-image"
export { NODE_PATH_PATTERN, nodePathSchema, WRITE_OPS } from "./nodes"
export { CTX_PATTERN, ctxCodeSchema } from "./ctx"
export { BLOCK_TYPES, blockTypeSchema, blockKeySchema, blockInputSchema, blockRef } from "./blocks"
export type { BlockType, BlockInput } from "./blocks"
export { FEEDBACK_VISIBLE, flagNameSchema, flagToggleSchema, flagViewSchema } from "./flags"
export type { FlagView } from "./flags"
export { feedbackInputSchema, feedbackTypeSchema } from "./feedback"
export type { FeedbackInput } from "./feedback"
export { feedbackListQuerySchema, feedbackStateChangeSchema, feedbackStateSchema, ticketSchema } from "./feedback"
export type {
  FeedbackCounts,
  FeedbackFilter,
  FeedbackList,
  FeedbackListQuery,
  FeedbackState,
  FeedbackStateChange,
  FeedbackStateChangeInput,
  FeedbackTicketView,
  FeedbackType,
} from "./feedback"
export { INACTIVE_DAYS, USAGE_MAX_LINES, usageQuerySchema } from "./usage"
export type { UsagePeriod, UsagePersonRow, UsageQuery, UsageStatistics, UsageSummary, UsageTeamRow, UsageWeek } from "./usage"
export {
  orderBlocks,
  renderBlock,
  renderBlocks,
  splitSections,
  findSections,
  sectionOfBlock,
  callLocation,
  formatCallLocation,
} from "./blocks-render"
export type { BlockLike, BlockSection, CallLocation, RenderOptions } from "./blocks-render"
export { decisionErrorSchema } from "./oauth"
// `connectorNameSchema`, `accountLabelSchema` et `accountModeSchema` restent internes à
// `connectors.ts` tant que seuls ses schémas les lisent (E04-S01, N33).
export { accountSecretInputSchema, connectorRefSchema, createAccountSchema, disableAccountSchema } from "./connectors"
export type { AccountMode, AccountSecretInput } from "./connectors"
export { createTeamSchema, equipesSearchSchema, teamMemberSchema, updateMemberSchema, updateTeamSchema } from "./teams"
export { teamRoleSchema } from "./teams"
export type {
  CreateTeam,
  EquipesTab,
  MemberRoleView,
  MemberView,
  PlatformAccessOverview,
  PlatformAccessView,
  StaffAddedMemberView,
  TeamDeletionView,
  TeamView,
  UpdateTeam,
} from "./teams"
// `accessLevelSchema` et `ruleSubjectSchema` restent internes à `rules.ts` tant que seuls
// `setNodeRuleSchema` et `setAccountRuleSchema` les lisent (E05-S03, E08-S06).
export { ACCESS_LEVEL_NAMES, setNodeRuleSchema } from "./rules"
export type { AccessLevelName, NodeRulesView, RuledNodeView, RuleSubject } from "./rules"
export { BLOCK_OPS, NODE_KINDS, nodeKindSchema, readNodeSchema, SECTION_OPS, strictWriteOpsSchema, writeNodeSchema, writeOpSchema } from "./nodes"
export type { BlockView, NodeKind, NodeView, ReadNodeInput, TreeNode, WriteNodeInput, WriteOp } from "./nodes"
export { writeNodeBodySchema } from "./node-body"
export type { WriteNodeBody, WriteOpBody } from "./node-body"
export { JOURNAL_PERIODS, journalFiltersSchema, journalSectionSchema } from "./journal"
export type {
  ConversationDetail,
  ConversationSummary,
  JournalArgs,
  JournalCall,
  JournalFilters,
  JournalPage,
  JournalParam,
  JournalSection,
} from "./journal"
// E05-S12 (lot B) : les activités et les procédures utiles de l'accueil.
export { USEFUL_PROCEDURES_SHOWN } from "./activity"
export type { Activity, ActivityPage, ActivityVerb, UsefulProcedure } from "./activity"
// 1.4.13 : la carte « Reprendre », les nouveautés et les vues des pages de l'accueil.
export {
  HOME_NEWS_DEFAULT_DAYS,
  HOME_NEWS_MAX,
  HOME_PAGE_SIZE,
  HOME_SCOPES,
  HOME_VIEWED_DAYS,
  homeActivitiesQuerySchema,
  homeContentsQuerySchema,
  LAUNCH_PROCEDURES_SHOWN,
  NODE_VIEWS_KEPT_DAYS,
  nodeViewSchema,
} from "./accueil"
export type { HomeContent, HomeContentsPage, HomeNews, HomeScope, HomeSpace, HomeTab } from "./accueil"
// Les bornes du nom, des domaines de travail, des seuils, du motif et du préfixe ne sortent que par les
// schémas qui les composent : les schémas servis du MCP admin les en tirent (`orgSettingsSchema.shape`,
// `platformAccessSchema.shape`). `hostSchema` sort seul : E09-S02 en passe chaque adresse d'une création
// et le domaine de base de la cellule (E08-S02).
export {
  addAdminSchema,
  emailSchema,
  hostOpSchema,
  hostSchema,
  orgCreateSchema,
  orgSettingsSchema,
  orgSlugSchema,
  orgUpdateSchema,
  platformAccessSchema,
  signupSchema,
  openEntrySchema,
  OPEN_ENTRY_DOMAINS_MAX,
} from "./admin"
export type { OpenEntry, OrgSettings, PersonOrganisation, SignupInput } from "./admin"
export { moveNodeSchema } from "./nodes"
export type { MoveNodeInput } from "./nodes"
// Tableaux (E07-S01) : en-tête, grammaire de filtre et arguments des trois fonctions de lecture, que
// lisent `server/tables/` (forms-patterns.md § Principe). `tableFilterSchema` et `tableRowReadSchema`
// restent internes à `tables.ts` tant que seuls ses schémas et les tests les lisent.
export {
  FILTER_OPERATORS,
  MAX_FILTER_CLAUSES,
  MAX_IN_VALUES,
  nullInFilterMessage,
  queryWords,
  tableAggregateArgsSchema,
  tableColumnSchema,
  tableHeaderSchema,
  tableLifecycleSchema,
  tableReviewSchema,
  tableRowsArgsSchema,
  tableSchemaArgsSchema,
  tooManyInValuesMessage,
  unknownOperatorMessage,
} from "./tables"
export type {
  AggregateOp,
  CellValue,
  ColumnType,
  FilterOperator,
  TableAggregateArgs,
  TableColumn,
  TableHeader,
  TableLifecycle,
  TableRowRead,
  TableRowsArgs,
  TableSort,
} from "./tables"
export { isPlaceholderValue, PROCEDURE_MAX_CHARS, PROCEDURE_REFUSAL_KINDS } from "./procedures"
export type { ProcedureRefusal, ProcedureRefusalKind, ProcedureSummary } from "./procedures"
export { nodeVersionParamSchema } from "./nodes"
// Tableau de bord (E08-S03) : réglages de l'organisation, impact d'une désactivation, comptes.
export { orgSettingsFormSchema } from "./admin"
export type { OrgSettingsForm, OrgView } from "./admin"
export type { AccountMark, AccountMarkReason, AccountView, ConnectorAccountForm, DeactivationImpact, OrgConnector } from "./connectors"
// L'écran d'un tableau (E07-S03) : décision de la revue, paramètres de la grille, vue d'un bloc
// `reference`, formes des lectures de l'écran.
export {
  GRID_PAGE_ROWS,
  GRID_ROWS_MAX,
  GRID_SEARCH_MAX,
  REVIEW_REASON_MAX,
  reviewDecisionSchema,
  SCREEN_REFERENCES_MAX,
  TABLE_VIEW_ROWS_MAX,
  tableScreenParamsSchema,
  tableViewSchema,
} from "./table-screen"
export type {
  ReviewOutcome,
  ScreenCard,
  ScreenReference,
  ScreenReferenceProblem,
  ScreenView,
  TableGridRows,
  TableGridSummary,
  TableReviewQueue,
} from "./table-screen"
export { previewSearchSchema, proceduresSearchSchema } from "./procedures"
export type { ProceduresSearch } from "./procedures"
export { languageSchema, profilePatchSchema } from "./profile"
export type { ProfilePatch, ProfileView } from "./profile"
// La page « Profil » et la langue servie à l'assistant (E05-S11, lot a).
export { PROFILE_TEXT_MAX } from "./profile"
export type { ProfileSheet } from "./profile"
export type { Language } from "./brand"
// MCP admin (E08-S06) : propriétaires et sujets en références plates (N1) ; règles d'un compte.
export { accountOwnerRefSchema, ownerRefSchema, subjectRefSchema } from "./admin"
export type { OwnerRef } from "./admin"
export { ACCOUNT_LEVEL_NAMES, setAccountRuleSchema } from "./rules"
export type { AccountLevelName, AccountRuleSubject, AccountShareEventView } from "./rules"
// L'écran « Équipes et droits » (E05-S09, partie d1) : la recherche, le filtre et le tri de ses tableaux,
// lus dans l'adresse par la page de l'hôte.
export { equipesListesSchema } from "./team-screen"
export type { ReglagesDesListes } from "./team-screen"
// Les gestes du rail et le partage public (E05-S10, parties e et d ; ADR-013).
export {
  GENERAL_ACCESS,
  generalAccessSchema,
  moveImpactQuerySchema,
  nodePathBodySchema,
  placeNodeSchema,
  publicReadQuerySchema,
  SHARE_TOKEN_PATTERN,
  shareNodeSchema,
  sharesQuerySchema,
} from "./node-gestures"
export type {
  AccessChange,
  GeneralAccess,
  MoveImpact,
  NodeLinksView,
  NodePathBody,
  OrgShareView,
  PlaceNodeInput,
  PlaceView,
  PublicBlock,
  PublicNodeView,
  ShareNodeInput,
  ShareView,
  TrashItem,
} from "./node-gestures"
export type { PublicTable } from "./node-gestures"
export { PUBLIC_TABLE_ROWS_MAX } from "./node-gestures"
export { nodeAccessArgsSchema, nodePublicLinkArgsSchema, nodeShareArgsSchema } from "./share-functions"
export type { NodePublicLinkArgs, NodeShareArgs } from "./share-functions"
// E10-S01 : Markdown et CSV. Le fichier d'une page (export et import), la lecture, la déduction, le contrôle et
// l'écriture d'un CSV, les bornes d'un import et les corps de `tables/import` et des exports.
export { NODE_HEAD_MAX, nodeExportQuerySchema, normalizeTitle, OP_TEXT_MAX, PAGE_MAX, slugOf } from "./nodes"
export { pageMarkdown, readPageMarkdown } from "./blocks-render"
export type { MarkdownFile } from "./blocks-render"
export { columnNameOf, columnNames, CSV_SEPARATORS, detectSeparator, fileBaseName, fileExtension, IMPORT_NAME_MAX, keyValue, parseCsv, rowCells, segmentOf, toCsv, withLineKey } from "./csv"
export type { CsvSeparator, CsvTable } from "./csv"
export { checkImport, importProblemsText, inferTable, readCell } from "./csv-cells"
export type { CellRead, CheckedImport, ImportColumn, ImportPlan, ImportProblem, ImportRow, InferredTable } from "./csv-cells"
export {
  IMPORT_CELL_MAX,
  IMPORT_COLUMNS_MAX,
  IMPORT_CSV_MAX,
  IMPORT_FILE_BYTES_MAX,
  IMPORT_LOT_ROWS,
  IMPORT_ROWS_MAX,
  tableImportArgsSchema,
  tableImportBodySchema,
} from "./table-write"
export type { TableImportArgs, TableImportBody } from "./table-write"
// M71 : les listes d'index d'une partie de Contexte servie, écrites par le service, relues par la vue « Contexte ».
export { CONTEXT_INDEX } from "./context-index"
// E05-S13 (AC-16) : les formats des blocs servis que la vue « Contexte » relit pour les dire en français.
export { SERVED_BUDGET, SERVED_NEWS, SERVED_PROCEDURES, SERVED_RECENT, SERVED_RELATED, SERVED_RULES } from "./context-index"
// E11-S07 : le préfixe de l'API des écrans, contrat de montage entre l'hôte et le paquet.
export { PLATFORM_API_PREFIX } from "./api"
// E10-S02 (lot a) : les fichiers joints à un nœud. Types admis, limites et corps des routes `files`.
export { FILE_MAX_BYTES, FILE_TYPES, fileIdSchema, fileReadQuerySchema, fileRequestSchema, fileTypeOf, IMAGE_TYPES, ORG_QUOTA_BYTES, TEXT_FILE_MAX_BYTES, TEXT_TYPES, transitFileRequestSchema } from "./files"
export type { FileAvailability, FileReady, FileStorageState, FileType, FileUpload, TransitFile, TransitFileUpload } from "./files"
// E10-S02 (lot c) : « Voir ». Les routes des fichiers d'un lien public, le paramètre `view` et le fichier vu.
export { FILES_ROUTE, filePath, fileViewParamSchema, publicFilesRoute } from "./files"
export type { FileMarkdown, FileView, ViewedBlock } from "./files"
// E12-S02 (ADR-022) : les capacités d'une organisation, fournies par l'hôte, et leur état pour les écrans.
export { limitReached, orgLimitsSchema } from "./limits"
export type { LimitState, OrgLimits, OrgLimitsView } from "./limits"
// E10-S02 (lot f, ADR-018) : le dépôt par lien à usage unique. Entrée d'`upload.link`, jeton, bornes, adresses.
export { MODES_OF, UPLOAD_BYTES_MAX, UPLOAD_FORM_ROUTE, UPLOAD_KINDS, UPLOAD_MODES, UPLOAD_RULE, UPLOAD_TOKEN_PATTERN, UPLOAD_TTL_MINUTES, UPLOADS_ROUTE, uploadLinkSchema } from "./uploads"
export type { UploadDone, UploadFormView, UploadKind, UploadLinkArgs, UploadMode } from "./uploads"
// L'origine d'un lien vers l'hôte appelé, sans base : `https` hors du poste local, jamais `x-forwarded-proto`. Le middleware
// de l'hôte la lit (Edge, sans la face server) ; `trustedRequestOrigin` (face server) y ajoute la confiance dans l'hôte.
export { linkOrigin } from "./link-origin"
