// 本地 Ozon 类目：目录树 + 检索 + 自动推荐
//
// 背景：
//   原实现 loadCatalog → command('EDITOR_CATALOG') → ERP 需要 listingWorkflowId
//   （必须已有草稿）→ 而建草稿流程第一步又要选类目 → 死锁；
//   且该接口响应体 712KB，会撑爆 chrome.runtime.sendMessage 的回执通道。
//
//   参考精铺 modules/ozon/api.js（ozon_category_tree_cache_v1 本地缓存 +
//   直连 api-seller.ozon.ru）与 modules/ozon/category-recommender.js（537 行
//   本地同义词匹配），我们改为内置官方快照 + 纯本地计算：
//     1) 7341 个叶子直接内置，0 网络
//     2) 三层层级树从扁平数据现算，左侧目录可用
//     3) 推荐引擎用同义词组 / 后缀 / 受众词 / 噪声词打分，采集完即可自动命中
//
// 产出结构对齐 category-dialog.js 的 applyCatalog 契约：
//   { catalogRevision, entries[], tree[], truncated, treeTruncated, total }

import {
  OZON_CATEGORIES,
  OZON_CATEGORY_COUNT,
  categoryPath,
  normalizeQuery,
} from './ozon-categories-data.js';

export const LOCAL_CATALOG_REVISION = 'ozon-official-snapshot-7341';

const MAX_ENTRIES = 500;
const MAX_TREE_NODES = 5000;

// =====================================================================
// 词库（聚合知了 + 精铺两份参考实现后收敛）
// =====================================================================

// 同义词组：只放**同级泛词**，绝不放具象类目名。
//
// 这是第一版踩过的坑：把「台灯」「夜灯」放进灯组后，商品标题里的「发光」
// 一旦命中该组，整组被加入 token 集合，「台灯」就变成了对「台灯」类目的
// 完全匹配 —— 于是「发光壁饰」被推荐成「台灯」。同理「置物架」「收纳盒」
// 也在组里，被英文片段误触后整组污染。
//
// 规则：组内只能放「同一概念的多种叫法」，具象叶子类目名交给
// item.typeNorm 直接匹配，不通过同义词扩展引入。
const SYNONYM_GROUPS = [
  // 「装饰品 / 摆件 / 挂件」是**泛词**，不是具象叶子类目名，放进组里安全，
  // 而且是必要的桥：1688 的「壁饰」在 Ozon 没有同名叶子，只有经「装饰品」
  // 才能命中「圣诞装饰品」「室内装饰品」「墙壁装饰」等真实类目。
  ['壁饰', '壁挂', '墙饰', '挂饰', '墙挂', '装饰品', '摆件', '挂件', 'wall decor', 'wall hanging', 'панно'],
  // 英文主题词也要收：采集标题常是中英混排，
  // 例如「跨境Bethlehem Star of Faith发光诞生场景壁饰」，
  // 圣诞语义只在 Bethlehem / Star of Faith 里，中文段没有。
  ['圣诞', '圣诞节', 'christmas', 'xmas', 'bethlehem', 'nativity', 'advent', 'santa', 'рождество'],
  ['工艺品', '手工艺', '工艺摆件', 'craft'],
  ['发光', 'led', 'luminous'],
  ['手机壳', '手机套', '保护套', '保护壳', 'iphone case', 'phone case', 'чехол'],
  ['保护膜', '钢化膜', '手机膜', 'screen protector', 'tempered glass'],
  ['数据线', '充电线', '快充线', 'usb cable', 'кабель'],
  ['充电器', '充电头', '电源适配器', 'charger', 'зарядное устройство'],
  ['耳机', 'headphones', 'earphones', 'наушники'],
  ['连衣裙', 'dress', 'платье'],
  ['t恤', 't-shirt', 'футболка'],
  ['鞋', 'sneakers', 'shoes', 'обувь'],
  ['背包', '手提包', '斜挎包', 'backpack', 'сумка'],
  ['宠物用品', 'pet supplies'],
  ['玩具', 'toy', 'игрушка'],
  ['置物架', '收纳架', '调料架', 'kitchen rack', 'органайзер'],
  ['收纳盒', '收纳箱', '储物盒', 'storage box', 'контейнер'],
  ['水杯', '保温杯', 'термос'],
  ['手表', '表带', 'strap', 'часы'],
  ['眼镜', '太阳镜', 'sunglasses', 'очки'],
  ['发夹', '发饰', '头绳', 'hair clip'],
  ['汽车用品', '车载', 'car accessories', 'авто'],
];

