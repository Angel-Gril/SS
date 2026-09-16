import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { isSourceListingAiMediaTarget, type SourceListingAiMediaTarget } from 'shared/ozon-listing-draft';
import type { ExtensionDeviceLiveAuthorization } from '../lib/extension-device-auth.js';
import type { ExtensionByokWorkbenchDraft } from './extension-byok-workbench-launch.js';
import type { ExtensionMediaTranslationLaunchContext } from './extension-media-workflow-launch.js';

export interface ErpSourceLaunchGrantStore {
  put(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  consume(key: string, expected: string): Promise<boolean>;
}

export interface ExtensionErpSourceLaunchOptions {
  store: ErpSourceLaunchGrantStore;
  apiOrigin: string;
  deploymentId: string;
  allowInsecureLocal?: boolean;
  loadDevice(sessionId: string): Promise<ExtensionDeviceLiveAuthorization | null>;
  loadShop(input: { ownerUserId: string; shopId: string }): Promise<{ id: string; userId: string; platform: string; status: string } | null>;
  loadDraft(input: { ownerUserId: string; workflowId: string }): Promise<ExtensionByokWorkbenchDraft | null>;
  loadMediaContext(input: { ownerUserId: string; listingWorkflowId: string; draftRevision: number; draftVersion: number; target?: SourceListingAiMediaTarget }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  isEnabled?(input: { ownerUserId: string; deviceSessionId: string; shopId: string; mode: 'WORKBENCH' | 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT' }): Promise<boolean>;
  now?: () => Date;
  createToken?: () => string;
}

export const ERP_SOURCE_LAUNCH_TTL_SECONDS = 120;
export const ERP_SOURCE_LAUNCH_VERSION = 'extension-erp-source-launch/v1' as const;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_GRANT_BYTES = 16 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (maximum = 200) => z.string().min(1).max(maximum)
  .refine(value => value === value.normalize('NFKC').trim()
    && !Array.from(value).some(character => (character.codePointAt(0) || 0) < 32));
const mode = z.enum(['WORKBENCH', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
const targetSchema = z.object({ skuKey: id(500).nullable(), slotKey: id(200) }).strict();
export const erpSourceLaunchRequestSchema = z.object({
  deviceSessionId: id(), shopId: id(), listingWorkflowId: id(),
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive(),
  mode, sourceMediaKeys: z.array(id(500)).max(4), preferredSkuKey: id(500).nullable(),
  target: targetSchema.optional(),
}).strict().superRefine((value, context) => {
  const maximum = value.mode === 'WORKBENCH' ? 0 : value.mode === 'IMAGE_TO_IMAGE' ? 4 : 1;
  if (value.sourceMediaKeys.length > maximum
    || (value.mode !== 'WORKBENCH' && value.sourceMediaKeys.length < 1)
    || new Set(value.sourceMediaKeys).size !== value.sourceMediaKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceMediaKeys'], message: 'Invalid source selection' });
  }
  if (value.mode === 'WORKBENCH' ? value.target !== undefined : !value.target) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'An editor requires an exact draft target' });
  }
});
export type ErpSourceLaunchRequest = z.infer<typeof erpSourceLaunchRequestSchema>;
const launchRequestSchema = z.object({
  sourcePlatform: z.enum(['1688', 'pdd', 'taobao', 'tmall']), sourceProductId: id(),
  sourceCaptureSnapshotId: id(), supplyGoodsId: id(), shopId: id(), workflowId: id(),
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive(),
  preferredSkuKey: id(500).nullable(), selectionKind: z.enum(['HINT', 'EXPLICIT']),
}).strict();
const resolvedSchema = z.object({
  contractVersion: z.literal(ERP_SOURCE_LAUNCH_VERSION), provenance: z.literal('ERP_SOURCE'),
  apiOrigin: z.string().url().max(2048), ownerUserId: id(), deviceSessionId: id(),
  mode, sourceMediaKeys: z.array(id(500)).max(4), launchRequest: launchRequestSchema,
  target: targetSchema.optional(),
}).strict();
const grantSchema = z.object({
  schemaVersion: z.literal(1), deploymentId: id(128), ownerUserId: id(), actorUserId: id(),
  createdAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  request: erpSourceLaunchRequestSchema, resolved: resolvedSchema,
}).strict();
const accountSchema = z.object({
  ownerUserId: id(), actorUserId: id(), actorParentId: z.null(), actorRole: z.enum(['ADMIN', 'USER']),
}).strict();
const deviceSchema = z.object({
  ownerUserId: id(), actorUserId: id(), sessionId: id(), deploymentId: id(128),
  scopes: z.array(z.string()), allowedShopIds: z.array(z.string()),
});

type LaunchCode = 'ERP_LAUNCH_INVALID_REQUEST' | 'ERP_LAUNCH_FORBIDDEN' | 'ERP_LAUNCH_CONTEXT_STALE'
  | 'ERP_LAUNCH_DISABLED' | 'ERP_LAUNCH_GRANT_UNAVAILABLE' | 'ERP_LAUNCH_UNAVAILABLE';
export class ExtensionErpSourceLaunchError extends Error {
  constructor(public readonly code: LaunchCode, public readonly statusCode: number) {
    super(code); this.name = 'ExtensionErpSourceLaunchError';
  }
}
const fail = (code: LaunchCode, statusCode: number): never => { throw new ExtensionErpSourceLaunchError(code, statusCode); };

export function createExtensionErpSourceLaunchService(options: ExtensionErpSourceLaunchOptions) {
  const now = options.now || (() => new Date());
  const createToken = options.createToken || (() => randomBytes(32).toString('base64url'));
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ExtensionErpSourceLaunchError) throw error;
      return fail('ERP_LAUNCH_UNAVAILABLE', 503);
    }
  }
  async function resolve(ownerUserId: string, actorUserId: string, request: ErpSourceLaunchRequest) {
    const endpoint = new URL(options.apiOrigin);
    const local = options.allowInsecureLocal === true && endpoint.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.origin !== options.apiOrigin || (endpoint.protocol !== 'https:' && !local)) {
      return fail('ERP_LAUNCH_UNAVAILABLE', 503);
    }
    const live = await options.loadDevice(request.deviceSessionId);
    if (!live || live.sessionId !== request.deviceSessionId || live.status !== 'ACTIVE'
      || live.deploymentId !== options.deploymentId || live.ownerUserId !== ownerUserId
      || live.actorUserId !== actorUserId || actorUserId !== ownerUserId || live.actorParentId !== null
      || live.ownerStatus !== 'ACTIVE' || live.actorStatus !== 'ACTIVE'
      || !['ADMIN', 'USER'].includes(live.ownerRole) || !['ADMIN', 'USER'].includes(live.actorRole)
      || !(live.expiresAt instanceof Date) || live.expiresAt.getTime() <= now().getTime()
      || !['listing:review', 'media:execute'].every(scope => live.scopes.includes(scope))
      || !live.shopGrants.some(grant => grant.shopId === request.shopId && grant.status === 'ACTIVE')) {
      return fail('ERP_LAUNCH_FORBIDDEN', 403);
    }
    if (!options.isEnabled || await options.isEnabled({
      ownerUserId, deviceSessionId: live.sessionId, shopId: request.shopId, mode: request.mode,
    }) !== true) return fail('ERP_LAUNCH_DISABLED', 403);
    const [draft, media, shop] = await Promise.all([
      options.loadDraft({ ownerUserId, workflowId: request.listingWorkflowId }),
      options.loadMediaContext({ ownerUserId, listingWorkflowId: request.listingWorkflowId,
        draftRevision: request.draftRevision, draftVersion: request.draftVersion,
        ...(request.target ? { target: request.target } : {}) }),
      options.loadShop({ ownerUserId, shopId: request.shopId }),
    ]);
    if (!shop || shop.id !== request.shopId || shop.userId !== ownerUserId
      || shop.status !== 'ACTIVE' || shop.platform !== 'OZON') return fail('ERP_LAUNCH_FORBIDDEN', 403);
    if (!draft || !media || draft.id !== request.listingWorkflowId || draft.ownerUserId !== ownerUserId
      || draft.shopId !== request.shopId || draft.revision !== request.draftRevision
      || draft.draftVersion !== request.draftVersion || draft.runState !== 'ACTIVE' || draft.stage === 'PUBLISHED'
      || draft.sourceCaptureCurrent !== true || media.id !== draft.id || media.ownerUserId !== ownerUserId
      || media.shopId !== draft.shopId || media.snapshotId !== draft.sourceCaptureSnapshotId
      || media.supplyGoodsId !== draft.supplyGoodsId || media.revision !== draft.revision
      || media.draftVersion !== draft.draftVersion
      || request.sourceMediaKeys.some(key => !media.sourceMediaKeys.includes(key))
      || request.target && (!isSourceListingAiMediaTarget(draft, request.target)
        || media.target?.skuKey !== request.target.skuKey || media.target?.slotKey !== request.target.slotKey)
      || (request.preferredSkuKey !== null && !draft.selectedSkuKeys.includes(request.preferredSkuKey))) {
      return fail('ERP_LAUNCH_CONTEXT_STALE', 409);
    }
    const resolved = resolvedSchema.safeParse({
      contractVersion: ERP_SOURCE_LAUNCH_VERSION, provenance: 'ERP_SOURCE',
      apiOrigin: options.apiOrigin, ownerUserId, deviceSessionId: live.sessionId,
      mode: request.mode, sourceMediaKeys: request.sourceMediaKeys,
      ...(request.target ? { target: request.target } : {}),
      launchRequest: {
        sourcePlatform: draft.sourcePlatform, sourceProductId: draft.sourceProductId,
        sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, supplyGoodsId: draft.supplyGoodsId,
        shopId: draft.shopId, workflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion,
        preferredSkuKey: request.preferredSkuKey, selectionKind: request.preferredSkuKey === null ? 'HINT' : 'EXPLICIT',
      },
    });
    if (!resolved.success || new URL(options.apiOrigin).origin !== options.apiOrigin) {
      return fail('ERP_LAUNCH_CONTEXT_STALE', 409);
    }
    return resolved.data;
  }
  return {
    issue(accountValue: unknown, input: unknown) {
      return guarded(async () => {
        const account = accountSchema.safeParse(accountValue);
        if (!account.success || account.data.actorUserId !== account.data.ownerUserId) return fail('ERP_LAUNCH_FORBIDDEN', 403);
        const parsed = erpSourceLaunchRequestSchema.safeParse(input);
        if (!parsed.success) return fail('ERP_LAUNCH_INVALID_REQUEST', 400);
        const resolved = await resolve(account.data.ownerUserId, account.data.actorUserId, parsed.data);
        const createdAt = now().getTime(), expiresAt = createdAt + ERP_SOURCE_LAUNCH_TTL_SECONDS * 1000;
        const value = JSON.stringify({ schemaVersion: 1, deploymentId: options.deploymentId,
          ownerUserId: account.data.ownerUserId, actorUserId: account.data.actorUserId,
          createdAt, expiresAt, request: parsed.data, resolved });
        const launchToken = createToken();
        if (!TOKEN.test(launchToken) || Buffer.byteLength(value) > MAX_GRANT_BYTES
          || !await options.store.put(hash(launchToken), value, ERP_SOURCE_LAUNCH_TTL_SECONDS)) {
          return fail('ERP_LAUNCH_UNAVAILABLE', 503);
        }
        return { contractVersion: ERP_SOURCE_LAUNCH_VERSION, provenance: 'ERP_SOURCE' as const,
          apiOrigin: options.apiOrigin, launchToken, expiresAt: new Date(expiresAt).toISOString() };
      });
    },
    consume(deviceValue: unknown, tokenValue: unknown) {
      return guarded(async () => {
        const device = deviceSchema.safeParse(deviceValue);
        if (!device.success || device.data.actorUserId !== device.data.ownerUserId) return fail('ERP_LAUNCH_FORBIDDEN', 403);
        if (typeof tokenValue !== 'string' || !TOKEN.test(tokenValue)) return fail('ERP_LAUNCH_INVALID_REQUEST', 400);
        const digest = hash(tokenValue), raw = await options.store.get(digest);
        if (!raw || Buffer.byteLength(raw) > MAX_GRANT_BYTES) return fail('ERP_LAUNCH_GRANT_UNAVAILABLE', 409);
        let parsed: ReturnType<typeof grantSchema.safeParse>;
        try { parsed = grantSchema.safeParse(JSON.parse(raw)); }
        catch { return fail('ERP_LAUNCH_GRANT_UNAVAILABLE', 409); }
        if (!parsed.success) return fail('ERP_LAUNCH_GRANT_UNAVAILABLE', 409);
        const grant = parsed.data, current = now().getTime();
        if (grant.expiresAt <= current || grant.createdAt > current
          || grant.expiresAt - grant.createdAt !== ERP_SOURCE_LAUNCH_TTL_SECONDS * 1000) {
          return fail('ERP_LAUNCH_GRANT_UNAVAILABLE', 409);
        }
        if (grant.deploymentId !== options.deploymentId || device.data.deploymentId !== options.deploymentId
          || grant.ownerUserId !== device.data.ownerUserId || grant.actorUserId !== device.data.actorUserId
          || grant.request.deviceSessionId !== device.data.sessionId || grant.resolved.apiOrigin !== options.apiOrigin
          || !device.data.allowedShopIds.includes(grant.request.shopId)
          || !['listing:review', 'media:execute'].every(scope => device.data.scopes.includes(scope))) {
          return fail('ERP_LAUNCH_FORBIDDEN', 403);
        }
        const resolved = await resolve(grant.ownerUserId, grant.actorUserId, grant.request);
        if (JSON.stringify(resolved) !== JSON.stringify(grant.resolved)) return fail('ERP_LAUNCH_CONTEXT_STALE', 409);
        if (!await options.store.consume(digest, raw)) return fail('ERP_LAUNCH_GRANT_UNAVAILABLE', 409);
        return { ...resolved, grantSha256: digest };
      });
    },
  };
}

