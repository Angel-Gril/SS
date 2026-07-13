import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as workbenchState from '../apps/web/src/components/logistics-rules/workbench-state.mjs';

const {
  buildAdminLogisticsWorkspacePath,
  isChannelRetirementEligible,
  isChannelRetirementReady,
  isPublishContextCurrent,
  logisticsIssueTarget,
  normalizeChannelReceiptReconciliation,
} = workbenchState;

const pagePath = 'apps/web/src/app/(dashboard)/admin/logistics-rules/page.tsx';
const diffPath = 'apps/web/src/components/logistics-rules/rule-diff-view.tsx';
const bindingPath = 'apps/web/src/components/logistics-rules/method-binding-table.tsx';
const resolutionPath =
  'apps/web/src/components/logistics-rules/official-formula-resolution-table.tsx';
const capturePath = 'apps/web/src/components/logistics-rules/logistics-capture-workspace.tsx';
const receiptsPath = 'apps/web/src/components/logistics-rules/channel-receipt-reconciliation.tsx';

function readRequired(path) {
  assert.ok(fs.existsSync(path), `${path} must exist`);
  return fs.readFileSync(path, 'utf8');
}

test('super-admin navigation exposes and protects the logistics release workbench', () => {
  const sidebar = readRequired('apps/web/src/components/layout/sidebar.tsx');
  const layout = readRequired('apps/web/src/app/(dashboard)/layout.tsx');

  assert.match(sidebar, /物流规则发布/);
  assert.match(sidebar, /href:\s*'\/admin\/logistics-rules',[\s\S]{0,100}superAdminOnly:\s*true/);
  assert.match(sidebar, /NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED/);
  assert.match(sidebar, /logisticsDistributionOnly: true/);
  assert.match(sidebar, /!child\.logisticsDistributionOnly \|\| logisticsDistributionEnabled/);
  assert.match(layout, /'\/admin\/logistics-rules'/);
});

test('workbench uses only the implemented admin logistics rule API contract', () => {
  const source = readRequired(pagePath);

  for (const route of [
    "'/api/admin/logistics-rules/drafts/import'",
    '`/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}`',
    '`/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/diff?channelId=${encodeURIComponent(channelId)}`',
    '`/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/preflight`',
    '`/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/publish`',
    '`/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/rollback`',
  ]) {
    assert.ok(source.includes(route), `missing API wiring: ${route}`);
  }

  assert.doesNotMatch(source, /logistics-rules\/(history|channels\/list)/);
  assert.match(source, /expectedSequence/);
  assert.match(source, /targetReleaseId/);
  assert.match(source, /rollbackReason/);
  assert.match(source, /publishReason/);
  assert.match(source, /publish[\s\S]{0,500}reason:\s*publishReason\.trim\(\)/);
  assert.match(source, /rollback[\s\S]{0,500}reason:\s*rollbackReason\.trim\(\)/);
  assert.match(source, /发布原因/);
  assert.doesNotMatch(source, /当前接口不接收 reason/);
});

test('workspace URL construction is encoded and supports discovery', () => {
  assert.equal(buildAdminLogisticsWorkspacePath(), '/api/admin/logistics-rules/workspace');
  assert.equal(
    buildAdminLogisticsWorkspacePath('channel/one', 'revision two'),
    '/api/admin/logistics-rules/workspace?channelId=channel%2Fone&revisionId=revision%20two',
  );
});

