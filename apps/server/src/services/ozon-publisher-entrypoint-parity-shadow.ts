import { createHash } from 'node:crypto';

import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY, type OzonListingDraft } from 'shared';
import {
  compareOzonPublisherEntrypointParity,
  type OzonPublisherEntrypoint,
  type OzonPublisherEntrypointParityReport,
  type OzonPublisherParityStrictBlockerCode,
} from './ozon-publisher-entrypoint-parity.js';
import { OZON_LISTING_PAYLOAD_COMPILER_VERSION } from './ozon-listing-payload-compiler.js';

const MAX_SHADOW_DRAFTS = 100;

export interface OzonPublisherParityDraftPointer {
  supplyGoodsId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
}

export interface OzonPublisherEntrypointParityObservation {
  ownerUserId: string;
  shopId: string;
  rolloutRevision: string;
  entrypoint: Exclude<OzonPublisherEntrypoint, 'EXTENSION_ADAPTER'>;
  legacy: {
    endpoint: '/v3/product/import' | '/v1/product/import-by-sku';
    payload: { items: unknown[] };
    itemTrace?: Array<{
      ordinal: number;
      supplyGoodsId: string;
      sourceSkuAlias?: string | null;
    }>;
  };
  drafts: OzonPublisherParityDraftPointer[];
}

interface CompiledShadowDraft {
  publisherContractVersion: string;
  endpoint: string;
  requestPayload: Record<string, unknown>;
  offerTrace: Array<{
    ordinal: number;
    skuKey?: string;
    offerId?: string;
  }>;
}

interface OzonPublisherParitySkuAliases {
  skuKey: string;
  aliases: string[];
}

