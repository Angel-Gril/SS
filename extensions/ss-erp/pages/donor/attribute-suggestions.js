import { planPrefill, planVariantPrefill, pickDictionaryValue } from '../../shared/ozon/attribute-prefill.js';

/**
 * 用直连把 ERP 报的 unresolvedValues 解析成官方 dictionary_value_id。
 *
 * ERP 的 attribute-suggestions 只做文本匹配，遇到 STRICT_DICTIONARY 字段就
 * 把值原样丢进 unresolvedValues，理由是「必须由服务器解析」——而它自己的
 * 解析器（EDITOR_DICTIONARY）在草稿刚建/刚改类目时会挂起，所以永远解析不了。
 *
 * Ozon 的 /v1/description-category/attribute/values 就是权威字典，直连即可。
 * 解析成功的值补进 row.dictionaryValueIds，并把该值从 unresolvedValues 移除，
 * 界面上的警告随之消失，勾选框也能真正勾上。
 */

/**
 * 把我们自己的规则预填结果，转成 ERP suggestions 的同形状，合并进同一个弹窗。
 *
 * 2026-11 实测：ERP 的 blockedSuggestions 是 {attributeName, message}，没有值、
 * 没有候选 —— 它在说「这个字段我完全没东西可推」，不是「我解析失败」。
 * 受影响的正是服装类目的必填项：Бренд / Сезон / Пол / Российский размер。
 *
 * 而这些恰好都能由规则给出来：
 *   brand   pinned dictionary_value_id 126745801（Нет бренда）
 *   Пол     标题「女装」→ женщины
 *   size    SKU 规格 "30541-粉色 / S" → S → 查 4295 字典
 *   color   SKU 规格 → 粉色 → 查 10096 字典
 *   型号     货号（保证同款合并）
 *
 * 所以两个功能是互补的：ERP 负责「从商品文本推材质/里料/生产商尺码」，
 * 规则负责「必填但 ERP 推不出的」。合并方式是把两者放进同一个弹窗，
 * 而不是删掉任一边。
 */
// 2026-11（方案 B）：规则建议先算、再缓存 —— 不要等到 ERP 往返之后才去问 SW。
//
// 症状：点「自动匹配属性」后弹窗只有 ERP 给的 3 组，规则算出的必填项一组都没进来，
// 诊断是 `schema failed: The message port closed before a response was received.`。
// 同一条消息在同一个 iframe 里手动发，23ms 成功 —— 不是权限、不是 wiring、不是
// schema 问题，是时序：弹窗在 ERP 的 ATTRIBUTE_SUGGESTIONS 往返之后立刻发直连读，
// 而 SW 刚被那次请求唤醒，Chrome 在应答第二条消息前丢了端口（加重试也无效）。
//
// 规则计划的输入（category + SKU 规格 + 标题）在弹窗打开前就全部已知，所以：
//   1) 弹窗先算规则建议（直连），算完再发 ERP 请求 —— 直连落在 SW 醒着的时候；
//   2) 结果按「类目:类型 + 商品指纹」写进 chrome.storage.session，TTL 与 schema
//      缓存一致（6 小时）；同类的第二个商品、反复点开弹窗都不再重算。
const RULE_CACHE_PREFIX = 'ss-erp:rule-suggestions:v1:';
const RULE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 规则计划只依赖这些输入；指纹一变（换商品 / 改 SKU），缓存立即作废。 */
function ruleInputFingerprint(product) {
  const p = product || {};
  const skus = Array.isArray(p.skus) ? p.skus : [];
  const seed = [
    String(p.title || ''),
    String(p.offerId || p.sourceProductId || ''),
    String(p.typeId || ''),
    ...skus.map((sku) => String((sku && sku.key) || '') + '=' + String((sku && sku.label) || '')),
  ].join('\u0001');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = ((h1 ^ code) * 0x01000193) >>> 0;
    h2 = ((h2 ^ (code + i)) * 0x85ebca6b) >>> 0;
  }
  const part = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
  return part(h1) + part(h2);
}

function ruleCacheStore() {
  try {
    const session = globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.session;
    return session && typeof session.get === 'function' && typeof session.set === 'function' ? session : null;
  } catch { return null; }
}

// 同一类目的 schema 只读一次；resolveUnresolved 复用它，不再在竞态窗口里多发消息。
const schemaMemo = new Map();

