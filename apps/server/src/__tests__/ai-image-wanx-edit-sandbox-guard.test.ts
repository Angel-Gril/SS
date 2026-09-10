import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createAiImageWanx21EditSandboxFetchGuard,
} from '../services/ai-image-wanx-edit-sandbox-guard.js';
import {
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
  AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
} from '../services/ai-image-wanx-edit-profile.js';
import { normalizeAiImageWanx21EditResultUrl } from '../services/ai-image-wanx-edit-profile.js';

const source = Buffer.from('bounded synthetic source');
const mask = Buffer.from('bounded converted mask');
const prompt = 'Preserve the product and replace the background.';

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function dataUrl(mimeType: string, bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function contract(overrides: Record<string, unknown> = {}) {
  return {
    submitEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
    taskEndpointBase: 'https://dashscope.aliyuncs.com/api/v1/tasks',
    operation: 'IMAGE_TO_IMAGE' as const,
    requestProfile: AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
    providerFunction: 'description_edit' as const,
    model: AI_IMAGE_WANX21_EDIT_MODEL,
    promptSha256: sha256(prompt),
    sourceSha256: sha256(source),
    transportMaskSha256: null,
    n: 1 as const,
    maxPollRequests: 3,
    maxPollDurationMs: 30_000,
    ...overrides,
  };
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: AI_IMAGE_WANX21_EDIT_MODEL,
    input: {
      function: 'description_edit',
      prompt,
      base_image_url: dataUrl('image/png', source),
    },
    parameters: { n: 1 },
    ...overrides,
  });
}

