import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAiMediaHostedPilotPolicy } from './verify-ai-media-pilot-policy.mjs';

const owner = 'owner-1';
const shop = 'shop-1';
const devices = ['device-1', 'device-2'];
const expected = {
  ownerUserIds: [owner], shopIds: [shop], deviceSessionIds: devices,
  rolloutRevision: 15, sourcePolicyRevision: 'pilot-16',
  allowedOperations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT', 'SUITE'],
};

function snapshot(overrides = {}) {
  const sourceFeatures = {
    SOURCE_LISTING_WORKFLOW: {
      mode: 'pilot', ownerUserIds: [owner], shopIds: [shop], listingStage: 'dual_read', platforms: ['OZON'],
    },
    SOURCE_LISTING_EXTENSION_WORKBENCH: { mode: 'pilot', ownerUserIds: [owner] },
    SOURCE_LISTING_WEB_MEDIA: { mode: 'pilot', ownerUserIds: [owner] },
  };
  const configRows = [
    ...['feature_ai_media_workflow_v2', 'feature_ai_media_image_to_image', 'feature_ai_media_full_edit',
      'feature_ai_media_inpaint', 'feature_ai_media_suite', 'feature_extension_hosted_ai',
      'feature_source_listing_workflow', 'feature_source_listing_extension_workbench',
      'feature_source_listing_web_media'].map((key) => ({ key, value: 'true' })),
    { key: 'feature_source_ozon_publisher_v2', value: 'false' },
    { key: 'feature_extension_byok_ai', value: 'false' },
    { key: 'ai_media_workflow_v2_rollout_policy', value: JSON.stringify({ revision: 15, tenantIds: [owner], mode: 'allowlist' }) },
    { key: 'source_workflow_rollout_policy', value: JSON.stringify({ revision: 'pilot-16', features: sourceFeatures }) },
  ];
  const deviceSessions = devices.map((id) => ({
    id, status: 'ACTIVE', ownerUserId: owner, actorUserId: owner,
    scopes: ['capture:write', 'listing:review', 'listing:write', 'media:execute'], shopIds: [shop],
  }));
  return { configRows, deviceSessions, ...overrides };
}

test('accepts an exact hosted pilot snapshot', () => {
  assert.deepEqual(verifyAiMediaHostedPilotPolicy(snapshot(), expected), {
    expectation: 'hosted-pilot', ...expected,
  });
});

for (const [label, mutate] of [
  ['wrong owner', (value) => { value.configRows.find((row) => row.key === 'ai_media_workflow_v2_rollout_policy').value = JSON.stringify({ revision: 15, tenantIds: ['other'], mode: 'allowlist' }); }],
  ['wrong source revision', (value) => { value.configRows.find((row) => row.key === 'source_workflow_rollout_policy').value = JSON.stringify({ revision: 'pilot-old', features: {} }); }],
  ['enabled publisher', (value) => { value.configRows.find((row) => row.key === 'feature_source_ozon_publisher_v2').value = 'true'; }],
  ['revoked device', (value) => { value.deviceSessions[0].status = 'REVOKED'; }],
  ['extra scope', (value) => { value.deviceSessions[0].scopes.push('listing:publish'); }],
  ['wrong shop', (value) => { value.deviceSessions[1].shopIds = ['shop-2']; }],
]) {
  test(`rejects ${label}`, () => {
    const value = snapshot();
    mutate(value);
    assert.throws(() => verifyAiMediaHostedPilotPolicy(value, expected), /pilot|source|publisher|scope|shop|owner|revision/iu);
  });
}