async function readCachedRuleSuggestions(cid, tid, fingerprint) {
  const store = ruleCacheStore();
  if (!store) return null;
  const key = RULE_CACHE_PREFIX + cid + ':' + tid;
  try {
    const got = await store.get(key);
    const hit = got && got[key];
    if (!hit || !Array.isArray(hit.suggestions) || !hit.suggestions.length) return null;
    if (Date.now() - Number(hit.at || 0) >= RULE_CACHE_TTL_MS) return null;
    if (String(hit.fingerprint || '') !== fingerprint) return null;
    return hit.suggestions;
  } catch { return null; }
}

async function writeCachedRuleSuggestions(cid, tid, fingerprint, suggestions) {
  const store = ruleCacheStore();
  if (!store) return;
  const key = RULE_CACHE_PREFIX + cid + ':' + tid;
  try {
    await store.set({ [key]: { at: Date.now(), fingerprint, suggestions } });
  } catch { /* 配额/权限问题忽略：缓存只是加速，不是正确性依赖 */ }
}

// schema 已经在 SW 侧按「类目:类型」缓存 6 小时（shared/ozon/direct-ozon-client.js）。
// 那个缓存本身就在 chrome.storage.session，扩展页可以直接读 —— 于是这条路完全不
// 经过 service worker，也就不会被「SW 冷启动、端口先被丢」打到。只有缓存缺失时
// 才回落直连（那时 SW 需要被叫醒，见 precision-workbench.js 的 directSend 退避）。
const SCHEMA_CACHE_PREFIX = 'ss-erp:direct:schema:';
const SCHEMA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function readSchemaFields(cid, tid, direct) {
  const store = ruleCacheStore();
  if (store) {
    try {
      const key = SCHEMA_CACHE_PREFIX + cid + ':' + tid;
      const got = await store.get(key);
      const hit = got && got[key];
      if (hit && Array.isArray(hit.fields) && hit.fields.length
        && Date.now() - Number(hit.at || 0) < SCHEMA_CACHE_TTL_MS) return hit.fields;
    } catch { /* 读不到就走直连 */ }
  }
  try {
    const schema = await direct('ss-erp:direct-ozon-attributes', { categoryId: cid, typeId: tid });
    return (schema && schema.fields) || [];
  } catch (error) {
    // 失败要说出来，不要像上一轮那样吞掉：这正是「规则一组都没进来」查了一夜的原因。
    throw Error('官方属性读取失败：' + String((error && error.message) || error).slice(0, 120));
  }
}

