export const AI_MEDIA_APPLICATION_CONTRACT_VERSION = 'ai-media-application-mutation/v1';
export const AI_MEDIA_APPLICATION_INTENT_TTL_MS = 15 * 60 * 1_000;
const AI_MEDIA_CONTEXT_SLOT_KEY_MAX_LENGTH = 1_024;

export type AiMediaApplicationMode = 'append' | 'replace';
export type AiMediaApplicationMutationKind = 'APPLY' | 'ROLLBACK';

export interface AiMediaApplicationCapability {
  contractVersion: typeof AI_MEDIA_APPLICATION_CONTRACT_VERSION;
  readEnabled: boolean;
  applyEnabled: boolean;
  listingDraftApplyEnabled: boolean;
  rollbackEnabled: boolean;
  defaultMode: 'append';
  replaceOperations: string[];
}

export interface AiMediaWorkflowApplicationSummary {
  id: string | null;
  revision: number;
  state: 'APPLIED' | 'ROLLED_BACK';
  mode: AiMediaApplicationMode;
  workflowId: string;
  jobId: string;
  outputAssetId: string;
  targetType: string;
  targetId: string;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  appliedAt: string;
  rolledBackAt: string | null;
  targetUpdatedAt: string;
  legacy: boolean;
  rollbackEligible?: boolean;
  rollbackIneligibilityReason?: string;
}

export interface AiMediaApplicationMutation {
  id: string;
  revision: number;
  kind: AiMediaApplicationMutationKind;
  workflowId: string;
  jobId: string;
  assetId: string;
  rollbackOfId: string | null;
  rolledBackById: string | null;
  targetType: 'collect';
  targetId: string;
  targetSequence: number;
  mode: AiMediaApplicationMode;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  operationKey: string;
  workflowRevisionBefore: number;
  workflowRevisionAfter: number;
  targetVersionBefore: string;
  targetVersionAfter: string;
  beforeCounts: AiMediaApplicationStateCounts;
  afterCounts: AiMediaApplicationStateCounts;
  createdAt: string;
  rollbackEligible: boolean;
  rollbackReason: string | null;
}

export interface AiMediaApplicationStateCounts {
  images: number;
  watermarkedImages: number;
  editedImages: number;
}

export interface AiMediaApplicationTarget {
  type: 'collect';
  id: string;
  updatedAt: string;
  images: unknown[] | null;
  editedImages: unknown[];
  mainImage: string | null;
}

export interface AiMediaLegacyApplication {
  jobId: string;
  mode: AiMediaApplicationMode | null;
  targetType: string | null;
  targetId: string | null;
  appliedAt: string;
  rollbackEligible: false;
  rollbackReason: 'LEGACY_APPLICATION';
}

export interface AiMediaApplicationLedger {
  contractVersion: typeof AI_MEDIA_APPLICATION_CONTRACT_VERSION;
  items: AiMediaApplicationMutation[];
  frontier: AiMediaApplicationMutation | null;
  recoveredOperation: AiMediaApplicationMutation | null;
  legacyApplications: AiMediaLegacyApplication[];
  nextBeforeSequence: number | null;
  target: AiMediaApplicationTarget;
}

export interface AiMediaApplicationMutationResult {
  contractVersion: typeof AI_MEDIA_APPLICATION_CONTRACT_VERSION;
  application: AiMediaApplicationMutation;
  target: AiMediaApplicationTarget;
  replayed: boolean;
}

export function resolveAiMediaApplicationTargetStaleVersion(input: {
  renderedTargetUpdatedAt?: string | null;
  authoritativeTargetUpdatedAt?: string | null;
  currentStaleVersion?: string | null;
}): string | null {
  const renderedTime = Date.parse(input.renderedTargetUpdatedAt || '');
  const candidates = [input.currentStaleVersion, input.authoritativeTargetUpdatedAt]
    .flatMap((version) => {
      const timestamp = Date.parse(version || '');
      return version && Number.isFinite(timestamp) ? [{ version, timestamp }] : [];
    })
    .sort((left, right) => right.timestamp - left.timestamp);
  if (!Number.isFinite(renderedTime)) return candidates[0]?.version || null;
  return candidates.find((candidate) => candidate.timestamp > renderedTime)?.version || null;
}

export interface AiMediaApplicationIntent {
  fingerprint: string;
  operationKey: string;
  createdAt: number;
}

