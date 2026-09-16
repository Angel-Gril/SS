import type { OzonListingDraftMediaAssignment } from 'shared';
import { api, type ApiResponse } from '@/lib/api';
import {
  normalizeAiMediaWorkflowPage,
  type AiMediaContextResponse,
  type AiMediaOperation,
  type AiMediaWorkflow,
  type AiMediaWorkflowPage,
} from '@/lib/ai-media-workflow';

export const AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION =
  'ai-media-listing-draft-application/v1' as const;

const AI_MEDIA_API_BASE = '/api/ai-images';
const IDENTIFIER_MAX_LENGTH = 1_024;
export const AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH = 200;

export type AiMediaListingDraftApplicationMode = 'append' | 'replace';
export type AiMediaListingDraftApplicationKind = 'APPLY' | 'ROLLBACK';

export interface AiMediaListingDraftSlotAuthority {
  draftId: string;
  revision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  skuKey: string | null;
  slotKey: string | null;
  assignedAssetId: string | null;
}

export interface AiMediaListingDraftApplicationTarget {
  type: 'listing-draft';
  id: string;
  revision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  media: { assignments: OzonListingDraftMediaAssignment[] };
}

export interface AiMediaListingDraftApplicationMutation {
  id: string;
  revision: number;
  kind: AiMediaListingDraftApplicationKind;
  workflowId: string;
  jobId: string;
  assetId: string;
  rollbackOfId: string | null;
  rolledBackById: string | null;
  targetType: 'listing-draft';
  targetId: string;
  targetSequence: number;
  mode: AiMediaListingDraftApplicationMode;
  contextSkuKey: string | null;
  contextSlotKey: string;
  source: 'GENERATED' | 'TRANSLATED' | 'EDITED';
  operationKey: string;
  workflowRevisionBefore: number;
  workflowRevisionAfter: number;
  targetRevisionBefore: number;
  targetRevisionAfter: number;
  targetDraftVersionBefore: number;
  targetDraftVersionAfter: number;
  createdAt: string;
  rollbackEligible: boolean;
  rollbackReason: string | null;
}

export interface AiMediaListingDraftApplicationLedger {
  contractVersion: typeof AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION;
  items: AiMediaListingDraftApplicationMutation[];
  frontier: AiMediaListingDraftApplicationMutation | null;
  recoveredOperation: AiMediaListingDraftApplicationMutation | null;
  nextBeforeSequence: number | null;
  target: AiMediaListingDraftApplicationTarget;
}

export interface AiMediaListingDraftApplicationResult {
  contractVersion: typeof AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION;
  application: AiMediaListingDraftApplicationMutation;
  target: AiMediaListingDraftApplicationTarget;
  replayed: boolean;
}

