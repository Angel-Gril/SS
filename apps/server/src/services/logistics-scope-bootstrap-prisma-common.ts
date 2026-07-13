import { createHash, randomUUID } from 'node:crypto';
import { LogisticsScopeBootstrapError } from './logistics-scope-bootstrap.js';

export interface LogisticsScopeSqlClient {
  $queryRawUnsafe<T = unknown[]>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction?<T>(
    operation: (tx: LogisticsScopeSqlClient) => Promise<T>,
    options?: { isolationLevel?: string },
  ): Promise<T>;
}

export const scopeEventId = randomUUID;

export function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sanitizedScopeEvent(value: Record<string, unknown>): string {
  const encoded = jsonValue(value);
  if (/(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)/i
    .test(encoded)) {
    throw new LogisticsScopeBootstrapError(
      'UNSAFE_SCOPE_EVENT',
      400,
      'Scope event payload contains credential fields',
    );
  }
  return encoded;
}

function retryable(error: unknown): boolean {
  const item = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  return item?.code === 'P2034'
    || item?.code === '40001'
    || item?.meta?.code === '40001'
    || String(item?.message || '').includes('40001');
}

export async function serializable<T>(
  client: LogisticsScopeSqlClient,
  action: (tx: LogisticsScopeSqlClient) => Promise<T>,
): Promise<T> {
  if (!client.$transaction) return action(client);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!retryable(error) || attempt === 3) throw error;
    }
  }
  throw new Error('unreachable');
}

export function unavailable(code = 'BINDING_PROBE_UNAVAILABLE'): never {
  throw new LogisticsScopeBootstrapError(code, 404, 'Binding probe is unavailable');
}
