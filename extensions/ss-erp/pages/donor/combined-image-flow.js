import { resolveSuitePrimaryAction } from './suite-primary-action.js';
// Navigation between existing ERP owners only; no local charge or permission.
export function resolveCombinedImageAction(input) {
  const { availability, billing, translation, busy } = input;
  if (busy || translation?.busy) return { action: 'NONE', label: '正在处理图片…', disabled: true };
  if (!input.draftId) return { action: 'NONE', label: '请先采集并选择店铺', disabled: true };
  if (translation?.unknown) return { action: 'READ', label: '核对已提交的图片任务', disabled: false };
  if (availability?.state !== 'ready') return { action: 'CHECK', label: '检查图片翻译可用性', disabled: availability?.state === 'loading' };
  if (!availability.available) return { action: 'NONE', label: '当前环境未开放图片翻译', disabled: true };
  const next = resolveSuitePrimaryAction(input);
  if (billing?.quote && billing.quote.itemCount !== 1) return { action: 'EXISTING_SUITE', label: '查看当前套图任务', disabled: false };
  if (billing?.suite?.status === 'SUCCEEDED') {
    const main = billing.suite.slots?.filter(slot => slot.goal === 'sku_hero');
    if (main?.length === 1 && main[0].status === 'SUCCEEDED' && main[0].media?.reviewStatus === 'APPROVED') {
      return { action: 'TRANSLATE', label: translation?.queuedCount ? '查看图片处理结果' : '继续翻译所选图片', disabled: false };
    }
    return { action: 'REVIEW', label: '预览并审核 AI 主图', disabled: false };
  }
  return { ...next, label: next.action === 'PREPARE' ? '准备 AI 主图' : next.label };
}
