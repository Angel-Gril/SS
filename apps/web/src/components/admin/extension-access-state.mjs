// UI projection only. The server's rollout owners remain authoritative on save and use.
export const SOURCE_POLICY_KEY = 'source_workflow_rollout_policy';
export const TENANT_POLICY_KEY = 'ai_media_workflow_v2_rollout_policy';
export const ACCESS_EXTRA_FLAGS = [
  'feature_extension_hosted_ai', 'feature_image_translate',
  'feature_ai_media_image_to_image', 'feature_ai_media_suite', 'feature_ai_media_full_edit',
  'feature_ai_media_inpaint', 'feature_ai_listing_copy_generation', 'feature_extension_product_vision',
];
export const SHOP_SCOPED_FEATURES = [
  'SOURCE_LISTING_WORKFLOW', 'SOURCE_OZON_MAPPING_V2_READ',
  'SOURCE_OZON_MAPPING_V2_WRITE', 'SOURCE_OZON_PUBLISHER_V2',
];
export const SOURCE_FEATURE_LABELS = {
  SOURCE_CAPTURE_V2: '商品采集', SOURCE_LISTING_WORKFLOW: '店铺草稿与上架工作流',
  SOURCE_OZON_MAPPING_V2_READ: '类目与属性读取', SOURCE_OZON_MAPPING_V2_WRITE: '类目与属性保存',
  SOURCE_OZON_PUBLISHER_V2: 'Ozon 商品发布', SOURCE_NETWORK_CAPTURE: '来源网络采集',
  AI_MEDIA_WORKFLOW_V2: '托管图片工作流', SOURCE_LISTING_WEB_MEDIA: 'ERP 图片工作台',
  SOURCE_LISTING_EXTENSION_WORKBENCH: '精铺扩展工作台',
};
const dimensions = ['ownerUserIds', 'shopIds', 'deviceSessionIds', 'platforms'];
const stages = ['shadow_write', 'dual_read', 'v2_only'];
export function accessRegionLabel(hostname) {
  if (hostname === 'ss-erp.cn' || hostname.endsWith('.ss-erp.cn')) return `CN · ${hostname}`;
  if (hostname === 'ss-erp.com' || hostname.endsWith('.ss-erp.com')) return `COM · ${hostname}`;
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return `本机 · ${hostname}`;
  return hostname || '读取区域中';
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keysAllowed(value, allowed) { return Object.keys(value).every(key => allowed.includes(key)); }
function list(value, max = 1000, length = 200) {
  return Array.isArray(value) && value.length >= 1 && value.length <= max
    && value.every(item => typeof item === 'string' && item.trim().length >= 1 && item.trim().length <= length);
}

export function parseSourcePolicy(raw) {
  try {
    const value = JSON.parse(raw);
    if (!object(value) || !keysAllowed(value, ['revision', 'features'])
      || typeof value.revision !== 'string' || !value.revision.trim() || value.revision.trim().length > 200
      || !object(value.features)) throw new Error();
    for (const [feature, rule] of Object.entries(value.features)) {
      if (!object(rule) || !['off', 'pilot', 'global'].includes(rule.mode)) throw new Error();
      const allowed = rule.mode === 'off' ? ['mode']
        : rule.mode === 'global' ? ['mode', 'stage', 'listingStage'] : ['mode', 'stage', 'listingStage', ...dimensions];
      if (!keysAllowed(rule, allowed)) throw new Error();
      if ('stage' in rule && (feature !== 'SOURCE_CAPTURE_V2' || !stages.includes(rule.stage))) throw new Error();
      if ('listingStage' in rule && (feature !== 'SOURCE_LISTING_WORKFLOW' || !stages.includes(rule.listingStage))) throw new Error();
      if (rule.mode === 'pilot') {
        if (!dimensions.some(key => key in rule)) throw new Error();
        for (const key of dimensions) {
          if (key in rule && !list(rule[key], key === 'platforms' ? 20 : 1000, key === 'platforms' ? 40 : 200)) throw new Error();
        }
        if (SHOP_SCOPED_FEATURES.includes(feature) && (!rule.shopIds || rule.deviceSessionIds)) throw new Error();
      }
    }
    return { value, error: null };
  } catch {
    return { value: null, error: '来源访问策略无法解析或不符合当前合同。原值已保留，请重新读取或由运维修复。' };
  }
}

export function parseTenantPolicy(raw) {
  try {
    const value = JSON.parse(raw);
    if (!object(value) || !keysAllowed(value, ['revision', 'tenantIds', 'mode'])
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.tenantIds) || value.tenantIds.some(id => typeof id !== 'string' || !id.trim())
      || new Set(value.tenantIds.map(id => id.trim())).size !== value.tenantIds.length
      || value.mode !== undefined && !['allowlist', 'all'].includes(value.mode)
      || value.mode === 'all' && value.tenantIds.length) throw new Error();
    return { value, error: null };
  } catch {
    return { value: null, error: '托管用户策略无法解析。原值已保留，未转换为关闭或全量开放。' };
  }
}