export interface AiMediaApplicationIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum = 8_000): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function nullableText(value: unknown, maximum = 8_000): string | null | undefined {
  if (value === null) return null;
  return boundedText(value, maximum) || undefined;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function dateText(value: unknown): string | null {
  const normalized = boundedText(value, 100);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export function projectAiMediaApplicationImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const url = typeof entry === 'string' ? entry.trim() : '';
    if (!url || url.length > 8_000 || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function normalizeCounts(value: unknown): AiMediaApplicationStateCounts | null {
  const candidate = record(value);
  const images = nonNegativeInteger(candidate?.images);
  const watermarkedImages = nonNegativeInteger(candidate?.watermarkedImages);
  const editedImages = nonNegativeInteger(candidate?.editedImages);
  return candidate && images !== null && watermarkedImages !== null && editedImages !== null
    ? { images, watermarkedImages, editedImages }
    : null;
}

export function normalizeAiMediaApplicationCapability(
  value: unknown,
): AiMediaApplicationCapability | null {
  const candidate = record(value);
  if (!candidate
    || candidate.contractVersion !== AI_MEDIA_APPLICATION_CONTRACT_VERSION
    || typeof candidate.readEnabled !== 'boolean'
    || typeof candidate.applyEnabled !== 'boolean'
    || typeof candidate.rollbackEnabled !== 'boolean'
    || candidate.defaultMode !== 'append'
    || !Array.isArray(candidate.replaceOperations)
    || candidate.replaceOperations.length > 10
    || candidate.replaceOperations.some((operation) => (
      typeof operation !== 'string' || !operation || operation.length > 100
    ))) return null;
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    readEnabled: candidate.readEnabled,
    applyEnabled: candidate.applyEnabled,
    listingDraftApplyEnabled: candidate.listingDraftApplyEnabled === true,
    rollbackEnabled: candidate.rollbackEnabled,
    defaultMode: 'append',
    replaceOperations: [...new Set(candidate.replaceOperations as string[])],
  };
}

export function normalizeAiMediaWorkflowApplicationSummary(
  value: unknown,
): AiMediaWorkflowApplicationSummary | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = candidate.id === null ? null : boundedText(candidate.id, 200);
  const revision = positiveInteger(candidate.revision);
  const workflowId = boundedText(candidate.workflowId, 200);
  const jobId = boundedText(candidate.jobId, 200);
  const outputAssetId = boundedText(candidate.outputAssetId, 200);
  const targetType = boundedText(candidate.targetType, 100);
  const targetId = boundedText(candidate.targetId, 200);
  const contextSkuKey = nullableText(candidate.contextSkuKey, 500);
  const contextSlotKey = nullableText(candidate.contextSlotKey, AI_MEDIA_CONTEXT_SLOT_KEY_MAX_LENGTH);
  const appliedAt = dateText(candidate.appliedAt);
  const rolledBackAt = candidate.rolledBackAt === null ? null : dateText(candidate.rolledBackAt);
  const targetUpdatedAt = dateText(candidate.targetUpdatedAt);
  if ((candidate.id !== null && !id) || !revision || !workflowId || !jobId || !outputAssetId
    || !targetType || !targetId || contextSkuKey === undefined || contextSlotKey === undefined
    || !appliedAt || !targetUpdatedAt
    || (candidate.rolledBackAt !== null && !rolledBackAt)
    || !['APPLIED', 'ROLLED_BACK'].includes(String(candidate.state))
    || !['append', 'replace'].includes(String(candidate.mode))
    || typeof candidate.legacy !== 'boolean') return null;
  if ((candidate.state === 'ROLLED_BACK') !== Boolean(rolledBackAt)) return null;
  if (candidate.legacy !== (id === null)) return null;
  return {
    id,
    revision,
    state: candidate.state as AiMediaWorkflowApplicationSummary['state'],
    mode: candidate.mode as AiMediaApplicationMode,
    workflowId,
    jobId,
    outputAssetId,
    targetType,
    targetId,
    contextSkuKey,
    contextSlotKey,
    appliedAt,
    rolledBackAt,
    targetUpdatedAt,
    legacy: candidate.legacy,
    ...(typeof candidate.rollbackEligible === 'boolean'
      ? { rollbackEligible: candidate.rollbackEligible }
      : {}),
    ...(boundedText(candidate.rollbackIneligibilityReason, 200)
      ? { rollbackIneligibilityReason: String(candidate.rollbackIneligibilityReason) }
      : {}),
  };
}

export function mergeAiMediaWorkflowApplicationSummary(
  current: AiMediaWorkflowApplicationSummary | null | undefined,
  incoming: AiMediaWorkflowApplicationSummary | null | undefined,
): AiMediaWorkflowApplicationSummary | null {
  if (!current) return incoming || null;
  if (!incoming) return current;
  if (current.id && incoming.id && current.id === incoming.id) {
    if (current.state === 'ROLLED_BACK' && incoming.state === 'APPLIED') return current;
    if (incoming.revision < current.revision) return current;
  }
  return incoming;
}

export function normalizeAiMediaApplicationMutation(value: unknown): AiMediaApplicationMutation | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = boundedText(candidate.id, 200);
  const revision = positiveInteger(candidate.revision);
  const workflowId = boundedText(candidate.workflowId, 200);
  const jobId = boundedText(candidate.jobId, 200);
  const assetId = boundedText(candidate.assetId, 200);
  const rollbackOfId = nullableText(candidate.rollbackOfId, 200);
  const rolledBackById = nullableText(candidate.rolledBackById, 200);
  const targetId = boundedText(candidate.targetId, 200);
  const targetSequence = positiveInteger(candidate.targetSequence);
  const contextSkuKey = nullableText(candidate.contextSkuKey, 500);
  const contextSlotKey = nullableText(candidate.contextSlotKey, AI_MEDIA_CONTEXT_SLOT_KEY_MAX_LENGTH);
  const operationKey = boundedText(candidate.operationKey, 128);
  const workflowRevisionBefore = positiveInteger(candidate.workflowRevisionBefore);
  const workflowRevisionAfter = positiveInteger(candidate.workflowRevisionAfter);
  const targetVersionBefore = dateText(candidate.targetVersionBefore);
  const targetVersionAfter = dateText(candidate.targetVersionAfter);
  const beforeCounts = normalizeCounts(candidate.beforeCounts);
  const afterCounts = normalizeCounts(candidate.afterCounts);
  const createdAt = dateText(candidate.createdAt);
  const rollbackReason = candidate.rollbackReason === null
    ? null
    : boundedText(candidate.rollbackReason, 200);
  if (!id || !revision || !workflowId || !jobId || !assetId
    || rollbackOfId === undefined || rolledBackById === undefined
    || candidate.targetType !== 'collect' || !targetId || !targetSequence
    || !['APPLY', 'ROLLBACK'].includes(String(candidate.kind))
    || !['append', 'replace'].includes(String(candidate.mode))
    || contextSkuKey === undefined || contextSlotKey === undefined
    || !operationKey || operationKey.length < 8
    || !workflowRevisionBefore || !workflowRevisionAfter
    || workflowRevisionAfter !== workflowRevisionBefore + 1
    || !targetVersionBefore || !targetVersionAfter || !beforeCounts || !afterCounts || !createdAt
    || typeof candidate.rollbackEligible !== 'boolean'
    || (candidate.rollbackReason !== null && !rollbackReason)) return null;
  if ((candidate.kind === 'ROLLBACK') !== Boolean(rollbackOfId)) return null;
  return {
    id,
    revision,
    kind: candidate.kind as AiMediaApplicationMutationKind,
    workflowId,
    jobId,
    assetId,
    rollbackOfId,
    rolledBackById,
    targetType: 'collect',
    targetId,
    targetSequence,
    mode: candidate.mode as AiMediaApplicationMode,
    contextSkuKey,
    contextSlotKey,
    operationKey,
    workflowRevisionBefore,
    workflowRevisionAfter,
    targetVersionBefore,
    targetVersionAfter,
    beforeCounts,
    afterCounts,
    createdAt,
    rollbackEligible: candidate.rollbackEligible,
    rollbackReason,
  };
}

