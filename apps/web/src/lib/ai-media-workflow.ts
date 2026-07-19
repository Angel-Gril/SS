export type AiMediaOperation = 'IMAGE_TO_IMAGE' | 'IMAGE_TRANSLATE';
export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaContextInput {
  sourceMediaKey: string;
  role: string;
  sourceUrl: string;
  assetId: string | null;
  assetUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

export interface AiMediaContextResponse {
  target: { type: 'collect'; id: string; label: string };
  snapshot: { id: string; version: number; captureHash: string };
  inputs: AiMediaContextInput[];
}

export interface AiImageTranslationTerminology {
  src: string;
  tgt: string;
}

export interface AiMediaWorkflowJob {
  id: string;
  operation?: AiMediaOperation;
  status: string;
  prompt?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerJobId?: string | null;
  costStatus?: 'RESERVED' | 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED' | 'SETTLED' | 'RELEASED' | null;
  appliedMode?: 'append' | 'replace' | null;
  translation?: {
    sourceLanguage: string;
    targetLanguage: string;
    policyVersion: string;
    terminologies?: AiImageTranslationTerminology[];
  };
  assets?: Array<{ id: string; url: string; mimeType?: string; width?: number | null; height?: number | null }>;
}

export interface AiMediaWorkflow {
  id: string;
  operation: AiMediaOperation;
  status: AiMediaWorkflowStatus;
  reviewStatus: AiMediaReviewStatus;
  revision: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt?: string;
  completedAt: string | null;
  inputs: Array<{ assetId: string; url: string }>;
  jobs: AiMediaWorkflowJob[];
}

export interface AiMediaOperationReadiness {
  enabled: boolean;
  ready: boolean;
  testOnly?: boolean;
  reasonCode: 'READY' | 'AI_MEDIA_WORKFLOW_DISABLED' | 'AI_MEDIA_OPERATION_DISABLED'
    | 'SOURCE_LISTING_WEB_MEDIA_DISABLED' | 'PROVIDER_NOT_READY' | 'STORAGE_NOT_READY';
  reason: string;
}

export interface AiMediaCapabilities {
  webMediaEnabled: boolean;
  workflowEnabled: boolean;
  operations: Partial<Record<AiMediaOperation, AiMediaOperationReadiness>>;
}

export function describeAiMediaReadiness(
  operation: AiMediaOperation,
  readiness: AiMediaOperationReadiness,
): string {
  if (readiness.ready && readiness.testOnly) {
    return '当前使用本地测试 Provider，结果不代表真实 AI 效果。';
  }
  if (readiness.reasonCode === 'SOURCE_LISTING_WEB_MEDIA_DISABLED') {
    return 'Web 媒体工具当前关闭。';
  }
  if (readiness.reasonCode === 'AI_MEDIA_WORKFLOW_DISABLED') {
    return 'AI 媒体工作流当前未对该账号开放。';
  }
  if (readiness.reasonCode === 'AI_MEDIA_OPERATION_DISABLED') {
    return operation === 'IMAGE_TRANSLATE' ? '图片翻译当前关闭。' : 'AI 改图当前关闭。';
  }
  if (readiness.reasonCode === 'PROVIDER_NOT_READY') {
    return operation === 'IMAGE_TRANSLATE'
      ? '图片翻译 Provider 尚未完成生产验证。'
      : 'AI 改图 Provider 尚未完成生产验证。';
  }
  if (readiness.reasonCode === 'STORAGE_NOT_READY') {
    return '图片翻译需要可用的 OSS 或本地存储，当前存储配置不兼容。';
  }
  return readiness.reason;
}

export interface WorkflowSubmissionIntent {
  fingerprint: string;
  idempotencyKey: string;
  createdAt: number;
}

export const AI_MEDIA_INTENT_TTL_MS = 15 * 60 * 1_000;

export interface WorkflowIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resolveWorkflowSubmissionIntent(
  current: WorkflowSubmissionIntent | null,
  fingerprint: string,
  createKey: () => string,
  options: { now?: number; ttlMs?: number } = {},
): WorkflowSubmissionIntent {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? AI_MEDIA_INTENT_TTL_MS;
  if (
    current?.fingerprint === fingerprint
    && Number.isSafeInteger(current.createdAt)
    && current.createdAt <= now
    && now - current.createdAt <= ttlMs
  ) return current;
  return { fingerprint, idempotencyKey: createKey(), createdAt: now };
}

function validWorkflowSubmissionIntent(value: unknown): value is WorkflowSubmissionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fingerprint === 'string'
    && candidate.fingerprint.length > 0
    && candidate.fingerprint.length <= 100_000
    && typeof candidate.idempotencyKey === 'string'
    && candidate.idempotencyKey.length >= 8
    && candidate.idempotencyKey.length <= 128
    && Number.isSafeInteger(candidate.createdAt);
}