/** 真正干活的版本：读 schema、生成计划、解析字典，返回 ERP 同形状的候选。 */
async function computeRuleSuggestions({ cid, tid, direct, product }) {
  if (typeof direct !== 'function') throw Error('直连通道不可用');

  const fields = await readSchemaFields(cid, tid, direct);
  if (!fields.length) throw Error('官方属性为空');
  schemaMemo.set(cid + ':' + tid, fields);

  const plan = planPrefill(product || {}, fields).concat(planVariantPrefill(product || {}, fields));
  if (!plan.length) throw Error(`规则没有命中可填字段（${fields.length} 个官方字段）`);

  // fieldId → 已解析的 { attributeName, rows }
  const byAttribute = new Map();
  // 同一次计算内复用字典结果（变体计划按 SKU 展开，同一属性会被查很多次）
  const dictionaryMemo = new Map();
  for (const item of plan) {
    const field = fields.find((f) => Number(f.attributeId) === Number(item.attributeId));
    if (!field) continue;
    const name = String(field.name || item.name || '');
    if (!name) continue;

    let entry = byAttribute.get(Number(item.attributeId));
    if (!entry) {
      entry = { attributeId: Number(item.attributeId), attributeName: name, rows: [] };
      byAttribute.set(Number(item.attributeId), entry);
    }

    if (item.kind === 'text') {
      entry.rows.push({
        skuKey: item.skuKey || null,
        value: String(item.value || ''),
        evidence: [{ path: '规则', value: item.reason || '本地规则' }],
        unresolvedValues: [],
        dictionaryValueIds: [],
      });
      continue;
    }

    // 字典字段：直连查，用 pickDictionaryValue 的严格策略（歧义返回 null）。
    // 2026-11 实测（连衣裙）：ZH_HANS 字典返回中文值（中国 / 女士 / 粉红色 / 44），
    // 而 Ozon 的 `value` 参数只是模糊搜索、排序完全不可控（查「粉色」第一条是
    // 白色，抄近路就会填错）。所以先整表取（≤1000）在本地精确匹配，再逐候选词兜底。
    const queries = (Array.isArray(item.queries) && item.queries.length ? item.queries : [item.query || ''])
      .map((q) => String(q == null ? '' : q).trim())
      .filter(Boolean);
    // 「类型」这类字段没有查询词，靠 pick='single' / typeId 反查 ——
    // 空查询词必须保留一个位置，否则整段匹配循环一次都不跑。
    if (!queries.length) queries.push('');
    const fetchValues = async (query, limit) => {
      // 100 个 SKU 会生成 200 条变体计划，而每个 SKU 的颜色/尺码用的是同一份
      // 字典 —— 不去重就是 200 次整表请求，直接撞 Ozon 的 80 次/分钟限流，
      // 弹窗会一直转圈。按「属性 + 查询词 + 上限」记一份就够。
      const memoKey = item.attributeId + '|' + query + '|' + limit;
      if (dictionaryMemo.has(memoKey)) return dictionaryMemo.get(memoKey);
      let result = { values: [], error: '' };
      try {
        const found = await direct('ss-erp:direct-ozon-attribute-values', {
          categoryId: cid, typeId: tid, attributeId: item.attributeId, query, limit,
        });
        result = { values: (found && found.values) || [], error: '' };
      } catch (error) {
        // 直连失败要留证据：是端口丢了、还是参数被拒，界面必须能区分
        result = { values: [], error: String((error && error.message) || error).slice(0, 140) };
      }
      dictionaryMemo.set(memoKey, result);
      return result;
    };
    const pickExtra = {
      id: item.fallbackValueId,
      typeId: item.attributeId === 8229 ? tid : undefined,
    };
    let values = [];
    let chosen = null;
    let dictionaryError = '';
    if (item.fullScan !== false) {
      const scan = await fetchValues('', 1000);
      values = scan.values;
      dictionaryError = scan.error;
      for (const q of queries) {
        chosen = pickDictionaryValue(values, item.pick, q, pickExtra);
        if (chosen) break;
      }
    }
    if (!chosen) {
      for (const q of queries) {
        const hit = await fetchValues(q, 100);
        values = hit.values;
        if (hit.error) dictionaryError = hit.error;
        chosen = pickDictionaryValue(values, item.pick, q, pickExtra);
        if (chosen) break;
      }
    }
    // 兜底 id 是「实测确认过」的官方值（例如品牌「Нет бренда」= 126745801，
    // Ozon 的 value 参数对它无效，字典前 100 条里也没有）。有兜底 id 就是有答案，
    // 不能因为搜索没命中就把它标成 unresolved —— 否则这一行会被应用环节跳过，
    // 必填品牌又会空着上架。
    const fallbackId = Number(item.fallbackValueId);
    const hasFallback = Number.isSafeInteger(fallbackId) && fallbackId > 0;
    const pinned = chosen ? null : (hasFallback ? values.find((v) => Number(v.id) === fallbackId) : null);
    entry.rows.push({
      skuKey: item.skuKey || null,
      value: chosen
        ? String(chosen.value || '')
        : String(item.fallbackValue || (pinned && pinned.value) || item.query || ''),
      evidence: [{ path: '规则', value: item.reason || '本地规则' }],
      unresolvedValues: chosen || hasFallback ? [] : [String(item.query || '')],
      dictionaryValueIds: chosen ? [chosen.id] : (hasFallback ? [fallbackId] : []),
      // 候选数写在界面上：「未匹配」是字典里真没有，还是请求根本没回来，
      // 一眼能分清 —— 上一轮就是在这上面耗了一夜。
      dictionaryCandidates: values.length,
      dictionaryError,
    });
  }

  return Array.from(byAttribute.values())
    .filter((entry) => entry.rows.length)
    .map((entry, index) => ({
      candidateId: 'rule:' + entry.attributeId,
      attributeName: entry.attributeName,
      attributeId: entry.attributeId,
      rows: entry.rows,
      source: 'rule',
      _order: index,
    }));
}

/**
 * 有缓存读缓存，没缓存才算 —— 这条路径永远在 ERP 请求之前跑（见 open()）。
 */
async function buildRuleSuggestions(ctx) {
  const { categoryId, typeId, direct, product } = ctx || {};
  const cid = Number(categoryId), tid = Number(typeId);
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(tid) || cid <= 0 || tid <= 0) {
    throw Error('没有官方类目/类型 ID，无法套用规则');
  }
  const fingerprint = ruleInputFingerprint(product);
  const cached = await readCachedRuleSuggestions(cid, tid, fingerprint);
  if (cached) return cached;
  const suggestions = await computeRuleSuggestions({ cid, tid, direct, product });
  // 只有「每一行都落到官方值」才写缓存：留着半成品缓存会让下一次打开看起来
  // 很快，但实际上少了几个必填值 —— 快不是目的，填进去才是。
  const complete = suggestions.length && suggestions.every((candidate) =>
    (candidate.rows || []).every((row) => !Array.isArray(row.unresolvedValues) || !row.unresolvedValues.length));
  if (complete) await writeCachedRuleSuggestions(cid, tid, fingerprint, suggestions);
  return suggestions;
}