export function normalizeAiMediaApplicationTarget(value: unknown): AiMediaApplicationTarget | null {
  const candidate = record(value);
  const id = boundedText(candidate?.id, 200);
  const updatedAt = dateText(candidate?.updatedAt);
  const editedImages = Array.isArray(candidate?.editedImages)
    && candidate.editedImages.length <= 100
    ? candidate.editedImages as unknown[]
    : null;
  const mainImage = candidate?.mainImage === null ? null : boundedText(candidate?.mainImage, 8_000);
  if (!candidate || candidate.type !== 'collect' || !id || !updatedAt || !editedImages
    || (!Array.isArray(candidate.images) && candidate.images !== null)
    || (Array.isArray(candidate.images) && candidate.images.length > 100)
    || (candidate.mainImage !== null && !mainImage)) return null;
  return {
    type: 'collect',
    id,
    updatedAt,
    images: candidate.images as unknown[] | null,
    editedImages,
    mainImage,
  };
}

function normalizeLegacyApplication(value: unknown): AiMediaLegacyApplication | null {
  const candidate = record(value);
  const jobId = boundedText(candidate?.jobId, 200);
  const mode = candidate?.mode === null ? null : candidate?.mode;
  const targetType = candidate?.targetType === null ? null : boundedText(candidate?.targetType, 100);
  const targetId = candidate?.targetId === null ? null : boundedText(candidate?.targetId, 200);
  const appliedAt = dateText(candidate?.appliedAt);
  if (!candidate || !jobId || !appliedAt || ![null, 'append', 'replace'].includes(mode as null | string)
    || targetType === undefined || targetId === undefined
    || candidate.rollbackEligible !== false || candidate.rollbackReason !== 'LEGACY_APPLICATION') return null;
  return {
    jobId,
    mode: mode as AiMediaApplicationMode | null,
    targetType,
    targetId,
    appliedAt,
    rollbackEligible: false,
    rollbackReason: 'LEGACY_APPLICATION',
  };
}

