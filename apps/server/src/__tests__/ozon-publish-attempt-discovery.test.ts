import { describe, expect, it, vi } from 'vitest';
import { createOzonListingPublisher } from '../services/ozon-listing-publisher.js';
import {
  decodeOzonPublishAttemptCursor,
  encodeOzonPublishAttemptCursor,
  normalizeOzonPublishAttemptListLimit,
  type OzonPublishAttemptRepository,
} from '../services/ozon-publish-attempts.js';

describe('Ozon publish attempt discovery contract', () => {
  it('normalizes bounded page limits and rejects values above the public maximum', () => {
    expect(normalizeOzonPublishAttemptListLimit(undefined)).toBe(20);
    expect(normalizeOzonPublishAttemptListLimit('100')).toBe(100);
    for (const invalid of [0, '0', 101, '101', 1.5, '1.5', 'not-a-number']) {
      expect(() => normalizeOzonPublishAttemptListLimit(invalid)).toThrowError(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });

  it('round-trips a stable createdAt/id cursor and rejects malformed cursors', () => {
    const cursor = encodeOzonPublishAttemptCursor({
      createdAt: '2026-07-15T12:00:00.000Z',
      id: 'attempt-0002',
    });
    expect(decodeOzonPublishAttemptCursor(cursor)).toEqual({
      createdAt: '2026-07-15T12:00:00.000Z',
      id: 'attempt-0002',
    });
    for (const invalid of [
      '',
      'not-base64-json',
      Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'attempt-1' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-07-15T12:00:00.000Z', id: '' })).toString('base64url'),
      'a'.repeat(501),
    ]) {
      expect(() => decodeOzonPublishAttemptCursor(invalid)).toThrowError(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });

  it('exposes owner and workflow bounded list/latest operations through the publisher', async () => {
    const page = {
      items: [{ id: 'attempt-1', workflowId: 'workflow-1' }],
      nextCursor: null,
    } as any;
    const repository = {
      listOwnedByWorkflow: vi.fn(async () => page),
      getLatestOwnedByWorkflow: vi.fn(async () => page.items[0]),
    } as unknown as OzonPublishAttemptRepository;
    const publisher = createOzonListingPublisher({
      workflow: {} as any,
      attempts: repository,
      compile: async () => { throw new Error('unused'); },
      submitImportOnce: async () => { throw new Error('unused'); },
      workerId: 'publisher-discovery-test',
      leaseMs: 60_000,
    });

    await expect(publisher.listAttempts({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', limit: 25, cursor: 'cursor-1',
    })).resolves.toBe(page);
    expect(repository.listOwnedByWorkflow).toHaveBeenCalledWith({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', limit: 25, cursor: 'cursor-1',
    });
    await expect(publisher.getLatestAttempt({
      workflowId: 'workflow-1', ownerUserId: 'owner-1',
    })).resolves.toBe(page.items[0]);
    expect(repository.getLatestOwnedByWorkflow).toHaveBeenCalledWith({
      workflowId: 'workflow-1', ownerUserId: 'owner-1',
    });
  });
});
