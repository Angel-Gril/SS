// 参考图选择：索引规则，零模型
//
// 依据（实跑精铺 v20260803 得到的结论）：
//   modules/image-generation/reference-selector.js  —— 主图/详情图按索引分配 visualRole
//   ui/modules/vision/index.js 的 collectVisionImages —— 同样只做索引切片与均匀采样
//
// 两家竞品都不「用 AI 判定哪张图适合做主图」。主图就是第 0 张。
// 我们此前在索引规则之外又套了「视觉模型逐张描述 + 人工确认」，
// 结果是每次分析都要经过 ERP operation 状态机，失败后整条链路停摆。
//
// 这里把索引规则独立出来，不依赖任何模型与 ERP。

export const REFERENCE_SELECTION_VERSION = 'reference-index-v1';

// 上限参照精铺：参考图最多 5 张（PROMPT_PLAN_SELECTED_REFERENCE_LIMIT）
export const SELECTED_REFERENCE_LIMIT = 5;
// 候选上限 30（PROMPT_PLAN_CANDIDATE_LIMIT）
export const REFERENCE_CANDIDATE_LIMIT = 30;
// 精铺实测：最多 3 张 SKU 图 + 5 张精选图
export const VISION_IMAGE_LIMIT = 8;

/**
 * 按索引给图片分配视觉角色。
 *
 * 规则（与精铺 reference-selector.js 一致）：
 *   主图第 0 张        → front   （产品身份与英雄角度）
 *   主图其余           → detail  （形状/颜色/另角度稳定）
 *   详情图每 3 张第 2 张 → package （包装与附件证据）
 *   详情图其余          → detail  （材质/结构/特写）
 *   额外图             → context
 *
 * @param media [{ key, url, role?, group? }]  role/group 可缺省
 * @returns [{ key, url, sourceType, sourceIndex, visualRole, reason }]
 */
export function classifyReferences(media) {
  const list = Array.isArray(media) ? media : [];
  const seen = new Set();
  const out = [];

  const push = (item, sourceType, sourceIndex, visualRole, reason) => {
    const url = normalizeHttps(item && item.url);
    const key = String((item && item.key) || '');
    if (!url || !key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, url, sourceType, sourceIndex, visualRole, reason });
  };

  // 分组：优先用 collector 给的 role/group，缺失时按顺序推断
  const mains = [];
  const details = [];
  const extras = [];
  for (const item of list) {
    const tag = String((item && (item.role || item.group || item.sourceType)) || '').toLowerCase();
    if (/detail|描述|详情/.test(tag)) details.push(item);
    else if (/extra|additional|其他|额外/.test(tag)) extras.push(item);
    else mains.push(item);
  }
  // 一条 role 都没有时，退化：前 6 张算主图，其余算详情
  if (!mains.length && !details.length && !extras.length) {
    list.forEach((item, i) => (i < 6 ? mains : details).push(item));
  }

  mains.forEach((item, i) => push(
    item, 'main', i,
    i === 0 ? 'front' : 'detail',
    i === 0
      ? '主图第 1 张：产品身份与英雄角度'
      : '主图补充：稳定形状、颜色与另一角度',
  ));

  details.forEach((item, i) => push(
    item, 'detail', i,
    i % 3 === 1 ? 'package' : 'detail',
    i % 3 === 1
      ? '详情图：锚定包装或随附物品证据'
      : '详情图：保留真实材质、结构或特写',
  ));

  extras.forEach((item, i) => push(
    item, 'extra', i, 'context', '来源画廊的额外视觉证据',
  ));

  return out.slice(0, REFERENCE_CANDIDATE_LIMIT);
}

/**
 * 选出实际送给生图的参考图。
 *
 * 配额策略（对齐精铺 collectVisionImages）：
 *   精铺是 main_images.slice(0, 2) —— 主图只取 2 张（front + 1 张 detail），
 *   剩余配额给详情图，这样 package（包装证据）才拿得到位置。
 *   第一版没限制主图配额，5 张主图把 5 个位置全占满，
 *   detail 里的 package 角色永远选不到，等于丢掉了包装证据。
 *
 * 顺序：front 必选 → 主图补 1 张 → 详情均匀采样 → 额外图兜底
 */
export function selectReferences(media, limit = SELECTED_REFERENCE_LIMIT) {
  const candidates = classifyReferences(media);
  if (!candidates.length) return [];

  const front = candidates.filter((c) => c.visualRole === 'front');
  const mains = candidates.filter((c) => c.sourceType === 'main' && c.visualRole !== 'front');
  const details = candidates.filter((c) => c.sourceType === 'detail');
  const extras = candidates.filter((c) => c.sourceType === 'extra');

  // 主图最多占 2 个位置（含 front），其余留给详情图
  const MAIN_QUOTA = 2;

  const picked = [];
  const take = (arr, n) => {
    for (const item of arr.slice(0, Math.max(0, n))) picked.push(item);
  };

  take(front, Math.min(1, limit));
  take(mains, Math.min(MAIN_QUOTA - picked.length, limit - picked.length));

  // 详情图按剩余配额均匀采样（保证 package 与首尾 detail 都可能被取到）
  if (picked.length < limit && details.length) {
    const need = limit - picked.length;
    evenSample(details, need).forEach((item) => picked.push(item));
  }

  take(extras, limit - picked.length);

  return picked.slice(0, limit).map((item, i) => ({ ...item, refId: `shared_ref_${i + 1}` }));
}

/**
 * 均匀采样（精铺同款算法）：
 *   取 index = round(i * (len-1) / (n-1))，保证首尾都覆盖到
 */
export function evenSample(arr, n) {
  const list = Array.isArray(arr) ? arr : [];
  if (!list.length || n <= 0) return [];
  if (list.length <= n) return [...list];
  if (n === 1) return [list[0]];
  const idx = new Set();
  for (let i = 0; i < n; i++) idx.add(Math.round(i * (list.length - 1) / (n - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => list[i]);
}

/**
 * 送给视觉/生图的图片集合（若将来保留 vision：一次请求最多 8 张）
 * 参考图 5 张 + SKU 图 3 张 = 8，与精铺上限一致。
 */
export function collectVisionImages(media, skuMedia = [], limit = VISION_IMAGE_LIMIT) {
  const refs = selectReferences(media, Math.min(SELECTED_REFERENCE_LIMIT, limit));
  const skus = (Array.isArray(skuMedia) ? skuMedia : []).slice(0, 3)
    .map((item, i) => ({
      key: String((item && item.key) || `sku_${i}`),
      url: normalizeHttps(item && item.url),
      label: `SKU ${i + 1}`,
    }))
    .filter((x) => x.url);
  const all = [
    ...skus.map((s) => ({ url: s.url, label: s.label })),
    ...refs.map((r) => ({ url: r.url, label: `[${r.visualRole}] ${r.reason}` })),
  ];
  return all.slice(0, limit);
}

export function referenceSelectionInfo() {
  return Object.freeze({
    version: REFERENCE_SELECTION_VERSION,
    selectedLimit: SELECTED_REFERENCE_LIMIT,
    candidateLimit: REFERENCE_CANDIDATE_LIMIT,
    visionImageLimit: VISION_IMAGE_LIMIT,
  });
}

function normalizeHttps(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.startsWith('data:')) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}