interface LaunchRedis {
  get(key: string): Promise<string | null>;
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
}
const PUT_GRANT = `
local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
if count > 20 then return 0 end
local result = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')
if result then return 1 end
return 0
`;
const CONSUME_GRANT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export function createRedisErpSourceLaunchGrantStore(options: { redis: LaunchRedis; enabled: boolean }): ErpSourceLaunchGrantStore {
  const key = (digest: string) => {
    if (!options.enabled || !HASH.test(digest)) return fail('ERP_LAUNCH_UNAVAILABLE', 503);
    return `extension-erp-launch:grant:${digest}`;
  };
  return {
    async put(digest, value, ttlSeconds) {
      const target = key(digest);
      if (ttlSeconds !== ERP_SOURCE_LAUNCH_TTL_SECONDS || Buffer.byteLength(value) > MAX_GRANT_BYTES) return false;
      const grant = grantSchema.parse(JSON.parse(value));
      const budget = `extension-erp-launch:issue:${hash(grant.ownerUserId + ':' + grant.request.deviceSessionId)}`;
      return Number(await options.redis.eval(PUT_GRANT, 2, target, budget, value, ttlSeconds)) === 1;
    },
    get(digest) { return options.redis.get(key(digest)); },
    async consume(digest, expected) {
      return Number(await options.redis.eval(CONSUME_GRANT, 1, key(digest), expected)) === 1;
    },
  };
}
