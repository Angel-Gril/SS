import { describe, expect, it, vi } from 'vitest';
import {
  lockAiMediaApplicationOperation,
  runAiMediaSerializableTransaction,
} from '../lib/ai-media-transaction.js';

describe('AI media serializable transactions', () => {
  it.each([
    { code: 'P2034' },
    { meta: { code: '40001' } },
    { cause: { code: '40P01' } },
  ])('retries bounded database conflicts %#', async (error) => {
    const action = vi.fn(async () => 'ok');
    const client = {
      $transaction: vi.fn()
        .mockRejectedValueOnce(error)
        .mockImplementationOnce((callback: any) => callback({})),
    };

    await expect(runAiMediaSerializableTransaction(client, action)).resolves.toBe('ok');
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transaction failures', async () => {
    const error = Object.assign(new Error('validation failed'), { code: 'P2002' });
    const client = { $transaction: vi.fn().mockRejectedValue(error) };

    await expect(runAiMediaSerializableTransaction(client, vi.fn())).rejects.toBe(error);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('serializes collect and listing-draft mutations on one owner operation key', async () => {
    const query = vi.fn(async () => [{ locked: 1 }]);

    await lockAiMediaApplicationOperation(
      { $queryRawUnsafe: query },
      'owner-1',
      'shared-operation-key',
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock(hashtextextended($1, 7390421))'),
      'ai-media-application-operation/v1:owner-1:shared-operation-key',
    );
  });
});
