// Adapted from jp20260803 image-manager-workspace-view.js renderSummary and
// sku-image-workspace.js. Only presentation lives here; ERP owns every task,
// review and assignment. No donor runner, upload or video authority is copied.
const taskLabels = {
  PLANNED: '等待处理', QUEUED: '排队中', RUNNING: '处理中',
  SUCCEEDED: '生成完成',
  FAILED: '处理失败', CANCELLED: '已取消', PARTIAL_FAILURE: '部分完成',
  CANCEL_REQUESTED: '正在取消', UNKNOWN_OUTCOME: '结果待核对',
};

export function partitionImageTasks(history, billing) {
  const items = history?.items || [];
  if (!billing?.suite) return { current: items.slice(0, 1), history: items.slice(1) };
  const currentIds = new Set(billing.suite.slots?.map(slot => slot.media?.workflowId).filter(Boolean));
  return { current: items.filter(item => currentIds.has(item.id)), history: items.filter(item => !currentIds.has(item.id)) };
}

export function buildImageProcess({ billing, history }) {
  const suite = billing?.suite;
  if (!suite) return { status: 'NOT_STARTED', total: 0, completed: 0, slots: [], candidates: [], message: '尚未开始生图；准备计划并确认费用后，在这里查看当前过程。' };
  const tasks = partitionImageTasks(history, billing).current;
  const slots = (suite.slots || []).map((slot, index) => ({ ...slot, label: ({ sku_hero: 'SKU 主图', hero: '商品主图', scene: '场景图', detail: '详情图' })[slot.goal] || `图片 ${index + 1}`,
    text: slot.status === 'SUCCEEDED' ? reviewStatus(slot.media?.reviewStatus) : taskLabels[slot.status] || '状态待核对' }));
  const total = slots.length || billing.quote?.itemCount || 0;
  const completed = slots.filter(slot => slot.status === 'SUCCEEDED').length;
  const failed = slots.filter(slot => ['FAILED', 'CANCELLED', 'UNKNOWN_OUTCOME'].includes(slot.status)).length;
  const message = suite.status === 'SUCCEEDED' ? `已生成 ${completed}/${total} 张，请预览并审核；尚未应用到草稿。`
    : suite.status === 'PARTIAL_FAILURE' ? `部分图片完成：已生成 ${completed}/${total} 张，${failed} 张失败或待核对；请核对原任务。`
      : `${taskLabels[suite.status] || '状态待核对'}${total ? ` · 已生成 ${completed}/${total} 张` : ''}`;
  const candidates = slots.flatMap(slot => {
    const task = tasks.find(item => item.id === slot.media?.workflowId);
    return (task?.outputs || []).filter(output => output.id === slot.media?.outputAssetId);
  });
  return { status: suite.status, total, completed, slots, candidates, message };
}
function reviewStatus(value) {
  return ({ PENDING: '图片已生成 · 待审核', APPROVED: '审核通过 · 待应用', REJECTED: '已驳回' })[value] || '生成完成，正在读取候选';
}

export function describeImageTask(item) {
  if (item.status !== 'SUCCEEDED') return {
    text: taskLabels[item.status] || '状态待核对',
    status: ['FAILED', 'CANCELLED'].includes(item.status) ? 'error' : 'running',
  };
  if (item.application?.state === 'APPLIED') return { text: '已应用到草稿', status: 'done' };
  if (item.reviewStatus === 'REJECTED') return { text: '已驳回', status: 'error' };
  if (item.reviewStatus === 'APPROVED') return { text: '审核通过 · 待应用', status: 'done' };
  return { text: '图片已生成 · 待审核', status: 'warning' };
}

export function describeSuite(billing) {
  if (!billing) return '读取图片任务后可开始处理';
  if (!billing.quote) return '尚未开始图片处理';
  const quote = billing.quote;
  const price = `${quote.itemCount} 张 · 最高 ${quote.currency} ${(quote.maximumCostMinor / 100).toFixed(2)}`;
  const suite = billing.suite;
  return `${price} · ${suite ? (suite.status === 'SUCCEEDED' ? '生成完成，请审核图片' : taskLabels[suite.status] || '状态待核对') : '待确认生成'}`;
}

export function buildSkuImageRows({ skus, media, history, billing, title = '' }) {
  return skus.map((sku, index) => {
    const sources = media.filter(item => !item.skuKeys.length || item.skuKeys.includes(sku.key));
    sources.sort((a, b) => Number(b.url === sku.imageUrl) - Number(a.url === sku.imageUrl)
      || Number(b.skuKeys.includes(sku.key)) - Number(a.skuKeys.includes(sku.key)));
    const tasks = (history?.items || []).filter(item => !item.contextSkuKey || item.contextSkuKey === sku.key);
    const images = [...sources.map(item => ({ ...item, kind: 'SOURCE' })),
      ...tasks.flatMap(item => item.outputs.map(output => ({ ...output, key: `candidate:${output.id}`, kind: 'CANDIDATE' })))];
    const seen = new Set();
    const uniqueImages = images.filter(image => !seen.has(image.url) && seen.add(image.url));
    const partition = partitionImageTasks({ items: tasks }, billing);
    const lines = partition.current.map(item => ({ key: item.id, ...describeImageTask(item) }));
    if (billing?.suite) lines.unshift({ key: 'suite', text: `本次套图 · ${buildImageProcess({ billing, history }).message}`,
      status: ['FAILED', 'PARTIAL_FAILURE', 'UNKNOWN_OUTCOME'].includes(billing.suite.status) ? 'error' : billing.suite.status === 'SUCCEEDED' ? 'warning' : 'running' });
    return { skuRowKey: sku.key, index: index + 1, name: [title, sku.label].filter(Boolean).join(' · '),
      images: uniqueImages, taskStatusLines: lines,
      historyTaskStatusLines: partition.history.map(item => ({ key: item.id, ...describeImageTask(item) })) };
  });
}

