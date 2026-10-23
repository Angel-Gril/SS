import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  parseSourcePolicy, parseTenantPolicy, prepareAccessSave, describeAccessChanges,
  buildOptionsPath, mergeOptions,
  initializeSourcePolicy,
  accessRegionLabel, ACCESS_EXTRA_FLAGS,
} from '../apps/web/src/components/admin/extension-access-state.mjs';

const source = { revision: 'current', features: {
  SOURCE_LISTING_WORKFLOW: { mode: 'pilot', listingStage: 'v2_only', ownerUserIds: ['owner-a'], shopIds: ['shop-a'] },
} };
const rows = [
  { key: 'source_workflow_rollout_policy', value: JSON.stringify(source), revision: 9 },
  { key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":2,"tenantIds":["owner-a"]}', revision: 4 },
  { key: 'feature_ai_media_suite', value: 'false', revision: 3 },
];

test('parsing invalid or missing policies never substitutes an off policy', () => {
  for (const raw of ['', '{}', 'null', '[1]', '{']) assert.equal(parseSourcePolicy(raw).value, null);
  assert.equal(parseTenantPolicy('bad').value, null);
  assert.equal(parseTenantPolicy('{"revision":1,"mode":"all","tenantIds":["a"]}').value, null);
  assert.equal(parseTenantPolicy('{"revision":1,"tenantIds":["a","a"]}').value, null);
  assert.deepEqual(parseSourcePolicy(JSON.stringify(source)).value, source);
});

test('source-stage and listing pilot constraints reflect the existing owner contract', () => {
  const parse = (feature, rule) => parseSourcePolicy(JSON.stringify({ revision: 'r', features: { [feature]: rule } }));
  assert.equal(parse('SOURCE_LISTING_WORKFLOW', { mode: 'pilot', deviceSessionIds: ['d'] }).value, null);
  assert.equal(parse('SOURCE_OZON_MAPPING_V2_WRITE', { mode: 'pilot', ownerUserIds: ['o'] }).value, null);
  assert.equal(parse('SOURCE_NETWORK_CAPTURE', { mode: 'global', listingStage: 'v2_only' }).value, null);
  assert.ok(parse('SOURCE_CAPTURE_V2', { mode: 'pilot', ownerUserIds: ['o'], stage: 'dual_read' }).value);
  assert.ok(parse('SOURCE_LISTING_EXTENSION_WORKBENCH', { mode: 'pilot', deviceSessionIds: ['d'] }).value);
});

test('round trips keep unlisted IDs and unknown feature entries intact', () => {
  const existing = { ...source, features: { ...source.features, FUTURE_FEATURE: { mode: 'off' } } };
  const parsed = parseSourcePolicy(JSON.stringify(existing)).value;
  assert.deepEqual(parsed, existing);
  assert.deepEqual(parsed.features.SOURCE_LISTING_WORKFLOW.shopIds, ['shop-a']);
});

test('save sends only changed keys with exact server revisions and increments policy revisions', () => {
  const draft = Object.fromEntries(rows.map(row => [row.key, row.value]));
  assert.deepEqual(prepareAccessSave(rows, draft, 'next'), []);
  draft.feature_ai_media_suite = 'true';
  draft.ai_media_workflow_v2_rollout_policy = '{"revision":2,"mode":"all","tenantIds":[]}';
  draft.source_workflow_rollout_policy = JSON.stringify({ ...source, features: { ...source.features, SOURCE_CAPTURE_V2: { mode: 'global', stage: 'v2_only' } } });
  const items = prepareAccessSave(rows, draft, 'next');
  assert.equal(items.length, 3);
  assert.equal(items.find(x => x.key === 'feature_ai_media_suite').expectedRevision, 3);
  assert.equal(JSON.parse(items.find(x => x.key === 'source_workflow_rollout_policy').value).revision, 'next');
  assert.equal(JSON.parse(items.find(x => x.key === 'ai_media_workflow_v2_rollout_policy').value).revision, 3);
  assert.equal(draft.ai_media_workflow_v2_rollout_policy, '{"revision":2,"mode":"all","tenantIds":[]}');
  assert.throws(() => prepareAccessSave(rows, { missing: 'true' }, 'next'), /配置项/);
});

test('save rejects malformed drafts, invalid booleans and invalid pilot dimensions', () => {
  assert.throws(() => prepareAccessSave(rows, { feature_ai_media_suite: '' }, 'r'), /开关/);
  assert.throws(() => prepareAccessSave(rows, { source_workflow_rollout_policy: '{}' }, 'r'), /策略/);
  assert.throws(() => prepareAccessSave(rows, { ai_media_workflow_v2_rollout_policy: 'null' }, 'r'), /策略/);
});

test('impact summary identifies global expansion, removed restrictions and added grants', () => {
  const global = JSON.stringify({ revision: 'r', features: { SOURCE_LISTING_WORKFLOW: { mode: 'global', listingStage: 'v2_only' } } });
  const changes = describeAccessChanges(rows, { source_workflow_rollout_policy: global });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].expands, true);
  assert.match(changes[0].detail, /全部/);
  const tenant = describeAccessChanges(rows, { ai_media_workflow_v2_rollout_policy: '{"revision":2,"tenantIds":["owner-a","owner-b"]}' });
  assert.equal(tenant[0].expands, true);
  const off = describeAccessChanges(rows, { feature_ai_media_suite: 'true' });
  assert.equal(off[0].expands, true);
  const changedShop = JSON.stringify({ ...source, features: { SOURCE_LISTING_WORKFLOW: { ...source.features.SOURCE_LISTING_WORKFLOW, shopIds: ['shop-b'] } } });
  assert.match(describeAccessChanges(rows, { source_workflow_rollout_policy: changedShop })[0].detail, /shop-a.*shop-b/);
});