// 通用类目后缀（越长越具体，匹配时优先）
const CATEGORY_SUFFIXES = [
  '保护套', '保护壳', '数据线', '充电线', '充电器', '适配器', '置物架', '收纳架',
  '收纳盒', '保温杯', '支架', '洗洁精', '洗碗液', '清洁剂', '按摩器', '仪器',
  '装饰品', '壁饰', '挂饰', '摆件', '挂件', '贴纸', '套装',
  '桶', '缸', '盆', '帽', '架', '盒', '箱', '壳', '套', '膜', '线', '器', '机',
  '灯', '杯', '锅', '鞋', '包', '裙', '裤', '衣', '夹', '垫', '板', '管', '阀',
  '泵', '刷', '瓶', '盘', '碗', '罩', '带', '杆', '椅', '桌', '床', '柜', '袋',
  '车', '表', '仪', '饰', '画', '钟',
].sort((a, b) => b.length - a.length);

// 受众词（不参与主匹配，但可用来区分同类目下的细分）
const AUDIENCE_TERMS = ['儿童', '婴儿', '宝宝', '孩子', '小孩', '成人', '大人', '男士', '女士', '老人', '学生'];

// 营销噪声词（必须剔除，否则会污染匹配）
const NOISE_TERMS = [
  '家用', '全身', '神器', '新款', '爆款', '热卖', '跨境', '专用', '通用',
  '加厚', '厂家', '批发', '包邮', '现货', '外贸', '网红', '同款', '多功能', '创意',
  'ins', '北欧', '日式', '复古', '简约', '高级感', '轻奢',
  // 尺寸/规格词。会被误当成品类：Ozon 的「大号」是乐器 tuba，
  // 不剔除会让「全封闭猫砂盆防外溅大号」把乐器推荐出来。
  '大号', '小号', '中号', '特大', '加大', '超大', '迷你', '加长', '缩短',
  '标准版', '升级版', '豪华版', '旗舰版', '基础款', '高配', '低配',
];

// 功能修饰词（保留，但不作为主匹配依据）
const FUNCTION_TERMS = [
  '无线', '有线', 'usb', '充电', '电动', '自动', '热敷', '手持', '便携', '智能',
  '充电式', '可充电', '清新', '去油', '去渍', '除异味', '异味', '不伤手', '滋润',
];

// 排除模式（这些类目名通常不是用户想要的）
const EXCLUDE_PATTERNS = [/其他/, /其它/, /\bother\b/i, /проч/i, /配件套装/, /附件套装/];

// =====================================================================
// 索引
// =====================================================================

let indexed = null;
function ensureIndex() {
  if (indexed) return indexed;
  indexed = new Array(OZON_CATEGORIES.length);
  for (let i = 0; i < OZON_CATEGORIES.length; i++) {
    const row = OZON_CATEGORIES[i];
    // row = [categoryId, typeId, typeName, topName, midName]
    const typeName = row[2];
    indexed[i] = {
      row,
      typeName,
      topName: row[3],
      midName: row[4],
      // 检索串：叶子名 + 顶级 + 中级
      haystack: normalizeQuery(typeName + row[3] + row[4]),
      // 叶子名单独归一化，用于「叶子优先」打分
      typeNorm: normalizeQuery(typeName),
    };
  }
  return indexed;
}

function toEntry(row) {
  return {
    categoryId: row[0],
    typeId: row[1],
    label: row[2],
    pathTitles: [row[3], row[4]].filter(Boolean),
  };
}

// =====================================================================
// 目录树（从扁平数据现算，供左侧目录使用）
// =====================================================================

