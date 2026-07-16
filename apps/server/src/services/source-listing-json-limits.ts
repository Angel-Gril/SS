export const SOURCE_LISTING_JSON_VALUE_MAX_BYTES = 64 * 1024;
export const SOURCE_LISTING_JSON_VALUE_MAX_DEPTH = 16;
export const SOURCE_LISTING_JSON_VALUE_MAX_NODES = 4_096;
export const SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES = 256 * 1024;
export const SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES = 16_384;

export interface SourceListingJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}

export type SourceListingJsonLimitReason =
  | 'BYTES'
  | 'DEPTH'
  | 'NODES'
  | 'UNSUPPORTED_VALUE'
  | 'CYCLIC_VALUE';

export interface SourceListingJsonComplexity {
  valid: boolean;
  bytes: number;
  nodes: number;
  depth: number;
  reason: SourceListingJsonLimitReason | null;
}

export const SOURCE_LISTING_JSON_VALUE_LIMITS: SourceListingJsonLimits = Object.freeze({
  maxBytes: SOURCE_LISTING_JSON_VALUE_MAX_BYTES,
  maxDepth: SOURCE_LISTING_JSON_VALUE_MAX_DEPTH,
  maxNodes: SOURCE_LISTING_JSON_VALUE_MAX_NODES,
});

function encodedBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function inspectSourceListingJsonValue(
  value: unknown,
  limits: SourceListingJsonLimits = SOURCE_LISTING_JSON_VALUE_LIMITS,
): SourceListingJsonComplexity {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  let depth = 0;

  const result = (reason: SourceListingJsonLimitReason | null): SourceListingJsonComplexity => ({
    valid: reason === null,
    bytes,
    nodes,
    depth,
    reason,
  });
  const addBytes = (count: number): SourceListingJsonLimitReason | null => {
    bytes += count;
    return bytes > limits.maxBytes ? 'BYTES' : null;
  };

  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes) return result('NODES');
    depth = Math.max(depth, current.depth);
    if (current.depth > limits.maxDepth) return result('DEPTH');

    if (current.value === null) {
      const reason = addBytes(4);
      if (reason) return result(reason);
      continue;
    }
    if (typeof current.value === 'string') {
      const reason = addBytes(encodedBytes(current.value));
      if (reason) return result(reason);
      continue;
    }
    if (typeof current.value === 'boolean') {
      const reason = addBytes(current.value ? 4 : 5);
      if (reason) return result(reason);
      continue;
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return result('UNSUPPORTED_VALUE');
      const reason = addBytes(Buffer.byteLength(JSON.stringify(current.value), 'utf8'));
      if (reason) return result(reason);
      continue;
    }
    if (typeof current.value !== 'object') return result('UNSUPPORTED_VALUE');

    if (seen.has(current.value)) return result('CYCLIC_VALUE');
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      const reason = addBytes(2 + Math.max(0, current.value.length - 1));
      if (reason) return result(reason);
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) return result('UNSUPPORTED_VALUE');
    const entries = Object.entries(current.value as Record<string, unknown>);
    let objectBytes = 2 + Math.max(0, entries.length - 1);
    for (const [key] of entries) objectBytes += encodedBytes(key) + 1;
    const reason = addBytes(objectBytes);
    if (reason) return result(reason);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      stack.push({ value: entries[index]![1], depth: current.depth + 1 });
    }
  }

  return result(null);
}

export function sourceListingJsonLimitMessage(
  complexity: SourceListingJsonComplexity,
  label = 'value',
): string {
  if (complexity.reason === 'BYTES') {
    return `${label} exceeds ${SOURCE_LISTING_JSON_VALUE_MAX_BYTES} UTF-8 bytes`;
  }
  if (complexity.reason === 'DEPTH') {
    return `${label} exceeds JSON depth ${SOURCE_LISTING_JSON_VALUE_MAX_DEPTH}`;
  }
  if (complexity.reason === 'NODES') {
    return `${label} exceeds ${SOURCE_LISTING_JSON_VALUE_MAX_NODES} JSON nodes`;
  }
  if (complexity.reason === 'CYCLIC_VALUE') return `${label} must not contain cyclic JSON values`;
  return `${label} contains a value that JSON cannot persist`;
}