export interface OzonPublisherEntrypointParityObserverOptions {
  beginAttempt?(input: {
    ownerUserId: string;
    shopId: string;
    rolloutRevision: string;
    entrypoint: OzonPublisherEntrypointParityObservation['entrypoint'];
    endpoint: OzonPublisherEntrypointParityObservation['legacy']['endpoint'];
    payload: { items: unknown[] };
    itemTrace?: OzonPublisherEntrypointParityObservation['legacy']['itemTrace'];
  }): Promise<{ eligibleAttemptKey: string } | null>;
  failAttempt?(input: {
    eligibleAttemptKey: string;
    failureCode: string;
  }): Promise<void> | void;
  loadDraft(input: {
    draftId: string;
    ownerUserId: string;
  }): Promise<OzonListingDraft | null>;
  compile(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<CompiledShadowDraft>;
  loadSkuAliases?(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<OzonPublisherParitySkuAliases[]>;
  record?(input: {
    scopeHash: string;
    rolloutRevision: string;
    entrypoint: OzonPublisherEntrypointParityObservation['entrypoint'];
    report: OzonPublisherEntrypointParityReport;
    eligibleAttemptKey?: string | null;
  }): Promise<void> | void;
  warn?(message: string): void;
}

const STRICT_BLOCKERS = new Set<OzonPublisherParityStrictBlockerCode>([
  'OZON_LISTING_COMPILE_STAGE_INVALID',
  'OZON_LISTING_COMPILE_DRAFT_STALE',
  'OZON_LISTING_COMPILE_SOURCE_INVALID',
  'OZON_LISTING_COMPILE_SKU_INVALID',
  'OZON_LISTING_COMPILE_VALIDATION_INVALID',
  'OZON_LISTING_COMPILE_VALIDATION_STALE',
  'OZON_LISTING_COMPILE_TITLE_INVALID',
  'OZON_LISTING_COMPILE_TITLE_UNREVIEWED',
  'OZON_LISTING_COMPILE_PRICING_INVALID',
  'OZON_LISTING_COMPILE_PACKAGE_INVALID',
  'OZON_LISTING_COMPILE_IMAGES_INVALID',
  'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED',
  'OZON_LISTING_COMPILE_OFFER_ID_INVALID',
  'OZON_LISTING_PRODUCTION_CAPTURE_STALE',
  'OZON_LISTING_PRODUCTION_VALIDATION_STALE',
  'OZON_LISTING_PRODUCTION_CATALOG_STALE',
  'OZON_LISTING_PRODUCTION_SCHEMA_STALE',
  'OZON_LISTING_PRODUCTION_MEDIA_INVALID',
  'OZON_LISTING_PRODUCTION_PAYLOAD_INVALID',
]);

function exactIdentifier(value: unknown, maxLength = 200): string {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim();
  return normalized === value && normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : '';
}

function exactPositiveInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function errorCode(error: unknown): string {
  const value = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/u.test(value)
    ? value
    : '';
}

function strictBlocker(error: unknown): OzonPublisherParityStrictBlockerCode | null {
  const code = errorCode(error) as OzonPublisherParityStrictBlockerCode;
  return STRICT_BLOCKERS.has(code) ? code : null;
}

function exactDraft(
  value: OzonListingDraft | null,
  input: OzonPublisherEntrypointParityObservation,
  pointer: OzonPublisherParityDraftPointer,
): value is OzonListingDraft {
  return !!value
    && value.id === pointer.draftId
    && value.ownerUserId === input.ownerUserId
    && value.shopId === input.shopId
    && value.supplyGoodsId === pointer.supplyGoodsId
    && value.draftVersion === pointer.draftVersion
    && value.revision === pointer.revision;
}

function itemsFromCompiled(value: CompiledShadowDraft): unknown[] | null {
  return value.requestPayload && Array.isArray(value.requestPayload.items)
    ? value.requestPayload.items
    : null;
}

function rolloutRevision(value: unknown): string {
  if (typeof value !== 'string') return 'unavailable';
  const normalized = value.normalize('NFKC').trim();
  return normalized === value && normalized.length > 0 && normalized.length <= 200
    ? normalized
    : 'unavailable';
}

function scopeHash(input: OzonPublisherEntrypointParityObservation): string {
  const draftIdentity = input.drafts
    .map((draft) => ({
      draftId: draft.draftId,
      draftVersion: draft.draftVersion,
      revision: draft.revision,
    }))
    .sort((left, right) => left.draftId < right.draftId ? -1 : left.draftId > right.draftId ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({
    ownerUserId: input.ownerUserId,
    shopId: input.shopId,
    rolloutRevision: input.rolloutRevision,
    entrypoint: input.entrypoint,
    drafts: draftIdentity,
  })).digest('hex');
}

function offerMatchedLegacyTrace(
  input: OzonPublisherEntrypointParityObservation,
  v2: Awaited<ReturnType<typeof compileShadow>>,
) {
  if (v2.kind !== 'COMPILED') return undefined;
  const traceKeyByOfferId = new Map<string, string>();
  const ambiguousOfferIds = new Set<string>();
  for (const trace of v2.offerTrace) {
    const offerId = exactIdentifier(trace.offerId, 500);
    const identity = exactIdentifier(trace.traceKey, 1_200)
      || exactIdentifier(trace.skuKey, 500);
    if (!offerId || !identity) continue;
    if (traceKeyByOfferId.has(offerId) && traceKeyByOfferId.get(offerId) !== identity) {
      ambiguousOfferIds.add(offerId);
      traceKeyByOfferId.delete(offerId);
      continue;
    }
    if (!ambiguousOfferIds.has(offerId)) traceKeyByOfferId.set(offerId, identity);
  }
  return input.legacy.payload.items.flatMap((raw, ordinal) => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const offerId = exactIdentifier(item.offer_id, 500);
    const identity = traceKeyByOfferId.get(offerId);
    return offerId && identity ? [{ ordinal, offerId, traceKey: identity }] : [];
  });
}

function traceKey(supplyGoodsId: string, skuKey: string): string {
  return `${supplyGoodsId}\0${skuKey}`;
}

function normalizedSkuAliases(value: unknown): OzonPublisherParitySkuAliases[] | null {
  if (!Array.isArray(value)) return null;
  const result: OzonPublisherParitySkuAliases[] = [];
  const seenSkuKeys = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as { skuKey?: unknown; aliases?: unknown };
    const skuKey = exactIdentifier(row.skuKey, 500);
    if (!skuKey || seenSkuKeys.has(skuKey) || !Array.isArray(row.aliases)) return null;
    const aliases = [...new Set(row.aliases.map((alias) => exactIdentifier(alias, 500)).filter(Boolean))];
    if (!aliases.includes(skuKey)) aliases.push(skuKey);
    seenSkuKeys.add(skuKey);
    result.push({ skuKey, aliases });
  }
  return result;
}

interface PreparedShadowDraft {
  pointer: OzonPublisherParityDraftPointer;
  draft: OzonListingDraft;
  compiled: CompiledShadowDraft;
  skuAliases: OzonPublisherParitySkuAliases[];
}

