import { describe, expect, it } from 'vitest';
import {
  isAiMediaEditCandidateFromContext,
  isAiMediaEditReadyCandidateAsset,
} from '../services/ai-image-edit-source.js';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate-1',
    ownerUserId: 'owner-1',
    kind: 'AI_GENERATED',
    aiImageJobId: 'job-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    url: '/uploads/candidate.png',
    storageBackend: 'local',
    storageKey: 'candidate.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    width: 900,
    height: 1200,
    sha256: 'a'.repeat(64),
    metadata: {
      pixelOrientationNormalized: true,
      outputRole: 'FINAL_CANDIDATE',
      editSourceContractVersion: 'ai-media-edit-source/v1',
    },
    aiImageJob: {
      id: 'job-1',
      ownerUserId: 'owner-1',
      status: 'SUCCEEDED',
      operation: 'FULL_EDIT',
      workflowId: 'workflow-1',
      workflowAttempt: 1,
      workflow: {
        id: 'workflow-1',
        ownerUserId: 'owner-1',
        status: 'SUCCEEDED',
        completedAt: new Date('2026-07-20T08:00:00.000Z'),
        operation: 'FULL_EDIT',
        currentAttempt: 1,
        contextType: 'collect',
        contextId: 'goods-1',
        contextSkuKey: null,
        contextSlotKey: null,
        suiteSlot: null,
      },
    },
    ...overrides,
  };
}

describe('AI image edit candidate source authority', () => {
  it('accepts only a normalized final candidate from a successful standalone edit workflow', () => {
    const source = candidate();
    expect(isAiMediaEditReadyCandidateAsset(source)).toBe(true);
    expect(isAiMediaEditCandidateFromContext(source, {
      ownerUserId: 'owner-1', contextId: 'goods-1', sourceCaptureSnapshotId: 'snapshot-1',
    })).toBe(true);
  });

  it('accepts an exact nullable SKU and slot scope', () => {
    const source = candidate({ aiImageJob: {
      ...candidate().aiImageJob,
      workflow: {
        ...candidate().aiImageJob.workflow,
        contextSkuKey: 'sku-1',
        contextSlotKey: 'hero',
      },
    } });
    expect(isAiMediaEditCandidateFromContext(source, {
      ownerUserId: 'owner-1', contextId: 'goods-1', sourceCaptureSnapshotId: 'snapshot-1',
      contextSkuKey: 'sku-1', contextSlotKey: 'hero',
    })).toBe(true);
  });

  it.each([
    ['another owner', { ownerUserId: 'owner-2' }],
    ['another snapshot', { sourceCaptureSnapshotId: 'snapshot-old' }],
    ['unnormalized pixels', { metadata: { outputRole: 'FINAL_CANDIDATE' } }],
    ['legacy output contract', { metadata: {
      outputRole: 'FINAL_CANDIDATE', pixelOrientationNormalized: true,
    } }],
    ['provider raw output', { kind: 'AI_PROVIDER_OUTPUT' }],
    ['failed job', { aiImageJob: { ...candidate().aiImageJob, status: 'FAILED' } }],
    ['failed workflow', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, status: 'FAILED' },
    } }],
    ['successful workflow without completion time', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, completedAt: null },
    } }],
    ['historical attempt', { aiImageJob: {
      ...candidate().aiImageJob, workflowAttempt: 1,
      workflow: { ...candidate().aiImageJob.workflow, currentAttempt: 2 },
    } }],
    ['translation output', { aiImageJob: { ...candidate().aiImageJob, operation: 'IMAGE_TRANSLATE' } }],
    ['another context', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, contextId: 'goods-2' },
    } }],
    ['another SKU', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, contextSkuKey: 'sku-2' },
    } }],
    ['another slot', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, contextSlotKey: 'gallery-2' },
    } }],
    ['suite child', { aiImageJob: {
      ...candidate().aiImageJob,
      workflow: { ...candidate().aiImageJob.workflow, suiteSlot: { suiteId: 'suite-1' } },
    } }],
  ])('rejects %s', (_label, overrides) => {
    expect(isAiMediaEditCandidateFromContext(candidate(overrides), {
      ownerUserId: 'owner-1', contextId: 'goods-1', sourceCaptureSnapshotId: 'snapshot-1',
    })).toBe(false);
  });
});