export function normalizeAiMediaApplicationLedger(value: unknown): AiMediaApplicationLedger | null {
  const candidate = record(value);
  if (!candidate || candidate.contractVersion !== AI_MEDIA_APPLICATION_CONTRACT_VERSION
    || !Array.isArray(candidate.items) || candidate.items.length > 100
    || !Array.isArray(candidate.legacyApplications) || candidate.legacyApplications.length > 10) return null;
  const items = candidate.items.map(normalizeAiMediaApplicationMutation);
  const frontier = candidate.frontier === null ? null : normalizeAiMediaApplicationMutation(candidate.frontier);
  const recoveredOperation = candidate.recoveredOperation === null
    ? null
    : normalizeAiMediaApplicationMutation(candidate.recoveredOperation);
  const legacyApplications = candidate.legacyApplications.map(normalizeLegacyApplication);
  const nextBeforeSequence = candidate.nextBeforeSequence === null
    ? null
    : positiveInteger(candidate.nextBeforeSequence);
  const target = normalizeAiMediaApplicationTarget(candidate.target);
  if (items.some((item) => !item) || (candidate.frontier !== null && !frontier)
    || (candidate.recoveredOperation !== null && !recoveredOperation)
    || legacyApplications.some((item) => !item)
    || (candidate.nextBeforeSequence !== null && !nextBeforeSequence) || !target) return null;
  const normalizedItems = items as AiMediaApplicationMutation[];
  if (normalizedItems.some((item) => item.targetId !== target.id)
    || (frontier && (frontier.kind !== 'APPLY' || frontier.targetId !== target.id))
    || (recoveredOperation && recoveredOperation.targetId !== target.id)) return null;
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    items: normalizedItems,
    frontier,
    recoveredOperation,
    legacyApplications: legacyApplications as AiMediaLegacyApplication[],
    nextBeforeSequence,
    target,
  };
}

export function normalizeAiMediaApplicationMutationResult(
  value: unknown,
): AiMediaApplicationMutationResult | null {
  const candidate = record(value);
  const application = normalizeAiMediaApplicationMutation(candidate?.application);
  const target = normalizeAiMediaApplicationTarget(candidate?.target);
  if (!candidate || candidate.contractVersion !== AI_MEDIA_APPLICATION_CONTRACT_VERSION
    || !application || !target || application.targetId !== target.id
    || typeof candidate.replayed !== 'boolean') return null;
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    application,
    target,
    replayed: candidate.replayed,
  };
}

