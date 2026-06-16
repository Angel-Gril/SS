import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

function extractFunction(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${name} body must start`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} body must close`);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext([
  extractFunction('containsCjkText'),
  extractFunction('normalizeCollectedTitleText'),
  extractFunction('pickOzonRussianTitleFromInsights'),
  extractFunction('repairOzonCollectedTitleFromInsights'),
].join('\n'), sandbox);

const product = {
  title: '室内装饰品',
  publishTitle: '室内装饰品',
  sourceTitleRaw: '室内装饰品',
};

sandbox.repairOzonCollectedTitleFromInsights(product, {
  item: {
    name: 'Рафия ручной работы декор на стену для интерьера',
  },
});

assert.equal(product.title, 'Рафия ручной работы декор на стену для интерьера');
assert.equal(product.publishTitle, 'Рафия ручной работы декор на стену для интерьера');
assert.equal(product.sourceTitleRaw, 'Рафия ручной работы декор на стену для интерьера');
assert.equal(product.sourceTitleTranslated, '室内装饰品');

const unchanged = { title: '室内装饰品', publishTitle: '室内装饰品', sourceTitleRaw: '室内装饰品' };
sandbox.repairOzonCollectedTitleFromInsights(unchanged, {
  item: { name: '室内装饰品' },
});
assert.equal(unchanged.title, '室内装饰品');

console.log('PASS Ozon collected title repair from seller insights');
