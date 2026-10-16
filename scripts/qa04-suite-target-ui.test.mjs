import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { verifyCurrentSuiteUiEvidence } from './qa04-suite-target-ui.mjs';
const require = createRequire(import.meta.url), sharp = require('../apps/server/node_modules/sharp');
const screenshot = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#ffffff' } }).png().toBuffer();
const hash = 'a'.repeat(64), commit = 'b'.repeat(40), NOW = '2026-10-16T12:00:00.000Z';
const cssPath = 'extensions/ss-erp/pages/precision-workbench.css';
const bridge = { targetCommit: commit, changes: [{ path: cssPath, kind: 'CSS_PRESENTATION', targetObjectId: 'c'.repeat(40) }] };
function fixture() {
  const record = { schemaVersion: 1, kind: 'SS_ERP_SUITE_TARGET_UI_READBACK', gitCommit: commit,
    version: '1.0.459', observedAt: '2026-10-16T11:59:00.000Z',
    releaseSignatureSha256: hash, cloudZipSha256: hash, installedTreeSha256: hash,
    workerScriptSha256: hash, runtimeWorkerScriptSha256: hash,
    visible: true, sourcePageVisible: true, controlsVisible: true, mutations: 0,
    viewport: { width: 1200, height: 900 },
    css: [{ path: cssPath, targetObjectId: 'c'.repeat(40), applied: true }],
    screenshot: { path: '/private/current-ui.png', sha256: hash } };
  return { record, read: { json: () => record, read: () => screenshot } };
}
test('CSS suite reuse requires fresh target UI and preserves explicit signature binding', () => {
  const f = fixture();
  const result = verifyCurrentSuiteUiEvidence(f.read, { sha256: hash }, bridge, '2026-10-16T11:40:00.000Z', NOW);
  assert.equal(result.releaseSignatureSha256, hash); assert.equal(result.observedAt, f.record.observedAt);
});
test('stale, hidden, wrong-version-source and unapplied CSS proof cannot replace a target UI check', () => {
  for (const mutate of [r => { r.gitCommit = 'd'.repeat(40); }, r => { r.observedAt = '2026-10-16T11:30:00.000Z'; },
    r => { r.visible = false; }, r => { r.mutations = 1; }, r => { r.controlsVisible = false; },
    r => { r.runtimeWorkerScriptSha256 = 'd'.repeat(64); }, r => { r.css[0].applied = false; },
    r => { r.css = []; }, r => { r.css[0].targetObjectId = 'd'.repeat(40); }]) {
    const f = fixture(); mutate(f.record);
    assert.throws(() => verifyCurrentSuiteUiEvidence(f.read, { sha256: hash }, bridge, '2026-10-16T11:40:00.000Z', NOW));
  }
});
