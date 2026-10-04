// Selection and progress only. The existing ERP command owner validates every
// source, draft, device, permission, quota and translation provider decision.
export function normalizeTranslationPrice(value) {
  if (value == null) return null;
  if (!['CNY', 'USD'].includes(value.currency) || !Number.isSafeInteger(value.unitCostCents) || value.unitCostCents < 1
    || !Number.isSafeInteger(value.maximumCostCents) || value.maximumCostCents < value.unitCostCents || value.maximumCostCents > 100_000_000
    || !/^[a-f0-9]{64}$/u.test(value.quoteFingerprint)) throw new Error('图片翻译报价无效，请重新读取');
  return Object.freeze({ currency: value.currency, unitCostCents: value.unitCostCents,
    maximumCostCents: value.maximumCostCents, quoteFingerprint: value.quoteFingerprint });
}
export function createTranslationFlow({ getContext, getSelectedMedia, submit, onState = () => {} }) {
  let binding = '', busy = false, unknown = false, error = '';
  let items = new Map();
  const identity = () => JSON.stringify(getContext());
  function state() {
    return { busy, unknown, error, items: [...items.values()],
      queuedCount: [...items.values()].filter(item => item.status === 'QUEUED').length };
  }
  function emit() { onState(state()); }
  function reset() {
    if (busy) return;
    binding = ''; unknown = false; error = ''; items = new Map(); emit();
  }
  async function start(options = {}) {
    if (busy) return state();
    const context = getContext();
    if (!context?.listingWorkflowId) throw new Error('请先创建当前店铺草稿');
    const current = identity();
    if (binding !== current) { binding = current; unknown = false; error = ''; items = new Map(); }
    if (unknown) throw new Error('上次翻译提交结果待核对，请重新读取任务状态');
    const selected = getSelectedMedia();
    if (!Array.isArray(selected) || !selected.length) throw new Error('请勾选要翻译的来源图片');
    if (selected.length > 5 || new Set(selected.map(item => item.key)).size !== selected.length) throw new Error('每次最多翻译 5 张不同的来源图片');
    const next = selected.filter(item => items.get(item.key)?.status !== 'QUEUED');
    if (!next.length) return state();
    busy = true; error = ''; emit();
    try {
      for (const item of next) {
        if (identity() !== current) throw Object.assign(new Error('商品或草稿已变化，后续图片未提交'), { outcome: 'NOT_SUBMITTED' });
        items.set(item.key, { sourceMediaKey: item.key, status: 'SUBMITTING' }); emit();
        try {
          const response = await submit({ listingWorkflowId: context.listingWorkflowId, sourceMediaKey: item.key,
            ...(options.priceConfirmation ? { priceConfirmation: Object.freeze({ ...options.priceConfirmation }) } : {}) });
          const data = response?.data;
          const result = data?.result ?? data;
          if (data?.state !== 'completed' || !result?.workflowId || !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(result.status)) {
            throw Object.assign(new Error('翻译回执待核对，请重新读取状态'), { outcome: 'UNKNOWN_OUTCOME' });
          }
          items.set(item.key, { sourceMediaKey: item.key, workflowId: result.workflowId, status: 'QUEUED' }); emit();
        } catch (failure) {
          unknown = failure.outcome !== 'NOT_SUBMITTED';
          items.set(item.key, { sourceMediaKey: item.key, status: unknown ? 'UNKNOWN' : 'FAILED' });
          throw failure;
        }
      }
    } catch (failure) {
      error = failure.message || '翻译未完成';
      throw failure;
    } finally { busy = false; emit(); }
    return state();
  }
  return { start, state, reset };
}
