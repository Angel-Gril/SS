import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const file = 'apps/web/src/components/source-listing/source-product-image.tsx';
function harness() {
  assert.ok(fs.existsSync(file), 'source images need one reusable browser request/failure consumer');
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let state = null;
  const element = (type, props) => ({ type, props: props || {} });
  const sandbox = { exports: {}, URL, require(name) {
    if (name === 'react') return { useState: () => [state, next => { state = next; }] };
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    throw Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(compiled, sandbox, { filename: file });
  return props => sandbox.exports.SourceProductImage(props);
}
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === type) return tree;
  for (const child of [].concat(tree.props?.children || [])) { const found = find(child, type); if (found) return found; }
  return null;
}

test('source image requests omit ERP Referer without requiring third-party CORS support', () => {
  const render = harness();
  const image = find(render({ src: 'https://images.example/source.jpg' }), 'img');
  assert.equal(image.props.referrerPolicy, 'no-referrer');
  assert.equal(image.props.crossOrigin, undefined);
  assert.equal(image.props.src, 'https://images.example/source.jpg');
});

test('ERP persisted CDN images use anonymous CORS without session credentials', () => {
  const render = harness();
  for (const src of ['https://media.example/api/cdn/users/user/image.png', '/api/cdn/users/user/image.png']) {
    const image = find(render({ src }), 'img');
    assert.equal(image.props.crossOrigin, 'anonymous');
    assert.equal(image.props.referrerPolicy, 'no-referrer');
  }
});

test('failed image stays visible as a useful placeholder and a new URL can load normally', () => {
  const render = harness(), src = 'https://images.example/missing.jpg';
  const first = find(render({ src }), 'img');
  first.props.onError();
  const failed = render({ src });
  assert.equal(find(failed, 'img'), null);
  const placeholder = find(failed, 'span');
  assert.ok(placeholder);
  assert.match(String(placeholder.props.children), /图片暂不可用/);
  assert.ok(find(render({ src: 'https://images.example/replacement.jpg' }), 'img'));
});

test('collection list, detail thumbnail and all image-grid consumers share the image component', () => {
  const source = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let rawImages = 0, sharedImages = 0;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(ast) === 'img') rawImages += 1;
      if (node.tagName.getText(ast) === 'SourceProductImage') sharedImages += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(rawImages, 0, 'raw image paths must not keep sending the ERP Referer');
  assert.equal(sharedImages, 3);
  assert.doesNotMatch(source, /parentElement\?\.parentElement\?\.classList\.add\('hidden'\)/);
});
