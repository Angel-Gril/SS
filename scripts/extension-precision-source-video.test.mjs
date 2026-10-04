import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceVideosForSku, resolveSourceVideo, createSourceVideoView } from '../extensions/ss-erp/pages/donor/source-video-view.js';
const main = { key: 'shared-video', url: 'https://media.example/product.mp4', skuKeys: [] };
const white = { key: 'white-video', url: 'https://media.example/white.webm', skuKeys: ['white'] };

test('source video choices include common media and only the exact canonical SKU', () => {
  assert.equal(typeof sourceVideosForSku, 'function');
  assert.deepEqual(sourceVideosForSku([main, white], 'black').map(item => item.key), ['shared-video']);
  assert.deepEqual(sourceVideosForSku([main, white], 'white').map(item => item.key), ['shared-video', 'white-video']);
  assert.deepEqual(sourceVideosForSku([main, white], '').map(item => item.key), ['shared-video']);
});

test('a preview resolves only a unique current video key and ignores caller supplied URLs', () => {
  assert.equal(typeof resolveSourceVideo, 'function');
  assert.equal(resolveSourceVideo([main], { key: main.key, url: 'https://foreign.example/fake.mp4' }, 'white').url, main.url);
  assert.equal(resolveSourceVideo([white], white.key, 'black'), null);
  assert.equal(resolveSourceVideo([main], 'https://foreign.example/fake.mp4', 'white'), null);
  assert.equal(resolveSourceVideo([{ ...main, url: 'https://foreign.example/fake.mp4' }, main], main.key, 'white'), null);
  assert.equal(resolveSourceVideo([], main.key, 'white'), null);
});

test('private, non-HTTPS, credentialed, non-video and invalid scope previews are unavailable', () => {
  assert.equal(typeof sourceVideosForSku, 'function');
  for (const url of ['', 'javascript:alert(1)', 'http://media.example/product.mp4', 'https://localhost/product.mp4',
    'https://preview.localhost/product.mp4', 'https://10.0.0.2/product.mp4', 'https://[::1]/product.mp4',
    'https://media.example/photo.jpg', 'https://user:secret@media.example/product.mp4', 'https://media.example/product.mp4#part']) {
    assert.deepEqual(sourceVideosForSku([{ ...main, url }], 'white'), [], url);
  }
  assert.deepEqual(sourceVideosForSku([{ ...main, skuKeys: [''] }], 'white'), []);
  assert.deepEqual(sourceVideosForSku([{ ...main, kind: 'image' }], 'white'), []);
  assert.deepEqual(sourceVideosForSku([{ ...main, skuKeys: undefined }], 'white'), []);
});

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.isConnected = true; this.dataset = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
  addEventListener(type, handler) { this.events[type] = handler; }
  focus() { this.ownerDocument.activeElement = this; }
  pause() { this.paused = true; }
  load() { this.loaded = true; }
  querySelectorAll() { return []; }
  click() { this.events.click?.({ stopPropagation() {}, preventDefault() {} }); }
}

test('same-window preview stops playback on close, handles failure, and closes when the source context changes', () => {
  assert.equal(typeof createSourceVideoView, 'function');
  const document = { createElement: tag => new Element(tag, document), activeElement: null };
  const root = new Element('body', document);
  let videos = [main, white], skuKey = 'white', contextKey = 'snapshot-1';
  const opener = new Element('button', document); opener.focus();
  const view = createSourceVideoView({ root, getVideos: () => videos, getSkuKey: () => skuKey,
    getContextKey: () => contextKey });
  assert.equal(view.open({ ...main, url: 'https://foreign.example/fake.mp4' }, opener), true);
  const modal = root.children[0], dialog = modal.children[0];
  const descend = node => [node, ...node.children.flatMap(descend)];
  const nodes = descend(dialog), player = nodes.find(node => node.tagName === 'video');
  assert.equal(player.src, main.url);
  assert.equal(player.preload, 'none');
  assert.equal(player.autoplay, false);
  assert.equal(modal.hidden, false);
  player.events.error();
  assert.ok(nodes.some(node => node.textContent.includes('无法播放')));
  view.close();
  assert.equal(modal.hidden, true);
  assert.equal(player.src, '');
  assert.equal(player.paused, true);
  assert.equal(document.activeElement, opener);
  assert.equal(view.open(white.key, opener), true);
  skuKey = 'black'; view.refresh();
  assert.equal(modal.hidden, true);
  assert.equal(view.open(white.key), false);
  assert.equal(view.open(main.key), true);
  contextKey = 'snapshot-2'; view.refresh();
  assert.equal(modal.hidden, true, 'even a shared video closes when the source context changes');
  videos = []; assert.equal(view.open(main.key), false);
});

test('summary video clicks select their exact SKU; empty rows expose no upload or fake generation action', () => {
  const document = { createElement: tag => new Element(tag, document), activeElement: null };
  const root = new Element('body', document);
  let skuKey = 'black';
  const view = createSourceVideoView({ root, getVideos: () => [white], getSkuKey: () => skuKey,
    onSelectSku: next => { skuKey = next; } });
  const cell = new Element('div', document);
  view.renderCell(cell, { skuKey: 'black' });
  assert.equal(cell.children[0].disabled, true);
  assert.equal(cell.children[0].title, '没有采集到来源视频');
  view.renderCell(cell, { skuKey: 'white' });
  const button = cell.children[0];
  assert.equal(button.disabled, false);
  assert.ok(button.attributes['aria-label'].includes('未提交 Ozon'));
  button.click();
  assert.equal(skuKey, 'white');
  assert.equal(root.children[0].hidden, false);
});
