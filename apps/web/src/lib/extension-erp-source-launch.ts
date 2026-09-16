export type ErpSourceImageEditorMode = 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
export type ErpSourceImageLaunchMode = 'WORKBENCH' | ErpSourceImageEditorMode;

export interface ErpSourceImageLaunchScope {
  epoch: number;
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  selectedSkuKeys: readonly string[];
  availableSourceMediaKeys: readonly string[];
  sourceMediaKey: string | null;
  preferredSkuKey: string | null;
  editorMode: ErpSourceImageEditorMode;
  ready: boolean;
  dirty: boolean;
}

interface ErpSourceImageLaunchRequest {
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  mode: ErpSourceImageLaunchMode;
  sourceMediaKeys: string[];
  preferredSkuKey: string | null;
}

interface LaunchDependencies {
  getApiOrigin(): string;
  sendToExtension(message: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  createGrant(body: ErpSourceImageLaunchRequest, options: {
    signal: AbortSignal; timeoutMs: number;
  }): Promise<unknown>;
  now?(): number;
}

const messages = {
  ERP_SOURCE_IMAGE_CONTEXT_INVALID: '请等待当前已保存草稿和来源图片读取完成，并核对所选 SKU 与原图。',
  ERP_SOURCE_IMAGE_DIRTY: '请先保存或放弃当前图片选择和遮罩草稿，再打开扩展。',
  ERP_SOURCE_IMAGE_BUSY: '正在打开扩展，请稍候。',
  ERP_SOURCE_IMAGE_CANCELLED: '草稿或图片选择已变化，本次扩展启动已取消。',
  ERP_SOURCE_IMAGE_DEVICE_UNAVAILABLE: '请确认 SS ERP 扩展已安装，并已配对当前账号。',
  ERP_SOURCE_IMAGE_ENDPOINT_MISMATCH: '扩展连接的 ERP 地址与当前站点不一致，请重新配对。',
  ERP_SOURCE_IMAGE_SCOPE_REQUIRED: '扩展缺少草稿审核或图片执行权限，请更新设备授权。',
  ERP_SOURCE_IMAGE_GRANT_REJECTED: '扩展启动授权未通过，请核对配对账号、店铺与当前草稿。',
  ERP_SOURCE_IMAGE_GRANT_INVALID: '扩展启动授权已失效，请从当前草稿重新打开。',
  ERP_SOURCE_IMAGE_TIMEOUT: '扩展启动响应超时，请检查当前扩展窗口后再操作。',
  ERP_SOURCE_IMAGE_OPEN_UNCONFIRMED: '扩展尚未确认打开结果，请检查扩展窗口后再操作。',
  ERP_SOURCE_IMAGE_UNAVAILABLE: '扩展暂时无法打开，请检查连接后重试。',
} as const;

type LaunchErrorCode = keyof typeof messages;
export class ErpSourceImageLaunchError extends Error {
  constructor(readonly code: LaunchErrorCode) {
    super(messages[code]);
    this.name = 'ErpSourceImageLaunchError';
  }
}

const fail = (code: LaunchErrorCode): never => { throw new ErpSourceImageLaunchError(code); };
const object = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);
function identifier(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.normalize('NFKC').trim()
    && !Array.from(value).some((character) => (character.codePointAt(0) || 0) < 32);
}
function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return value;
  } catch { /* rejected below */ }
  return fail('ERP_SOURCE_IMAGE_ENDPOINT_MISMATCH');
}
function validateScope(scope: ErpSourceImageLaunchScope | null, mode: ErpSourceImageLaunchMode) {
  if (scope?.dirty) return fail('ERP_SOURCE_IMAGE_DIRTY');
  if (!scope || !scope.ready || !['WORKBENCH', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(mode)
    || ![scope.snapshotId, scope.supplyGoodsId, scope.shopId, scope.listingWorkflowId].every((id) => identifier(id))
    || !Number.isSafeInteger(scope.epoch) || scope.epoch < 0
    || ![scope.draftRevision, scope.draftVersion].every((value) => Number.isSafeInteger(value) && value > 0)
    || scope.selectedSkuKeys.length < 1 || scope.selectedSkuKeys.length > 100
    || scope.selectedSkuKeys.some((key) => !identifier(key, 500))
    || scope.preferredSkuKey !== null && !scope.selectedSkuKeys.includes(scope.preferredSkuKey)
    || mode !== 'WORKBENCH' && (scope.editorMode !== mode || !identifier(scope.sourceMediaKey, 500)
      || !scope.availableSourceMediaKeys.includes(scope.sourceMediaKey))) {
    return fail('ERP_SOURCE_IMAGE_CONTEXT_INVALID');
  }
  return scope;
}

export function createErpSourceImageLauncher(options: LaunchDependencies) {
  let scope: ErpSourceImageLaunchScope | null = null;
  let scopeKey = 'null';
  let epoch = 0;
  let active: AbortController | null = null;
  const now = options.now || Date.now;

  function updateScope(value: ErpSourceImageLaunchScope | null): boolean {
    const next = value ? Object.freeze({
      ...value,
      selectedSkuKeys: Object.freeze([...value.selectedSkuKeys]),
      availableSourceMediaKeys: Object.freeze([...value.availableSourceMediaKeys]),
    }) : null;
    const nextKey = JSON.stringify(next);
    if (scopeKey === nextKey) return false;
    scope = next; scopeKey = nextKey; epoch += 1;
    const previous = active; active = null;
    previous?.abort(new ErpSourceImageLaunchError('ERP_SOURCE_IMAGE_CANCELLED'));
    return true;
  }

  async function open(mode: ErpSourceImageLaunchMode): Promise<{
    state: 'workbench_opened' | 'workbench_focused' | 'editor_opened' | 'choice_required';
  }> {
    if (active) return fail('ERP_SOURCE_IMAGE_BUSY');
    const input = validateScope(scope, mode);
    const requestEpoch = epoch;
    const apiOrigin = canonicalOrigin(options.getApiOrigin());
    const controller = new AbortController();
    active = controller;
    function assertCurrent() {
      if (controller.signal.aborted || active !== controller || epoch !== requestEpoch
        || options.getApiOrigin() !== apiOrigin) {
        throw controller.signal.reason instanceof ErpSourceImageLaunchError
          ? controller.signal.reason : new ErpSourceImageLaunchError('ERP_SOURCE_IMAGE_CANCELLED');
      }
    }
    async function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
      assertCurrent();
      let abort = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      const timer = setTimeout(() => controller.abort(
        new ErpSourceImageLaunchError('ERP_SOURCE_IMAGE_TIMEOUT'),
      ), timeoutMs);
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => { assertCurrent(); return operation(); }), interrupted,
        ]);
        assertCurrent();
        return result;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abort);
      }
    }
    try {
      const statusResponse = object(await bounded(() => options.sendToExtension({
        type: 'ss-erp:extension-device-status', verify: true,
      }, 8000), 8000));
      const status = object(statusResponse?.data);
      if (statusResponse?.ok !== true || status?.state !== 'paired' || !identifier(status.sessionId)) {
        return fail('ERP_SOURCE_IMAGE_DEVICE_UNAVAILABLE');
      }
      if (status.endpoint !== apiOrigin) return fail('ERP_SOURCE_IMAGE_ENDPOINT_MISMATCH');
      if (!Array.isArray(status.scopes)
        || !['listing:review', 'media:execute'].every((required) => (status.scopes as unknown[]).includes(required))) {
        return fail('ERP_SOURCE_IMAGE_SCOPE_REQUIRED');
      }
      const issued = object(await bounded(() => options.createGrant({
        deviceSessionId: status.sessionId as string, shopId: input.shopId,
        listingWorkflowId: input.listingWorkflowId, draftRevision: input.draftRevision,
        draftVersion: input.draftVersion, mode,
        sourceMediaKeys: mode === 'WORKBENCH' ? [] : [input.sourceMediaKey!],
        preferredSkuKey: input.preferredSkuKey,
      }, { signal: controller.signal, timeoutMs: 15_000 }), 15_000));
      if (issued?.code !== 1) return fail('ERP_SOURCE_IMAGE_GRANT_REJECTED');
      const grant = object(issued.data);
      const expires = typeof grant?.expiresAt === 'string' ? Date.parse(grant.expiresAt) : NaN;
      if (grant?.contractVersion !== 'extension-erp-source-launch/v1' || grant.provenance !== 'ERP_SOURCE'
        || grant.apiOrigin !== apiOrigin || typeof grant.launchToken !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/u.test(grant.launchToken) || !Number.isFinite(expires) || expires <= now()) {
        return fail('ERP_SOURCE_IMAGE_GRANT_INVALID');
      }
      // The short-lived ticket stays in this invocation. The bridge receives no
      // account, raw source context, media URL, Provider key or caller authority.
      const opened = object(await bounded(() => options.sendToExtension({
        type: 'ss-erp:erp-source-image-open', launchToken: grant.launchToken,
      }, 30_000), 30_000));
      const result = object(opened?.result);
      const allowed = mode === 'WORKBENCH'
        ? ['workbench_opened', 'workbench_focused', 'choice_required'] : ['editor_opened'];
      if (opened?.ok !== true || result?.provenance !== 'ERP_SOURCE' || !allowed.includes(String(result.state))
        || result.tabId !== undefined && (!Number.isSafeInteger(result.tabId) || Number(result.tabId) < 0)
        || mode === 'WORKBENCH' && result.state !== 'choice_required' && result.tabId === undefined) {
        return fail('ERP_SOURCE_IMAGE_OPEN_UNCONFIRMED');
      }
      return { state: result.state as 'workbench_opened' | 'workbench_focused' | 'editor_opened' | 'choice_required' };
    } catch (cause) {
      if (cause instanceof ErpSourceImageLaunchError) throw cause;
      if (object(cause)?.code === 'API_REQUEST_TIMEOUT') return fail('ERP_SOURCE_IMAGE_TIMEOUT');
      return fail('ERP_SOURCE_IMAGE_UNAVAILABLE');
    } finally {
      if (active === controller) active = null;
    }
  }

  return Object.freeze({ updateScope, clear: () => updateScope(null), isBusy: () => active !== null, open });
}
