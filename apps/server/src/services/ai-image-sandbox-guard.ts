import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class AiImageSandboxGuardError extends Error {
  constructor(
    public readonly code: 'INVALID_SANDBOX_BUDGET' | 'INVALID_SANDBOX_OPERATION' | 'SANDBOX_OPERATION_EXISTS',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSandboxGuardError';
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AiImageSandboxCreateContract {
  endpoint: string;
  model: string;
  promptSha256: string;
  size: string;
  n: 1;
}

function positiveInteger(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_BUDGET',
      `${field} must be a positive integer`,
    );
  }
  return number;
}

export async function claimAiImageSandboxOperation(input: {
  directory: string;
  operationId: string;
  providerEndpoint: string;
  model: string;
  request: Record<string, unknown>;
  quotedCostCents: unknown;
  maximumCostCents: unknown;
}) {
  const operationId = String(input.operationId || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(operationId)) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_OPERATION',
      'Sandbox operation ID is invalid',
    );
  }
  const quotedCostCents = positiveInteger(input.quotedCostCents, 'quotedCostCents');
  const maximumCostCents = positiveInteger(input.maximumCostCents, 'maximumCostCents');
  if (quotedCostCents > maximumCostCents) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_BUDGET',
      'Quoted sandbox cost exceeds the confirmed maximum',
    );
  }

  await mkdir(input.directory, { recursive: true });
  const intentPath = resolve(input.directory, `${operationId}.intent.json`);
  const requestFingerprint = createHash('sha256').update(JSON.stringify({
    providerEndpoint: input.providerEndpoint,
    model: input.model,
    request: input.request,
    quotedCostCents,
    maximumCostCents,
  })).digest('hex');
  const intent = {
    schemaVersion: 1,
    operationId,
    state: 'SUBMITTING',
    providerEndpoint: input.providerEndpoint,
    model: input.model,
    requestFingerprint,
    quotedCostCents,
    maximumCostCents,
    createdAt: new Date().toISOString(),
  };
  try {
    await writeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`, { flag: 'wx' });
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new AiImageSandboxGuardError(
        'SANDBOX_OPERATION_EXISTS',
        'Sandbox operation already has an immutable intent; inspect it instead of resubmitting',
      );
    }
    throw error;
  }
  return { intent, intentPath };
}

export function createAiImageSandboxFetchGuard(input: {
  contract: AiImageSandboxCreateContract;
  validateUrl: (url: string) => Promise<string>;
  fetch: FetchLike;
}) {
  const expectedEndpoint = new URL(input.contract.endpoint).toString();
  let createRequests = 0;
  let followupGetRequests = 0;
  const guardedFetch: FetchLike = async (request, init) => {
    const rawUrl = request instanceof Request ? request.url : String(request);
    const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new Error('The single-submit sandbox permits only GET and POST requests');
    }
    if (method === 'GET') {
      if (createRequests !== 1) {
        throw new Error('The single-submit sandbox permits result downloads only after its create request');
      }
      followupGetRequests += 1;
      if (followupGetRequests > input.contract.n) {
        throw new Error('The single-submit sandbox blocked excess result downloads');
      }
    }
    const safeUrl = await input.validateUrl(rawUrl);
    if (method === 'POST') {
      if (new URL(safeUrl).toString() !== expectedEndpoint) {
        throw new Error('The single-submit sandbox permits only its exact images/generations endpoint');
      }
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(String(init?.body || '')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        body = parsed as Record<string, unknown>;
      } catch {
        throw new Error('The single-submit sandbox requires a JSON create body');
      }
      const allowedKeys = new Set(['model', 'prompt', 'n', 'size']);
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const promptSha256 = createHash('sha256').update(prompt).digest('hex');
      if (
        Object.keys(body).some((key) => !allowedKeys.has(key))
        || body.n !== input.contract.n
        || body.model !== input.contract.model
        || body.size !== input.contract.size
        || promptSha256 !== input.contract.promptSha256
      ) {
        throw new Error('The single-submit sandbox blocked an unexpected create contract');
      }
      createRequests += 1;
      if (createRequests > 1) {
        throw new Error('The single-submit sandbox blocked a duplicate create request');
      }
    }
    return input.fetch(safeUrl, { ...init, redirect: 'error' });
  };
  return {
    fetch: guardedFetch,
    getCreateRequests: () => createRequests,
    getFollowupGetRequests: () => followupGetRequests,
  };
}
