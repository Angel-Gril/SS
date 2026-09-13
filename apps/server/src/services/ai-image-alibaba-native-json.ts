import { AI_IMAGE_SANDBOX_MONEY_MAX_SCALE, parseAiImageSandboxMoney, type AiImageSandboxMoney } from './ai-image-sandbox-money.js';

export class AiImageAlibabaNativeNumber {
  constructor(readonly source: string) {}
}

// JSON.parse owns syntax. This linear pass only checks duplicate decoded keys and
// depth. In particular, an unterminated escaped string must never trigger regex rescans.
export function parseAiImageAlibabaNativeJson(source: string, invalid: () => never): unknown {
  try {
    const stack: Array<Set<string> | null> = [];
    let cursor = 0;
    while (cursor < source.length) {
      const token = source[cursor];
      if (token === '"') {
        const start = cursor++;
        let closed = false;
        while (cursor < source.length) {
          if (source[cursor] === '\\') { cursor += 2; continue; }
          if (source[cursor++] === '"') { closed = true; break; }
        }
        if (!closed) invalid();
        let next = cursor;
        while (/[\x20\t\r\n]/u.test(source[next] || 'x')) next++;
        if (source[next] === ':') {
          if (cursor - start > 256) invalid();
          const keys = stack.at(-1);
          const key = JSON.parse(source.slice(start, cursor)) as string;
          if (!keys || keys.has(key)) invalid();
          keys.add(key);
        }
        continue;
      }
      if (token === '{' || token === '[') {
        stack.push(token === '{' ? new Set<string>() : null);
        if (stack.length > 12) invalid();
      } else if (token === '}' || token === ']') {
        if (!stack.length) invalid();
        const container = stack.pop();
        if ((token === ']') !== (container === null)) invalid();
      }
      cursor++;
    }
    if (stack.length) invalid();
    return JSON.parse(source, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') invalid();
      return new AiImageAlibabaNativeNumber(context.source);
    }) as unknown;
  } catch {
    invalid();
  }
}

export function parseAiImageAlibabaNativeMoney(value: unknown, invalid: () => never, stringAllowed = false): AiImageSandboxMoney {
  const source = value instanceof AiImageAlibabaNativeNumber ? value.source
    : stringAllowed && typeof value === 'string' ? value : '';
  if (!source || source.length > 64) invalid();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,3}))?$/u.exec(source);
  if (!match) invalid();
  const exponent = Number(match[3] || 0);
  if (Math.abs(exponent) > 100) invalid();
  let amount = BigInt(match[1] + (match[2] || ''));
  let scale = (match[2]?.length || 0) - exponent;
  if (amount === 0n) return { currency: 'CNY', amount: 0, scale: 0 };
  if (scale < 0) {
    if (scale < -15) invalid();
    amount *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && amount % 10n === 0n) { amount /= 10n; scale--; }
  if (scale > AI_IMAGE_SANDBOX_MONEY_MAX_SCALE || amount > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return parseAiImageSandboxMoney({ currency: 'CNY', amount: Number(amount), scale }, 'Native bill amount', { allowZero: true });
}
