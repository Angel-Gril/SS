import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_WORKBENCH_COMMANDS,
  AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT,
  AI_IMAGE_WORKBENCH_CONTRACT_VERSION,
  AI_IMAGE_WORKBENCH_EXECUTION_MODES,
  AI_IMAGE_WORKBENCH_GLOBAL_STATES,
  AI_IMAGE_WORKBENCH_LIMITS,
  AI_IMAGE_WORKBENCH_ROUTES,
  AI_IMAGE_WORKBENCH_SLOT_STATES,
  AI_IMAGE_WORKBENCH_UNKNOWN_OUTCOME_POLICY,
  AiImageWorkbenchContractError,
  assertAiImageWorkbenchPublicPayload,
  parseAiImageWorkbenchExecutionMode,
  resolveAiImageWorkbenchExecutionMode,
  resolveAiImageWorkbenchProviderOutcome,
  transitionAiImageWorkbenchGlobalState,
  transitionAiImageWorkbenchSlotState,
} from 'shared';

describe('AI image workbench v1 contract', () => {
  it('keeps execution modes and hosted/BYOK command surfaces closed and distinct', () => {
    expect(AI_IMAGE_WORKBENCH_CONTRACT_VERSION).toBe('ai-image-workbench/v1');
    expect(AI_IMAGE_WORKBENCH_EXECUTION_MODES).toEqual(['ERP_HOSTED', 'BYOK']);
    expect(parseAiImageWorkbenchExecutionMode('ERP_HOSTED')).toBe('ERP_HOSTED');
    expect(parseAiImageWorkbenchExecutionMode('BYOK')).toBe('BYOK');
    expect(() => parseAiImageWorkbenchExecutionMode('custom')).toThrowError(
      expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_MODE_INVALID' }),
    );

    expect(AI_IMAGE_WORKBENCH_ROUTES.ERP_HOSTED.execute).toBe(
      '/api/extension-device/media-workflows/execute',
    );
    expect(AI_IMAGE_WORKBENCH_ROUTES.BYOK.ingest).toBe(
      '/api/extension-device/byok-media/ingest',
    );
    expect(AI_IMAGE_WORKBENCH_ROUTES.BYOK.ingestStatus).toBe(
      '/api/extension-device/byok-media/ingest-status',
    );
    expect(AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT).toEqual({
      contractVersion: 'extension-byok-media-ingest-status/v1',
      requestHashPattern: '^[a-f0-9]{64}$',
      states: { notCommitted: 'NOT_COMMITTED', pending: 'PENDING', succeeded: 'SUCCEEDED' },
    });
    expect(AI_IMAGE_WORKBENCH_ROUTES.ERP_HOSTED.execute)
      .not.toBe(AI_IMAGE_WORKBENCH_ROUTES.BYOK.ingest);
    expect(AI_IMAGE_WORKBENCH_COMMANDS.ERP_HOSTED.execute).toBe('MEDIA_EXECUTE');
    expect(AI_IMAGE_WORKBENCH_COMMANDS.BYOK.execute).toBe('BYOK_PROVIDER_EXECUTE');
    expect(AI_IMAGE_WORKBENCH_COMMANDS.BYOK.ingest).toBe('BYOK_MEDIA_INGEST');
    expect(AI_IMAGE_WORKBENCH_COMMANDS.ERP_HOSTED.execute)
      .not.toBe(AI_IMAGE_WORKBENCH_COMMANDS.BYOK.execute);
  });

  it('locks the execution mode after the first dispatch', () => {
    expect(resolveAiImageWorkbenchExecutionMode({
      currentMode: 'ERP_HOSTED',
      requestedMode: 'BYOK',
      dispatched: false,
    })).toBe('BYOK');
    expect(resolveAiImageWorkbenchExecutionMode({
      currentMode: 'ERP_HOSTED',
      requestedMode: 'ERP_HOSTED',
      dispatched: true,
    })).toBe('ERP_HOSTED');
    expect(() => resolveAiImageWorkbenchExecutionMode({
      currentMode: 'ERP_HOSTED',
      requestedMode: 'BYOK',
      dispatched: true,
    })).toThrowError(expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_MODE_LOCKED' }));
  });

  it.each([
    { apiKey: 'secret' },
    { nested: { provider_api_key: 'secret' } },
    { authorization: 'Bearer secret' },
    { accessToken: 'secret' },
    { profile: { clientSecret: 'secret' } },
    { credentials: { value: 'secret' } },
    { commandGrant: 'secret' },
    { providerToken: 'secret' },
    { privateKey: 'secret' },
    { sk: 'secret' },
    { authHeader: 'secret' },
  ])('rejects secret-bearing public payload fields: $s', (payload) => {
    expect(() => assertAiImageWorkbenchPublicPayload(payload)).toThrowError(
      expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_SECRET_FIELD' }),
    );
  });

  it('accepts redacted Provider readiness without exposing a secret field', () => {
    const payload = {
      schemaVersion: AI_IMAGE_WORKBENCH_CONTRACT_VERSION,
      executionMode: 'BYOK',
      provider: { origin: 'https://images.example.com', model: 'image-v1', hasKey: true },
    };
    expect(assertAiImageWorkbenchPublicPayload(payload)).toBe(payload);
  });

  it('uses deterministic closed global and slot state transitions', () => {
    expect(Object.isFrozen(AI_IMAGE_WORKBENCH_GLOBAL_STATES)).toBe(true);
    expect(Object.isFrozen(AI_IMAGE_WORKBENCH_SLOT_STATES)).toBe(true);
    expect(transitionAiImageWorkbenchGlobalState('READY', 'PLANNING')).toBe('PLANNING');
    expect(transitionAiImageWorkbenchGlobalState('READY', 'PLANNING')).toBe('PLANNING');
    expect(transitionAiImageWorkbenchGlobalState('PAUSING', 'PAUSED')).toBe('PAUSED');
    expect(transitionAiImageWorkbenchSlotState('EMPTY', 'QUEUED')).toBe('QUEUED');
    expect(transitionAiImageWorkbenchSlotState('CANDIDATE_READY', 'APPROVED'))
      .toBe('APPROVED');
    expect(transitionAiImageWorkbenchSlotState('APPROVED', 'INGESTING')).toBe('INGESTING');

    expect(() => transitionAiImageWorkbenchGlobalState('READY', 'PUBLISHED')).toThrowError(
      expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_STATE_TRANSITION_INVALID' }),
    );
    expect(() => transitionAiImageWorkbenchSlotState('QUEUED', 'BOUND')).toThrowError(
      expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_SLOT_TRANSITION_INVALID' }),
    );
    expect(() => transitionAiImageWorkbenchGlobalState('UNKNOWN' as never, 'READY'))
      .toThrowError(expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_STATE_INVALID' }));
    expect(() => transitionAiImageWorkbenchSlotState('EMPTY', 'UNKNOWN' as never))
      .toThrowError(expect.objectContaining({ code: 'AI_IMAGE_WORKBENCH_SLOT_STATE_INVALID' }));
  });

  it('exposes typed contract errors without leaking rejected values', () => {
    try {
      parseAiImageWorkbenchExecutionMode('secret-mode');
      throw new Error('expected parser to reject the mode');
    } catch (error) {
      expect(error).toBeInstanceOf(AiImageWorkbenchContractError);
      expect(error).toMatchObject({ code: 'AI_IMAGE_WORKBENCH_MODE_INVALID' });
      expect(String((error as Error).message)).not.toContain('secret-mode');
    }
  });

  it('shares bounded image, Prompt, concurrency, and timeout limits', () => {
    expect(Object.isFrozen(AI_IMAGE_WORKBENCH_LIMITS)).toBe(true);
    expect(AI_IMAGE_WORKBENCH_LIMITS).toEqual({
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
    });
  });

  it('classifies an accepted but unacknowledged Provider request as unknown and non-retryable', () => {
    expect(resolveAiImageWorkbenchProviderOutcome({
      requestDispatched: false,
      responseReceived: false,
      definiteFailure: false,
    })).toBe('FAILED_RETRYABLE');
    expect(resolveAiImageWorkbenchProviderOutcome({
      requestDispatched: true,
      responseReceived: false,
      definiteFailure: false,
    })).toBe('UNKNOWN_OUTCOME');
    expect(resolveAiImageWorkbenchProviderOutcome({
      requestDispatched: true,
      responseReceived: true,
      definiteFailure: false,
    })).toBe('SUCCEEDED');
    expect(resolveAiImageWorkbenchProviderOutcome({
      requestDispatched: true,
      responseReceived: true,
      definiteFailure: true,
    })).toBe('FAILED_FINAL');
    expect(AI_IMAGE_WORKBENCH_UNKNOWN_OUTCOME_POLICY).toEqual({
      automaticRetryAllowed: false,
      recoveryRequirement: 'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY',
    });
    expect(() => resolveAiImageWorkbenchProviderOutcome({
      requestDispatched: false,
      responseReceived: true,
      definiteFailure: false,
    })).toThrowError(expect.objectContaining({
      code: 'AI_IMAGE_WORKBENCH_OUTCOME_INPUT_INVALID',
    }));
  });
});
