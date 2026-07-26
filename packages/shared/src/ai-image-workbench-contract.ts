export const AI_IMAGE_WORKBENCH_CONTRACT_VERSION = 'ai-image-workbench/v1' as const;

export const AI_IMAGE_WORKBENCH_EXECUTION_MODES = Object.freeze([
  'ERP_HOSTED',
  'BYOK',
] as const);

export type AiImageWorkbenchExecutionMode =
  typeof AI_IMAGE_WORKBENCH_EXECUTION_MODES[number];

export const AI_IMAGE_WORKBENCH_GLOBAL_STATES = Object.freeze([
  'BOOTSTRAP',
  'CONTEXT_REQUIRED',
  'READY',
  'PLANNING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'REVIEW',
  'INGESTING',
  'BINDING',
  'READY_TO_PUBLISH',
  'PUBLISHING',
  'PUBLISHED',
  'RECONCILING',
  'CANCELLED',
  'FAILED',
  'STALE_DRAFT',
  'AUTH_REVOKED',
] as const);

export type AiImageWorkbenchGlobalState =
  typeof AI_IMAGE_WORKBENCH_GLOBAL_STATES[number];

export const AI_IMAGE_WORKBENCH_SLOT_STATES = Object.freeze([
  'EMPTY',
  'QUEUED',
  'SUBMITTING',
  'WAITING',
  'CANDIDATE_READY',
  'APPROVED',
  'REJECTED',
  'INGESTING',
  'INGESTED',
  'BOUND',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'UNKNOWN_OUTCOME',
] as const);

export type AiImageWorkbenchSlotState =
  typeof AI_IMAGE_WORKBENCH_SLOT_STATES[number];

export const AI_IMAGE_WORKBENCH_LIMITS = Object.freeze({
  maxImagesPerRequest: 4,
  maxReferenceImages: 4,
  maxRequestBytes: 50 * 1024 * 1024,
  maxResultBytes: 20 * 1024 * 1024,
  maxDimension: 4096,
  maxPixels: 4096 * 4096,
  maxPromptCharacters: 8000,
  maxNegativePromptCharacters: 4000,
  maxConcurrency: 4,
  providerTimeoutMs: 120_000,
} as const);

export const AI_IMAGE_WORKBENCH_UNKNOWN_OUTCOME_POLICY = Object.freeze({
  automaticRetryAllowed: false,
  recoveryRequirement: 'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY',
} as const);

export const AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT = Object.freeze({
  contractVersion: 'extension-byok-media-ingest-status/v1' as const,
  requestHashPattern: '^[a-f0-9]{64}$' as const,
  states: Object.freeze({
    notCommitted: 'NOT_COMMITTED' as const,
    pending: 'PENDING' as const,
    succeeded: 'SUCCEEDED' as const,
  }),
});

export type AiImageWorkbenchProviderOutcome =
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'UNKNOWN_OUTCOME';

function frozenList<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

