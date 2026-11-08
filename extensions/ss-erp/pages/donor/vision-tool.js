import { compileHostedReferenceSelection } from './hosted-reference-selection.js';
import { createInlineConfirmation } from './inline-confirmation.js';

export function createVisionTool({ root, command, getBinding, getSkuKey, getMedia, getBusy, applyDescription, onMessage, report, confirmAction }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const modal = make('div', 'settings-modal'); modal.id = 'precision-vision-modal'; modal.hidden = true;
  const dialog = make('div', 'settings-dialog precision-vision-dialog'), head = make('div', 'settings-head');
  head.append(make('div', 'settings-title', '看图分析 · 视觉 JSON'));
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-vision-close'; close.type = 'button';
  close.addEventListener('click', () => { confirmation.cancel(); modal.hidden = true; }); head.append(close);
  const body = make('div', 'settings-body'), note = make('p', '', '选择当前 SKU 的 1–5 张来源图，生成可编辑的构图、背景、光线和风格建议。');
  const images = make('div', 'precision-vision-images');
  const result = make('textarea'); result.id = 'precision-vision-result'; result.readOnly = true;
  result.setAttribute('aria-label', '看图分析返回的视觉 JSON');
  const state = make('p'); state.id = 'precision-vision-state'; state.setAttribute('role', 'status');
  const foot = make('div', 'settings-foot'), start = make('button', 'ghost', '分析所选图片'), recover = make('button', 'ghost', '核对原分析'), apply = make('button', 'primary', '应用到可编辑提示词');
  start.id = 'precision-vision-start'; recover.id = 'precision-vision-recover'; apply.id = 'precision-vision-apply';
  for (const button of [start, recover, apply]) button.type = 'button';
  recover.hidden = true; apply.disabled = true; foot.append(start, recover, apply);
  body.append(note, images, result, state); dialog.append(head, body, foot); modal.append(dialog); root.append(modal);
  const confirmation = createInlineConfirmation({ container: body, make });
  const ask = confirmAction || (options => confirmation.request(options));
  let token = '', capability = null, operation = null, originalSelection = null, output = null, opening = false, busy = false;
  const binding = () => { try { return getBinding(); } catch { return null; } };
  const currentToken = () => JSON.stringify([binding(), getSkuKey(), getMedia().map(item => [item.key, item.url])]);
  const selected = () => [...images.querySelectorAll('input:checked')].map(input => input.value);
  const confirmationToken = () => JSON.stringify([currentToken(), selected(), capability]);
  const sameOperation = () => operation && JSON.stringify(originalSelection) === JSON.stringify(selected());
  function sync() {
    if (modal.hidden) return;
    if (token !== currentToken()) { output = null; apply.disabled = true; state.textContent = '商品、SKU 或草稿已变化，请关闭后重新打开看图分析。'; }
    confirmation.sync(confirmationToken());
    const count = selected().length, unavailable = getBusy() || opening || busy;
    start.disabled = token !== currentToken() || unavailable || !capability?.available || count < 1 || count > 5 || Boolean(operation);
    recover.hidden = !operation; recover.disabled = unavailable || !sameOperation();
    apply.disabled = token !== currentToken() || unavailable || !output;
    for (const input of images.querySelectorAll('input')) input.disabled = unavailable || Boolean(operation);
  }
  async function analyze(replay = false) {
    if (busy) return;
    if (!replay) {
      if (token !== currentToken() || !capability?.available || selected().length < 1 || selected().length > 5) throw new Error('请重新读取当前图片和看图能力');
      const frozenToken = confirmationToken();
      if (!await ask({ message: capability.providerFeeNotice, detail: `分析 ${selected().length} 张图，结果仅用于编辑提示词。`, token: frozenToken, getToken: confirmationToken }) || frozenToken !== confirmationToken()) return;
      const frozenBinding = binding(), sourceKeys = selected();
      busy = true; sync();
      try {
        const mediaKeys = await compileHostedReferenceSelection(sourceKeys, getMedia());
        if (token !== currentToken()) throw new Error('选择图片期间草稿已变化，请重新打开看图分析');
        originalSelection = sourceKeys;
        operation = { binding: frozenBinding, listingWorkflowId: frozenBinding.listingWorkflowId, skuKey: getSkuKey(),
          sourceMediaKeys: mediaKeys, operationKey: 'precision-vision:' + crypto.randomUUID() };
      } catch (error) { busy = false; sync(); throw error; }
    }
    busy = true; state.textContent = replay ? '正在核对原分析结果…' : '正在分析所选图片…'; sync();
    try {
      const response = await command('VISION_ANALYZE', operation);
      const data = response.data?.analysis;
      if (!data || JSON.stringify(data.binding) !== JSON.stringify(operation.binding) || data.operationKey !== operation.operationKey) throw Object.assign(new Error('看图回执不完整，请核对原操作'), { outcome: 'UNKNOWN_OUTCOME' });
      if (token !== currentToken()) { operation = null; throw new Error('分析期间草稿或 SKU 已变化，结果未应用'); }
      output = data.visualDescription;
      result.value = JSON.stringify(output, null, 2);
      operation = null;
      state.textContent = '看图分析完成。检查视觉 JSON 后，可应用到提示词继续编辑。';
      onMessage(state.textContent, 'ok');
    } catch (error) {
      if (error.outcome === 'NOT_SUBMITTED') operation = null;
      state.textContent = error.message; report(error);
    } finally { busy = false; sync(); }
  }
  start.addEventListener('click', event => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !start.disabled) void analyze().catch(report); });
  recover.addEventListener('click', event => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !recover.disabled) void analyze(true).catch(report); });
  apply.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || apply.disabled || token !== currentToken()) return;
    try { applyDescription(output); modal.hidden = true; } catch (error) { report(error); }
  });
  return {
    sync,
    async open() {
      if (!binding() || !getSkuKey()) throw new Error('请先创建草稿并选择当前 SKU');
      const nextToken = currentToken();
      if (operation && token !== nextToken) throw new Error('原看图请求尚未核对，请回到原商品与草稿再核对');
      token = nextToken; modal.hidden = false; opening = true; capability = null;
      if (!operation) {
        output = null; result.value = ''; images.replaceChildren();
        for (const [index, media] of getMedia().entries()) {
          const label = make('label'), input = make('input'), image = make('img');
          input.type = 'checkbox'; input.value = media.key; input.checked = index < 3; input.dataset.visionMediaKey = media.key;
          image.src = media.url; image.alt = media.label || '来源商品图'; image.referrerPolicy = 'no-referrer';
          input.addEventListener('change', () => { output = null; result.value = ''; state.textContent = `已选 ${selected().length} 张图（最多五张）`; sync(); });
          label.append(input, image); images.append(label);
        }
      }
      state.textContent = '正在读取看图分析能力…'; sync();
      try {
        const response = await command('VISION_CAPABILITY', { binding: binding(), listingWorkflowId: binding().listingWorkflowId });
        if (token !== currentToken()) return;
        capability = response.data?.capability;
        state.textContent = capability?.available ? capability.providerFeeNotice : '当前未启用托管看图分析，可继续手工编辑视觉 JSON 和提示词。';
      } catch (error) { state.textContent = error.message; }
      finally { opening = false; sync(); }
    },
  };
}