/**
 * 把一条规则候选转成 ERP「手动属性变更」的形状。
 *
 * 为什么不能走 ATTRIBUTE_SUGGESTIONS 的 candidates：那套引用是服务端签发的冻结
 * 快照（candidateId + 64 位 candidateHash + schemaRevision 三重校验），本地规则
 * 算出来的候选根本不在服务端的 suggestions 表里，提交必然被 400 拒。
 * 而「手动编辑属性」通道只要求 {attributeId, skuKey?, action, value,
 * dictionaryValueIds, evidence}，服务端会用官方字典核验我们带过去的 id ——
 * 这些 id 恰好就是 Ozon 直连字典返回的权威值。
 */
function ruleChangesFor(candidate, workspaceFields) {
  const changes = [];
  const attributeId = Number(candidate && candidate.attributeId);
  if (!Number.isSafeInteger(attributeId) || attributeId <= 0) return changes;
  // 可写性以**服务端 workspace 的 ownership / editorMode** 为准：
  // 直连 Ozon 的 schema 没有这个信息（那边一律给 SKU）。实测「合并至一张卡片」
  // (8292) 在服务端是 SYSTEM，提交它会被 422 挡回
  // 「... is managed by the system」，而 ERP 自己会关联该字段。
  const field = workspaceFields && workspaceFields.get(attributeId);
  if (field && (field.ownership === 'SYSTEM' || field.ownership === 'MEDIA'
    || field.editorMode === 'READ_ONLY' || field.editorMode === 'MEDIA_WORKBENCH')) return changes;
  const skuOwned = !field || field.ownership === 'SKU';
  for (const row of (candidate && candidate.rows) || []) {
    if (!row) continue;
    // 没解析出官方选项的行不提交 —— 填错比不填危险（见 pickDictionaryValue）
    if (Array.isArray(row.unresolvedValues) && row.unresolvedValues.length) continue;
    // SKU 专属字段（颜色/尺码）只接受带 skuKey 的行；类目级那条「默认值」
    // 由每个 SKU 各自的行覆盖，单独提交会被判「requires a selected SKU key」。
    if (skuOwned && !row.skuKey) continue;
    const value = row.value;
    if (value === undefined || value === null || value === '') continue;
    const ids = Array.isArray(row.dictionaryValueIds)
      ? row.dictionaryValueIds.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 100)
      : [];
    // 服务端的 cardinality 用 SINGLE / MULTI（直连 schema 写 MULTIPLE）：
    // 多选字段必须是数组，传标量会被判「dictionary selections do not match its values」。
    const multiple = field && (field.cardinality === 'MULTI' || field.cardinality === 'MULTIPLE');
    const shaped = multiple && !Array.isArray(value) ? [value] : value;
    const evidence = [];
    for (const item of Array.isArray(row.evidence) ? row.evidence : []) {
      const text = String((item && item.value) || '').trim();
      if (text) evidence.push(('规则预填：' + text).slice(0, 500));
    }
    if (!evidence.length) evidence.push('规则预填：本地规则');
    if (!skuOwned) {
      // 产品级字段只提交一条（SKU 行只是同一值的展开）
      if (changes.length) break;
      changes.push({
        attributeId,
        action: 'SET',
        value: shaped,
        ...(ids.length ? { dictionaryValueIds: ids } : {}),
        evidence: evidence.slice(0, 20),
      });
      continue;
    }
    changes.push({
      attributeId,
      ...(row.skuKey ? { skuKey: String(row.skuKey) } : {}),
      action: 'SET',
      value: shaped,
      ...(ids.length ? { dictionaryValueIds: ids } : {}),
      evidence: evidence.slice(0, 20),
    });
  }
  return changes;
}

/**
 * 用直连把 ERP 报的 unresolvedValues 解析成官方 dictionary_value_id。
 *
 * ERP 的 attribute-suggestions 只做文本匹配，遇到 STRICT_DICTIONARY 字段就
 * 把值原样丢进 unresolvedValues，理由是「必须由服务器解析」——而它自己的
 * 解析器（EDITOR_DICTIONARY）在草稿刚建/刚改类目时会挂起，所以永远解析不了。
 *
 * Ozon 的 /v1/description-category/attribute/values 就是权威字典，直连即可。
 * 解析成功的值补进 row.dictionaryValueIds，并把该值从 unresolvedValues 移除，
 * 界面上的警告随之消失，勾选框也能真正勾上。
 */
