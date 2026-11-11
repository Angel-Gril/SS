// 直连凭据表单：Ozon 店铺 Key 与生图服务 Key 的唯一填写入口（工作台「设置」里）。
//
// 见 dev-docs/extension-direction.md：Key 由用户填写，保存在浏览器本地。
// 表单只显示“是否已配置”与非敏感信息（Client-Id、服务地址、模型名），不回显任何 Key；
// Key 输入框保存后立即清空。
import { describeCheck } from '../../shared/ozon/direct-check-presentation.js';

function serviceOrigin(baseUrl) {
  let origin;
  try { origin = new URL(String(baseUrl || '')).origin; } catch { throw new Error('服务地址不是有效的网址'); }
  if (!origin.startsWith('https://')) throw new Error('服务地址必须以 https:// 开头');
  return origin;
}

/**
 * 确保浏览器允许扩展访问给定的主机。打包版里任意 https 主机是“可选权限”，
 * 需要在用户点击时向浏览器申请一次；已授予时不会弹窗。必须在可信点击的处理过程中调用。
 */
async function ensureHostAccess(origins, deniedMessage, permissions = globalThis.chrome && globalThis.chrome.permissions) {
  if (!permissions || typeof permissions.contains !== 'function') return;
  const pattern = { origins };
  const call = (method) => new Promise((resolve, reject) => {
    try {
      const pending = permissions[method](pattern, resolve);
      if (pending && typeof pending.then === 'function') pending.then(resolve, reject);
    } catch (error) { reject(error); }
  });
  if (await call('contains').catch(() => false)) return;
  if (!await call('request').catch(() => false)) throw new Error(deniedMessage);
}

/** 文本模型等只需要访问服务地址本身。 */
export async function ensureOriginAccess(baseUrl, permissions) {
  const origin = serviceOrigin(baseUrl);
  await ensureHostAccess([origin + '/*'], `浏览器没有授予访问 ${origin} 的权限，无法连接该服务`, permissions);
  return origin;
}

/**
 * 生图需要的访问范围比服务地址更大：扩展要下载来源商品图作为参考图（货源平台的图片域名），
 * 还要下载生图服务返回的结果图（地址由服务商决定）再托管到 ERP。这些主机事先无法列举，
 * 所以这里申请一次“所有 https 网站”的访问权限。
 */
export async function ensureImageHostAccess(baseUrl, permissions) {
  const origin = serviceOrigin(baseUrl);
  await ensureHostAccess(['https://*/*'], '浏览器没有授予访问图片地址的权限，无法下载参考图和生成结果', permissions);
  return origin;
}

