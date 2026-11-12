// 视觉描述（多模态）—— 采集只跑一次，产出结构化报告
//
// 移植自精铺快照的 prompts.js / ai-prompt-plan.js：
//   一次视觉 → 一份报告 → 同时供 标题/描述/标签、属性观察、生图提示词 使用。
// 之前我们把视觉做成「点一次按钮只喂标题」，属于用错了形态，这里改正。
//
// 走 SW 的 ss-erp:direct-ai-text（扩展页 origin 直接 fetch 会卡在 CORS）。

import { buildVisionPrompt, parseVisionReport, visionReportToPairs } from './vision-prompt.js';

const VISION_MODEL_DEFAULT = 'qwen3.8-flash';

function normalizeBase(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(text)) throw new Error('AI baseUrl 必须是 https 地址');
  return text;
}

/**
 * @param {object} input
 *   baseUrl, apiKey, model?
 *   product   { title, skus:[{ label, color, size }] }
 *   fields    官方属性字段（{name,description,options}）
 *   categoryTitle
 *   imageUrls [https]
 */
export async function describeProductWithAi(input) {
  const baseUrl = normalizeBase(input.baseUrl);
  const images = (Array.isArray(input.imageUrls) ? input.imageUrls : [])
    .filter((url) => /^https:\/\//.test(String(url))).slice(0, 3);
  if (!images.length) throw new Error('没有可用的 https 图片地址');
  const model = String(input.model || VISION_MODEL_DEFAULT);

  const prompt = buildVisionPrompt({
    product: input.product || { title: input.sourceTitle || '', skus: [] },
    fields: input.fields || [],
    categoryTitle: input.categoryTitle || input.typeName || '',
  });
  const userText = [
    input.product && input.product.title ? `【商品标题】${input.product.title}` : '',
    prompt,
  ].filter(Boolean).join('\n\n');

  const reply = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        contractVersion: 3,
        type: 'ss-erp:direct-ai-text',
        payload: {
          baseUrl,
          apiKey: input.apiKey,
          model,
          temperature: 0.2,
          maxTokens: 1200,
          // 视觉比纯文本慢：给 150 秒预算（SW 默认 60 秒实测会超时）
          timeoutMs: 150000,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: userText },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          }],
        },
      }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(String(lastError.message || lastError).slice(0, 200))); return; }
        if (!response) { reject(new Error('视觉通道没有返回')); return; }
        if (response.ok === false) { reject(new Error(String(response.error || '视觉请求失败').slice(0, 240))); return; }
        resolve(response.result);
      });
    } catch (error) { reject(error); }
  });

  const raw = String((reply && reply.content) || '').trim();
  if (!raw) throw new Error('视觉模型没有返回内容');
  const report = parseVisionReport(raw);
  const pairs = visionReportToPairs(report);
  const summary = report
    ? [report['视觉总结'], Array.isArray(report['核心卖点']) ? report['核心卖点'].slice(0, 3).join('；') : '']
      .filter(Boolean).join(' ｜ ')
    : raw.split(/\r?\n/)[0].slice(0, 200);
  return { report, pairs, summary: summary || raw.slice(0, 200), raw, model, images: images.length };
}

/** 兼容旧调用：把报告转成标题用的属性对 */
export function visionToAttributePairs(reportOrFields) {
  if (!reportOrFields) return [];
  if (reportOrFields['视觉总结'] || reportOrFields['属性观察']) return visionReportToPairs(reportOrFields);
  return [];
}