export function prepareAccessSave(rows, draft, nextRevision) {
  const byKey = new Map(rows.map(row => [row.key, row]));
  return Object.entries(draft).flatMap(([key, raw]) => {
    const row = byKey.get(key);
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('配置项或版本未完整读取，请刷新后再保存');
    if (raw === row.value) return [];
    let value = raw;
    if (key === SOURCE_POLICY_KEY) {
      const parsed = parseSourcePolicy(raw);
      if (!parsed.value) throw new Error(parsed.error);
      value = JSON.stringify({ ...parsed.value, revision: nextRevision });
    } else if (key === TENANT_POLICY_KEY) {
      const parsed = parseTenantPolicy(raw);
      if (!parsed.value || parsed.value.revision >= Number.MAX_SAFE_INTEGER) throw new Error(parsed.error || '托管策略版本超出范围');
      value = JSON.stringify({ ...parsed.value, revision: parsed.value.revision + 1 });
    } else if (!key.startsWith('feature_') || !['true', 'false'].includes(raw)) throw new Error('功能开关值无效，请重新读取');
    return [{ key, value, expectedRevision: row.revision }];
  });
}

export function initializeSourcePolicy(raw, confirmed) {
  if (raw !== '{}' || confirmed !== true) return null;
  return { revision: 'admin-initial', features: {} };
}

function scope(rule, labels = {}) {
  if (!rule || rule.mode === 'off') return '关闭';
  if (rule.mode === 'global') return '全部用户及店铺';
  return dimensions.filter(key => rule[key]?.length).map(key => `${({ownerUserIds:'用户',shopIds:'店铺',deviceSessionIds:'设备',platforms:'平台'})[key]}：${rule[key].map(id => labels[id] || id).join('、')}`).join('；');
}
function ruleExpands(before, after) {
  if (!after || after.mode === 'off') return false;
  if (!before || before.mode === 'off') return true;
  if (before.mode === 'global') return false;
  if (after.mode === 'global') return true;
  return dimensions.some(key => before[key] && (!after[key] || after[key].some(id => !before[key].includes(id))));
}
export function describeAccessChanges(rows, draft, labels = {}) {
  const changes = [];
  for (const row of rows) {
    const raw = draft[row.key];
    if (raw === undefined || raw === row.value) continue;
    if (row.key === SOURCE_POLICY_KEY) {
      const before = parseSourcePolicy(row.value).value;
      const after = parseSourcePolicy(raw).value;
      if (!after) continue;
      if (!before) changes.push({ label: '来源工作流策略', detail: '显式初始化关闭策略；未配置的功能保持关闭', expands: false });
      for (const name of new Set([...Object.keys(before?.features || {}), ...Object.keys(after.features)])) {
        const a = before?.features[name], b = after.features[name];
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        const stage = b?.stage || b?.listingStage;
        const beforeStage = a?.stage || a?.listingStage;
        const stageChanged = stage !== beforeStage;
        changes.push({ label: SOURCE_FEATURE_LABELS[name] || name, detail: `${scope(a, labels)} → ${scope(b, labels)}${stageChanged ? `；阶段 ${beforeStage || '默认'} → ${stage || '默认'}` : stage ? `；阶段 ${stage}` : ''}`,
          expands: ruleExpands(a, b) || Boolean(stageChanged && b?.mode !== 'off') });
      }
    } else if (row.key === TENANT_POLICY_KEY) {
      const a = parseTenantPolicy(row.value).value, b = parseTenantPolicy(raw).value;
      if (!b) continue;
      changes.push({ label: '托管 AI 用户范围', detail: `${a?.mode === 'all' ? '全部用户' : a?.tenantIds.map(id => labels[id] || id).join('、') || '无用户'} → ${b.mode === 'all' ? '全部用户' : b.tenantIds.map(id => labels[id] || id).join('、') || '无用户'}`,
        expands: b.mode === 'all' && a?.mode !== 'all' || a?.mode !== 'all' && b.tenantIds.some(id => !a?.tenantIds.includes(id)) });
    } else changes.push({ label: row.label || row.key, detail: `${row.value === 'true' ? '开启' : '关闭'} → ${raw === 'true' ? '开启' : '关闭'}`, expands: raw === 'true' });
  }
  return changes;
}

export function buildOptionsPath(search, ownerIds) {
  const ids = [...new Set(ownerIds)];
  if (ids.length > 50) throw new Error('每次最多查看 50 位用户的店铺和设备，请缩小选择范围');
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim().slice(0, 100));
  if (ids.length) query.set('ownerUserIds', ids.join(','));
  query.set('limit', '100');
  return `/api/admin/extension-rollout/options?${query}`;
}
export function mergeOptions(previous, next) {
  const merged = { ...next };
  for (const key of ['owners', 'shops', 'devices']) {
    const records = new Map((previous?.[key] || []).map(item => [item.id, item]));
    for (const item of next[key]) records.set(item.id, item);
    merged[key] = [...records.values()];
  }
  return merged;
}