export function createDirectCredentialsForm({ make, send, onSaved = () => {} }) {
  const panel = make('section', 'ss-direct-credentials'); panel.id = 'precision-direct-credentials';
  const field = (label, input) => { const row = make('label', 'ss-direct-credentials-field'); row.append(make('span', '', label), input); return row; };
  const input = (id, type, placeholder) => {
    const node = make('input'); node.id = id; node.type = type; node.placeholder = placeholder;
    node.autocomplete = 'off'; node.spellcheck = false; return node;
  };
  function group(title, hint, fields, saveLabel, saveId) {
    const box = make('div', 'ss-direct-credentials-group');
    const status = make('p', 'ss-direct-credentials-status'); status.setAttribute('role', 'status');
    const save = make('button', 'primary', saveLabel); save.type = 'button'; save.id = saveId;
    const grid = make('div', 'ss-direct-credentials-grid'); grid.append(...fields);
    box.append(make('strong', '', title), make('p', 'settings-tip', hint), grid, save, status);
    return { box, status, save };
  }
  const setStatus = (node, text, tone = '') => { node.textContent = text; node.dataset.tone = tone; };

  const clientId = input('direct-ozon-client-id', 'text', '例如 1234567');
  const ozonKey = input('direct-ozon-api-key', 'password', '保存后不再显示');
  const ozon = group('Ozon 店铺', '在 Ozon 卖家后台「设置 → API 密钥」创建；用于读取类目属性、上架和改库存。',
    [field('Client-Id', clientId), field('Api-Key', ozonKey)], '保存 Ozon 密钥', 'direct-ozon-save');

  const imageBase = input('direct-image-base-url', 'url', 'https://…/v1');
  const imageModel = input('direct-image-model', 'text', '例如 gpt-image-2');
  const imageKey = input('direct-image-api-key', 'password', '保存后不再显示');
  const imageSize = input('direct-image-size', 'text', '1008x1344');
  const image = group('生图服务', '任意兼容 OpenAI 图片接口的服务；翻译、AI 主图和 AI 套图都用它，费用由该服务商收取。保存时浏览器可能询问一次“访问所有网站”的权限：用于下载参考图和生成结果。',
    [field('服务地址', imageBase), field('模型', imageModel), field('API Key', imageKey), field('尺寸（可选）', imageSize)],
    '保存生图服务', 'direct-image-save');

  panel.append(make('h3', '', '直连密钥'),
    make('p', 'settings-tip', '密钥只保存在这台电脑的浏览器里，不会上传到 ERP。多人共用电脑时请勿保存。'), ozon.box, image.box);

  async function refresh() {
    try {
      const saved = await send('ss-erp:direct-ozon-credentials-read', {});
      setStatus(ozon.status, saved ? `已配置：Client-Id ${saved.clientId}` : '尚未配置', saved ? 'ok' : '');
      if (saved && !clientId.value) clientId.value = saved.clientId;
    } catch (error) { setStatus(ozon.status, String(error && error.message || error), 'err'); }
    try {
      const saved = await send('ss-erp:direct-image-provider-read', {});
      setStatus(image.status, saved ? `已配置：${saved.model} · ${new URL(saved.baseUrl).host}` : '尚未配置', saved ? 'ok' : '');
      if (saved) {
        if (!imageBase.value) imageBase.value = saved.baseUrl;
        if (!imageModel.value) imageModel.value = saved.model;
        if (!imageSize.value) imageSize.value = saved.size || '';
      }
    } catch (error) { setStatus(image.status, String(error && error.message || error), 'err'); }
  }

  async function run(target, task) {
    target.save.disabled = true;
    setStatus(target.status, '正在保存并检查连接…');
    try { await task(); } catch (error) { setStatus(target.status, String(error && error.message || error).slice(0, 200), 'err'); }
    finally { target.save.disabled = false; }
  }

  ozon.save.addEventListener('click', (event) => {
    if (!event.isTrusted || ozon.save.disabled) return;
    void run(ozon, async () => {
      const saved = await send('ss-erp:direct-ozon-credentials-write', { clientId: clientId.value, apiKey: ozonKey.value });
      ozonKey.value = '';
      const probe = await send('ss-erp:direct-ozon-probe', {});
      setStatus(ozon.status, probe && probe.ok ? `已保存并连接成功：Client-Id ${saved.clientId}`
        : `已保存，但连接检查未通过：${describeCheck(probe)}`, probe && probe.ok ? 'ok' : 'warn');
      onSaved('ozon');
    });
  });
  image.save.addEventListener('click', (event) => {
    if (!event.isTrusted || image.save.disabled) return;
    void run(image, async () => {
      const baseUrl = String(imageBase.value || '').trim().replace(/\/+$/u, '');
      await ensureImageHostAccess(baseUrl);
      const saved = await send('ss-erp:direct-image-provider-write', {
        baseUrl, model: imageModel.value, apiKey: imageKey.value, ...(imageSize.value.trim() ? { size: imageSize.value.trim() } : {}),
      });
      imageKey.value = '';
      const probe = await send('ss-erp:direct-image-probe', {});
      setStatus(image.status, probe && probe.ok && probe.kind === 'OK' ? `已保存并连接成功：${saved.model}`
        : `已保存，但连接检查未通过：${describeCheck(probe)}`, probe && probe.ok && probe.kind === 'OK' ? 'ok' : 'warn');
      onSaved('image');
    });
  });

  return { panel, refresh };
}
