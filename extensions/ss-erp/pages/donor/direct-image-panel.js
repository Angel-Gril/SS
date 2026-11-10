// 直连生图结果面板（只负责展示与勾选，不发请求）。
// 结果落在图片工作区的「处理结果」里：可预览、可勾选是否用于上架、失败项可单独重试。
import { summarizeDirectImages } from './direct-image-flow.js';

const STATUS_TEXT = Object.freeze({ pending: '未开始', running: '生成中…', done: '已完成', failed: '失败' });

export function createDirectImagePanel({ container, make, onToggle, onRetry, onRetryFailed, onClear }) {
  const panel = make('section', 'ss-direct-images'); panel.id = 'precision-direct-images';
  const head = make('header', 'ss-direct-images-head');
  const summary = make('strong'); summary.setAttribute('role', 'status');
  const retryFailed = make('button', 'ghost', '重试失败项'); retryFailed.type = 'button';
  const clear = make('button', 'ghost', '清空结果'); clear.type = 'button';
  head.append(summary, retryFailed, clear);
  const notice = make('p', 'ss-direct-images-notice');
  const grid = make('div', 'ss-direct-images-grid');
  panel.append(head, notice, grid);
  container.append(panel);
  retryFailed.addEventListener('click', (event) => { if (event.isTrusted && !retryFailed.disabled) onRetryFailed(); });
  clear.addEventListener('click', (event) => { if (event.isTrusted && !clear.disabled) onClear(); });
  let signature = '';

  function card(item, busy) {
    const node = make('article', `ss-direct-image is-${item.status}`);
    node.dataset.directImage = item.id;
    const source = item.url || item.dataUrl || '';
    if (source) {
      const image = make('img'); image.src = source; image.alt = item.label; image.loading = 'lazy'; image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      if (item.url) {
        const link = make('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noreferrer noopener';
        link.title = '在新标签页查看原图'; link.append(image); node.append(link);
      } else node.append(image);
    } else node.append(make('div', 'ss-direct-image-placeholder', STATUS_TEXT[item.status] || ''));
    node.append(make('p', 'ss-direct-image-label', item.label));
    if (item.status === 'failed') {
      node.append(make('p', 'ss-direct-image-error', item.error || '生成失败'));
      const retry = make('button', 'ghost', '重试'); retry.type = 'button'; retry.disabled = busy;
      retry.addEventListener('click', (event) => { if (event.isTrusted && !retry.disabled) onRetry(item.id); });
      node.append(retry);
    } else if (item.status === 'done') {
      const use = make('label', 'ss-direct-image-use');
      const check = make('input'); check.type = 'checkbox'; check.checked = item.publishable && item.selected;
      check.disabled = !item.publishable;
      check.addEventListener('change', () => onToggle(item.id, check.checked));
      use.append(check, make('span', '', item.publishable ? '用于上架' : '仅可预览'));
      node.append(use);
      if (!item.hosted) node.append(make('p', 'ss-direct-image-warn',
        item.publishable ? `未托管到 ERP，链接可能过期${item.reason ? `：${item.reason}` : ''}` : `无法上架${item.reason ? `：${item.reason}` : ''}`));
    } else node.append(make('p', 'ss-direct-image-state', STATUS_TEXT[item.status] || ''));
    return node;
  }

  return {
    panel,
    /** @param state runner.state()  @param view { skuKey, all } 当前查看的 SKU 与是否查看整个草稿 */
    render(state, view = {}) {
      const visible = state.results.filter(item => view.all || item.skuKey === null || item.skuKey === undefined
        || String(item.skuKey) === String(view.skuKey));
      visible.sort((a, b) => (a.kind === 'hero' ? 0 : a.kind === 'gallery' ? 1 : 2) - (b.kind === 'hero' ? 0 : b.kind === 'gallery' ? 1 : 2)
        || (Number(a.order) || 0) - (Number(b.order) || 0));
      const info = summarizeDirectImages(state);
      panel.hidden = !state.results.length && !state.busy;
      summary.textContent = info.text;
      retryFailed.hidden = !info.failed; retryFailed.disabled = state.busy;
      clear.disabled = state.busy; clear.hidden = !state.results.length;
      notice.hidden = !info.unhosted;
      notice.textContent = info.unhosted ? '部分图片没有托管到 ERP 对象存储：请在设置里连接 ERP 后重新生成，否则 Provider 链接过期后图片会失效。' : '';
      const nextSignature = JSON.stringify([state.busy, visible]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      grid.replaceChildren(...visible.map(item => card(item, state.busy)));
    },
  };
}