export interface AiMediaListingDraftApplicationClient {
  getContext(input: {
    draftId: string;
    revision: number;
    draftVersion: number;
    skuKey: string | null;
    slotKey: string | null;
  }): Promise<AiMediaContextResponse>;
  listWorkflows(input: {
    draftId: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<AiMediaWorkflowPage>;
  listApplications(input: {
    draftId: string;
    beforeSequence?: number | null;
    operationKey?: string | null;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<AiMediaListingDraftApplicationLedger>;
  apply(
    workflow: AiMediaWorkflow,
    context: AiMediaContextResponse,
    input: {
      mode: AiMediaListingDraftApplicationMode;
      operationKey: string;
      replaceConfirmed?: boolean;
    },
  ): Promise<AiMediaListingDraftApplicationResult>;
  rollback(
    application: AiMediaListingDraftApplicationMutation,
    target: AiMediaListingDraftApplicationTarget,
    operationKey: string,
  ): Promise<AiMediaListingDraftApplicationResult>;
}

export class AiMediaListingDraftApplicationResponseError extends Error {
  override readonly name = 'AiMediaListingDraftApplicationResponseError';

  constructor(
    public readonly code: ApiResponse['code'],
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export function isAiMediaListingDraftApplicationResponseError(
  value: unknown,
): value is AiMediaListingDraftApplicationResponseError {
  return value instanceof AiMediaListingDraftApplicationResponseError;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(value: unknown, maximum = IDENTIFIER_MAX_LENGTH): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value === value.normalize('NFKC').trim()
    ? value
    : null;
}

function nullableText(value: unknown, maximum = IDENTIFIER_MAX_LENGTH): string | null | undefined {
  if (value === null) return null;
  return exactText(value, maximum) || undefined;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

function dateText(value: unknown): string | null {
  const normalized = exactText(value, 100);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function operationKey(value: string): string {
  const normalized = String(value || '').trim();
  if (normalized.length < 8 || normalized.length > 128) {
    throw new Error('图片应用操作标识无效');
  }
  return normalized;
}

function expectedVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}已失效，请刷新后重试`);
  return value;
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function optionalQueryValue(query: URLSearchParams, key: string, value: string | null | undefined) {
  if (value != null) query.set(key, value);
}

function unwrap<T>(response: ApiResponse<T>, fallback: string): T {
  if (response.code === 1 && response.data !== undefined) return response.data;
  throw new AiMediaListingDraftApplicationResponseError(
    response.code,
    response.msg || fallback,
    response.data,
  );
}

function normalizeAssignment(value: unknown): OzonListingDraftMediaAssignment | null {
  const candidate = record(value);
  const slotKey = exactText(
    candidate?.slotKey,
    AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH,
  );
  const assetId = exactText(candidate?.assetId, 200);
  if (!candidate || !slotKey || !assetId
    || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(String(candidate.source))) {
    return null;
  }
  if (candidate.scope === 'PRODUCT') {
    if (candidate.skuKey !== undefined && candidate.skuKey !== null) return null;
    return {
      scope: 'PRODUCT',
      slotKey,
      assetId,
      source: candidate.source as OzonListingDraftMediaAssignment['source'],
    };
  }
  const skuKey = exactText(candidate.skuKey, 500);
  if (candidate.scope !== 'SKU' || !skuKey) return null;
  return {
    scope: 'SKU',
    skuKey,
    slotKey,
    assetId,
    source: candidate.source as OzonListingDraftMediaAssignment['source'],
  };
}

export function normalizeAiMediaListingDraftApplicationTarget(
  value: unknown,
): AiMediaListingDraftApplicationTarget | null {
  const candidate = record(value);
  const id = exactText(candidate?.id, 200);
  const revision = positiveInteger(candidate?.revision);
  const draftVersion = positiveInteger(candidate?.draftVersion);
  const sourceCaptureSnapshotId = exactText(candidate?.sourceCaptureSnapshotId, 200);
  const media = record(candidate?.media);
  if (!candidate || candidate.type !== 'listing-draft' || !id || !revision || !draftVersion
    || !sourceCaptureSnapshotId || !media || !Array.isArray(media.assignments)
    || media.assignments.length > 500) return null;
  const assignments = media.assignments.map(normalizeAssignment);
  if (assignments.some((assignment) => !assignment)) return null;
  const slotKeys = new Set<string>();
  for (const assignment of assignments as OzonListingDraftMediaAssignment[]) {
    if (slotKeys.has(assignment.slotKey)) return null;
    slotKeys.add(assignment.slotKey);
  }
  return {
    type: 'listing-draft',
    id,
    revision,
    draftVersion,
    sourceCaptureSnapshotId,
    media: { assignments: assignments as OzonListingDraftMediaAssignment[] },
  };
}

function applicationSource(operation: unknown): AiMediaListingDraftApplicationMutation['source'] | null {
  if (operation === 'IMAGE_TO_IMAGE' || operation === 'GENERATED') return 'GENERATED';
  if (operation === 'IMAGE_TRANSLATE' || operation === 'TRANSLATED') return 'TRANSLATED';
  if (operation === 'FULL_EDIT' || operation === 'INPAINT' || operation === 'EDITED') return 'EDITED';
  return null;
}

export function normalizeAiMediaListingDraftApplicationMutation(
  value: unknown,
): AiMediaListingDraftApplicationMutation | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = exactText(candidate.id, 200);
  const revision = positiveInteger(candidate.revision);
  const workflowId = exactText(candidate.workflowId, 200);
  const jobId = exactText(candidate.jobId, 200);
  const assetId = exactText(candidate.assetId ?? candidate.outputAssetId, 200);
  const rollbackOfId = nullableText(candidate.rollbackOfId, 200);
  const rolledBackById = nullableText(candidate.rolledBackById, 200);
  const targetId = exactText(candidate.targetId, 200);
  const targetSequence = positiveInteger(candidate.targetSequence);
  const contextSkuKey = nullableText(candidate.contextSkuKey, 500);
  const contextSlotKey = exactText(
    candidate.contextSlotKey,
    AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH,
  );
  const normalizedOperationKey = exactText(candidate.operationKey, 128);
  const workflowRevisionBefore = positiveInteger(candidate.workflowRevisionBefore);
  const workflowRevisionAfter = positiveInteger(candidate.workflowRevisionAfter);
  const targetRevisionBefore = positiveInteger(candidate.targetRevisionBefore);
  const targetRevisionAfter = positiveInteger(candidate.targetRevisionAfter);
  const targetDraftVersionBefore = positiveInteger(candidate.targetDraftVersionBefore);
  const targetDraftVersionAfter = positiveInteger(candidate.targetDraftVersionAfter);
  const createdAt = dateText(candidate.createdAt);
  const rollbackReason = candidate.rollbackReason === null
    ? null
    : exactText(candidate.rollbackReason, 200);
  const source = applicationSource(candidate.source ?? candidate.operation);
  if (!id || !revision || !workflowId || !jobId || !assetId
    || rollbackOfId === undefined || rolledBackById === undefined
    || candidate.targetType !== 'listing-draft' || !targetId || !targetSequence
    || !['APPLY', 'ROLLBACK'].includes(String(candidate.kind))
    || !['append', 'replace'].includes(String(candidate.mode))
    || contextSkuKey === undefined || !contextSlotKey || !source
    || !normalizedOperationKey || normalizedOperationKey.length < 8
    || !workflowRevisionBefore || !workflowRevisionAfter
    || workflowRevisionAfter !== workflowRevisionBefore + 1
    || !targetRevisionBefore || !targetRevisionAfter
    || !targetDraftVersionBefore || !targetDraftVersionAfter
    || !createdAt || typeof candidate.rollbackEligible !== 'boolean'
    || (candidate.rollbackReason !== null && !rollbackReason)) return null;
  if ((candidate.kind === 'ROLLBACK') !== Boolean(rollbackOfId)) return null;
  return {
    id,
    revision,
    kind: candidate.kind as AiMediaListingDraftApplicationKind,
    workflowId,
    jobId,
    assetId,
    rollbackOfId,
    rolledBackById,
    targetType: 'listing-draft',
    targetId,
    targetSequence,
    mode: candidate.mode as AiMediaListingDraftApplicationMode,
    contextSkuKey,
    contextSlotKey,
    source,
    operationKey: normalizedOperationKey,
    workflowRevisionBefore,
    workflowRevisionAfter,
    targetRevisionBefore,
    targetRevisionAfter,
    targetDraftVersionBefore,
    targetDraftVersionAfter,
    createdAt,
    rollbackEligible: candidate.rollbackEligible,
    rollbackReason,
  };
}

export function normalizeAiMediaListingDraftApplicationLedger(
  value: unknown,
): AiMediaListingDraftApplicationLedger | null {
  const candidate = record(value);
  if (!candidate
    || candidate.contractVersion !== AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION
    || !Array.isArray(candidate.items) || candidate.items.length > 100) return null;
  const items = candidate.items.map(normalizeAiMediaListingDraftApplicationMutation);
  const frontier = candidate.frontier === null
    ? null
    : normalizeAiMediaListingDraftApplicationMutation(candidate.frontier);
  const recoveredOperation = candidate.recoveredOperation === null
    ? null
    : normalizeAiMediaListingDraftApplicationMutation(candidate.recoveredOperation);
  const nextBeforeSequence = candidate.nextBeforeSequence === null
    ? null
    : positiveInteger(candidate.nextBeforeSequence);
  const target = normalizeAiMediaListingDraftApplicationTarget(candidate.target);
  if (items.some((item) => !item)
    || (candidate.frontier !== null && !frontier)
    || (candidate.recoveredOperation !== null && !recoveredOperation)
    || (candidate.nextBeforeSequence !== null && !nextBeforeSequence)
    || !target) return null;
  const normalizedItems = items as AiMediaListingDraftApplicationMutation[];
  if (normalizedItems.some((item) => item.targetId !== target.id)
    || (frontier && (frontier.kind !== 'APPLY' || frontier.targetId !== target.id))
    || (recoveredOperation && recoveredOperation.targetId !== target.id)) return null;
  return {
    contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    items: normalizedItems,
    frontier,
    recoveredOperation,
    nextBeforeSequence,
    target,
  };
}

export function normalizeAiMediaListingDraftApplicationResult(
  value: unknown,
): AiMediaListingDraftApplicationResult | null {
  const candidate = record(value);
  const application = normalizeAiMediaListingDraftApplicationMutation(candidate?.application);
  const target = normalizeAiMediaListingDraftApplicationTarget(candidate?.target);
  if (!candidate
    || candidate.contractVersion !== AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION
    || !application || !target || application.targetId !== target.id
    || typeof candidate.replayed !== 'boolean') return null;
  return {
    contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    application,
    target,
    replayed: candidate.replayed,
  };
}

function compareListingDraftTargetVersion(
  left: AiMediaListingDraftApplicationTarget,
  right: AiMediaListingDraftApplicationTarget,
): number {
  return left.revision - right.revision || left.draftVersion - right.draftVersion;
}

/** Merge an older keyset page without allowing it to regress the current frontier. */
export function appendAiMediaListingDraftApplicationLedgerPage(
  current: AiMediaListingDraftApplicationLedger,
  page: AiMediaListingDraftApplicationLedger,
): AiMediaListingDraftApplicationLedger {
  if (current.target.id !== page.target.id) return current;
  const pageIsNewer = compareListingDraftTargetVersion(page.target, current.target) > 0;
  const byId = new Map<string, AiMediaListingDraftApplicationMutation>(
    current.items.map((item) => [item.id, item]),
  );
  for (const item of page.items) {
    const existing = byId.get(item.id);
    // The target snapshot determines whether a duplicate row is fresher. Mutation
    // revisions alone do not change when an APPLY is later marked rolled back.
    if (!existing || pageIsNewer) byId.set(item.id, item);
  }
  const frontier = pageIsNewer ? page.frontier : current.frontier;
  const recoveredOperation = page.recoveredOperation || current.recoveredOperation;
  return {
    ...current,
    items: [...byId.values()].sort((left, right) => right.targetSequence - left.targetSequence),
    frontier,
    recoveredOperation,
    nextBeforeSequence: page.nextBeforeSequence,
    target: pageIsNewer ? page.target : current.target,
  };
}

export function listingDraftContextPath(input: {
  draftId: string;
  revision: number;
  draftVersion: number;
  skuKey?: string | null;
  slotKey?: string | null;
}): string {
  const draftId = exactText(input.draftId, 200);
  if (!draftId) throw new Error('图片草稿标识无效');
  const query = new URLSearchParams({
    revision: String(expectedVersion(input.revision, '草稿修订版本')),
    draftVersion: String(expectedVersion(input.draftVersion, '草稿业务版本')),
  });
  optionalQueryValue(query, 'skuKey', input.skuKey);
  optionalQueryValue(query, 'slotKey', input.slotKey);
  return `${AI_MEDIA_API_BASE}/contexts/listing-draft/${encoded(draftId)}?${query.toString()}`;
}

export function listingDraftWorkflowHistoryPath(input: {
  draftId: string;
  cursor?: string | null;
  limit?: number;
}): string {
  const draftId = exactText(input.draftId, 200);
  if (!draftId) throw new Error('图片草稿标识无效');
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('任务历史分页大小无效');
  const query = new URLSearchParams({
    contextType: 'listing-draft',
    contextId: draftId,
    limit: String(limit),
    pageVersion: '1',
  });
  optionalQueryValue(query, 'cursor', input.cursor);
  return `${AI_MEDIA_API_BASE}/workflows?${query.toString()}`;
}

export function listingDraftApplicationHistoryPath(input: {
  draftId: string;
  beforeSequence?: number | null;
  operationKey?: string | null;
  limit?: number;
}): string {
  const draftId = exactText(input.draftId, 200);
  if (!draftId) throw new Error('图片草稿标识无效');
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('应用历史分页大小无效');
  const query = new URLSearchParams({ limit: String(limit) });
  if (input.beforeSequence != null) {
    query.set('beforeSequence', String(expectedVersion(input.beforeSequence, '应用历史游标')));
  }
  if (input.operationKey) query.set('operationKey', operationKey(input.operationKey));
  return `${AI_MEDIA_API_BASE}/contexts/listing-draft/${encoded(draftId)}/applications?${query.toString()}`;
}

export function listingDraftApplicationApplyPath(workflowId: string): string {
  const normalized = exactText(workflowId, 200);
  if (!normalized) throw new Error('AI 图片任务标识无效');
  return `${AI_MEDIA_API_BASE}/workflows/${encoded(normalized)}/listing-draft-application`;
}

export function listingDraftApplicationRollbackPath(applicationId: string): string {
  const normalized = exactText(applicationId, 200);
  if (!normalized) throw new Error('图片应用记录标识无效');
  return `${AI_MEDIA_API_BASE}/listing-draft-applications/${encoded(normalized)}/rollback`;
}

export function listingDraftSlotAuthority(
  context: AiMediaContextResponse,
): AiMediaListingDraftSlotAuthority | null {
  const target = context?.target;
  if (!target || target.type !== 'listing-draft') return null;
  const draftId = exactText(target.id, 200);
  const revision = positiveInteger(target.revision);
  const draftVersion = positiveInteger(target.draftVersion);
  const sourceCaptureSnapshotId = exactText(context.snapshot?.id, 200);
  const skuKey = nullableText(target.skuKey, 500);
  const slotKey = nullableText(
    target.slotKey,
    AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH,
  );
  const assignedAssetId = nullableText(target.assignedAssetId, 200);
  if (!draftId || !revision || !draftVersion || !sourceCaptureSnapshotId
    || skuKey === undefined || slotKey === undefined || assignedAssetId === undefined) return null;
  return {
    draftId,
    revision,
    draftVersion,
    sourceCaptureSnapshotId,
    skuKey,
    slotKey,
    assignedAssetId,
  };
}

export function workflowMatchesListingDraftAuthority(
  workflow: AiMediaWorkflow,
  context: AiMediaContextResponse,
): boolean {
  const authority = listingDraftSlotAuthority(context);
  return Boolean(authority
    && workflow.contextType === 'listing-draft'
    && workflow.contextId === authority.draftId
    && workflow.contextDraftRevision === authority.revision
    && workflow.contextDraftVersion === authority.draftVersion
    && (workflow.contextSkuKey ?? null) === authority.skuKey
    && (workflow.contextSlotKey ?? null) === authority.slotKey);
}

export function buildAiMediaListingDraftApplicationRequest(input: {
  workflow: AiMediaWorkflow;
  context: AiMediaContextResponse;
  mode: AiMediaListingDraftApplicationMode;
  operationKey: string;
  replaceConfirmed?: boolean;
}) {
  const rawSlotKey = input.context.target.type === 'listing-draft'
    ? input.context.target.slotKey
    : null;
  if (typeof rawSlotKey === 'string'
    && rawSlotKey.length > AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH) {
    throw new Error('当前槽位标识过长，无法写回商品草稿，请重新选择标准槽位');
  }
  const authority = listingDraftSlotAuthority(input.context);
  if (!authority || !authority.slotKey || !workflowMatchesListingDraftAuthority(input.workflow, input.context)) {
    throw new Error('候选图与当前冻结槽位不一致，请刷新后重试');
  }
  if (input.workflow.status !== 'SUCCEEDED'
    || input.workflow.reviewStatus !== 'APPROVED'
    || !input.workflow.selectedOutputAssetId) {
    throw new Error('候选图尚未通过审核');
  }
  if (input.mode === 'append') {
    if (authority.assignedAssetId) throw new Error('当前槽位已有图片，只能明确确认替换');
  } else {
    if (!authority.assignedAssetId) throw new Error('空槽位不能执行替换');
    if (input.replaceConfirmed !== true) throw new Error('替换现有槽位需要再次确认');
  }
  return {
    mode: input.mode,
    operationKey: operationKey(input.operationKey),
    expectedWorkflowRevision: expectedVersion(input.workflow.revision, '候选任务版本'),
    expectedTargetRevision: authority.revision,
    expectedTargetDraftVersion: authority.draftVersion,
    ...(input.mode === 'replace' ? { replaceConfirmed: true as const } : {}),
  };
}

export function buildAiMediaListingDraftRollbackRequest(input: {
  application: AiMediaListingDraftApplicationMutation;
  target: AiMediaListingDraftApplicationTarget;
  operationKey: string;
}) {
  if (input.application.kind !== 'APPLY'
    || !input.application.rollbackEligible
    || input.application.targetId !== input.target.id) {
    throw new Error('当前图片应用记录不能回滚');
  }
  return {
    operationKey: operationKey(input.operationKey),
    expectedApplicationRevision: expectedVersion(input.application.revision, '应用记录版本'),
    expectedWorkflowRevision: expectedVersion(input.application.workflowRevisionAfter, '候选任务版本'),
    expectedTargetRevision: expectedVersion(input.target.revision, '草稿修订版本'),
    expectedTargetDraftVersion: expectedVersion(input.target.draftVersion, '草稿业务版本'),
  };
}

function assertListingContext(value: unknown): AiMediaContextResponse {
  const candidate = record(value);
  const target = record(candidate?.target);
  const snapshot = record(candidate?.snapshot);
  if (!candidate || !target || target.type !== 'listing-draft'
    || !exactText(target.id, 200) || !positiveInteger(target.revision)
    || !positiveInteger(target.draftVersion)
    || nullableText(target.skuKey, 500) === undefined
    || nullableText(target.slotKey) === undefined
    || nullableText(target.assignedAssetId, 200) === undefined
    || !snapshot || !exactText(snapshot.id, 200)
    || !positiveInteger(snapshot.version) || !exactText(snapshot.captureHash, 128)
    || !Array.isArray(candidate.inputs) || candidate.inputs.length > 50) {
    throw new Error('服务端返回了无效的 listing-draft 图片上下文');
  }
  return value as AiMediaContextResponse;
}

export function aiMediaListingDraftApplicationClient(
  transport: Pick<typeof api, 'get' | 'post'> = api,
): AiMediaListingDraftApplicationClient {
  return {
    async getContext(input) {
      return assertListingContext(unwrap(
        await transport.get<unknown>(listingDraftContextPath(input)),
        '读取草稿图片上下文失败',
      ));
    },

    async listWorkflows(input) {
      const raw = unwrap(
        await transport.get<unknown>(listingDraftWorkflowHistoryPath(input)),
        '读取草稿图片任务失败',
      );
      const page = normalizeAiMediaWorkflowPage(raw);
      if (!page) throw new Error('服务端返回了无效的图片任务历史');
      return page;
    },

    async listApplications(input) {
      const raw = unwrap(
        await transport.get<unknown>(listingDraftApplicationHistoryPath(input), { signal: input.signal }),
        '读取草稿图片应用记录失败',
      );
      const ledger = normalizeAiMediaListingDraftApplicationLedger(raw);
      if (!ledger || ledger.target.id !== input.draftId) {
        throw new Error('服务端返回了无效的草稿图片应用记录');
      }
      return ledger;
    },

    async apply(workflow, context, input) {
      const body = buildAiMediaListingDraftApplicationRequest({ workflow, context, ...input });
      const raw = unwrap(
        await transport.post<unknown>(listingDraftApplicationApplyPath(workflow.id), body),
        '应用候选图失败',
      );
      const result = normalizeAiMediaListingDraftApplicationResult(raw);
      if (!result || result.target.id !== workflow.contextId) {
        throw new Error('服务端返回了无效的候选图应用结果');
      }
      return result;
    },

    async rollback(application, target, operationKeyValue) {
      const body = buildAiMediaListingDraftRollbackRequest({
        application,
        target,
        operationKey: operationKeyValue,
      });
      const raw = unwrap(
        await transport.post<unknown>(listingDraftApplicationRollbackPath(application.id), body),
        '回滚候选图失败',
      );
      const result = normalizeAiMediaListingDraftApplicationResult(raw);
      if (!result || result.target.id !== target.id || result.application.rollbackOfId !== application.id) {
        throw new Error('服务端返回了无效的候选图回滚结果');
      }
      return result;
    },
  };
}

export function listingDraftApplicationSourceForOperation(
  operation: AiMediaOperation,
): AiMediaListingDraftApplicationMutation['source'] {
  if (operation === 'IMAGE_TRANSLATE') return 'TRANSLATED';
  if (operation === 'FULL_EDIT' || operation === 'INPAINT') return 'EDITED';
  return 'GENERATED';
}