let treeCache = null;
function buildTree() {
  if (treeCache) return treeCache;

  const tops = new Map(); // topName -> { categoryId, label, children: Map }
  const list = ensureIndex();

  for (const item of list) {
    const { row, topName, midName } = item;
    const categoryId = row[0];
    const typeId = row[1];
    const typeName = row[2];

    if (!tops.has(topName)) {
      // 顶级节点用该顶级下第一个 categoryId 代表（Ozon 的 categoryId 就是分类层级）
      tops.set(topName, { categoryId, label: topName, children: new Map() });
    }
    const top = tops.get(topName);
    // 顶级节点的 categoryId 应取该顶级下最小的（Ozon 里顶级 categoryId 更小）
    if (categoryId < top.categoryId) top.categoryId = categoryId;

    const midKey = midName || '（未分类）';
    if (!top.children.has(midKey)) {
      top.children.set(midKey, { categoryId, label: midKey, types: [] });
    }
    const mid = top.children.get(midKey);
    if (categoryId < mid.categoryId) mid.categoryId = categoryId;

    mid.types.push({ categoryId, typeId, label: typeName, pathTitles: [topName, midKey] });
  }

  let nodeCount = 0;
  const tree = [];
  for (const top of [...tops.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh'))) {
    const children = [];
    for (const mid of [...top.children.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh'))) {
      if (nodeCount >= MAX_TREE_NODES) break;
      nodeCount++;
      children.push({
        categoryId: mid.categoryId,
        label: mid.label,
        children: [],
        types: mid.types.sort((a, b) => a.label.localeCompare(b.label, 'zh')),
      });
    }
    tree.push({ categoryId: top.categoryId, label: top.label, children, types: [] });
  }

  treeCache = { tree, truncated: nodeCount >= MAX_TREE_NODES };
  return treeCache;
}

// =====================================================================
// 检索
// =====================================================================

export function searchLocalCategories(query, revisionOverride, product) {
  const list = ensureIndex();
  const q = normalizeQuery(query);
  const rev = (typeof revisionOverride === 'string' && revisionOverride.trim())
    ? revisionOverride.trim()
    : LOCAL_CATALOG_REVISION;
  const { tree, truncated: treeTruncated } = buildTree();

  const wrap = (entries, total, truncated, recs) => Object.freeze({
    catalogRevision: rev,
    entries,
    tree,
    treeTruncated,
    truncated,
    total,
    ...(Array.isArray(recs) && recs.length ? { recommendations: recs } : {}),
  });

  if (!q) {
    // 打开类目弹窗时不要求用户先搜：有商品信息就直接给出自动命中的推荐。
    // 这是「采集完自动命中类目」的落点 —— 精铺/知了也是这个行为。
    const recs = product ? recommendCategories(product, 5) : [];
    return wrap([], OZON_CATEGORY_COUNT, false, recs);
  }

  const exact = [];
  const loose = [];
  for (const item of list) {
    if (item.typeNorm.includes(q)) exact.push(item.row);
    else if (item.haystack.includes(q)) loose.push(item.row);
  }
  exact.sort((a, b) => a[2].length - b[2].length);
  loose.sort((a, b) => a[2].length - b[2].length);

  const all = exact.concat(loose);
  const entries = all.slice(0, MAX_ENTRIES).map(toEntry);
  return wrap(entries, all.length, all.length > MAX_ENTRIES);
}

// =====================================================================
// 自动推荐（采集完成后自动命中类目）
// =====================================================================

function stripNoise(text) {
  let out = String(text || '');
  for (const n of NOISE_TERMS) {
    out = out.replace(new RegExp(n, 'gi'), ' ');
  }
  return out;
}

function expandSynonyms(tokenSet) {
  const tokens = new Set(tokenSet);
  const arr = [...tokens];
  // 只做**精确相等**匹配。
  //
  // 第一版用 `t === w || t.includes(w) || w.includes(t)` 双向子串判断，
  // 后果是英文 2 字片段会误触发整组：
  //   标题 "Star" 里的 'ta' → 'storage box'.includes('ta') → 收纳组被加入
  //   标题 "kitchen" 里的 'he' → 'kitchen rack'.includes('he') → 厨房组被加入
  //   标题 "led" 里的 'le' → 'led'.includes('le') → 灯组被加入
  // 于是一个「发光壁饰」被推荐成「台灯/置物架/收纳盒」。
  // 精确相等后，只有整词命中才扩展，不会再被片段污染。
  for (const group of SYNONYM_GROUPS) {
    if (group.some((w) => arr.includes(w))) {
      for (const w of group) tokens.add(w);
    }
  }
  return tokens;
}

function extractTokens(text) {
  const raw = String(text == null ? '' : text);
  const norm = normalizeQuery(raw);
  const tokens = new Set();
  // 后缀优先（更具体，且只加真正出现在文本里的）
  for (const suf of CATEGORY_SUFFIXES) {
    if (norm.includes(suf)) tokens.add(suf);
  }
  // 中文：只从**连续中文段**提取 2 字片段。
  // 之前对整串无差别切片，英文商标（Star / Bethlehem）会产出 'ta' 'he' 'le'
  // 这类片段，进而误触英文同义词组（见 expandSynonyms 注释）。
  const segments = norm.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of segments) {
    for (let i = 0; i + 2 <= seg.length; i++) tokens.add(seg.slice(i, i + 2));
  }
  // 英文：从**原始文本**取整词，不能用 norm。
  // normalizeQuery 会删掉空格，把 "Bethlehem Star of Faith" 压成
  // "bethlehemstaroffaith"，整词匹配就永远失败。
  for (const word of raw.toLowerCase().match(/[a-z]{3,}/g) || []) {
    tokens.add(word);
  }
  return tokens;
}

/**
 * 根据来源商品给 Ozon 类目打分。
 *
 * 关键设计（第一版有 bug，这里修正）：
 *   1) 商品标题与 1688 来源类目**分权重**。来源类目是别家体系，
 *      权重 0.45，不能压过标题。第一版同权重时「其他材质工艺品」里的
 *      「工艺品」会命中「手工艺品填充剂」并靠四个子串累加到 166 分，
 *      盖过真正该选的「圣诞装饰品」。
 *   2) 同一来源内只取**最高命中**，不累加。否则 2 字泛词互相堆叠，
 *      类目名越长越容易命中，形成长类目偏好。
 *   3) 2 字泛词低权重、3 字中、4 字以上高。
 *
 * 输入 product 形如采集结果：
 *   { title, sourceCategory, attributes?: [{name, value}] }
 * 输出按分数降序的候选，供工作台自动预选 Top-1。
 */
export function recommendCategories(product, limit = 5) {
  const list = ensureIndex();
  const title = String(product?.title || '');
  const sourceCategory = String(product?.sourceCategory || '');
  const attrText = Array.isArray(product?.attributes)
    ? product.attributes.map((a) => `${a.name || ''} ${a.value || ''}`).join(' ')
    : '';

  const titleTokens = expandSynonyms(extractTokens(stripNoise(title)));
  const categoryTokens = expandSynonyms(extractTokens(stripNoise(sourceCategory)));
  const attrTokens = expandSynonyms(extractTokens(stripNoise(attrText)));
  if (!titleTokens.size && !categoryTokens.size && !attrTokens.size) return [];

  // 每个来源取「最高命中 + 次高 30%」。
  //
  // 只取最高会把多词命中的优势丢掉：「毛绒玩具」同时被 token「毛绒」和
  // 「玩具」命中，却只按 6 分算，输给只命中「玩具」的「玩具书」。
  // 次高给 30% 既能体现契合度，又不会让长类目靠堆叠子串反超。
  function bestHit(item, tokens, weight) {
    let best = 0;
    let second = 0;
    let bestWord = '';
    for (const t of tokens) {
      if (t.length < 2) continue;
      let w = 0;
      if (item.typeNorm === t) w = 60;
      else if (item.typeNorm.includes(t)) w = t.length <= 2 ? 6 : t.length === 3 ? 12 : 18;
      else continue;
      if (w > best) { second = best; best = w; bestWord = t; }
      else if (w > second) second = w;
    }
    return { score: (best + second * 0.3) * weight, word: bestWord };
  }

  const scored = [];
  for (const item of list) {
    if (EXCLUDE_PATTERNS.some((re) => re.test(item.typeName))) continue;

    let score = 0;
    const reasons = [];

    const fromTitle = bestHit(item, titleTokens, 1.0);
    if (fromTitle.score > 0) { score += fromTitle.score; reasons.push(`标题「${fromTitle.word}」`); }

    const fromCategory = bestHit(item, categoryTokens, 0.45);
    if (fromCategory.score > 0) { score += fromCategory.score; reasons.push(`来源类目「${fromCategory.word}」`); }

    const fromAttr = bestHit(item, attrTokens, 0.3);
    if (fromAttr.score > 0) { score += fromAttr.score; }

    // 类目后缀命中：只在标题里也出现该后缀时才加分
    for (const suf of CATEGORY_SUFFIXES) {
      if (item.typeNorm.endsWith(suf) && titleTokens.has(suf)) {
        score += 10;
        reasons.push(`后缀「${suf}」`);
        break;
      }
    }

    // 受众词（标题里出现且类目里也有）
    for (const a of AUDIENCE_TERMS) {
      if (title.includes(a) && item.haystack.includes(a)) { score += 6; reasons.push(`受众「${a}」`); }
    }

    // 惩罚：类目名过长通常是细分过度，且容易被泛词蹭到
    if (item.typeNorm.length > 12) score -= 4;

    if (score > 0) {
      scored.push({
        categoryId: item.row[0],
        typeId: item.row[1],
        label: item.typeName,
        pathTitles: [item.topName, item.midName].filter(Boolean),
        pathText: categoryPath(item.row),
        score: Math.round(score),
        match: score >= 25 ? 'recommended' : score >= 12 ? 'optional' : 'risky',
        reasons: [...new Set(reasons)].slice(0, 4),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
  return scored.slice(0, limit);
}

export function localCatalogInfo() {
  const { tree, truncated } = buildTree();
  return Object.freeze({
    total: OZON_CATEGORY_COUNT,
    revision: LOCAL_CATALOG_REVISION,
    topNodes: tree.length,
    treeTruncated: truncated,
    sample: OZON_CATEGORIES.slice(0, 3).map(categoryPath),
  });
}
