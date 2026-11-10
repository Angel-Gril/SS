// 直连生图流程（唯一 owner）：把「仅翻译 / AI 主图＋翻译 / AI 套图」三种模式
// 统一成同一份任务清单，由同一个执行器逐张执行、逐张落盘。
//
// 设计约束（见 dev-docs/extension-direction.md）：
//   - 一条路径：三种模式都走 service worker 的 ss-erp:direct-image-generate。
//   - 失败不丢已付费的结果：每张完成即保存；重跑只补未完成的任务。
//   - 结果可用于上架：完成的图片带可上架的 https 链接（publishable）。
//
// 本模块不碰 DOM，也不直接调用 chrome.*；存储与消息通道由调用方注入，便于测试。
import { buildDirectPromptPlan } from '../../shared/ozon/direct-prompt-plan.js';

export const DIRECT_IMAGE_MODES = Object.freeze(['translate', 'ai-main-translate', 'ai-suite']);
export const DIRECT_IMAGE_STORE_PREFIX = 'ss-erp:direct-images:v1:';
const MAX_TRANSLATIONS = 5;
const STORE_LIMIT = 60;

const TRANSLATE_PROMPT = [
  'Task: translate every piece of Chinese text in this product image into natural Russian.',
  'Keep the product, layout, colours, composition, typography style and text positions unchanged.',
  'Do not add, remove or redraw any element other than the text. Keep numbers and units as they are.',
  'If the image contains no text, return it unchanged.',
].join('\n');

const KIND_LABELS = Object.freeze({
  hero_image: 'SKU 主图', scene_image: '场景图', detail_image: '细节图', function_image: '功能图',
  fitment_image: '适配图', spec_board: '规格图', package_image: '包装图', poster_image: '卖点海报',
});

