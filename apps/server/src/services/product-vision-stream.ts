export const PRODUCT_VISION_STREAM_LIMITS = Object.freeze({
  responseBytes: 2 * 1024 * 1024,
  outputBytes: 64 * 1024,
  eventBytes: 64 * 1024,
});

export type ProductVisionStreamReason =
  | 'STREAM_INCOMPLETE'
  | 'STREAM_FINISH_INVALID'
  | 'STREAM_PROVIDER_ERROR'
  | 'STREAM_EVENT_INVALID'
  | 'STREAM_CONTENT_TYPE_INVALID'
  | 'OUTPUT_LIMIT'
  | 'SECRET_ECHO';

type StreamErrorCode = 'PRODUCT_VISION_RESPONSE_INVALID' | 'PRODUCT_VISION_RESPONSE_TOO_LARGE' | 'PRODUCT_VISION_TIMEOUT';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Parses only the compatible chat-completion SSE wire protocol. The caller owns
// DNS, authorization, timeout, abort and the single POST; this reader never retries.
export async function readProductVisionStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: {
    signal: AbortSignal;
    apiKey: string;
    fail(code: StreamErrorCode, reasonCode?: ProductVisionStreamReason): Error;
  },
): Promise<{ text: string; usage: unknown }> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const output: string[] = [];
  let buffer = '', data: string[] = [], usage: unknown = null;
  let responseBytes = 0, outputBytes = 0, eventBytes = 0, sawFinish = false, sawDone = false, secretTail = '';
  const invalid = (reasonCode: ProductVisionStreamReason): never => { throw options.fail('PRODUCT_VISION_RESPONSE_INVALID', reasonCode); };
  const checkAbort = () => { if (options.signal.aborted) throw options.fail('PRODUCT_VISION_TIMEOUT'); };

  function dispatch() {
    if (!data.length) { eventBytes = 0; return; }
    const event = data.join('\n');
    data = []; eventBytes = 0;
    if (event === '[DONE]') {
      if (!sawFinish || !output.join('').trim()) invalid('STREAM_INCOMPLETE');
      sawDone = true; return;
    }
    let value: unknown;
    try { value = JSON.parse(event); } catch { return invalid('STREAM_EVENT_INVALID'); }
    if (!record(value)) return invalid('STREAM_EVENT_INVALID');
    if (value.error != null) invalid('STREAM_PROVIDER_ERROR');
    if (!Array.isArray(value.choices) || value.choices.length > 1) return invalid('STREAM_EVENT_INVALID');
    if (value.usage != null) usage = value.usage;
    if (!value.choices.length) {
      if (value.usage == null) invalid('STREAM_EVENT_INVALID');
      return;
    }
    const choice: unknown = value.choices[0];
    if (!record(choice) || choice.index != null && choice.index !== 0 || !record(choice.delta)) return invalid('STREAM_EVENT_INVALID');
    const delta = choice.delta;
    if (delta.tool_calls != null || delta.function_call != null || delta.refusal != null) invalid('STREAM_FINISH_INVALID');
    const content = delta.content;
    if (content != null && typeof content !== 'string') invalid('STREAM_EVENT_INVALID');
    if (typeof content === 'string' && content.length) {
      if (sawFinish) invalid('STREAM_EVENT_INVALID');
      outputBytes += Buffer.byteLength(content);
      if (outputBytes > PRODUCT_VISION_STREAM_LIMITS.outputBytes) throw options.fail('PRODUCT_VISION_RESPONSE_TOO_LARGE', 'OUTPUT_LIMIT');
      const sentinelInput = secretTail + content;
      if (sentinelInput.includes(options.apiKey)) invalid('SECRET_ECHO');
      secretTail = options.apiKey.length > 1 ? sentinelInput.slice(-(options.apiKey.length - 1)) : '';
      output.push(content);
    }
    if (choice.finish_reason != null) {
      if (choice.finish_reason !== 'stop' || sawFinish) invalid('STREAM_FINISH_INVALID');
      sawFinish = true;
    }
  }

  function line(value: string) {
    if (!value) { dispatch(); return; }
    eventBytes += Buffer.byteLength(value) + 1;
    if (eventBytes > PRODUCT_VISION_STREAM_LIMITS.eventBytes) throw options.fail('PRODUCT_VISION_RESPONSE_TOO_LARGE');
    // SSE comments, ids and event labels do not contain model output.
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    if (field !== 'data') return;
    let contents = colon < 0 ? '' : value.slice(colon + 1);
    if (contents.startsWith(' ')) contents = contents.slice(1);
    data.push(contents);
  }

  function drain(eof: boolean) {
    let offset = 0;
    for (let index = 0; index < buffer.length && !sawDone; index += 1) {
      const character = buffer[index];
      if (character !== '\r' && character !== '\n') continue;
      if (character === '\r' && index === buffer.length - 1 && !eof) break;
      line(buffer.slice(offset, index));
      if (character === '\r' && buffer[index + 1] === '\n') index += 1;
      offset = index + 1;
    }
    buffer = buffer.slice(offset);
    if (Buffer.byteLength(buffer) + eventBytes > PRODUCT_VISION_STREAM_LIMITS.eventBytes) throw options.fail('PRODUCT_VISION_RESPONSE_TOO_LARGE');
    if (eof && !sawDone) {
      if (buffer.length) line(buffer);
      buffer = ''; dispatch();
    }
  }

  while (!sawDone) {
    checkAbort();
    const chunk = await reader.read();
    checkAbort();
    if (chunk.done) {
      try { buffer += decoder.decode(); } catch { invalid('STREAM_EVENT_INVALID'); }
      drain(true); break;
    }
    if (!(chunk.value instanceof Uint8Array)) invalid('STREAM_EVENT_INVALID');
    responseBytes += chunk.value.byteLength;
    if (responseBytes > PRODUCT_VISION_STREAM_LIMITS.responseBytes) throw options.fail('PRODUCT_VISION_RESPONSE_TOO_LARGE');
    try { buffer += decoder.decode(chunk.value, { stream: true }); } catch { invalid('STREAM_EVENT_INVALID'); }
    drain(false);
  }
  if (!sawDone || !sawFinish) invalid('STREAM_INCOMPLETE');
  checkAbort();
  // DONE is a protocol terminal, so there is no need to wait on a transport
  // that keeps its connection open afterwards.
  void reader.cancel().catch(() => undefined);
  return { text: output.join('').trim(), usage };
}
