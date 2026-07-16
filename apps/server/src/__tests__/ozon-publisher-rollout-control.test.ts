import { describe, expect, it, vi } from 'vitest';

import {
  loadPrismaOzonPublisherRolloutControlSnapshot,
  OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS,
  ozonPublisherRolloutEvidencePolicyHash,
} from '../services/ozon-publisher-rollout-control.js';

const INPUT = {
  writerEntrypoint: 'COLLECT_PUBLISH_OZON' as const,
  originChannel: 'DIRECT' as const,
  rolloutRevision: 'rollout-1',
};

function reader(rows: Array<{ key: string; value: string }>) {
  const findMany = vi.fn(async () => rows);
  return { client: { systemConfig: { findMany } }, findMany };
}

describe('Ozon publisher rollout control snapshot', () => {
  it('derives stable policy and config hashes from the exact persisted control inputs', async () => {
    const first = reader([
      { key: 'source_workflow_rollout_policy', value: '{"revision":"rollout-1"}' },
      { key: 'feature_source_ozon_publisher_v2', value: 'false' },
      { key: 'feature_source_listing_workflow', value: 'false' },
    ]);
    const second = reader([
      { key: 'feature_source_listing_workflow', value: 'false' },
      { key: 'source_workflow_rollout_policy', value: '{"revision":"rollout-1"}' },
      { key: 'feature_source_ozon_publisher_v2', value: 'false' },
    ]);

    const left = await loadPrismaOzonPublisherRolloutControlSnapshot(first.client, INPUT);
    const right = await loadPrismaOzonPublisherRolloutControlSnapshot(second.client, INPUT);

    expect(left).toEqual(right);
    expect(left.evidencePolicyHash).toBe(ozonPublisherRolloutEvidencePolicyHash());
    expect(left.evidencePolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.controlConfigHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.findMany).toHaveBeenCalledWith({
      where: { key: { in: [...OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS] } },
      select: { key: true, value: true },
    });
  });

  it('fails closed when any raw control value, revision, or exact gate identity changes', async () => {
    const baseRows = [
      { key: 'feature_source_listing_workflow', value: 'false' },
      { key: 'feature_source_ozon_publisher_v2', value: 'false' },
      { key: 'source_workflow_rollout_policy', value: '{"revision":"rollout-1"}' },
    ];
    const base = await loadPrismaOzonPublisherRolloutControlSnapshot(reader(baseRows).client, INPUT);
    const enabled = await loadPrismaOzonPublisherRolloutControlSnapshot(reader([
      { ...baseRows[0]!, value: 'true' }, ...baseRows.slice(1),
    ]).client, INPUT);
    const changedRevision = await loadPrismaOzonPublisherRolloutControlSnapshot(
      reader(baseRows).client,
      { ...INPUT, rolloutRevision: 'rollout-2' },
    );
    const changedOrigin = await loadPrismaOzonPublisherRolloutControlSnapshot(
      reader(baseRows).client,
      { ...INPUT, originChannel: 'BROWSER_ONE_CLICK' },
    );

    expect(enabled.controlConfigHash).not.toBe(base.controlConfigHash);
    expect(changedRevision.controlConfigHash).not.toBe(base.controlConfigHash);
    expect(changedOrigin.controlConfigHash).not.toBe(base.controlConfigHash);
  });

  it('includes missing keys explicitly and rejects duplicate or malformed repository rows', async () => {
    const missing = await loadPrismaOzonPublisherRolloutControlSnapshot(reader([]).client, INPUT);
    const explicit = await loadPrismaOzonPublisherRolloutControlSnapshot(reader([
      { key: 'feature_source_listing_workflow', value: '' },
    ]).client, INPUT);

    expect(missing.controlConfigHash).not.toBe(explicit.controlConfigHash);
    await expect(loadPrismaOzonPublisherRolloutControlSnapshot(reader([
      { key: 'feature_source_listing_workflow', value: 'false' },
      { key: 'feature_source_listing_workflow', value: 'false' },
    ]).client, INPUT)).rejects.toThrow('control snapshot is invalid');
    await expect(loadPrismaOzonPublisherRolloutControlSnapshot(reader([
      { key: 'unexpected', value: 'false' },
    ]).client, INPUT)).rejects.toThrow('control snapshot is invalid');
    await expect(loadPrismaOzonPublisherRolloutControlSnapshot(reader([]).client, {
      ...INPUT,
      rolloutRevision: ' rollout-1 ',
    })).rejects.toThrow('rolloutRevision is invalid');
  });
});