function httpsOnly(urls) {
  const seen = new Set();
  return (Array.isArray(urls) ? urls : []).map(url => String(url || '').trim())
    .filter(url => /^https:\/\//u.test(url) && !seen.has(url) && seen.add(url));
}

function shortHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

/**
 * 按模式生成任务清单。任务 id 稳定，同一商品重复生成不会改变 id，
 * 执行器据此跳过已完成的任务。
 */
export function buildDirectImageJobs({ mode, product, media, skus, translationUrls } = {}) {
  if (!DIRECT_IMAGE_MODES.includes(mode)) throw new Error('未知的图片处理方式');
  const jobs = [];
  if (mode !== 'translate') {
    const plan = buildDirectPromptPlan({ product, media, skus });
    for (const entry of plan.perSku) {
      const slot = entry.slots[0];
      const inputImageUrls = httpsOnly(slot.inputImageUrls);
      if (!inputImageUrls.length) continue;
      jobs.push({ id: `hero:${entry.variantKey}`, kind: 'hero', skuKey: entry.variantKey, order: 0,
        label: `${KIND_LABELS.hero_image} · ${entry.variantLabel || entry.variantKey}`,
        prompt: slot.prompt, inputImageUrls });
    }
    if (mode === 'ai-suite') {
      for (const slot of plan.sharedGallery) {
        const inputImageUrls = httpsOnly(slot.inputImageUrls);
        if (!inputImageUrls.length) continue;
        jobs.push({ id: `gallery:${slot.slotId}`, kind: 'gallery', skuKey: null, order: slot.sortOrder,
          label: KIND_LABELS[slot.goalType] || '详情图', prompt: slot.prompt, inputImageUrls });
      }
    }
  }
  if (mode !== 'ai-suite') {
    httpsOnly(translationUrls).slice(0, MAX_TRANSLATIONS).forEach((url, index) => {
      jobs.push({ id: `translate:${shortHash(url)}`, kind: 'translate', skuKey: null, order: 100 + index,
        label: `翻译图 ${index + 1}`, prompt: TRANSLATE_PROMPT, inputImageUrls: [url] });
    });
  }
  return jobs;
}

/** 结果落盘：按来源商品分键保存；只保存可上架链接，不保存 data: 预览。 */
export function createDirectImageStore({ storage, sourceKey }) {
  const key = DIRECT_IMAGE_STORE_PREFIX + String(sourceKey || 'unknown');
  return {
    key,
    async load() {
      const stored = await storage.get(key);
      const value = stored && stored[key];
      return Array.isArray(value && value.results) ? value.results : [];
    },
    async save(results) {
      const persisted = results.filter(item => item.status === 'done' || item.status === 'failed').slice(-STORE_LIMIT)
        .map(({ dataUrl: _dataUrl, ...rest }) => rest);
      await storage.set({ [key]: { savedAt: Date.now(), results: persisted } });
    },
  };
}

function toResult(job, patch) {
  return { id: job.id, kind: job.kind, skuKey: job.skuKey, order: job.order, label: job.label,
    status: 'pending', url: '', publishable: false, hosted: false, selected: true, error: '', reason: '', elapsedMs: 0, ...patch };
}

/**
 * 执行器：串行逐张生成（Provider 普遍限流，并发只会换来 429）。
 * send(message) 由调用方提供，返回 { url, hosted, dataUrl?, reason?, elapsedMs? }。
 */
export function createDirectImageRunner({ send, store, getShopId = () => '', onChange = () => {} }) {
  let results = [];
  let busy = false;
  let cancelRequested = false;
  let currentId = '';

  const snapshot = () => ({ busy, currentId, cancelRequested, results: results.map(item => ({ ...item })) });
  const upsert = (next) => {
    const index = results.findIndex(item => item.id === next.id);
    if (index >= 0) results[index] = next; else results.push(next);
  };
  const emit = () => { try { onChange(snapshot()); } catch { /* 渲染错误不应中断付费任务 */ } };

  async function persist() {
    try { await store.save(results); } catch { /* 落盘失败只影响重开后的恢复，不影响本次结果 */ }
  }

  return {
    state: snapshot,
    async load() {
      results = (await store.load()).map(item => ({ ...item }));
      emit();
      return snapshot().results;
    },
    cancel() { if (busy) { cancelRequested = true; emit(); } },
    toggle(id, selected) {
      const item = results.find(entry => entry.id === id);
      if (!item) return;
      item.selected = selected === undefined ? !item.selected : selected === true;
      void persist(); emit();
    },
    async clear() { results = []; await persist(); emit(); },
    /** @returns 本次任务清单对应的结果（顺序与 jobs 一致） */
    async run(jobs, { force = false } = {}) {
      if (busy) throw new Error('图片正在处理中');
      busy = true; cancelRequested = false;
      try {
        for (const job of jobs) {
          const existing = results.find(item => item.id === job.id);
          if (existing && existing.status === 'done' && !force) continue;
          if (cancelRequested) { upsert(toResult(job, { selected: existing ? existing.selected : true })); continue; }
          currentId = job.id;
          upsert(toResult(job, { status: 'running', selected: existing ? existing.selected : true }));
          emit();
          try {
            const reply = await send({ type: 'ss-erp:direct-image-generate', payload: {
              jobId: job.id, prompt: job.prompt, inputImageUrls: job.inputImageUrls, shopId: getShopId() || undefined,
            } });
            const url = String((reply && reply.url) || '');
            const publishable = /^https:\/\//u.test(url);
            upsert(toResult(job, { status: 'done', url, publishable, hosted: Boolean(reply && reply.hosted),
              reason: String((reply && reply.reason) || ''), elapsedMs: Number(reply && reply.elapsedMs) || 0,
              selected: existing ? existing.selected : true,
              ...(reply && reply.dataUrl ? { dataUrl: String(reply.dataUrl) } : {}) }));
          } catch (error) {
            upsert(toResult(job, { status: 'failed', error: String((error && error.message) || error).slice(0, 300),
              selected: existing ? existing.selected : true }));
          }
          await persist();
          emit();
        }
        const byId = new Map(results.map(item => [item.id, item]));
        return jobs.map(job => ({ ...(byId.get(job.id) || toResult(job)) }));
      } finally {
        busy = false; currentId = ''; cancelRequested = false;
        emit();
      }
    },
  };
}

/**
 * 上架用图：当前 SKU 的主图在最前，其后是共享详情图、翻译图；
 * 没有任何可上架的生成图时退回来源图，保证上架不因为没生图而卡住。
 */
export function selectPublishImages(results, { skuKey, sourceUrls = [], limit = 15 } = {}) {
  const usable = (Array.isArray(results) ? results : []).filter(item => item.status === 'done'
    && item.publishable && item.selected && /^https:\/\//u.test(String(item.url || ''))
    && (item.skuKey === null || item.skuKey === undefined || String(item.skuKey) === String(skuKey)));
  const rank = (item) => (item.kind === 'hero' ? 0 : item.kind === 'gallery' ? 1 : 2);
  usable.sort((a, b) => rank(a) - rank(b) || (Number(a.order) || 0) - (Number(b.order) || 0));
  const generated = httpsOnly(usable.map(item => item.url));
  return (generated.length ? generated : httpsOnly(sourceUrls)).slice(0, limit);
}

/** 进度摘要，供界面显示一句话状态。 */
export function summarizeDirectImages(state, jobs = null) {
  const scope = jobs ? state.results.filter(item => jobs.some(job => job.id === item.id)) : state.results;
  const done = scope.filter(item => item.status === 'done').length;
  const failed = scope.filter(item => item.status === 'failed').length;
  const unhosted = scope.filter(item => item.status === 'done' && !item.hosted).length;
  const total = jobs ? jobs.length : scope.length;
  const running = state.results.find(item => item.id === state.currentId);
  const text = state.busy
    ? `${state.cancelRequested ? '正在停止' : '正在生成'}：${running ? running.label : ''}（${done}/${total}）`
    : !total ? '尚未生成图片'
      : `已完成 ${done}/${total} 张${failed ? `，${failed} 张失败可重试` : ''}${unhosted ? `，${unhosted} 张未托管到 ERP` : ''}`;
  return { total, done, failed, unhosted, text };
}
