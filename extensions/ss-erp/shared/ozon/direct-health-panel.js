// 直连通道的启动自检面板
//
// 背景（实跑精铺与本次改造得到）：
//   扩展里所有「点了没反应」的问题，最终都指向某个前置条件没满足，
//   而且失败信息不可读：
//     - panel iframe fetch 失败只报 "Failed to fetch"，拿不到状态码
//     - 精铺把 403 FreeTierOnly 报成 "Model not exist"
//     - 我们的 ERP operation 卡死只显示「未确认，请核对原操作」
//   这个面板在开跑前把三件事一次性说清楚：Ozon 直连、生图 Provider、凭据。

import { describeCheck } from './direct-check-presentation.js';

const CHECK_STATE = {
  idle: { label: '未检查', tone: 'idle' },
  running: { label: '检查中', tone: 'running' },
  ok: { label: '正常', tone: 'ok' },
  warn: { label: '注意', tone: 'warn' },
  bad: { label: '异常', tone: 'bad' },
};

/**
 * 创建一个自检面板。
 *
 * @param {object} input
 *   root       挂载容器
 *   send       (message) => Promise<{ok, result, error}>  直连消息发送器
 *   make       (tag, className, text) => element
 */
export function createDirectHealthPanel({ root, send, make }) {
  const panel = make('section', 'precision-direct-health');
  panel.id = 'precision-direct-health';
  const head = make('div', 'precision-direct-health-head');
  const title = make('span', 'precision-direct-health-title', '直连通道自检');
  const badge = make('span', 'precision-direct-health-badge', '未检查');
  badge.dataset.tone = 'idle';
  const run = make('button', 'ghost precision-direct-health-run', '检查');
  run.type = 'button';
  head.append(title, badge, run);

  const body = make('div', 'precision-direct-health-body');
  const rows = new Map();

  const rowFor = (key, label) => {
    if (rows.has(key)) return rows.get(key);
    const row = make('div', 'precision-direct-health-row');
    row.dataset.key = key;
    const name = make('span', 'precision-direct-health-name', label);
    const state = make('span', 'precision-direct-health-state', '—');
    state.dataset.tone = 'idle';
    const detail = make('span', 'precision-direct-health-detail', '');
    row.append(name, state, detail);
    body.append(row);
    const entry = { row, name, state, detail };
    rows.set(key, entry);
    return entry;
  };

  const setRow = (key, label, state, text) => {
    const entry = rowFor(key, label);
    entry.state.textContent = CHECK_STATE[state] ? CHECK_STATE[state].label : String(state);
    entry.state.dataset.tone = CHECK_STATE[state] ? CHECK_STATE[state].tone : 'idle';
    entry.detail.textContent = String(text || '').slice(0, 220);
    entry.row.title = String(text || '');
  };

  panel.append(head, body);
  root.append(panel);

  let busy = false;
  let lastResult = null;

  async function check() {
    if (busy) return lastResult;
    busy = true;
    run.disabled = true;
    badge.textContent = '检查中';
    badge.dataset.tone = 'running';

    const result = { at: Date.now(), ozon: null, image: null, credentials: null };

    // 1. 凭据
    try {
      const reply = await send({ type: 'ss-erp:direct-ozon-credentials-read' });
      const credentials = reply && reply.ok ? reply.result : null;
      if (!credentials) {
        result.credentials = { ok: false, kind: 'NO_CREDENTIALS', message: '未配置 Ozon Client-Id / Api-Key' };
      } else {
        result.credentials = {
          ok: true, kind: 'OK',
          message: `Client-Id ${credentials.clientId}${credentials.label ? '（' + credentials.label + '）' : ''}`,
        };
      }
    } catch (error) {
      result.credentials = { ok: false, kind: 'ERROR', message: String((error && error.message) || error) };
    }
    setRow('credentials', 'Ozon 凭据', result.credentials.ok ? 'ok' : 'bad', result.credentials.message);

    // 2. Ozon 直连（真正发一次最小请求）
    try {
      const reply = await send({ type: 'ss-erp:direct-ozon-probe' });
      result.ozon = (reply && reply.result) || { ok: false, kind: 'ERROR', message: String((reply && reply.error) || '无返回') };
    } catch (error) {
      result.ozon = { ok: false, kind: 'ERROR', message: String((error && error.message) || error) };
    }
    setRow('ozon', 'Ozon 直连', result.ozon.ok ? 'ok' : 'bad',
      describeCheck(result.ozon));

    // 3. 生图 Provider
    try {
      const reply = await send({ type: 'ss-erp:direct-image-probe' });
      result.image = (reply && reply.result) || { ok: false, kind: 'ERROR', message: String((reply && reply.error) || '无返回') };
    } catch (error) {
      result.image = { ok: false, kind: 'ERROR', message: String((error && error.message) || error) };
    }
    setRow('image', '生图 Provider', result.image.ok ? 'ok' : 'bad',
      describeCheck(result.image));

    const allOk = result.credentials.ok && result.ozon.ok && result.image.ok;
    const anyBad = !result.credentials.ok || !result.ozon.ok || !result.image.ok;
    badge.textContent = allOk ? '全部正常' : anyBad ? '需要处理' : '部分可用';
    badge.dataset.tone = allOk ? 'ok' : 'bad';

    busy = false;
    run.disabled = false;
    lastResult = result;
    return result;
  }

  run.addEventListener('click', () => { void check(); });

  /** 供外部在开跑前强制门禁用 */
  async function ensureReady() {
    const result = await check();
    const blockers = [];
    if (!result.credentials.ok) blockers.push('Ozon 凭据：' + result.credentials.message);
    if (!result.ozon.ok) blockers.push('Ozon 直连：' + describeCheck(result.ozon));
    if (!result.image.ok) blockers.push('生图 Provider：' + describeCheck(result.image));
    return { ready: blockers.length === 0, blockers, result };
  }

  return {
    element: panel,
    check,
    ensureReady,
    last: () => lastResult,
    setCollapsed(collapsed) { body.hidden = collapsed === true; },
  };
}
