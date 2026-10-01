import { SOURCE_LISTING_SKU_KEY_MAX_LENGTH } from 'shared';
import type { SourceListingAttributeManualChange } from './source-listing-workflow-attributes.js';
import {
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES,
  inspectSourceListingJsonValue,
} from './source-listing-json-limits.js';

export class SourceListingManualAttributeChangeError extends Error {
  readonly code = 'OZON_LISTING_DRAFT_INPUT_INVALID';
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SourceListingManualAttributeChangeError';
  }
}
function fail(message: string): never { throw new SourceListingManualAttributeChangeError(message); }
const CHANGE_KEYS = ['attributeId', 'skuKey', 'action', 'value', 'dictionaryValueId', 'dictionaryValueIds', 'evidence'];
function positiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }

/** Only user edits enter the request hash; review/provenance is prepared by the attribute owner. */
export function normalizeSourceListingManualAttributeChanges(value: unknown): SourceListingAttributeManualChange[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) fail('Attribute edits require 1 to 500 changes');
  let bytes = 0;
  let nodes = 0;
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Attribute change must be an object');
    const change = entry as Record<string, unknown>;
    if (Object.keys(change).some((key) => !CHANGE_KEYS.includes(key)) || !positiveInteger(change.attributeId)) {
      fail('Attribute change fields are invalid');
    }
    if (change.skuKey !== undefined && (typeof change.skuKey !== 'string' || !change.skuKey
      || change.skuKey !== change.skuKey.normalize('NFKC').trim() || change.skuKey.length > SOURCE_LISTING_SKU_KEY_MAX_LENGTH)) fail('Attribute SKU key is invalid');
    if (change.action !== undefined && change.action !== 'SET' && change.action !== 'CLEAR') fail('Attribute change action is invalid');
    if (change.dictionaryValueId !== undefined && !positiveInteger(change.dictionaryValueId)) fail('Dictionary value ID is invalid');
    if (change.dictionaryValueIds !== undefined && (!Array.isArray(change.dictionaryValueIds)
      || change.dictionaryValueIds.length < 1 || change.dictionaryValueIds.length > 100
      || change.dictionaryValueIds.some((id) => !positiveInteger(id)))) fail('Dictionary value IDs are invalid');
    if (!Array.isArray(change.evidence) || change.evidence.length < 1 || change.evidence.length > 20
      || change.evidence.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 500)) {
      fail('Attribute manual evidence is required');
    }
    const hasValue = Object.prototype.hasOwnProperty.call(change, 'value') && change.value !== undefined;
    if (change.action === 'CLEAR') {
      if (hasValue || change.dictionaryValueId !== undefined || change.dictionaryValueIds !== undefined) fail('Attribute CLEAR cannot include a value');
    } else {
      if (!hasValue) fail('Attribute SET requires a value');
      const complexity = inspectSourceListingJsonValue(change.value);
      if (!complexity.valid) fail('Attribute value exceeds its existing JSON limits');
      bytes += complexity.bytes;
      nodes += complexity.nodes;
      if (bytes > SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES || nodes > SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES) {
        fail('Attribute SET values exceed the existing aggregate JSON limits');
      }
    }
    return { attributeId: change.attributeId,
      ...(change.skuKey === undefined ? {} : { skuKey: change.skuKey as string }),
      ...(change.action === undefined ? {} : { action: change.action as 'SET' | 'CLEAR' }),
      ...(hasValue ? { value: structuredClone(change.value) } : {}),
      ...(change.dictionaryValueId === undefined ? {} : { dictionaryValueId: change.dictionaryValueId as number }),
      ...(change.dictionaryValueIds === undefined ? {} : { dictionaryValueIds: [...change.dictionaryValueIds as number[]] }),
      evidence: (change.evidence as string[]).map((item) => item.trim()),
    };
  });
}