function tracedLegacyItems(
  input: OzonPublisherEntrypointParityObservation,
  prepared: PreparedShadowDraft[],
) {
  if (!input.legacy.itemTrace) return undefined;
  if (input.legacy.itemTrace.length !== input.legacy.payload.items.length) return null;
  const byGoodsId = new Map(prepared.map((entry) => [entry.pointer.supplyGoodsId, entry]));
  const seenOrdinals = new Set<number>();
  const result: Array<{ ordinal: number; traceKey: string }> = [];
  for (const item of input.legacy.itemTrace) {
    if (!Number.isSafeInteger(item.ordinal)
      || item.ordinal < 0
      || item.ordinal >= input.legacy.payload.items.length
      || seenOrdinals.has(item.ordinal)) return null;
    const supplyGoodsId = exactIdentifier(item.supplyGoodsId);
    const preparedDraft = byGoodsId.get(supplyGoodsId);
    if (!preparedDraft) return null;
    const sourceSkuAlias = exactIdentifier(item.sourceSkuAlias, 500);
    const productOnly = preparedDraft.draft.selectedSkuKeys.length === 1
      && preparedDraft.draft.selectedSkuKeys[0] === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY;
    const matches = productOnly
      ? preparedDraft.skuAliases.filter((row) => row.skuKey === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)
      : sourceSkuAlias
        ? preparedDraft.skuAliases.filter((row) => row.aliases.includes(sourceSkuAlias))
        : [];
    if (matches.length !== 1) return null;
    seenOrdinals.add(item.ordinal);
    result.push({
      ordinal: item.ordinal,
      traceKey: traceKey(supplyGoodsId, matches[0]!.skuKey),
    });
  }
  return result.sort((left, right) => left.ordinal - right.ordinal);
}

async function compileShadow(
  options: OzonPublisherEntrypointParityObserverOptions,
  input: OzonPublisherEntrypointParityObservation,
) {
  if (!exactIdentifier(input.ownerUserId)
    || !exactIdentifier(input.shopId)
    || !Array.isArray(input.drafts)
    || input.drafts.length < 1
    || input.drafts.length > MAX_SHADOW_DRAFTS) {
    return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
  }
  const seenDrafts = new Set<string>();
  const preparedDrafts: PreparedShadowDraft[] = [];
  for (const pointer of input.drafts) {
    if (!exactIdentifier(pointer.supplyGoodsId)
      || !exactIdentifier(pointer.draftId)
      || !exactPositiveInteger(pointer.draftVersion)
      || !exactPositiveInteger(pointer.revision)
      || seenDrafts.has(pointer.draftId)) {
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
    }
    seenDrafts.add(pointer.draftId);
    let draft: OzonListingDraft | null;
    try {
      draft = await options.loadDraft({
        draftId: pointer.draftId,
        ownerUserId: input.ownerUserId,
      });
    } catch {
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
    }
    if (!exactDraft(draft, input, pointer)) {
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
    }
    if (!Array.isArray(draft.selectedSkuKeys) || draft.selectedSkuKeys.length < 1) {
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
    }
    let skuAliases: OzonPublisherParitySkuAliases[] = draft.selectedSkuKeys.map((skuKey) => ({
      skuKey,
      aliases: [skuKey],
    }));
    if (input.legacy.itemTrace && options.loadSkuAliases) {
      try {
        const loaded = normalizedSkuAliases(await options.loadSkuAliases({
          ownerUserId: input.ownerUserId,
          draft,
        }));
        if (!loaded) {
          return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
        }
        const selected = new Set(draft.selectedSkuKeys);
        skuAliases = loaded.filter((row) => selected.has(row.skuKey));
        if (skuAliases.length !== selected.size) {
          return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
        }
      } catch {
        return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
      }
    }
    try {
      const compiled = await options.compile({ ownerUserId: input.ownerUserId, draft });
      preparedDrafts.push({ pointer, draft, compiled, skuAliases });
    } catch (error) {
      const blockerCode = strictBlocker(error);
      if (blockerCode) {
        return {
          kind: 'BLOCKED' as const,
          blockerCode,
          compilerVersions: {
            payloadCompilerVersion: OZON_LISTING_PAYLOAD_COMPILER_VERSION,
          },
        };
      }
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
    }
  }

  const endpoint = preparedDrafts[0]?.compiled.endpoint;
  const publisherContractVersion = preparedDrafts[0]?.compiled.publisherContractVersion;
  if (!endpoint || !publisherContractVersion
    || preparedDrafts.some(({ compiled }) => (
      compiled.endpoint !== endpoint || compiled.publisherContractVersion !== publisherContractVersion
    ))) {
    return { kind: 'UNAVAILABLE' as const, reasonCode: 'INTERNAL_UNAVAILABLE' as const };
  }
  const items: unknown[] = [];
  const offerTrace: Array<{
    ordinal: number;
    skuKey?: string;
    offerId?: string;
    traceKey?: string;
  }> = [];
  for (const { pointer, compiled } of preparedDrafts) {
    const compiledItems = itemsFromCompiled(compiled);
    if (!compiledItems) {
      return { kind: 'UNAVAILABLE' as const, reasonCode: 'INTERNAL_UNAVAILABLE' as const };
    }
    const offset = items.length;
    items.push(...compiledItems);
    for (const trace of compiled.offerTrace || []) {
      offerTrace.push({
        ordinal: offset + trace.ordinal,
        ...(trace.skuKey ? { skuKey: trace.skuKey } : {}),
        ...(trace.offerId ? { offerId: trace.offerId } : {}),
        ...(trace.skuKey ? { traceKey: traceKey(pointer.supplyGoodsId, trace.skuKey) } : {}),
      });
    }
  }
  if (offerTrace.length !== items.length) {
    return { kind: 'UNAVAILABLE' as const, reasonCode: 'INTERNAL_UNAVAILABLE' as const };
  }
  const legacyOfferTrace = tracedLegacyItems(input, preparedDrafts);
  if (legacyOfferTrace === null) {
    return { kind: 'UNAVAILABLE' as const, reasonCode: 'WORKFLOW_UNAVAILABLE' as const };
  }
  return {
    kind: 'COMPILED' as const,
    endpoint,
    payload: { items },
    offerTrace,
    legacyOfferTrace,
    compilerVersions: {
      publisherContractVersion,
      payloadCompilerVersion: OZON_LISTING_PAYLOAD_COMPILER_VERSION,
    },
  };
}

