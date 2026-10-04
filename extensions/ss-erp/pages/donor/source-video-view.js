// The donor summary distinguishes video slots. This view previews captured
// sources only; publishing and video generation are not implied by playback.
function safeVideoUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/u.test(host)
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host === 'metadata.google.internal'
      || !/\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)$/iu.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

export function sourceVideosForSku(videos, skuKey) {
  return (Array.isArray(videos) ? videos : []).filter(item => item
    && typeof item.key === 'string' && item.key.trim() === item.key && item.key.length > 0
    && (item.kind === undefined || item.kind === 'video')
    && Array.isArray(item.skuKeys)
    && item.skuKeys.every(key => typeof key === 'string' && key.length > 0 && key.trim() === key)
    && (!item.skuKeys.length || item.skuKeys.includes(skuKey))
    && safeVideoUrl(item.url));
}

export function resolveSourceVideo(videos, value, skuKey) {
  const key = typeof value === 'string' ? value : value?.key;
  const matches = sourceVideosForSku(videos, skuKey).filter(item => item.key === key);
  return matches.length === 1 ? { ...matches[0], url: safeVideoUrl(matches[0].url) } : null;
}

export function createSourceVideoView({ root, getVideos, getSkuKey, onSelectSku, onMessage,
  getContextKey = () => '' }) {
  const document = root.ownerDocument;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const modal = make('section', 'image-manager-modal');
  modal.id = 'precision-source-video-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'precision-source-video-title');
  const dialog = make('div', 'image-manager-dialog precision-image-dialog precision-source-video-dialog');
  const heading = make('header', 'precision-image-head');
  const title = make('strong', '', '来源视频'); title.id = 'precision-source-video-title';
  const closeButton = make('button', 'ghost', '返回商品'); closeButton.type = 'button';
  closeButton.id = 'precision-source-video-close'; heading.append(title, closeButton);
  const body = make('div', 'precision-image-body');
  const player = make('video', 'precision-source-video-player'); player.id = 'precision-source-video-player';
  player.controls = true; player.preload = 'none'; player.autoplay = false;
  player.setAttribute('playsinline', ''); player.setAttribute('aria-label', '采集来源视频预览');
  const message = make('p', 'image-manager-global-status'); message.setAttribute('role', 'status');
  const choices = make('nav', 'precision-image-modes'); choices.setAttribute('aria-label', '采集视频');
  body.append(player, message, choices);
  const foot = make('footer', 'image-manager-foot');
  foot.append(make('span', 'image-manager-global-status', '来源视频可在这里预览；当前不会随图片应用到草稿或自动提交 Ozon。'));
  dialog.append(heading, body, foot); modal.append(dialog); root.append(modal);
  let active = null, opener = null, openSku = '', openContext = '';

  function close() {
    if (modal.hidden) return;
    modal.hidden = true; active = null;
    player.pause(); player.removeAttribute('src'); player.load();
    if (opener?.isConnected) opener.focus();
  }
  function open(value, trigger) {
    const skuKey = getSkuKey();
    const selected = resolveSourceVideo(getVideos(), value, skuKey);
    if (!selected) {
      onMessage?.('当前 SKU 没有可预览的来源视频，请重新采集或选择商品。');
      return false;
    }
    if (modal.hidden) opener = trigger || document.activeElement;
    active = selected; openSku = skuKey; openContext = getContextKey();
    title.textContent = selected.title || '来源视频';
    message.textContent = '点击播放预览；播放失败时可保留采集记录，不会触发上传。';
    player.pause(); player.src = selected.url; modal.hidden = false;
    choices.replaceChildren();
    for (const [index, item] of sourceVideosForSku(getVideos(), skuKey).entries()) {
      const button = make('button', 'ghost', `视频 ${index + 1}`); button.type = 'button';
      button.setAttribute('aria-pressed', String(item.key === selected.key));
      button.addEventListener('click', () => open(item.key)); choices.append(button);
    }
    closeButton.focus();
    return true;
  }
  function refresh() {
    if (modal.hidden) return;
    const selected = resolveSourceVideo(getVideos(), active?.key, getSkuKey());
    if (getSkuKey() !== openSku || getContextKey() !== openContext
      || !selected || selected.url !== active.url) close();
  }
  function renderCell(cell, { skuKey, label = '来源视频' }) {
    const available = sourceVideosForSku(getVideos(), skuKey);
    cell.replaceChildren();
    const button = make('button', 'image-manager-summary-video precision-source-video-button'); button.type = 'button';
    button.disabled = !available.length;
    button.title = available.length ? `${label}：预览已采集的视频（未提交 Ozon）` : '没有采集到来源视频';
    button.setAttribute('aria-label', button.title);
    const icon = make('span', 'image-manager-video-icon'); icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    button.addEventListener('keydown', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.stopPropagation(); onSelectSku?.(skuKey);
      open(sourceVideosForSku(getVideos(), skuKey)[0]?.key, button);
    });
    cell.append(button);
  }
  closeButton.addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled),video[controls]')]
      .filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (document.activeElement === (event.shiftKey ? first : last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  });
  player.addEventListener('error', () => {
    if (active) message.textContent = '来源视频暂时无法播放，可能需要源站登录或不支持此视频格式；采集记录仍然保留。';
  });
  return { open, close, refresh, renderCell };
}
