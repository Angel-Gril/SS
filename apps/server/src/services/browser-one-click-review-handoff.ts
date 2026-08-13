export const BROWSER_ONE_CLICK_V2_HANDOFF_VERSION = 'browser-one-click-v2-handoff/v1' as const;
export const BROWSER_ONE_CLICK_MAX_ITEMS = 100;

export interface BrowserOneClickReviewHandoffSqlClient {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
}

export interface BrowserOneClickReviewDraftIdentity {
  supplyGoodsId: string;
  snapshotId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
  skuKey: string;
  sourceSku: string;
}

export interface BrowserOneClickReviewFailureIdentity {
  errorCode: string;
  supplyGoodsId?: string;
}

export interface BrowserOneClickReviewHandoff {
  contractVersion: typeof BROWSER_ONE_CLICK_V2_HANDOFF_VERSION;
  state: 'REVIEW_REQUIRED';
  drafts: BrowserOneClickReviewDraftIdentity[];
  failures: BrowserOneClickReviewFailureIdentity[];
  [key: string]: unknown;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function exactId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && value === value.normalize('NFKC').trim()
    && !hasAsciiControl(value)
    ? value
    : null;
}

function exactRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export async function findBrowserOneClickReviewProtectedSupplyGoodsIds(
  client: BrowserOneClickReviewHandoffSqlClient,
  input: { ownerUserId: string; shopId: string; supplyGoodsIds: string[] },
): Promise<string[]> {
  const ownerUserId = exactId(input.ownerUserId);
  const shopId = exactId(input.shopId);
  const supplyGoodsIds = [...new Set(input.supplyGoodsIds.map(exactId).filter((id): id is string => Boolean(id)))];
  if (!ownerUserId || !shopId) throw new Error('Browser one-click review ownership is invalid');
  if (!supplyGoodsIds.length) return [];

  const rows = await client.$queryRawUnsafe<Array<{ supplyGoodsId: unknown }>>(
    `SELECT DISTINCT handoff_draft.value->>'supplyGoodsId' AS "supplyGoodsId"
     FROM "sync_jobs" job
     JOIN "shops" shop
       ON shop."id" = job."shop_id" AND shop."user_id" = $1
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(job."payload"->'browserOneClickPublishHandoff'->'drafts') = 'array'
           THEN job."payload"->'browserOneClickPublishHandoff'->'drafts'
         ELSE '[]'::jsonb
       END
     ) AS handoff_draft(value)
     JOIN "source_listing_workflows" workflow
       ON workflow."id" = handoff_draft.value->>'draftId'
      AND workflow."owner_user_id" = shop."user_id"
      AND workflow."shop_id" = job."shop_id"
      AND workflow."supply_goods_id" = handoff_draft.value->>'supplyGoodsId'
     JOIN "source_listing_draft_versions" draft
       ON draft."workflow_id" = workflow."id"
      AND draft."owner_user_id" = workflow."owner_user_id"
      AND draft."supply_goods_id" = handoff_draft.value->>'supplyGoodsId'
      AND draft."source_capture_snapshot_id" = handoff_draft.value->>'snapshotId'
      AND draft."draft_version"::text = handoff_draft.value->>'draftVersion'
      AND draft."revision"::text = handoff_draft.value->>'revision'
     WHERE job."shop_id" = $2
       AND job."type" = 'PRODUCT_PUSH'
       AND job."payload"->>'source' = 'browser-one-click-listing'
       AND job."payload"->'browserOneClickPublishHandoff'->>'contractVersion' = $4
       AND job."payload"->'browserOneClickPublishHandoff'->>'state' = 'REVIEW_REQUIRED'
       AND handoff_draft.value->>'supplyGoodsId' = ANY($3::text[])`,
    ownerUserId,
    shopId,
    supplyGoodsIds,
    BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
  );
  const requested = new Set(supplyGoodsIds);
  return [...new Set(rows
    .map((row) => exactId(row.supplyGoodsId))
    .filter((id): id is string => Boolean(id && requested.has(id))))];
}

export function parseBrowserOneClickReviewHandoff(
  value: unknown,
): BrowserOneClickReviewHandoff | null {
  const candidate = objectRecord(value);
  if (!candidate
    || candidate.contractVersion !== BROWSER_ONE_CLICK_V2_HANDOFF_VERSION
    || candidate.state !== 'REVIEW_REQUIRED'
    || !Array.isArray(candidate.drafts)
    || !Array.isArray(candidate.failures)
    || candidate.drafts.length === 0
    || candidate.drafts.length > BROWSER_ONE_CLICK_MAX_ITEMS
    || candidate.failures.length > BROWSER_ONE_CLICK_MAX_ITEMS
    || candidate.drafts.length + candidate.failures.length > BROWSER_ONE_CLICK_MAX_ITEMS) {
    return null;
  }

  const drafts: BrowserOneClickReviewDraftIdentity[] = [];
  const supplyGoodsIds = new Set<string>();
  const draftIds = new Set<string>();
  for (const value of candidate.drafts) {
    const draft = objectRecord(value);
    if (!draft) return null;
    const supplyGoodsId = exactId(draft.supplyGoodsId);
    const snapshotId = exactId(draft.snapshotId);
    const draftId = exactId(draft.draftId);
    const draftVersion = exactRevision(draft.draftVersion);
    const revision = exactRevision(draft.revision);
    const skuKey = exactId(draft.skuKey);
    const sourceSku = exactId(draft.sourceSku);
    if (!supplyGoodsId || !snapshotId || !draftId || draftVersion == null
      || revision == null || !skuKey || !sourceSku
      || supplyGoodsIds.has(supplyGoodsId) || draftIds.has(draftId)) {
      return null;
    }
    supplyGoodsIds.add(supplyGoodsId);
    draftIds.add(draftId);
    drafts.push({
      supplyGoodsId,
      snapshotId,
      draftId,
      draftVersion,
      revision,
      skuKey,
      sourceSku,
    });
  }

  const failures: BrowserOneClickReviewFailureIdentity[] = [];
  const failedSupplyGoodsIds = new Set<string>();
  for (const value of candidate.failures) {
    const failure = objectRecord(value);
    if (!failure) return null;
    const errorCode = exactId(failure.errorCode);
    const supplyGoodsId = failure.supplyGoodsId == null
      ? undefined
      : exactId(failure.supplyGoodsId);
    if (!errorCode || supplyGoodsId === null
      || (supplyGoodsId !== undefined
        && (supplyGoodsIds.has(supplyGoodsId) || failedSupplyGoodsIds.has(supplyGoodsId)))) {
      return null;
    }
    if (supplyGoodsId) failedSupplyGoodsIds.add(supplyGoodsId);
    failures.push({ errorCode, ...(supplyGoodsId ? { supplyGoodsId } : {}) });
  }

  return {
    ...candidate,
    contractVersion: BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
    state: 'REVIEW_REQUIRED',
    drafts,
    failures,
  };
}