function submitInit(body = submitBody()): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('single-submit Wanx 2.1 edit sandbox guard', () => {
  it('pins one submit, the accepted task, bounded polls and one uncredentialed result download', async () => {
    const rawResultUrl = 'http://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png?signature=opaque';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        output: { task_id: 'task-1', task_status: 'PENDING' },
        request_id: 'request-submit',
      }))
      .mockResolvedValueOnce(json({
        output: { task_id: 'task-1', task_status: 'RUNNING' },
        request_id: 'request-running',
      }))
      .mockResolvedValueOnce(json({
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          results: [{ url: rawResultUrl }],
          task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
        },
        usage: { image_count: 1 },
        request_id: 'request-success',
      }))
      .mockResolvedValueOnce(new Response('image', { status: 200 }));
    const taskAccepted = vi.fn(async () => undefined);
    const resultReady = vi.fn(async () => undefined);
    const beforeCreate = vi.fn(async () => undefined);
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
      onProviderTaskId: taskAccepted,
      onRawResultUrl: resultReady,
    });

    await guard.fetch(contract().submitEndpoint, submitInit());
    await guard.fetch(`${contract().taskEndpointBase}/task-1`, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    });
    await guard.fetch(`${contract().taskEndpointBase}/task-1`, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    });
    const resultUrl = normalizeAiImageWanx21EditResultUrl(rawResultUrl);
    await guard.fetch(resultUrl, { method: 'GET' });

    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(taskAccepted).toHaveBeenCalledWith('task-1');
    expect(resultReady).toHaveBeenCalledWith(rawResultUrl);
    expect(guard.getCreateRequests()).toBe(1);
    expect(guard.getPollRequests()).toBe(2);
    expect(guard.getResultDownloads()).toBe(1);
    expect(guard.getEvidence()).toMatchObject({
      state: 'ACCEPTED',
      providerRequestIdHash: sha256('task-1'),
      providerHttpStatus: 200,
      providerTaskIdHash: sha256('task-1'),
      providerRequestIdHashes: [
        sha256('request-submit'), sha256('request-running'), sha256('request-success'),
      ],
      usage: { imageCount: 1 },
      providerStatus: 'SUCCEEDED',
    });
    expect(new Headers((fetcher.mock.calls[3]?.[1] as RequestInit).headers).has('authorization')).toBe(false);
  });

  it('validates the exact async JSON contract before dispatch', async () => {
    const fetcher = vi.fn();
    const beforeCreate = vi.fn();
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });

    await expect(guard.fetch(contract().submitEndpoint, submitInit(JSON.stringify({
      ...JSON.parse(submitBody()),
      size: '1024x1024',
    })))).rejects.toThrow('unexpected Wanx create contract');
    expect(fetcher).not.toHaveBeenCalled();
    expect(beforeCreate).not.toHaveBeenCalled();
  });

  it('requires the async header and prevents a renamed duplicate submit', async () => {
    const fetcher = vi.fn(async () => json({
      output: { task_id: 'task-once', task_status: 'PENDING' },
    }));
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    const withoutAsync = submitInit();
    delete (withoutAsync.headers as Record<string, string>)['X-DashScope-Async'];
    await expect(guard.fetch(contract().submitEndpoint, withoutAsync)).rejects.toThrow('async header');
    await guard.fetch(contract().submitEndpoint, submitInit());
    await expect(guard.fetch(contract().submitEndpoint, submitInit())).rejects.toThrow('duplicate submit');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['IMAGE_TO_IMAGE', AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE, 'dns'],
    ['IMAGE_TO_IMAGE', AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE, 'approval'],
    ['FULL_EDIT', AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE, 'dns'],
    ['FULL_EDIT', AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE, 'approval'],
    ['INPAINT', AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE, 'dns'],
    ['INPAINT', AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE, 'approval'],
  ] as const)('permits only one %s POST for %s during %s checks', async (operation, requestProfile, phase) => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const pause = async () => { entered(); await barrier; };
    let actualPosts = 0;
    const fetcher = vi.fn(async () => json({
      output: { task_id: `task-${++actualPosts}`, task_status: 'PENDING' },
    }));
    const beforeCreate = vi.fn(async () => { if (phase === 'approval') await pause(); });
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract({
        operation, requestProfile,
        providerFunction: operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit',
        transportMaskSha256: operation === 'INPAINT' ? sha256(mask) : null,
      }),
      validateUrl: async (url) => { if (phase === 'dns') await pause(); return new URL(url).toString(); },
      fetch: fetcher, beforeCreate, toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    const body = submitBody({ input: {
      function: operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit',
      prompt, base_image_url: dataUrl('image/png', source),
      ...(operation === 'INPAINT' ? { mask_image_url: dataUrl('image/png', mask) } : {}),
    } });
    const first = guard.fetch(contract().submitEndpoint, submitInit(body));
    await waiting;
    expect(guard.getCreateRequests()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    const second = guard.fetch(contract().submitEndpoint, submitInit(body));
    const joined = Promise.allSettled([first, second]);
    release();
    const results = await joined;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(actualPosts).toBe(1);
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(guard.getCreateRequests()).toBe(actualPosts);
    expect(guard.getEvidence()).toMatchObject({ state: 'ACCEPTED', providerTaskIdHash: sha256('task-1') });
  });

  it.each(['dns', 'approval'] as const)('does not retry or count a dispatched request after %s rejects a claimed submission', async (phase) => {
    const fetcher = vi.fn();
    const reject = () => { throw new Error('synthetic pre-dispatch rejection'); };
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => { if (phase === 'dns') reject(); return url; },
      beforeCreate: async () => { if (phase === 'approval') reject(); },
      fetch: fetcher, toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    await expect(guard.fetch(contract().submitEndpoint, submitInit())).rejects.toThrow('pre-dispatch rejection');
    await expect(guard.fetch(contract().submitEndpoint, submitInit())).rejects.toThrow('duplicate submit');
    expect(guard.getCreateRequests()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never releases the one-use claim after a lost POST response', async () => {
    const fetcher = vi.fn(async () => { throw new Error('synthetic response lost'); });
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(), validateUrl: async (url) => url, beforeCreate: async () => undefined,
      fetch: fetcher, toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    await expect(guard.fetch(contract().submitEndpoint, submitInit())).rejects.toThrow('response lost');
    await expect(guard.fetch(contract().submitEndpoint, submitInit())).rejects.toThrow('duplicate submit');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(guard.getCreateRequests()).toBe(1);
    expect(guard.getEvidence().state).toBe('RECONCILIATION_REQUIRED');
  });

  it('persists a valid task identity before quarantining an inline terminal status', async () => {
    const fetcher = vi.fn(async () => json({
      output: { task_id: 'task-inline-failed', task_status: 'FAILED' },
      request_id: 'request-inline-failed',
    }));
    const taskAccepted = vi.fn(async () => undefined);
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
      onProviderTaskId: taskAccepted,
    });

    await guard.fetch(contract().submitEndpoint, submitInit());

    expect(taskAccepted).toHaveBeenCalledWith('task-inline-failed');
    expect(guard.getEvidence()).toMatchObject({
      state: 'RECONCILIATION_REQUIRED',
      providerTaskIdHash: sha256('task-inline-failed'),
      providerStatus: 'FAILED',
      providerRequestIdHashes: [sha256('request-inline-failed')],
    });
    await expect(guard.fetch(`${contract().taskEndpointBase}/task-inline-failed`, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    })).rejects.toThrow('read-only reconciliation');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retains the accepted task hash when private task persistence fails', async () => {
    const fetcher = vi.fn(async () => json({
      output: { task_id: 'task-persistence-failed', task_status: 'PENDING' },
    }));
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
      onProviderTaskId: async () => {
        throw new Error('simulated private evidence write failure');
      },
    });

    await expect(guard.fetch(contract().submitEndpoint, submitInit()))
      .rejects.toThrow('simulated private evidence write failure');
    expect(guard.getEvidence()).toMatchObject({
      state: 'RECONCILIATION_REQUIRED',
      providerTaskIdHash: sha256('task-persistence-failed'),
      providerStatus: 'PENDING',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('persists a valid accepted task from a response above the former evidence limit', async () => {
    const acceptedBody = JSON.stringify({
      output: { task_id: 'task-large-valid', task_status: 'PENDING' },
      request_id: 'request-large-valid',
      padding: 'x'.repeat(2 * 1024 * 1024),
    });
    const fetcher = vi.fn(async () => new Response(acceptedBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const taskAccepted = vi.fn(async () => undefined);
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
      onProviderTaskId: taskAccepted,
    });

    await guard.fetch(contract().submitEndpoint, submitInit());
    expect(taskAccepted).toHaveBeenCalledWith('task-large-valid');
    expect(guard.getEvidence()).toMatchObject({
      state: 'ACCEPTED',
      providerTaskIdHash: sha256('task-large-valid'),
      providerRequestIdHashes: [sha256('request-large-valid')],
    });
    await expect(guard.fetch(contract().submitEndpoint, submitInit()))
      .rejects.toThrow('duplicate submit');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not wait on a cloned oversized response branch', async () => {
    const oversized = JSON.stringify({
      output: { task_id: 'task-oversized', task_status: 'PENDING' },
      padding: 'x'.repeat(32 * 1024 * 1024),
    });
    const fetcher = vi.fn(async () => new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const taskAccepted = vi.fn(async () => undefined);
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
      onProviderTaskId: taskAccepted,
    });

    await expect(Promise.race([
      guard.fetch(contract().submitEndpoint, submitInit()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('guard timed out')), 1_000)),
    ])).resolves.toBeInstanceOf(Response);
    expect(taskAccepted).not.toHaveBeenCalled();
    expect(guard.getEvidence()).toMatchObject({
      state: 'RECONCILIATION_REQUIRED',
      providerTaskIdHash: null,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('binds the derived Wanx mask bytes for inpaint', async () => {
    const fetcher = vi.fn(async () => json({ code: 'InvalidParameter' }, 400));
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract({
        operation: 'INPAINT',
        requestProfile: AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
        providerFunction: 'description_edit_with_mask',
        transportMaskSha256: sha256(mask),
      }),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    const body = JSON.stringify({
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      input: {
        function: 'description_edit_with_mask',
        prompt,
        base_image_url: dataUrl('image/png', source),
        mask_image_url: dataUrl('image/png', mask),
      },
      parameters: { n: 1 },
    });
    await guard.fetch(contract().submitEndpoint, submitInit(body));
    expect(guard.getEvidence()).toMatchObject({ state: 'REJECTED', providerHttpStatus: 400 });
  });

  it('blocks wrong-task polls and credential forwarding to result storage', async () => {
    const rawResultUrl = 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-bound', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({
        output: {
          task_id: 'task-bound', task_status: 'SUCCEEDED',
          results: [{ url: rawResultUrl }],
          task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
        },
        usage: { image_count: 1 },
      }));
    const guard = createAiImageWanx21EditSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      beforeCreate: async () => undefined,
      toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
    });
    await guard.fetch(contract().submitEndpoint, submitInit());
    await expect(guard.fetch(`${contract().taskEndpointBase}/other-task`, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    })).rejects.toThrow('non-task or unexpected result URL');
    await guard.fetch(`${contract().taskEndpointBase}/task-bound`, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    });
    await expect(guard.fetch(rawResultUrl, {
      method: 'GET', headers: { Authorization: 'Bearer secret' },
    })).rejects.toThrow('must not receive Provider authorization');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
