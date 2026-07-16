import { decrypt } from '../lib/crypto.js';
import { OzonClient } from './ozon-client.js';

export const SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE =
  'SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE';

export class SourceWorkflowOzonCredentialsUnavailableError extends Error {
  readonly code = SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE;
  readonly statusCode = 503;

  constructor() {
    super('Ozon 店铺凭证不可用，请重新保存店铺 API 密钥');
    this.name = 'SourceWorkflowOzonCredentialsUnavailableError';
  }
}

export function findSourceWorkflowOzonCredentialsUnavailableError(
  error: unknown,
): SourceWorkflowOzonCredentialsUnavailableError | null {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    if (current instanceof SourceWorkflowOzonCredentialsUnavailableError) return current;
    seen.add(current);
    current = typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return null;
}

export function createSourceWorkflowOzonClient(input: {
  clientId: string;
  apiKeyEncrypted: string;
}): OzonClient {
  try {
    const apiKey = decrypt(input.apiKeyEncrypted);
    if (!String(input.clientId || '').trim() || !String(apiKey || '').trim()) {
      throw new Error('Ozon credentials are empty');
    }
    return new OzonClient({ clientId: input.clientId, apiKey });
  } catch (error) {
    if (error instanceof SourceWorkflowOzonCredentialsUnavailableError) throw error;
    throw new SourceWorkflowOzonCredentialsUnavailableError();
  }
}