test('safe options query bounds owner lists and merge retains selected records across search', () => {
  assert.equal(buildOptionsPath(' a&b ', ['owner-a', 'owner-a']), '/api/admin/extension-rollout/options?search=a%26b&ownerUserIds=owner-a&limit=100');
  assert.throws(() => buildOptionsPath('', Array.from({length: 51}, (_, i) => `o${i}`)), /50/);
  const a = { owners: [{ id: 'a', nickname: 'A' }], shops: [], devices: [], features: [], hasMore: { owners: true, shops: false, devices: false } };
  const b = { ...a, owners: [{ id: 'b', nickname: 'B' }] };
  assert.deepEqual(mergeOptions(a, b).owners.map(x => x.id), ['a', 'b']);
});

test('empty initial source policy requires explicit confirmation and never resets malformed policies', () => {
  assert.equal(initializeSourcePolicy('{}', false), null);
  for (const raw of ['', 'null', '{bad', '{"revision":"existing"}', ' {} ']) assert.equal(initializeSourcePolicy(raw, true), null);
  const value = initializeSourcePolicy('{}', true);
  assert.deepEqual(value, { revision: 'admin-initial', features: {} });
  assert.deepEqual(prepareAccessSave([{ key: 'source_workflow_rollout_policy', value: '{}', revision: 1 }], { source_workflow_rollout_policy: '{}' }, 'new'), []);
  assert.equal(describeAccessChanges([{ key: 'source_workflow_rollout_policy', value: '{}', revision: 1 }], { source_workflow_rollout_policy: JSON.stringify(value) })[0].expands, false);
});

test('settings use structured controls and preserve edits on conflicts until explicit refresh', () => {
  const panel = readFileSync('apps/web/src/components/admin/extension-access-admin-controls.tsx', 'utf8');
  const page = readFileSync('apps/web/src/app/(dashboard)/admin/settings/page-client.tsx', 'utf8');
  assert.match(page, /<ExtensionAccessAdminControls/);
  assert.match(panel, /system_config_revision_conflict/);
  assert.match(panel, /setConflict\(true\)/);
  assert.match(panel, /expectedRevision/);
  assert.match(panel, /Dialog/);
  assert.match(panel, /prepareAccessSave/);
  assert.doesNotMatch(panel, /window\.confirm|JSON\.parse\(.*\)\s*\|\|\s*\{/);
});

test('hosted master and translation have one editor and region labels identify exact destination', () => {
  assert.ok(ACCESS_EXTRA_FLAGS.includes('feature_extension_hosted_ai'));
  assert.ok(ACCESS_EXTRA_FLAGS.includes('feature_image_translate'));
  const byok = readFileSync('apps/web/src/components/admin/extension-ai-admin-controls.tsx', 'utf8');
  assert.doesNotMatch(byok, /configs\.feature_extension_hosted_ai/);
  assert.doesNotMatch(byok, /'feature_extension_hosted_ai'/);
  assert.equal(accessRegionLabel('admin.ss-erp.cn'), 'CN · admin.ss-erp.cn');
  assert.equal(accessRegionLabel('admin.ss-erp.com'), 'COM · admin.ss-erp.com');
  assert.equal(accessRegionLabel('127.0.0.1'), '本机 · 127.0.0.1');
  assert.equal(accessRegionLabel('erp.example'), 'erp.example');
});