async function resolveUnresolved(suggestions, ctx) {
  if (!suggestions || !Array.isArray(suggestions.suggestions)) return;
  const { categoryId, typeId, send, direct } = ctx || {};
  const cid = Number(categoryId), tid = Number(typeId);
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(tid) || cid <= 0 || tid <= 0) return;

  // attributeName → attributeId：ERP 的 candidate 只给名字，没有 id
  let nameToId = new Map();
  try {
    // 必须走 directSend（chrome.runtime.sendMessage 直发 SW）。
    // 注入的 send 是 workbench 的 command → postMessage → bridge，
    // 而 bridge 的 waitForAuthority 会挂起所有非 mutation 命令，
    // 所以直连消息用 command 发出去也是永远不回的。
    // schema 复用规则侧刚读过的那份（同一类目），避免再往 SW 发一条消息 ——
    // 这里已经在 ERP 往返之后的竞态窗口里，消息越少越好。
    const memoKey = cid + ':' + tid;
    let fields = schemaMemo.get(memoKey) || [];
    if (!fields.length) {
      const schema = await direct('ss-erp:direct-ozon-attributes', { categoryId: cid, typeId: tid });
      fields = (schema && schema.fields) || [];
      if (fields.length) schemaMemo.set(memoKey, fields);
    }
    for (const f of fields) nameToId.set(String(f.name || '').trim(), Number(f.attributeId));
  } catch (_e) { return; }

  for (const candidate of suggestions.suggestions) {
    const attributeId = nameToId.get(String(candidate.attributeName || '').trim());
    if (!Number.isSafeInteger(attributeId)) continue;
    for (const row of (candidate.rows || [])) {
      if (!row || !Array.isArray(row.unresolvedValues) || !row.unresolvedValues.length) continue;
      const stillUnresolved = [];
      row.dictionaryValueIds = Array.isArray(row.dictionaryValueIds) ? row.dictionaryValueIds : [];
      for (const raw of row.unresolvedValues) {
        const query = String(raw == null ? '' : raw).trim();
        if (!query) continue;
        try {
          const found = await direct('ss-erp:direct-ozon-attribute-values', {
            categoryId: cid, typeId: tid, attributeId, query, limit: 50,
          });
          const values = (found && found.values) || [];
          // 复用主预填的匹配策略：唯一命中才接受，有歧义就不填
          const picked = pickBest(values, query);
          if (picked && !row.dictionaryValueIds.includes(picked.id)) {
            row.dictionaryValueIds.push(picked.id);
            row.resolvedByDirect = true;
          } else {
            stillUnresolved.push(raw);
          }
        } catch (_e) { stillUnresolved.push(raw); }
      }
      row.unresolvedValues = stillUnresolved;
    }
  }
}

/** 与 attribute-prefill 的 pickDictionaryValue 同策略：精确 > 词干 > 唯一包含 */
function pickBest(values, query) {
  const list = Array.isArray(values) ? values.filter(v => v && Number.isSafeInteger(v.id)) : [];
  if (!list.length) return null;
  const want = String(query).toLowerCase().replace(/\s+/g, ' ').trim();
  const eq = list.filter(v => String(v.value).toLowerCase().trim() === want);
  if (eq.length === 1) return eq[0];
  const stem = (s) => String(s).toLowerCase().replace(/[^а-яёa-z0-9]/gi, '')
    .replace(/(ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ую|юю|а|я|о|е|ы|и|у|ю)$/u, '').slice(0, 12);
  const ws = stem(want);
  if (ws.length >= 3) {
    const byStem = list.filter(v => stem(v.value) === ws);
    if (byStem.length === 1) return byStem[0];
    if (byStem.length > 1) return byStem.slice().sort((a,b) => Math.abs(String(a.value).length-want.length) - Math.abs(String(b.value).length-want.length))[0];
  }
  const contains = list.filter(v => String(v.value).toLowerCase().includes(want) || (want.length >= 4 && want.includes(String(v.value).toLowerCase())));
  return contains.length === 1 ? contains[0] : null;
}

