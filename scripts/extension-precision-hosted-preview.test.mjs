import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const previewSource = readFileSync('extensions/ss-erp/pages/donor/ui/presentation/views/preview-view.js', 'utf8')
  .replace('import { t } from "../../modules/i18n.js";', 'const t = (_key, _values, fallback) => fallback;')
  .replace('export function createPreviewController', 'function createPreviewController');
function imageNode() {
  const requests = [], attributes = {}, node = { requests, attributes,
    crossOrigin: null, removeAttribute(name) { delete attributes[name]; if (name === 'crossorigin') this.crossOrigin = null; } };
  Object.defineProperty(node, 'src', { set(url) { requests.push({ url, mode: this.crossOrigin }); }, get() { return requests.at(-1)?.url; } });
  return node;
}
test('candidate preview uses anonymous CORS before assigning its image URL', () => {
  const context = {}; vm.runInNewContext(previewSource + '\nthis.create=createPreviewController;', context);
  const image = imageNode(), els = { previewImage: image, previewModal: { hidden: true }, previewTitle: {}, previewDesc: {} };
  const items = [{ id: 'candidate:asset', originalUrl: 'https://app.ss-erp-fixture.invalid/api/cdn/output.png', crossOrigin: 'anonymous', group: 'gallery' },
    { id: 'source', originalUrl: 'https://source-fixture.invalid/item.jpg', group: 'gallery' }];
  const controller = context.create({ els, text: { previewTitle: '预览', previewDesc: () => '图片' },
    getRoleLabel: () => '', getStatusLabel: () => '', getItems: () => items });
  controller.open({ id: 'candidate:asset' });
  assert.equal(image.requests.at(-1).mode, 'anonymous');
  controller.next();
  assert.equal(image.requests.at(-1).url, items[1].originalUrl);
  assert.equal(image.requests.at(-1).mode, null, 'source images keep their existing loading mode');
  controller.prev();
  assert.equal(image.requests.at(-1).mode, 'anonymous', 'previous/next must restore candidate CORS mode');
});
test('precision candidate thumbnails use the same CORS mode as the preview', () => {
  const source = readFileSync('extensions/ss-erp/pages/precision-workbench.js', 'utf8');
  const start = source.indexOf("      let image = card.querySelector('img');");
  const end = source.indexOf('      const reviewLabel', start);
  assert.ok(start >= 0 && end > start);
  const image = imageNode(), context = { card: { querySelector: () => null }, output: { url: 'https://app.ss-erp-fixture.invalid/api/cdn/output.png', id: 'asset' },
    make: () => image, item: { id: 'workflow' }, preview: { open() {} } };
  image.addEventListener = () => {};
  vm.runInNewContext(source.slice(start, end), context);
  assert.deepEqual(image.requests, [{ url: context.output.url, mode: 'anonymous' }]);
});