const GLOBAL_TRANSITIONS = Object.freeze({
  BOOTSTRAP: frozenList(['CONTEXT_REQUIRED', 'READY', 'FAILED', 'AUTH_REVOKED']),
  CONTEXT_REQUIRED: frozenList(['READY', 'FAILED', 'AUTH_REVOKED']),
  READY: frozenList(['PLANNING', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED']),
  PLANNING: frozenList(['READY', 'RUNNING', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED']),
  RUNNING: frozenList([
    'PAUSING', 'REVIEW', 'CANCELLED', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED',
  ]),
  PAUSING: frozenList([
    'PAUSED', 'REVIEW', 'CANCELLED', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED',
  ]),
  PAUSED: frozenList(['RUNNING', 'CANCELLED', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED']),
  REVIEW: frozenList([
    'RUNNING', 'INGESTING', 'READY_TO_PUBLISH', 'CANCELLED', 'FAILED',
    'STALE_DRAFT', 'AUTH_REVOKED',
  ]),
  INGESTING: frozenList(['BINDING', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED']),
  BINDING: frozenList([
    'REVIEW', 'READY_TO_PUBLISH', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED',
  ]),
  READY_TO_PUBLISH: frozenList(['REVIEW', 'PUBLISHING', 'STALE_DRAFT', 'AUTH_REVOKED']),
  PUBLISHING: frozenList([
    'PUBLISHED', 'RECONCILING', 'FAILED', 'STALE_DRAFT', 'AUTH_REVOKED',
  ]),
  PUBLISHED: frozenList([]),
  RECONCILING: frozenList(['PUBLISHED', 'FAILED', 'AUTH_REVOKED']),
  CANCELLED: frozenList(['READY', 'AUTH_REVOKED']),
  FAILED: frozenList(['READY', 'RUNNING', 'AUTH_REVOKED']),
  STALE_DRAFT: frozenList(['READY', 'AUTH_REVOKED']),
  AUTH_REVOKED: frozenList(['BOOTSTRAP']),
} satisfies Record<AiImageWorkbenchGlobalState, readonly AiImageWorkbenchGlobalState[]>);

const SLOT_TRANSITIONS = Object.freeze({
  EMPTY: frozenList(['QUEUED']),
  QUEUED: frozenList(['EMPTY', 'SUBMITTING']),
  SUBMITTING: frozenList([
    'WAITING', 'CANDIDATE_READY', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN_OUTCOME',
  ]),
  WAITING: frozenList([
    'CANDIDATE_READY', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN_OUTCOME',
  ]),
  CANDIDATE_READY: frozenList(['APPROVED', 'REJECTED', 'QUEUED']),
  APPROVED: frozenList(['INGESTING', 'QUEUED', 'REJECTED']),
  REJECTED: frozenList(['QUEUED', 'CANDIDATE_READY']),
  INGESTING: frozenList(['INGESTED', 'FAILED_RETRYABLE', 'FAILED_FINAL']),
  INGESTED: frozenList(['BOUND', 'FAILED_RETRYABLE', 'FAILED_FINAL']),
  BOUND: frozenList([]),
  FAILED_RETRYABLE: frozenList(['QUEUED']),
  FAILED_FINAL: frozenList([]),
  UNKNOWN_OUTCOME: frozenList(['CANDIDATE_READY', 'FAILED_RETRYABLE', 'FAILED_FINAL']),
} satisfies Record<AiImageWorkbenchSlotState, readonly AiImageWorkbenchSlotState[]>);

export const AI_IMAGE_WORKBENCH_ROUTES = Object.freeze({
  ERP_HOSTED: Object.freeze({
    readiness: '/api/extension-device/source-workbench/status',
    execute: '/api/extension-device/media-workflows/execute',
    publish: '/api/extension-device/ozon-publish/execute',
  }),
  BYOK: Object.freeze({
    readiness: '/api/extension-device/byok-media/readiness',
    ingest: '/api/extension-device/byok-media/ingest',
    ingestStatus: '/api/extension-device/byok-media/ingest-status',
    publish: '/api/extension-device/ozon-publish/execute',
  }),
} as const);

export const AI_IMAGE_WORKBENCH_COMMANDS = Object.freeze({
  ERP_HOSTED: Object.freeze({
    execute: 'MEDIA_EXECUTE',
    review: 'MEDIA_REVIEW',
    apply: 'MEDIA_APPLY',
    publish: 'OZON_PUBLISH',
  }),
  BYOK: Object.freeze({
    execute: 'BYOK_PROVIDER_EXECUTE',
    ingest: 'BYOK_MEDIA_INGEST',
    publish: 'OZON_PUBLISH',
  }),
} as const);

export class AiImageWorkbenchContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageWorkbenchContractError';
  }
}

function fail(code: string, message: string): never {
  throw new AiImageWorkbenchContractError(code, message);
}

export function parseAiImageWorkbenchExecutionMode(
  value: unknown,
): AiImageWorkbenchExecutionMode {
  if (value !== 'ERP_HOSTED' && value !== 'BYOK') {
    fail('AI_IMAGE_WORKBENCH_MODE_INVALID', 'AI image workbench mode is invalid');
  }
  return value;
}

export function resolveAiImageWorkbenchExecutionMode(input: {
  currentMode: unknown;
  requestedMode: unknown;
  dispatched: boolean;
}): AiImageWorkbenchExecutionMode {
  const currentMode = parseAiImageWorkbenchExecutionMode(input.currentMode);
  const requestedMode = parseAiImageWorkbenchExecutionMode(input.requestedMode);
  if (input.dispatched && currentMode !== requestedMode) {
    fail('AI_IMAGE_WORKBENCH_MODE_LOCKED', 'AI image workbench mode is locked after dispatch');
  }
  return requestedMode;
}

function parseGlobalState(value: unknown): AiImageWorkbenchGlobalState {
  if (!AI_IMAGE_WORKBENCH_GLOBAL_STATES.includes(value as AiImageWorkbenchGlobalState)) {
    fail('AI_IMAGE_WORKBENCH_STATE_INVALID', 'AI image workbench state is invalid');
  }
  return value as AiImageWorkbenchGlobalState;
}

function parseSlotState(value: unknown): AiImageWorkbenchSlotState {
  if (!AI_IMAGE_WORKBENCH_SLOT_STATES.includes(value as AiImageWorkbenchSlotState)) {
    fail('AI_IMAGE_WORKBENCH_SLOT_STATE_INVALID', 'AI image workbench slot state is invalid');
  }
  return value as AiImageWorkbenchSlotState;
}

export function transitionAiImageWorkbenchGlobalState(
  current: unknown,
  next: unknown,
): AiImageWorkbenchGlobalState {
  const currentState = parseGlobalState(current);
  const nextState = parseGlobalState(next);
  if (currentState === nextState) return currentState;
  const allowed = GLOBAL_TRANSITIONS[currentState] as readonly AiImageWorkbenchGlobalState[];
  if (!allowed.includes(nextState)) {
    fail(
      'AI_IMAGE_WORKBENCH_STATE_TRANSITION_INVALID',
      'AI image workbench state transition is invalid',
    );
  }
  return nextState;
}

export function transitionAiImageWorkbenchSlotState(
  current: unknown,
  next: unknown,
): AiImageWorkbenchSlotState {
  const currentState = parseSlotState(current);
  const nextState = parseSlotState(next);
  if (currentState === nextState) return currentState;
  const allowed = SLOT_TRANSITIONS[currentState] as readonly AiImageWorkbenchSlotState[];
  if (!allowed.includes(nextState)) {
    fail(
      'AI_IMAGE_WORKBENCH_SLOT_TRANSITION_INVALID',
      'AI image workbench slot transition is invalid',
    );
  }
  return nextState;
}

export function resolveAiImageWorkbenchProviderOutcome(input: {
  requestDispatched: boolean;
  responseReceived: boolean;
  definiteFailure: boolean;
}): AiImageWorkbenchProviderOutcome {
  if (!input
    || typeof input.requestDispatched !== 'boolean'
    || typeof input.responseReceived !== 'boolean'
    || typeof input.definiteFailure !== 'boolean'
    || (input.responseReceived && !input.requestDispatched)) {
    fail(
      'AI_IMAGE_WORKBENCH_OUTCOME_INPUT_INVALID',
      'AI image workbench Provider outcome input is invalid',
    );
  }
  if (input.definiteFailure) return 'FAILED_FINAL';
  if (input.responseReceived) return 'SUCCEEDED';
  if (input.requestDispatched) return 'UNKNOWN_OUTCOME';
  return 'FAILED_RETRYABLE';
}

function normalizedPublicKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function isSecretPublicKey(value: string): boolean {
  const key = normalizedPublicKey(value);
  return key === 'key'
    || key === 'sk'
    || key.endsWith('apikey')
    || key.endsWith('token')
    || key.endsWith('authorization')
    || key.endsWith('authheader')
    || key.endsWith('accesstoken')
    || key.endsWith('refreshtoken')
    || key.endsWith('clientsecret')
    || key.endsWith('privatekey')
    || key.endsWith('secret')
    || key.endsWith('credential')
    || key.endsWith('credentials')
    || key.endsWith('password')
    || key.endsWith('bearer')
    || key.endsWith('commandgrant')
    || key === 'base64'
    || key === 'b64json'
    || key.endsWith('imagedata')
    || key.endsWith('imagebytes')
    || key.endsWith('rawimage')
    || key.endsWith('resulturl')
    || key.endsWith('providerurl')
    || key.endsWith('sourceurl');
}

function inspectPublicPayload(value: unknown, seen: Set<object>): void {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    fail('AI_IMAGE_WORKBENCH_PUBLIC_PAYLOAD_INVALID', 'Public workbench payload is invalid');
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    fail('AI_IMAGE_WORKBENCH_PUBLIC_PAYLOAD_INVALID', 'Public workbench payload is invalid');
  }
  seen.add(objectValue);
  if (Array.isArray(value)) {
    value.forEach((item) => inspectPublicPayload(item, seen));
    seen.delete(objectValue);
    return;
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    fail('AI_IMAGE_WORKBENCH_PUBLIC_PAYLOAD_INVALID', 'Public workbench payload is invalid');
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretPublicKey(key)) {
      fail('AI_IMAGE_WORKBENCH_SECRET_FIELD', 'Secret fields are forbidden in public payloads');
    }
    inspectPublicPayload(item, seen);
  }
  seen.delete(objectValue);
}

export function assertAiImageWorkbenchPublicPayload<T>(value: T): T {
  inspectPublicPayload(value, new Set());
  return value;
}