export function createAttributeSuggestions({
  root,
  command,
  getBinding,
  getEditor,
  // 2026-11：类目 id 直接读原始 editor.category（getEditor() 经 binding 校验，
  // 草稿刚建/刚刷新时返回 null，导致直连 schema 拿不到 id 而早退）。
  getCategory,
  getProduct,
  // 直连消息必须走 chrome.runtime.sendMessage：command 的投递链是
  // postMessage → content/donor-workbench-bridge.js → SW，而 bridge 的
  // waitForAuthority 会挂起所有非 mutation 命令，直连消息发出去永远不回。
  directSend,
  getBusy,
  hasUnsavedAttributes = () => false,
  getSkuLabel,
  onApply,
  // 规则候选的写入通道：ERP 的 ATTRIBUTE_SUGGESTIONS 只认服务端签发的冻结引用
  // （candidateHash），本地规则算不出这个哈希，所以规则值改走「手动编辑属性」——
  // 由调用方以 ATTRIBUTES 动作提交 {schemaRevision, changes}。
  onApplyRules,
  onSaved,
  onManual,
  report,
}) {
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const modal = make('div', 'settings-modal');
  modal.id = 'precision-attribute-suggestions-modal';
  modal.hidden = true;
  const dialog = make('div', 'settings-dialog precision-attribute-suggestions-dialog'),
    head = make('div', 'settings-head');
  head.append(make('div', 'settings-title', '自动匹配商品属性'));
  const close = make('button', 'ghost', '关闭');
  close.id = 'precision-attribute-suggestions-close';
  close.addEventListener('click', () => {
    if (close.disabled) return;
    epoch += 1;
    modal.hidden = true;
    data = null;
  });
  head.append(close);
  const body = make('div', 'settings-body'),
    note = make(
      'p',
      '',
      '依据当前采集资料和官方选项匹配。检查各 SKU 的值与来源后，确认应用；未匹配的属性仍可手工补充。',
    ),
    list = make('div'),
    state = make('p');
  state.id = 'precision-attribute-suggestions-state';
  state.setAttribute('role', 'status');
  const apply = make('button', 'primary', '确认应用选中属性');
  apply.id = 'precision-attribute-suggestions-apply';
  const foot = make('div', 'settings-foot');
  const manual = make('button', 'ghost', '改为手工补充');
  manual.id = 'precision-attribute-suggestions-manual';
  manual.hidden = typeof onManual !== 'function';
  foot.append(manual, apply);
  body.append(note, list, state);
  dialog.append(head, body, foot);
  modal.append(dialog);
  root.append(modal);
  let token = '',
    data = null,
    opening = false,
    applying = false,
    epoch = 0;
  const context = () => {
    try {
      return JSON.stringify(getBinding());
    } catch {
      return '';
    }
  };
  const identity = (binding) => {
    try {
      const value = typeof binding === 'string' ? JSON.parse(binding) : binding;
      return JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map((key) => value[key]));
    } catch { return ''; }
  };
  const unsavedMessage = '有商品属性编辑尚未保存，请先保存后再自动匹配。';
  function invalidate() {
    epoch += 1;
    modal.hidden = true;
    data = null;
    opening = false;
    state.textContent = '草稿或官方属性已变化，请重新读取自动匹配。';
    report(new Error(state.textContent));
  }
  const selected = () =>
    [...list.querySelectorAll('input:checked')].map(
      (input) => data.suggestions[Number(input.value)],
    );
  function sync() {
    if (modal.hidden) return;
    const stale = applying ? identity(context()) !== identity(token) : context() !== token;
    if (stale) { invalidate(); return; }
    close.disabled = applying;
    apply.disabled = getBusy() || hasUnsavedAttributes() || opening || applying || !data || !selected().length;
    manual.disabled = getBusy() || hasUnsavedAttributes() || opening || applying || !data;
    if (hasUnsavedAttributes()) state.textContent = unsavedMessage;
  }
  manual.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || manual.disabled || modal.hidden || !data || typeof onManual !== 'function') return;
    if (context() !== token || hasUnsavedAttributes() || getBusy() || opening || applying) { sync(); return; }
    modal.hidden = true;
    epoch += 1;
    data = null;
    onManual();
  });
  apply.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || apply.disabled) return;
    const attempt = epoch, basis = token;
    applying = true;
    sync();
    void Promise.resolve()
      .then(async () => {
        if (attempt !== epoch || context() !== basis) throw Error('草稿已变化，请重新读取候选');
        if (hasUnsavedAttributes()) throw Error(unsavedMessage);
        if (getBusy()) throw Error('请等待当前操作完成后再应用属性');
        const chosen = selected();
        const ruleCandidates = chosen.filter((candidate) => candidate
          && (candidate.source === 'rule' || String(candidate.candidateId || '').startsWith('rule:')));
        const erpCandidates = chosen.filter((candidate) => !ruleCandidates.includes(candidate));
        const changes = [];
        const workspaceFields = new Map(
          ((data.workspace && data.workspace.fields) || []).map((field) => [Number(field.attributeId), field]),
        );
        const skippedRuleNames = [];
        for (const candidate of ruleCandidates) {
          const rows = ruleChangesFor(candidate, workspaceFields);
          if (!rows.length) {
            // 系统托管/只读字段：ERP 自己会关联，跳过而不是整单失败
            skippedRuleNames.push(candidate.attributeName);
            continue;
          }
          changes.push(...rows);
        }
        if (!changes.length && !erpCandidates.length) {
          throw Error(skippedRuleNames.length
            ? `选中的规则属性由系统托管，无需手工写入：${skippedRuleNames.join(' / ')}`
            : '请选择要应用的属性');
        }
        const schemaRevision = data.workspace && data.workspace.schemaRevision;
        // 规则候选先写：走手动属性通道（服务端用官方字典核验我们带的 id）。
        // ERP 的冻结引用应用会回读整份编辑器并覆盖本地状态，放在最后顺序更稳。
        if (changes.length) {
          if (typeof onApplyRules !== 'function') throw Error('当前工作台不支持写入规则属性，请刷新后重试');
          if (!/^[a-f0-9]{64}$/u.test(String(schemaRevision || ''))) {
            throw Error('官方属性版本缺失，请重新读取候选');
          }
          await onApplyRules({ schemaRevision, changes });
        }
        if (erpCandidates.length) {
          await onApply({
            schemaRevision,
            candidates: erpCandidates.map(
              ({ attributeId, candidateId, candidateHash, schemaRevision: candidateRevision }) => ({
                attributeId,
                candidateId,
                candidateHash,
                schemaRevision: candidateRevision,
              }),
            ),
          });
        }
        if (attempt !== epoch || identity(context()) !== identity(basis)) return;
        modal.hidden = true;
        onSaved?.();
      })
      .catch((error) => {
        if (attempt !== epoch) return;
        state.textContent = error.message;
        report(error);
      })
      .finally(() => {
        applying = false;
        close.disabled = false;
        if (attempt === epoch) sync();
      });
  });
  return {
    sync,
    async open() {
      if (hasUnsavedAttributes()) throw Error(unsavedMessage);
      if (getBusy() || applying) throw Error('请等待当前操作完成后再自动匹配');
      const basis = context();
      if (!basis) throw Error('请先创建草稿并确认官方类目');
      const attempt = ++epoch;
      token = basis;
      modal.hidden = false;
      opening = true;
      data = null;
      list.replaceChildren();
      state.textContent = '正在匹配采集资料与官方属性…';
      sync();
      try {
        // 2026-11（方案 B）：类目 id 不能从 currentEditorForPublish() 取 —— 它要求
        // binding 完全相等，草稿刚建/刚刷新时返回 null。getCategory 直接读编辑器
        // 原始 category，不做 binding 校验。
        const category = (typeof getCategory === 'function' ? getCategory() : null)
          || (typeof getEditor === 'function' ? ((getEditor() || {}).category) : null)
          || null;
        const direct = typeof directSend === 'function' ? directSend : command;

        // ★ 顺序是修复的核心：规则建议先算完，再发 ERP 请求。
        // 反过来（ERP 往返之后再直连读）会撞上 SW 刚被唤醒、端口在第二条消息应答前
        // 被 Chrome 丢掉的窗口，而且加重试也救不回来。规则输入在弹窗打开前就全部
        // 已知，没有理由排到 ERP 后面；结果另有 6 小时会话缓存（见 buildRuleSuggestions）。
        // 规则侧彻底失败也不阻塞 ERP 结果。
        let ruleSuggestions = [];
        let ruleError = '';
        try {
          ruleSuggestions = await buildRuleSuggestions({
            categoryId: category && category.categoryId,
            typeId: category && category.typeId,
            direct,
            product: typeof getProduct === 'function' ? getProduct() : null,
          });
        } catch (error) {
          ruleSuggestions = [];
          ruleError = String((error && error.message) || error).slice(0, 160);
        }
        if (attempt !== epoch || modal.hidden) return;

        const binding = getBinding(),
          reply = await command('EDITOR_ATTRIBUTE_SUGGESTIONS', {
            binding,
            listingWorkflowId: binding.listingWorkflowId,
          });
        if (attempt !== epoch || modal.hidden) return;
        if (basis !== context()) { invalidate(); return; }
        data = reply.data?.suggestions;
        if (!data || data.state !== 'ready') throw Error('属性匹配响应不完整');
        // 兜底：规则侧在 ERP 之前跑，如果那次撞上 SW 冷启动失败（schema 还没进
        // 会话缓存），现在 ERP 往返已经把这个 SW 叫醒了 —— 再试一次几乎必然成功。
        // 顺序仍然是「先直连、后 ERP」，这里只是不把一次冷启动当成终局。
        if (!ruleSuggestions.length && ruleError) {
          try {
            ruleSuggestions = await buildRuleSuggestions({
              categoryId: category && category.categoryId,
              typeId: category && category.typeId,
              direct,
              product: typeof getProduct === 'function' ? getProduct() : null,
            });
            ruleError = '';
          } catch (error) {
            ruleError = String((error && error.message) || error).slice(0, 160);
          }
        }
        // 2026-11：ERP 只做「从商品文本推候选属性」，遇到严格字典字段时它自己
        // 不解析，直接回 unresolvedValues，界面上就成了
        // "Strict dictionary values must be resolved by the server before they
        //  can be suggested" —— 用户点了也填不进任何东西。
        // 字典解析我们自己能用直连做（Ozon 的 attribute/values 接口），
        // 所以拿到 ERP 的候选后，在渲染前把未解析的值补成 dictionary_value_id。
        await resolveUnresolved(data, {
          categoryId: category && category.categoryId,
          typeId: category && category.typeId,
          send: command,
          // 直连消息必须用 chrome.runtime.sendMessage（workbench 注入的 directSend），
          // 用 command 会经 bridge 被 waitForAuthority 挂住。
          direct,
        });
        if (attempt !== epoch || modal.hidden) return;

        // 把我们自己的规则预填结果并进同一个弹窗。
        // ERP 的 blockedSuggestions 只是「这个字段我没东西可推」，而那些字段
        // （品牌 / 性别 / 尺码 / 颜色 / 型号）恰好都能由规则给出。
        // 规则建议排前面 —— 它们是必填项，ERP 反而给不了。
        if (ruleSuggestions.length) {
          data.suggestions = ruleSuggestions.concat(data.suggestions || []);
        }
        if (attempt !== epoch || modal.hidden) return;
        data.suggestions.forEach((candidate, index) => {
          const card = make('section', 'precision-attribute-suggestion');
          const label = make('label'),
            checkbox = make('input');
          checkbox.type = 'checkbox';
          checkbox.value = String(index);
          checkbox.checked = candidate.rows.every((row) => !row.unresolvedValues.length);
          checkbox.dataset.attributeCandidate = candidate.candidateId;
          checkbox.addEventListener('change', sync);
          label.append(checkbox, make('strong', '', candidate.attributeName));
          if (candidate.source === 'rule') {
            const badge = make('span', '', ' 规则');
            badge.title = '由本地规则 + Ozon 官方字典得出，应用时走手动属性通道';
            label.append(badge);
          }
          card.append(label);
          for (const row of candidate.rows) {
            card.append(
              make(
                'p',
                '',
                `${row.skuKey ? getSkuLabel(row.skuKey) : '所有 SKU'}：${JSON.stringify(row.value)}`,
              ),
            );
            const details = make('details'),
              summary = make('summary', '', '来源依据');
            details.append(summary);
            for (const evidence of row.evidence)
              details.append(
                make('div', '', `${evidence.path}：${JSON.stringify(evidence.value)}`),
              );
            card.append(details);
            if (row.unresolvedValues.length)
              card.append(
                make(
                  'p',
                  'precision-attribute-warning',
                  '部分值未匹配官方选项，应用后仍需补齐：' + JSON.stringify(row.unresolvedValues)
                    + (row.dictionaryError
                      ? `（直连字典失败：${row.dictionaryError}）`
                      : row.dictionaryCandidates === 0
                        ? '（字典请求没有返回候选，检查直连通道）'
                        : `（字典返回 ${row.dictionaryCandidates} 个候选，无唯一命中）`),
                ),
              );
          }
          list.append(card);
        });
        for (const blocked of data.blockedSuggestions)
          list.append(
            make(
              'p',
              'precision-attribute-warning',
              `${blocked.attributeName}：${blocked.message}`,
            ),
          );
        if (ruleError) {
          list.append(
            make('p', 'precision-attribute-warning', '规则预填未完成：' + ruleError),
          );
        } else {
          list.append(
            make('p', '', ruleSuggestions.length
              ? `规则补充 ${ruleSuggestions.length} 组：` + ruleSuggestions.map((c) => c.attributeName).join(' / ')
              : '规则没有可补的字段。'),
          );
        }
        state.textContent = data.suggestions.length
          ? `已匹配 ${data.suggestions.length} 组属性`
            + (ruleSuggestions.length ? `（其中规则 ${ruleSuggestions.length} 组）` : '')
            + '，请确认后应用。'
          : '没有可安全匹配的属性，请在当前表格补充。';
      } catch (error) {
        if (attempt !== epoch || modal.hidden) return;
        state.textContent = error.message;
        report(error);
      } finally {
        if (attempt === epoch) { opening = false; sync(); }
      }
    },
  };
}