export function createSkuImageWorkspace({ container, root, onSelect, onChange, onModeChange, renderVideoCell }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const summary = make('div', 'image-manager-summary');
  container.classList.add('precision-image-summary'); container.append(summary);
  const modal = make('section', 'image-manager-modal'); modal.id = 'precision-image-manager'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'precision-image-manager-title');
  const dialog = make('div', 'image-manager-dialog precision-image-dialog');
  const head = make('header', 'precision-image-head');
  const heading = make('strong'); heading.id = 'precision-image-manager-title';
  const previous = make('button', 'ghost', '上一 SKU'); previous.id = 'precision-image-previous';
  const next = make('button', 'ghost', '下一 SKU'); next.id = 'precision-image-next';
  const close = make('button', 'ghost', '返回商品'); close.id = 'precision-image-close';
  head.append(heading, previous, next, close);
  const body = make('div', 'precision-image-body');
  const modes = make('nav', 'precision-image-modes'); modes.setAttribute('aria-label', '图片处理方式');
  for (const [mode, label] of [['translate', '仅翻译'], ['ai-main-translate', 'AI主图＋翻译'], ['ai-suite', 'AI套图'], ['byok', '自带 API']]) {
    const button = make('button', 'ghost', label); button.dataset.imageMode = mode;
    button.addEventListener('click', () => onModeChange(mode)); modes.append(button);
  }
  body.append(modes);
  const tabs = make('nav', 'image-manager-tabs'); tabs.setAttribute('aria-label', 'SKU 图片内容');
  const sources = make('button', '', '来源图片'); sources.id = 'precision-image-sources';
  const results = make('button', '', '处理结果'); results.id = 'precision-image-results';
  tabs.append(sources, results);
  const scope = make('button', 'ghost', '查看整个草稿的素材'); scope.id = 'precision-image-scope';
  tabs.append(scope); body.append(tabs);
  const sourcePanel = make('section'); sourcePanel.id = 'precision-image-source-panel';
  const resultPanel = make('section'); resultPanel.id = 'precision-image-result-panel';
  body.append(sourcePanel, resultPanel);
  const foot = make('footer', 'image-manager-foot');
  const hint = make('span', 'image-manager-global-status'); hint.id = 'precision-image-notice'; hint.setAttribute('role', 'status');
  foot.append(hint); dialog.append(head, body, foot); modal.append(dialog); root.append(modal);
  let rows = [], selected = '', tab = 'sources', all = false, process = false, signature = '', focusBefore = null, focusSkuKey = '';
  const expandedHistory = new Set();

  function sync(resetNotice = false) {
    const index = rows.findIndex(row => row.skuRowKey === selected);
    heading.textContent = `${process && tab === 'results' ? 'AI 生图过程 · ' : ''}${rows[index]?.name || '图片管理'}`;
    previous.disabled = index <= 0; next.disabled = index < 0 || index >= rows.length - 1;
    sourcePanel.hidden = tab !== 'sources'; resultPanel.hidden = tab !== 'results';
    sources.classList.toggle('is-active', tab === 'sources'); results.classList.toggle('is-active', tab === 'results');
    sources.setAttribute('aria-pressed', String(tab === 'sources')); results.setAttribute('aria-pressed', String(tab === 'results'));
    scope.textContent = all ? '只看当前 SKU' : '查看整个草稿的素材'; scope.setAttribute('aria-pressed', String(all));
    if (resetNotice || !hint.textContent) {
      hint.textContent = tab === 'results' ? '先预览图片，再审核并应用到草稿。' : '点击图片可预览；勾选需要处理的素材。';
      hint.className = 'image-manager-global-status';
    }
    summary.querySelectorAll('[data-image-sku-key]').forEach(row => {
      row.classList.toggle('is-active', row.dataset.imageSkuKey === selected);
      row.setAttribute('aria-pressed', String(row.dataset.imageSkuKey === selected));
    });
  }
  function open(key, options = {}) {
    if (!rows.some(row => row.skuRowKey === key)) return;
    if (modal.hidden) { focusBefore = document.activeElement; focusSkuKey = focusBefore?.dataset.imageSkuKey || ''; }
    selected = key; tab = options.tab || 'sources'; all = options.all === true; process = options.process === true;
    modal.hidden = false; sync(true); onSelect(key); onChange(); close.focus();
  }
  function hide() {
    if (modal.hidden) return;
    modal.hidden = true;
    const target = focusBefore?.isConnected ? focusBefore
      : [...summary.querySelectorAll('[data-image-sku-key]')].find(row => row.dataset.imageSkuKey === focusSkuKey);
    target?.focus();
  }
  close.addEventListener('click', hide);
  modal.addEventListener('click', event => { if (event.target === modal) hide(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
      .filter(node => node.getClientRects().length);
    const target = event.shiftKey ? focusable.at(-1) : focusable[0];
    if (document.activeElement === (event.shiftKey ? focusable[0] : focusable.at(-1))) { event.preventDefault(); target?.focus(); }
  });
  previous.addEventListener('click', () => open(rows[rows.findIndex(row => row.skuRowKey === selected) - 1]?.skuRowKey, { tab }));
  next.addEventListener('click', () => open(rows[rows.findIndex(row => row.skuRowKey === selected) + 1]?.skuRowKey, { tab }));
  sources.addEventListener('click', () => { tab = 'sources'; process = false; sync(true); onChange(); });
  results.addEventListener('click', () => { tab = 'results'; sync(true); onChange(); });
  scope.addEventListener('click', () => { all = !all; sync(); onChange(); });
  function render(nextRows, selectedKey) {
    rows = nextRows; selected = selectedKey;
    const nextSignature = JSON.stringify(rows);
    if (nextSignature !== signature) {
      signature = nextSignature;
      const headRow = make('div', 'image-manager-summary-row image-manager-summary-head'); headRow.setAttribute('role', 'row');
      for (const text of ['序号', 'SKU名称', '图片', '图片任务状态', '主图视频', '富内容视频']) {
        const cell = make('div', '', text); cell.setAttribute('role', 'columnheader'); headRow.append(cell);
      }
      summary.setAttribute('role', 'table'); summary.setAttribute('aria-label', 'SKU 图片与处理任务'); summary.replaceChildren(headRow);
      for (const row of rows) {
        const node = make('div', 'image-manager-summary-row image-manager-summary-item'); node.dataset.imageSkuKey = row.skuRowKey;
        node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', `管理${row.name}的图片`);
        node.addEventListener('click', () => open(row.skuRowKey));
        node.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(row.skuRowKey); } });
        const name = make('div', 'image-manager-summary-name', row.name); name.title = row.name;
        const thumbnails = make('div', 'image-manager-summary-images');
        for (const item of row.images.slice(0, 4)) {
          const image = make('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
          thumbnails.append(image);
        }
        if (row.images.length > 4) thumbnails.append(make('span', 'image-manager-summary-more', `+${row.images.length - 4}`));
        if (!row.images.length) thumbnails.append(make('span', 'image-manager-summary-no-image', '无图'));
        const tasks = make('div', 'image-manager-summary-task');
        for (const line of row.taskStatusLines) tasks.append(make('span', `image-manager-summary-task-line is-${line.status}`, line.text));
        if (!row.taskStatusLines.length) tasks.append(make('span', 'image-manager-summary-task-empty', '暂无任务'));
        if (row.historyTaskStatusLines?.length) {
          const history = make('details', 'precision-image-task-history'); history.dataset.historySku = row.skuRowKey;
          history.open = expandedHistory.has(row.skuRowKey);
          history.append(make('summary', '', `${row.historyTaskStatusLines.length} 条历史任务`));
          for (const line of row.historyTaskStatusLines) history.append(make('span', `image-manager-summary-task-line is-${line.status}`, line.text));
          history.addEventListener('click', event => event.stopPropagation());
          history.addEventListener('keydown', event => event.stopPropagation());
          history.addEventListener('toggle', () => { if (history.open) expandedHistory.add(row.skuRowKey); else expandedHistory.delete(row.skuRowKey); });
          tasks.append(history);
        }
        node.append(make('div', 'image-manager-summary-index', row.index), name, thumbnails, tasks);
        for (const label of ['主图视频', '富内容视频']) {
          const video = make('div', 'image-manager-summary-video'); video.title = `${label}：查看来源或设置草稿视频`;
          const icon = make('span', 'image-manager-video-icon', '▹'); icon.setAttribute('aria-label', label);
          video.append(icon); node.append(video);
          renderVideoCell?.(video, { skuKey: row.skuRowKey, label, role: label === '主图视频' ? 'MAIN' : 'RICH_CONTENT' });
        }
        summary.append(node);
      }
    }
    if (!rows.some(row => row.skuRowKey === selected)) hide();
    sync();
  }
  return { render, open, close: hide, sourcePanel, resultPanel, foot,
    setMode(mode, disabled) { modes.querySelectorAll('button').forEach(button => { button.disabled = disabled;
      button.classList.toggle('is-active', button.dataset.imageMode === mode); button.setAttribute('aria-pressed', String(button.dataset.imageMode === mode)); }); },
    state: () => ({ selectedSkuKey: selected, tab, all, open: !modal.hidden }) };
}