export function loadWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  options: { now?: number; ttlMs?: number } = {},
): WorkflowSubmissionIntent | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validWorkflowSubmissionIntent(parsed)) {
      storage.removeItem(key);
      return null;
    }
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? AI_MEDIA_INTENT_TTL_MS;
    if (parsed.createdAt > now || now - parsed.createdAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  intent: WorkflowSubmissionIntent,
): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(intent));
  } catch {
    // Private browsing and quota failures must not block a submission.
  }
}

export function clearWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable after a browser context is closed.
  }
}

export function isDefinitiveWorkflowSubmissionFailure(code: unknown): boolean {
  return new Set([
    'INVALID_REQUEST',
    'AI_MEDIA_WORKFLOW_DISABLED',
    'AI_MEDIA_OPERATION_DISABLED',
    'PROVIDER_NOT_READY',
    'SOURCE_ASSET_NOT_FOUND',
    'SOURCE_ASSET_INVALID',
    'SOURCE_ASSET_DUPLICATE',
    'AI_MEDIA_CONTEXT_MISMATCH',
    'IDEMPOTENCY_KEY_CONFLICT',
    'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
    'QUEUE_UNAVAILABLE',
  ]).has(String(code || '').toUpperCase());
}

function languageTag(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(normalized)) {
    throw new Error('翻译语言代码无效');
  }
  return normalized;
}

export function normalizeImageTranslationTerminologies(
  entries: AiImageTranslationTerminology[],
): AiImageTranslationTerminology[] {
  if (entries.length > 50) throw new Error('术语表最多支持 50 条');
  const bySource = new Map<string, AiImageTranslationTerminology>();
  for (const entry of entries) {
    const src = String(entry.src || '').trim();
    const tgt = String(entry.tgt || '').trim();
    if (!src && !tgt) continue;
    if (!src || !tgt) throw new Error('每条术语都需要填写原文和译文');
    if (src.length > 120 || tgt.length > 120) throw new Error('单条术语不能超过 120 个字符');
    const key = src.toLocaleLowerCase();
    const existing = bySource.get(key);
    if (existing && existing.tgt.toLocaleLowerCase() !== tgt.toLocaleLowerCase()) {
      throw new Error(`术语“${src}”存在冲突译文`);
    }
    if (!existing) bySource.set(key, { src, tgt });
  }
  return [...bySource.values()];
}

export function buildImageTranslationWorkflowRequest(input: {
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  terminologies: AiImageTranslationTerminology[];
  idempotencyKey: string;
  contextId: string;
}) {
  const sourceAssetId = input.sourceAssetId.trim();
  const contextId = input.contextId.trim();
  if (!sourceAssetId || !contextId) throw new Error('请选择当前商品的源图');
  const sourceLanguage = languageTag(input.sourceLanguage);
  const targetLanguage = languageTag(input.targetLanguage);
  if (sourceLanguage === targetLanguage) throw new Error('源语言和目标语言不能相同');
  const domainHint = input.domainHint.trim();
  if (new TextEncoder().encode(domainHint).byteLength > 2_000) {
    throw new Error('翻译要求不能超过 2000 字节');
  }
  return {
    operation: 'IMAGE_TRANSLATE' as const,
    sourceAssetId,
    sourceLanguage,
    targetLanguage,
    domainHint,
    terminologies: normalizeImageTranslationTerminologies(input.terminologies),
    idempotencyKey: input.idempotencyKey,
    context: { type: 'collect' as const, id: contextId },
  };
}

export function isAiMediaWorkflowInputCurrent(
  workflow: Pick<AiMediaWorkflow, 'inputs'>,
  currentInputs: AiMediaContextInput[],
) {
  if (!workflow.inputs.length) return false;
  const currentAssetIds = new Set(currentInputs.map((input) => input.assetId).filter(Boolean));
  return workflow.inputs.every((input) => currentAssetIds.has(input.assetId));
}