test('workbench discovers scoped records instead of requiring raw IDs', () => {
  const source = readRequired(pagePath);
  const bindings = readRequired(bindingPath);
  const resolutions = readRequired(resolutionPath);

  assert.match(source, /buildAdminLogisticsWorkspacePath/);
  assert.match(source, /useEffect/);
  assert.match(source, /workspace\.channels/);
  assert.match(source, /workspace\.assignments/);
  assert.match(source, /workspace\.releaseHistory/);
  assert.match(source, /<select[^>]+id="logistics-channel-id"/s);
  assert.match(source, /<select[^>]+id="logistics-assignment-id"/s);
  assert.doesNotMatch(source, /<Input[^>]+id="logistics-(channel|assignment|revision)-id"/s);
  assert.match(source, /method-bindings\/\$\{encodeURIComponent/);
  assert.match(source, /official-resolutions\/\$\{encodeURIComponent/);
  assert.match(source, /buildMethodBindingReviewPayload/);
  assert.match(source, /buildOfficialResolutionReviewPayload/);
  assert.match(bindings, /onReview/);
  assert.match(bindings, /CONFIRMED/);
  assert.match(bindings, /REJECTED/);
  assert.match(resolutions, /onReview/);
  assert.match(resolutions, /candidateSetChecksum/);
});
test('an empty draft creates server-derived method and Official suggestions', () => {
  const source = readRequired(pagePath);
  const bindings = readRequired(bindingPath);
  const resolutions = readRequired(resolutionPath);

  assert.equal(typeof workbenchState.buildMethodBindingSuggestionPayload, 'function');
  assert.equal(typeof workbenchState.buildOfficialResolutionSuggestionPayload, 'function');
  assert.equal(typeof workbenchState.buildMethodBindingReviewPayload, 'function');
  assert.equal(typeof workbenchState.buildOfficialResolutionReviewPayload, 'function');
  assert.equal(typeof workbenchState.buildOfficialResolutionRows, 'function');
  const requirementKey = `req:v2:${JSON.stringify([
    'service-1',
    'weight',
    500,
    'at',
    'fingerprint-1',
  ])}`;

  assert.deepEqual(
    workbenchState.buildMethodBindingSuggestionPayload({
      channelId: 'channel-1',
      revisionId: 'revision-1',
      deliveryMethodId: 'method-1',
      stableServiceKey: 'service-1',
      note: 'method matched',
      evidence: { forged: true },
    }),
    {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      deliveryMethodId: 'method-1',
      stableServiceKey: 'service-1',
      note: 'method matched',
    },
  );
  assert.deepEqual(
    workbenchState.buildOfficialResolutionSuggestionPayload({
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey,
      officialFingerprint: 'client-must-not-decide',
      note: 'official sample reviewed',
      candidateServiceKeys: ['client-must-not-decide'],
      candidateSetChecksum: 'client-must-not-decide',
      evidence: { forged: true },
    }),
    {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey,
      note: 'official sample reviewed',
    },
  );
  assert.deepEqual(
    workbenchState.buildMethodBindingReviewPayload({
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedUpdatedAt: '2026-07-13T08:30:00.000Z',
      note: 'method checked',
      stableServiceKey: 'client-must-not-repeat',
      evidence: { forged: true },
    }),
    {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedUpdatedAt: '2026-07-13T08:30:00.000Z',
      note: 'method checked',
    },
  );
  assert.deepEqual(
    workbenchState.buildOfficialResolutionReviewPayload({
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedUpdatedAt: '2026-07-13T08:31:00.000Z',
      selectedServiceKey: 'service-1',
      note: 'formula checked',
      candidateSetChecksum: 'client-must-not-decide',
      evidence: { forged: true },
    }),
    {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedUpdatedAt: '2026-07-13T08:31:00.000Z',
      selectedServiceKey: 'service-1',
      note: 'formula checked',
    },
  );

  assert.match(source, /'\/api\/admin\/logistics-rules\/method-bindings\/suggestions'/);
  assert.match(source, /'\/api\/admin\/logistics-rules\/official-resolutions\/suggestions'/);
  assert.match(source, /await loadWorkspaceContext\(channelId, revisionId, false\)/);

  assert.match(bindings, /onSuggest/);
  assert.match(bindings, /payload\?\.deliveryMethods/);
  assert.match(bindings, /创建绑定建议/);
  assert.match(bindings, /绑定审核说明/);
  assert.match(bindings, /deliveryMethodId/);

  assert.match(resolutions, /onSuggest/);
  assert.match(resolutions, /buildOfficialResolutionRows/);
  assert.match(resolutions, /row\.requirementKey/);
  assert.doesNotMatch(resolutions, /resolutionByFingerprint/);
  assert.match(resolutions, /解析审核说明/);
  assert.match(resolutions, /生成解析建议/);
  assert.doesNotMatch(resolutions, /<select[^>]+multiple/s);
});

test('Official requirements sharing one fingerprint keep independent resolution rows', () => {
  const fingerprintKey = 'fingerprint-shared';
  const requirementA = `req:v2:${JSON.stringify([
    'service-a',
    'weight',
    500,
    'at',
    fingerprintKey,
  ])}`;
  const requirementB = `req:v2:${JSON.stringify([
    'service-b',
    'weight',
    500,
    'at',
    fingerprintKey,
  ])}`;
  const rows = workbenchState.buildOfficialResolutionRows({
    requirements: [
      { requirementKey: requirementA, stableServiceKey: 'service-a' },
      { requirementKey: requirementB, stableServiceKey: 'service-b' },
    ],
    samples: [{ fingerprintKey, tariffs: [{ stableServiceKey: 'official-a' }] }],
    resolutions: [
      {
        id: 'resolution-a',
        officialFingerprint: fingerprintKey,
        evidence: { requirementKey: requirementA },
        candidateServiceKeys: ['service-a'],
      },
    ],
    blockers: [
      {
        code: 'official_branch_uncovered',
        requirementKey: requirementB,
        stableServiceKey: 'service-b',
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.rowId),
    [requirementA, requirementB],
  );
  assert.deepEqual(
    rows.map((row) => row.fingerprintKey),
    [fingerprintKey, fingerprintKey],
  );
  assert.deepEqual(
    rows.map((row) => row.resolution?.id || null),
    ['resolution-a', null],
  );
  assert.deepEqual(
    rows.map((row) => row.issues.length),
    [0, 1],
  );
});
test('workbench exposes an accessible import-review-history workflow and deployment identity', () => {
  const source = readRequired(pagePath);

  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected/);
  assert.match(source, /type="file"/);
  assert.match(source, /accept="\.json,application\/json"/);
  assert.match(source, /ozon-logistics-draft-import\/v1/);
  assert.match(source, /getApiBase/);
  assert.match(source, /NEXT_PUBLIC_RUNTIME_MODE/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /服务端预检/);
  assert.match(source, /发布草稿/);
  assert.match(source, /回滚发布/);
});

test('review components surface stable diff, method binding, and Official resolution evidence', () => {
  const diff = readRequired(diffPath);
  const bindings = readRequired(bindingPath);
  const resolutions = readRequired(resolutionPath);

  assert.match(diff, /stableServiceKey|稳定服务标识/);
  assert.match(diff, /\.sort\(/);
  assert.match(diff, /新增/);
  assert.match(diff, /变更/);
  assert.match(diff, /移除/);

  assert.match(bindings, /实际物流方式绑定/);
  assert.match(bindings, /method_binding_required/);
  assert.match(bindings, /destination_evidence_required/);
  assert.match(bindings, /selected_provider_unavailable/);
  assert.match(bindings, /ShopDeliveryMethod ID/);
  assert.match(bindings, /接口未返回绑定明细/);
  assert.match(bindings, /buildMethodBindingRows/);
  assert.doesNotMatch(bindings, /bindingByService\s*=\s*new Map/);
  assert.doesNotMatch(bindings, /预检已确认/);

  assert.match(resolutions, /Official/);
  assert.match(resolutions, /fingerprint/);
  assert.match(resolutions, /official_branch_uncovered|official/);
  assert.match(resolutions, /CNY 0\.01/);
});

test('actual delivery-method bindings remain separate when they share one stable service', () => {
  assert.equal(typeof workbenchState.buildMethodBindingRows, 'function');
  const rows = workbenchState.buildMethodBindingRows({
    services: [
      { stableServiceKey: 'service-a', normalizedDescription: 'Service A' },
      { stableServiceKey: 'service-b', normalizedDescription: 'Service B' },
    ],
    methodBindings: [
      { id: 'binding-1', stableServiceKey: 'service-a', deliveryMethodId: 'method-1' },
      { id: 'binding-2', stableServiceKey: 'service-a', deliveryMethodId: 'method-2' },
    ],
    selectedServiceKeys: ['service-a', 'service-b'],
  });

  assert.deepEqual(
    rows.map((row) => row.rowId),
    ['binding:binding-1', 'binding:binding-2', 'service:service-b'],
  );
  assert.deepEqual(
    rows.slice(0, 2).map((row) => row.binding.deliveryMethodId),
    ['method-1', 'method-2'],
  );
  assert.equal(rows[2].binding, null);
});

test('candidate and current-pointer transitions cannot reuse stale diff state', () => {
  const source = readRequired(pagePath);

  assert.match(source, /setRevisionId\(nextRevisionId\);\s+setDiff\(null\);/);
  assert.equal(source.match(/await refreshCurrentReleaseState\(release\.sequence\)/g)?.length, 2);
});

test('publish readiness is bound to the currently entered revision and channel', () => {
  const source = readRequired(pagePath);

  assert.match(source, /const contextMatches = isPublishContextCurrent/);
  assert.ok((source.match(/invalidateLoadedContext\(\)/g) || []).length >= 1);
});

test('network failures and provider diagnostics stay recoverable and actionable', () => {
  const source = readRequired(pagePath);

  assert.match(source, /async function safeRequest/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /return null/);
  assert.match(source, /异常 Provider 明细/);
  assert.match(source, /finally/);
});

test('publish context rejects stale revision, channel, diff, or preflight identities', () => {
  const current = {
    revisionId: 'revision-a',
    channelId: 'channel-a',
    draft: { id: 'revision-a' },
    diff: { revisionId: 'revision-a', channelId: 'channel-a' },
    preflight: { revisionId: 'revision-a', channelId: 'channel-a' },
  };

  assert.equal(isPublishContextCurrent(current), true);
  assert.equal(isPublishContextCurrent({ ...current, revisionId: 'revision-b' }), false);
  assert.equal(
    isPublishContextCurrent({
      ...current,
      diff: { revisionId: 'revision-b', channelId: 'channel-a' },
    }),
    false,
  );
  assert.equal(
    isPublishContextCurrent({
      ...current,
      preflight: { revisionId: 'revision-a', channelId: 'channel-b' },
    }),
    false,
  );
  assert.equal(isPublishContextCurrent({ ...current, preflight: null }), false);
});

test('provider-only warnings navigate to provider diagnostics', () => {
  assert.equal(logisticsIssueTarget('unselected_provider_failed'), 'provider-inventory');
  assert.equal(logisticsIssueTarget('method_binding_required'), 'method-bindings');
  assert.equal(logisticsIssueTarget('official_branch_uncovered'), 'official-resolutions');
  assert.equal(logisticsIssueTarget('validation_expired'), 'readiness-summary');
});

test('capture workspace manages scoped test tasks and reviewed server candidates', () => {
  const page = readRequired(pagePath);
  const capture = readRequired(capturePath);

  assert.match(page, /LogisticsCaptureWorkspace/);
  assert.match(page, /id: 'capture'/);

  for (const route of [
    '/capture-tasks/seller',
    '/capture-tasks/official',
    '/capture-tasks?',
    '/capture-tasks/reviewable',
    '/verify',
    '/reject',
    '/capture-tasks/matrix-preview',
    '/capture-tasks/candidate-sets',
    '/capture-tasks/drafts',
  ]) {
    assert.ok(capture.includes(route), `capture workspace must use ${route}`);
  }

  assert.match(capture, /已签发|采集中|待审核|已取消|已过期/);
  assert.match(capture, /seller\/template\/by-location|seller\/provider-inventory/);
  const sellerEndpoints =
    capture.match(/const SELLER_ENDPOINTS = \[([\s\S]*?)\] as const;/)?.[1] || '';
  assert.match(sellerEndpoints, /seller\/template\/by-location/);
  assert.match(sellerEndpoints, /seller\/provider-inventory/);
  assert.doesNotMatch(sellerEndpoints, /seller\/category\/list|seller\/delivery-speed/);

  assert.match(
    capture,
    /declaredPriceMinor[\s\S]*weightGrams[\s\S]*dimensionsMm[\s\S]*batteryMode/,
  );
  assert.match(capture, /normalizedPayload[\s\S]*services[\s\S]*stableServiceKey/);
  assert.match(capture, /requiredFingerprints/);
  assert.match(capture, /pointEvidence/);
  assert.match(capture, /matrix\.blockers/);
  assert.match(
    capture,
    /matrix-preview[\s\S]{0,500}\{\s*sellerCandidateId,\s*assignmentId,\s*selectedServiceKeys,\s*baseProduct,?\s*\}/,
  );
  assert.match(capture, /candidate-sets[\s\S]{0,700}defaultServiceKeys/);
  assert.match(
    capture,
    /capture-tasks\/drafts[\s\S]{0,300}\{\s*candidateSetId:\s*frozenCandidateSet\.id,?\s*\}/,
  );
  assert.match(capture, /onDraftCreated\(draft\.id\)/);
  assert.doesNotMatch(capture, /officialCandidateIds|validationFacts/);
});

test('channel retirement requires the active selected channel and explicit confirmation', () => {
  const active = {
    id: 'channel-1',
    currentReleaseId: 'release-3',
    currentSequence: 3,
    retiredAt: null,
  };

  assert.equal(
    isChannelRetirementEligible({
      selectedChannelId: 'channel-1',
      channel: active,
      currentReleaseId: 'release-3',
    }),
    true,
  );
  assert.equal(
    isChannelRetirementEligible({
      selectedChannelId: 'channel-2',
      channel: active,
      currentReleaseId: 'release-3',
    }),
    false,
  );
  assert.equal(
    isChannelRetirementEligible({
      selectedChannelId: 'channel-1',
      channel: { ...active, retiredAt: '2026-07-13T08:30:00.000Z' },
      currentReleaseId: 'release-3',
    }),
    false,
  );
  assert.equal(
    isChannelRetirementEligible({
      selectedChannelId: 'channel-1',
      channel: active,
      currentReleaseId: '',
    }),
    false,
  );

  assert.equal(
    isChannelRetirementReady({ eligible: true, acknowledged: true, reason: ' stop pilot ' }),
    true,
  );
  assert.equal(
    isChannelRetirementReady({ eligible: true, acknowledged: false, reason: 'stop pilot' }),
    false,
  );
  assert.equal(
    isChannelRetirementReady({ eligible: true, acknowledged: true, reason: 'ab' }),
    false,
  );
  assert.equal(
    isChannelRetirementReady({ eligible: true, acknowledged: true, reason: 'x'.repeat(501) }),
    false,
  );
});

test('receipt reconciliation keeps only bounded operational fields', () => {
  const normalized = normalizeChannelReceiptReconciliation({
    channelId: ' channel-1 ',
    currentSequence: '3',
    retiredAt: null,
    summary: {
      total: '4',
      byStatus: { APPLIED: '2', FAILED: 2 },
      expected: '5',
      pending: '1',
    },
    records: [
      {
        receiptId: ' receipt-1 ',
        assignmentId: ' assignment-1 ',
        releaseId: ' release-3 ',
        releaseSequence: '3',
        effectiveChecksum: 'abc123',
        status: 'FAILED',
        failureCode: ' checksum_mismatch ',
        extensionVersion: ' 1.2.0 ',
        appliedAt: null,
        receivedAt: '2026-07-13T08:30:00.000Z',
        deviceLabel: ' Device A ',
        accessToken: 'must-not-leak',
        sessionId: 'must-not-leak',
        deviceId: 'must-not-leak',
        localFees: [999],
        browserData: { cookie: 'must-not-leak' },
      },
      { receiptId: 'invalid', status: 'UNKNOWN', accessToken: 'must-not-leak' },
    ],
  });

  assert.deepEqual(normalized, {
    channelId: 'channel-1',
    currentSequence: 3,
    retiredAt: null,
    summary: {
      total: 4,
      byStatus: { APPLIED: 2, FAILED: 2 },
      expected: 5,
      pending: 1,
    },
    records: [
      {
        receiptId: 'receipt-1',
        assignmentId: 'assignment-1',
        releaseId: 'release-3',
        releaseSequence: 3,
        effectiveChecksum: 'abc123',
        status: 'FAILED',
        failureCode: 'checksum_mismatch',
        extensionVersion: '1.2.0',
        appliedAt: null,
        receivedAt: '2026-07-13T08:30:00.000Z',
        deviceLabel: 'Device A',
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(normalized),
    /accessToken|sessionId|deviceId|localFees|browserData|cookie/i,
  );

  const compatible = normalizeChannelReceiptReconciliation({ summary: {} });
  assert.deepEqual(compatible.summary, {
    total: 0,
    byStatus: { APPLIED: 0, FAILED: 0 },
    expected: null,
    pending: null,
  });
});

test('workbench exposes a guarded channel kill switch and receipt reconciliation', () => {
  const page = readRequired(pagePath);
  const receipts = readRequired(receiptsPath);

  assert.ok(
    page.includes('`/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/retire`'),
  );
  assert.match(
    page,
    /retire[\s\S]{0,700}expectedSequence:\s*activeChannel\.currentSequence[\s\S]{0,200}reason:\s*retireReason\.trim\(\)/,
  );
  assert.match(page, /紧急停用 Channel/);
  assert.match(page, /停止新报价/);
  assert.match(page, /设备下次联系返回 410/);
  assert.match(page, /不能直接恢复/);
  assert.match(page, /id="retire-channel-acknowledgement"/);
  assert.match(page, /retireAcknowledged/);
  assert.match(page, /确认永久停用/);
  assert.match(page, /setChannelId\(''\)/);
  assert.match(page, /setAssignmentId\(''\)/);
  assert.match(page, /setRevisionId\(''\)/);
  assert.match(page, /setDraft\(null\)/);
  assert.match(page, /setDiff\(null\)/);
  assert.match(page, /setPreflight\(null\)/);
  assert.match(page, /await requestWorkspace\(\)/);
  assert.match(page, /<ChannelReceiptReconciliation[\s\S]{0,200}channelId=\{channelId\}/);

  assert.ok(
    receipts.includes(
      '`/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/receipts?limit=50`',
    ),
  );
  assert.match(receipts, /normalizeChannelReceiptReconciliation/);
  assert.match(
    receipts,
    /setData\(\{\s*\.\.\.EMPTY_RECONCILIATION,\s*channelId: selectedChannelId\s*\}\)/,
  );
  assert.match(receipts, /加载设备回执/);
  assert.match(receipts, /尚无设备应用回执/);
  assert.match(receipts, /重新加载回执/);
  assert.match(receipts, /刷新回执/);
  assert.match(receipts, /overflow-x-auto/);
  assert.match(receipts, /min-w-\[/);
  assert.doesNotMatch(receipts, /accessToken|sessionId|deviceId|localFees|browserData|cookie/i);
});

test('review decisions carry the row updatedAt optimistic-lock token', () => {
  const page = readRequired(pagePath);
  assert.match(page, /expectedUpdatedAt:\s*reviewTarget\.updatedAt/);
  assert.match(page, /updatedAt:\s*String\(binding\.updatedAt/);
  assert.match(page, /updatedAt:\s*String\(resolution\.updatedAt/);
});

test('review conflicts discard stale context while ordinary failures remain retryable', () => {
  const reviewTarget = { id: 'binding-1', updatedAt: '2026-07-13T08:30:00.000Z' };
  const preflight = { status: 'READY', revisionId: 'revision-1' };

  assert.deepEqual(
    workbenchState.reconcileReviewFailure({
      errorCode: 'REVIEW_CONFLICT',
      reviewTarget,
      preflight,
    }),
    { discardReviewContext: true, invalidatePreflight: true, refreshWorkspace: true },
  );
  assert.deepEqual(
    workbenchState.reconcileReviewFailure({
      errorCode: 'REQUEST_FAILED',
      reviewTarget,
      preflight,
    }),
    { discardReviewContext: false, invalidatePreflight: false, refreshWorkspace: false },
  );

  const page = readRequired(pagePath);
  assert.match(page, /reconcileReviewFailure\(\{/);
  assert.match(page, /if \(recovery\.refreshWorkspace\)/);
  assert.match(page, /setReviewTarget\(null\)/);
  assert.match(page, /setPreflight\(null\)/);
  assert.match(page, /await loadWorkspaceContext\(channelId, revisionId, false\)/);
});
