import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function loadCommissionParser() {
  const source = readFileSync(join(root, 'extensions', 'ss-erp', 'shared', 'commission', 'commission-rates.js'), 'utf8');
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.OZON_CALC_COMMISSION_RATES;
}

function cell(text, attrs = {}) {
  return {
    type: 'tableCell',
    attrs: Object.assign({ type: 'td' }, attrs),
    content: text
      ? [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      : [],
  };
}

function row(cells) {
  return { type: 'tableRow', content: cells };
}

test('parses Ozon document-manager commission tables with rowspans', () => {
  const parser = loadCommissionParser();
  assert.equal(typeof parser.buildSnapshotFromOzonDocumentPayload, 'function');

  const payload = {
    document: {
      url: '/commissions/ozon-fees/commissions',
      contentJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ozon商品销售佣金（2025年12月1日起）' }] },
          {
            type: 'table',
            content: [
              row([cell('', { type: 'th', colspan: '2' }), cell('最多1500(含)', { type: 'th', colspan: '2' }), cell('最多5000(含)', { type: 'th', colspan: '2' }), cell('超过5000卢布', { type: 'th', colspan: '2' })]),
              row([cell('类目模块'), cell('商品类目'), cell('在rFBS方案下的销售佣金'), cell('在FBP方案下的销售佣金'), cell('在rFBS方案下的销售佣金'), cell('在FBP方案下的销售佣金'), cell('在rFBS方案下的销售佣金'), cell('在FBP方案下的销售佣金')]),
              row([cell('药房商品', { rowspan: '2' }), cell('药店'), cell('12,0%'), cell('11,0%'), cell('14,0%'), cell('13,0%'), cell('18,0%'), cell('17,0%')]),
              row([cell('矫形用品'), cell('12,0%'), cell('11,0%'), cell('17,0%'), cell('16,0%'), cell('17,0%'), cell('16,0%')]),
            ],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '关于折扣积分佣金的计算方式' }] },
        ],
      }),
    },
  };

  const snapshot = parser.buildSnapshotFromOzonDocumentPayload(payload, 'https://global-help.ozon.com/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=zh&childDocsRegion=CHN');

  assert.equal(snapshot.rules.length, 2);
  assert.equal(snapshot.rules[0].group, '药房商品');
  assert.equal(snapshot.rules[0].category, '药店');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.rules[0].bands)), [
    { minRUB: 0, maxRUB: 1500, rfbs: 12, fbp: 11 },
    { minRUB: 1500, maxRUB: 5000, rfbs: 14, fbp: 13 },
    { minRUB: 5000, maxRUB: 0, rfbs: 18, fbp: 17 },
  ]);
  assert.equal(snapshot.rules[1].group, '药房商品');
  assert.equal(snapshot.rules[1].category, '矫形用品');

  const match = parser.matchCommissionRate(snapshot, {
    categoryHints: ['药店'],
    priceRUB: 1600,
    scheme: 'fbp',
    manualRatePct: 99,
  });
  assert.equal(match.source, 'official');
  assert.equal(match.ratePct, 13);
});
