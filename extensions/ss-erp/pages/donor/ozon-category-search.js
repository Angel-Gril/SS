// 本地 Ozon 类目检索 —— 0 网络、0 草稿依赖
//
// 背景：
//   原实现 categoryPicker.loadCatalog → command('EDITOR_CATALOG')
//   → background /editor/catalog → ERP 需要 listingWorkflowId（草稿）
//   → 而建草稿流程第一步又要选类目 → 死锁。
//   且该接口响应体 712KB 会撑爆 chrome.runtime.sendMessage 的回执通道。
//   参考精铺 modules/ozon/api.js：类目树本地缓存 + 纯同步匹配。
//   我们用内置的 Ozon 官方快照（7341 叶子，中文名）直接检索。
//
// 产出结构对齐 category-dialog.js 的 applyCatalog 契约：
//   { catalogRevision, entries[], truncated, total }
//   entries: { categoryId, typeId, label, pathTitles }

import {
  OZON_CATEGORIES,
  OZON_CATEGORY_COUNT,
  categoryPath,
  normalizeQuery,
} from './ozon-categories-data.js';

// Ozon 官方类目快照的稳定标识（用于 applyCatalog 的 revision 比对）。
// 快照内容不变则 revision 不变，切换快照时这里也要改。
export const LOCAL_CATALOG_REVISION = 'ozon-official-snapshot-7341';

// applyCatalog 硬上限
const MAX_ENTRIES = 500;

// 预建索引：把所有字段拼成一条可检索字符串，避免每次搜索重复计算。
let indexed = null;
function ensureIndex() {
  if (indexed) return indexed;
  indexed = new Array(OZON_CATEGORIES.length);
  for (let i = 0; i < OZON_CATEGORIES.length; i++) {
    const row = OZON_CATEGORIES[i];
    // row = [categoryId, typeId, typeName, topName, midName]
    indexed[i] = {
      row,
      typeName: row[2],
      // 检索串：叶子名 + 顶级 + 中级（不含分隔符，避免误匹配）
      haystack: normalizeQuery(row[2] + row[3] + row[4]),
    };
  }
  return indexed;
}

function toEntry(row) {
  return {
    categoryId: row[0],
    typeId: row[1],
    label: row[2],
    // pathTitles 供 UI 显示 "顶级 > 中级"，leafProjection 会把它和 label 拼起来
    pathTitles: [row[3], row[4]].filter(Boolean),
  };
}

/**
 * 本地类目检索。
 * @param {string} query 用户输入；空串时返回按路径排序的前 500 条（浏览模式）
 * @returns {{catalogRevision:string, entries:object[], truncated:boolean, total:number}}
 */
export function searchLocalCategories(query, revisionOverride) {
  const list = ensureIndex();
  const q = normalizeQuery(query);
  // ERP 的 /editor/save 会校验 catalogRevision 与它自己维护的一致，
  // 不一致就返回 409 source_listing_catalog_stale。
  // 所以有 ERP revision 时优先用它，没有才退回本地标识。
  const rev = (typeof revisionOverride === 'string' && revisionOverride.trim())
    ? revisionOverride.trim()
    : LOCAL_CATALOG_REVISION;

  let matched;
  if (!q) {
    // 浏览模式：给推荐的起始集合（按类目树顺序取前 500）
    matched = list.slice(0, MAX_ENTRIES).map(x => x.row);
    return Object.freeze({
      catalogRevision: rev,
      entries: matched.map(toEntry),
      truncated: OZON_CATEGORY_COUNT > MAX_ENTRIES,
      total: OZON_CATEGORY_COUNT,
    });
  }

  // 精确度分层：先找「叶子名包含 query」，再找「全路径包含 query」
  const exact = [];
  const loose = [];
  for (const item of list) {
    if (normalizeQuery(item.typeName).includes(q)) exact.push(item.row);
    else if (item.haystack.includes(q)) loose.push(item.row);
  }

  // 叶子名匹配优先；同类里短名优先（更可能是用户要的主类目）
  exact.sort((a, b) => a[2].length - b[2].length);
  loose.sort((a, b) => a[2].length - b[2].length);

  const all = exact.concat(loose);
  const entries = all.slice(0, MAX_ENTRIES).map(toEntry);

  return Object.freeze({
    catalogRevision: rev,
    entries,
    truncated: all.length > MAX_ENTRIES,
    total: all.length,
  });
}

/** 供调试/测试：确认数据已加载 */
export function localCatalogInfo() {
  return Object.freeze({
    total: OZON_CATEGORY_COUNT,
    revision: LOCAL_CATALOG_REVISION,
    sample: OZON_CATEGORIES.slice(0, 3).map(categoryPath),
  });
}
