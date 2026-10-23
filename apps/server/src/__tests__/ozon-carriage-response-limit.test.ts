import { describe, expect, it, vi } from 'vitest';
import { OzonClient } from '../services/ozon-client.js';

describe('bounded Ozon JSON responses', () => {
  it('cancels an oversized streamed response without retrying a carriage write', async () => {
    const cancelled = vi.fn();
    const requestFetch = vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"payload":"' + 'a'.repeat(100) + '"}')); }, cancel: cancelled,
    })));
    const client = new OzonClient({ clientId: 'fixture', apiKey: 'fixture', requestFetch });
    await expect(client.request('/v1/carriage/container/create', { body: {}, skipRetry: true, maxResponseBytes: 64 })).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(requestFetch).toHaveBeenCalledOnce();
  });
  it('accepts valid bounded JSON and rejects oversized content-length before reading', async () => {
    const requestFetch = vi.fn().mockResolvedValueOnce(new Response('{"ok":true}')).mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': '99999' } }));
    const client = new OzonClient({ clientId: 'fixture', apiKey: 'fixture', requestFetch });
    expect(await client.request('/v1/roles', { skipRetry: true, maxResponseBytes: 64 })).toEqual({ ok: true });
    await expect(client.request('/v1/roles', { skipRetry: true, maxResponseBytes: 64 })).rejects.toThrow();
  });
  it('bounds error response bodies too, including a proxy 524', async () => {
    const cancel = vi.fn();
    const requestFetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1000)); c.close(); }, cancel }), { status: 524 }));
    const client = new OzonClient({ clientId: 'fixture', apiKey: 'fixture', requestFetch });
    await expect(client.request('/v1/carriage/container/create', { body: {}, skipRetry: true, maxResponseBytes: 64 })).rejects.toThrow('size limit');
    expect(requestFetch).toHaveBeenCalledOnce();
  });
});