export function appendAiMediaApplicationLedgerPage(
  current: AiMediaApplicationLedger,
  page: AiMediaApplicationLedger,
): AiMediaApplicationLedger {
  if (current.target.id !== page.target.id) return page;
  const byId = new Map<string, AiMediaApplicationMutation>();
  for (const item of [...current.items, ...page.items]) {
    const existing = byId.get(item.id);
    if (!existing || item.revision > existing.revision) byId.set(item.id, item);
  }
  const currentTargetTimestamp = Date.parse(current.target.updatedAt);
  const pageTargetTimestamp = Date.parse(page.target.updatedAt);
  const currentAuthoritySequence = Math.max(
    current.frontier?.targetSequence || 0,
    current.recoveredOperation?.targetSequence || 0,
    ...current.items.map((item) => item.targetSequence),
  );
  const pageAuthoritySequence = Math.max(
    page.frontier?.targetSequence || 0,
    page.recoveredOperation?.targetSequence || 0,
    ...page.items.map((item) => item.targetSequence),
  );
  const authority = pageTargetTimestamp > currentTargetTimestamp
    || (pageTargetTimestamp === currentTargetTimestamp && pageAuthoritySequence > currentAuthoritySequence)
    ? page
    : current;
  return {
    ...authority,
    items: [...byId.values()].sort((left, right) => right.targetSequence - left.targetSequence),
    legacyApplications: [...new Map(
      [...current.legacyApplications, ...page.legacyApplications].map((item) => [item.jobId, item]),
    ).values()],
    nextBeforeSequence: page.nextBeforeSequence,
  };
}

function operationKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) throw new Error('应用操作标识无效');
  return normalized;
}

function expectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('应用版本已失效，请刷新后重试');
  return value;
}

function expectedTimestamp(value: string): string {
  const normalized = value.trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new Error('商品图片版本无效，请刷新后重试');
  }
  return normalized;
}

export function buildAiMediaApplicationRequest(input: {
  mode: AiMediaApplicationMode;
  operationKey: string;
  expectedWorkflowRevision: number;
  expectedTargetUpdatedAt: string;
  replaceConfirmed?: boolean;
}) {
  if (input.mode === 'replace' && input.replaceConfirmed !== true) {
    throw new Error('替换全部发布图需要再次确认');
  }
  return {
    mode: input.mode,
    operationKey: operationKey(input.operationKey),
    expectedWorkflowRevision: expectedRevision(input.expectedWorkflowRevision),
    expectedTargetUpdatedAt: expectedTimestamp(input.expectedTargetUpdatedAt),
    ...(input.mode === 'replace' ? { replaceConfirmed: true as const } : {}),
  };
}

export function buildAiMediaApplicationRollbackRequest(input: {
  application: AiMediaApplicationMutation;
  operationKey: string;
  expectedTargetUpdatedAt: string;
}) {
  if (input.application.kind !== 'APPLY' || !input.application.rollbackEligible) {
    throw new Error('该应用记录当前不能回滚');
  }
  return {
    operationKey: operationKey(input.operationKey),
    expectedApplicationRevision: expectedRevision(input.application.revision),
    expectedWorkflowRevision: expectedRevision(input.application.workflowRevisionAfter),
    expectedTargetUpdatedAt: expectedTimestamp(input.expectedTargetUpdatedAt),
  };
}

export function aiMediaApplicationRecoveryPath(workflowId: string, operationKeyValue: string) {
  const normalizedWorkflowId = workflowId.trim();
  if (!normalizedWorkflowId || normalizedWorkflowId.length > 200) throw new Error('AI 图片工作流无效');
  return `/api/ai-images/workflows/${encodeURIComponent(normalizedWorkflowId)}/applications?limit=25&operationKey=${encodeURIComponent(operationKey(operationKeyValue))}`;
}

export function aiMediaTargetApplicationsPath(
  targetId: string,
  options: { limit?: number; beforeSequence?: number; operationKey?: string } = {},
) {
  const normalizedTargetId = targetId.trim();
  if (!normalizedTargetId || normalizedTargetId.length > 200) throw new Error('商品图片目标无效');
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('应用记录分页大小无效');
  const query = new URLSearchParams({
    targetType: 'collect',
    targetId: normalizedTargetId,
    limit: String(limit),
  });
  if (options.beforeSequence !== undefined) {
    query.set('beforeSequence', String(expectedRevision(options.beforeSequence)));
  }
  if (options.operationKey) query.set('operationKey', operationKey(options.operationKey));
  return `/api/ai-images/applications?${query.toString()}`;
}

