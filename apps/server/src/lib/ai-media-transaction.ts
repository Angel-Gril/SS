function retryableDatabaseCodes(error: unknown): string[] {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
    : {};
  return [candidate.code, candidate.meta?.code, candidate.cause?.code]
    .map((value) => String(value || ''))
    .concat(String(candidate.message || '').match(/40001|40P01|P2034/gu) || []);
}

export function isRetryableAiMediaTransactionError(error: unknown): boolean {
  return retryableDatabaseCodes(error).some((code) => ['P2034', '40001', '40P01'].includes(code));
}

export async function runAiMediaSerializableTransaction<T>(
  client: any,
  action: (tx: any) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryableAiMediaTransactionError(error) || attempt === 3) throw error;
    }
  }
  throw new Error('Serializable AI media transaction exhausted');
}