export function createOzonPublisherEntrypointParityObserver(
  options: OzonPublisherEntrypointParityObserverOptions,
) {
  return {
    async observe(
      input: OzonPublisherEntrypointParityObservation,
    ): Promise<OzonPublisherEntrypointParityReport> {
      const v2 = await compileShadow(options, input);
      const offerTrace = v2.kind === 'COMPILED'
        ? v2.legacyOfferTrace || offerMatchedLegacyTrace(input, v2)
        : undefined;
      const { itemTrace: _itemTrace, ...legacy } = input.legacy;
      const report = compareOzonPublisherEntrypointParity({
        entrypoint: input.entrypoint,
        legacy: {
          ...legacy,
          ...(offerTrace ? { offerTrace } : {}),
        },
        v2,
      });
      let eligibleAttemptKey: string | null = null;
      if (options.beginAttempt) {
        const attempt = await options.beginAttempt({
          ownerUserId: input.ownerUserId,
          shopId: input.shopId,
          rolloutRevision: input.rolloutRevision,
          entrypoint: input.entrypoint,
          endpoint: input.legacy.endpoint,
          payload: input.legacy.payload,
          itemTrace: input.legacy.itemTrace,
        });
        eligibleAttemptKey = attempt?.eligibleAttemptKey || null;
      }
      if (options.record) {
        try {
          await options.record({
            scopeHash: scopeHash(input),
            rolloutRevision: rolloutRevision(input.rolloutRevision),
            entrypoint: input.entrypoint,
            report,
            eligibleAttemptKey,
          });
        } catch {
          if (eligibleAttemptKey && options.failAttempt) {
            try {
              await options.failAttempt({
                eligibleAttemptKey,
                failureCode: 'OBSERVATION_RECORD_FAILED',
              });
            } catch {
              options.warn?.('Ozon publisher rollout recorder failure outcome could not be stored');
            }
          }
          options.warn?.('Ozon publisher parity diagnostic recording failed');
        }
      }
      return report;
    },
  };
}

export type OzonPublisherEntrypointParityObserver = ReturnType<
  typeof createOzonPublisherEntrypointParityObserver
>;