export function aiMediaApplicationIntentStorageKey(
  targetId: string,
  kind: 'apply' | 'rollback',
  subjectId: string,
) {
  return `ss-erp:ai-media-application:${encodeURIComponent(targetId)}:${kind}:${encodeURIComponent(subjectId)}`;
}

export function resolveAiMediaApplicationIntent(
  current: AiMediaApplicationIntent | null,
  fingerprint: string,
  createKey: () => string,
  options: { now?: number; ttlMs?: number } = {},
): AiMediaApplicationIntent {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? AI_MEDIA_APPLICATION_INTENT_TTL_MS;
  if (current?.fingerprint === fingerprint
    && current.createdAt <= now
    && now - current.createdAt <= ttlMs) return current;
  return { fingerprint, operationKey: operationKey(createKey()), createdAt: now };
}

function validIntent(value: unknown): value is AiMediaApplicationIntent {
  const candidate = record(value);
  return Boolean(candidate
    && typeof candidate.fingerprint === 'string'
    && candidate.fingerprint.length > 0
    && candidate.fingerprint.length <= 100_000
    && typeof candidate.operationKey === 'string'
    && candidate.operationKey.length >= 8
    && candidate.operationKey.length <= 128
    && Number.isSafeInteger(candidate.createdAt));
}

export function loadAiMediaApplicationIntent(
  storage: AiMediaApplicationIntentStorage | null | undefined,
  key: string,
  options: { now?: number; ttlMs?: number } = {},
): AiMediaApplicationIntent | null {
  if (!storage || !key) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || 'null');
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? AI_MEDIA_APPLICATION_INTENT_TTL_MS;
    if (!validIntent(value) || value.createdAt > now || now - value.createdAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function saveAiMediaApplicationIntent(
  storage: AiMediaApplicationIntentStorage | null | undefined,
  key: string,
  intent: AiMediaApplicationIntent,
) {
  if (!storage || !key) return;
  try { storage.setItem(key, JSON.stringify(intent)); } catch { /* storage is best effort */ }
}

export function clearAiMediaApplicationIntent(
  storage: AiMediaApplicationIntentStorage | null | undefined,
  key: string,
) {
  if (!storage || !key) return;
  try { storage.removeItem(key); } catch { /* storage is best effort */ }
}

export type AiMediaApplicationRecoveryDecision = 'confirmed' | 'rolled_back' | 'retry' | 'conflict';

export function resolveAiMediaApplicationRecovery(input: {
  kind: AiMediaApplicationMutationKind;
  workflowId: string;
  applicationId?: string;
  operationKey: string;
  recoveredOperation: AiMediaApplicationMutation | null;
}): AiMediaApplicationRecoveryDecision {
  const recovered = input.recoveredOperation;
  if (!recovered) return 'retry';
  if (recovered.operationKey !== input.operationKey || recovered.kind !== input.kind
    || recovered.workflowId !== input.workflowId) return 'conflict';
  if (input.kind === 'ROLLBACK' && recovered.rollbackOfId !== input.applicationId) return 'conflict';
  if (input.kind === 'APPLY' && recovered.rolledBackById) return 'rolled_back';
  return 'confirmed';
}

export function isDefinitiveAiMediaApplicationFailure(code: unknown): boolean {
  return new Set([
    'INVALID_REQUEST',
    'NOT_FOUND',
    'TARGET_NOT_FOUND',
    'AI_MEDIA_WORKFLOW_DISABLED',
    'SOURCE_LISTING_WEB_MEDIA_DISABLED',
    'PROVIDER_NOT_READY',
    'IDEMPOTENCY_KEY_CONFLICT',
    'WORKFLOW_CONFLICT',
    'TARGET_CONFLICT',
    'APPLICATION_CONFLICT',
    'APPLICATION_NO_CHANGE',
    'LEGACY_APPLICATION',
    'ALREADY_ROLLED_BACK',
    'ROLLBACK_ORDER_CONFLICT',
    'ROLLBACK_TARGET_CHANGED',
    'STALE_MEDIA_WORKFLOW',
    'REPLACE_CONFIRMATION_REQUIRED',
    'UNSAFE_APPLY_MODE',
    'INVALID_STATE',
    'APPLICATION_STATE_INVALID',
    'APPLICATION_STATE_TOO_LARGE',
    'APPLICATION_OUTPUT_INVALID',
    'UNSUPPORTED_TARGET',
  ]).has(String(code || '').toUpperCase());
}
