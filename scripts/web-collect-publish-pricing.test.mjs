import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('apps/web/src/lib/collect-publish-pricing.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const sandbox = { exports: {}, module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(compiled, sandbox);

const resolveVariantPublishPreviewPrice = sandbox.exports.resolveVariantPublishPreviewPrice;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(resolveVariantPublishPreviewPrice({
  manualPrice: '30',
  variantPrice: '13.05',
  groupBasePrice: '13.05',
  markupPct: 100,
  markupAmount: 10,
})), { finalPrice: 30, manual: true, source: 'manual' });

assert.deepEqual(plain(resolveVariantPublishPreviewPrice({
  manualPrice: '',
  variantPrice: '86.08',
  groupBasePrice: '13.05',
  markupPct: 0,
  markupAmount: 0,
})), { finalPrice: 87, manual: false, source: 'variant' });

assert.deepEqual(plain(resolveVariantPublishPreviewPrice({
  manualPrice: '',
  variantPrice: '86.08',
  groupBasePrice: '13.05',
  markupPct: 10,
  markupAmount: 5,
})), { finalPrice: 100, manual: false, source: 'variant' });

assert.deepEqual(plain(resolveVariantPublishPreviewPrice({
  manualPrice: '',
  variantPrice: '',
  groupBasePrice: '13.05',
  markupPct: 0,
  markupAmount: 0,
})), { finalPrice: 14, manual: false, source: 'group' });

console.log('PASS web collect publish pricing');
