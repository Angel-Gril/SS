import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateRel04DarkCanarySummary } from './extension-website-publication-approval.mjs';
import { canonicalExtensionReleaseEvidenceJson, parseExtensionReleaseEvidence } from './extension-release-contract.mjs';
import {
  canonicalReleaseSignatureJson, canonicalTrustedKeyringJson, releaseSignaturePayload,
  sha256,
} from './extension-release-publication-contract.mjs';
import {
  REL04_DARK_CONFIG_KEYS,
  parseRel04DarkCanaryEnvironment,
  runRel04DarkCanary,
  writeRel04DarkCanarySummary,
} from './rel04-dark-canary.mjs';

const roots = [];
const apiOrigin = 'https://api.example.com';
const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const gitCommit = 'b'.repeat(40);
const ownerToken = 'owner-token.secret.value';
const adminToken = 'admin-token.secret.value';
const pairingCode = 'pairing-code-secret-value-000000';
const accessToken = 'device-access-token.secret.value';
const nextAccessToken = 'next-device-access-token.secret.value';
const refreshToken = 'device-refresh-token-secret-value-000000';
const nextRefreshToken = 'next-device-refresh-token-secret-000000';
const shopId = 'shop-canary-01';
const workflowId = 'workflow-canary-01';
const attemptId = 'attempt-canary-01';
const sessionId = 'session-canary-01';
const pilotOwner = 'owner-pilot-01';
const pilotSessionIds = ['pilot-device-session-01', 'pilot-device-session-02'];
const pilotExpectation = Object.freeze({
  ownerUserIds: [pilotOwner],
  shopIds: [shopId],
  deviceSessionIds: pilotSessionIds,
  rolloutRevision: 15,
  sourcePolicyRevision: 'pilot-source-revision-15',
  allowedOperations: ['IMAGE_TO_IMAGE', 'SUITE'],
});
const approvedComExpectation = { ...pilotExpectation,
  allowedOperations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT', 'SUITE', 'IMAGE_TRANSLATE', 'OZON_PUBLISH'] };

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function jsonResponse(body, status = 200, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  return new Response(bytes, {
    status,
    headers: {
      'access-control-allow-origin': extensionOrigin,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bytes.length),
      ...extraHeaders,
    },
  });
}

function darkConfigValues() {
  return new Map([
    ['feature_ai_media_workflow_v2', 'false'],
    ['feature_ai_media_image_to_image', 'false'],
    ['feature_ai_media_suite', 'false'],
    ['feature_ai_media_full_edit', 'false'],
    ['feature_ai_media_inpaint', 'false'],
    ['feature_source_listing_web_media', 'false'],
    ['feature_source_listing_extension_workbench', 'false'],
    ['feature_source_ozon_publisher_v2', 'false'],
    ['ai_image_generation_enabled', 'false'],
    ['ai_image_provider', 'disabled'],
    ['feature_image_translate', 'false'],
    ['ai_image_translation_provider', 'disabled'],
    ['ai_media_workflow_v2_rollout_policy', JSON.stringify({ revision: 0, tenantIds: [] })],
    ['feature_extension_hosted_ai', 'false'],
    ['feature_extension_byok_ai', 'false'],
    ['feature_extension_byok_ingest', 'false'],
    ['feature_extension_byok_publish', 'false'],
    ['extension_byok_admin_policy', JSON.stringify({
      contractVersion: 'extension-byok-admin-policy/v1',
      revision: 0,
      mode: 'off',
      ownerUserIds: [],
      shopIds: [],
      deviceSessionIds: [],
      allowedOrigins: [],
      allowedOperations: [],
      maxConcurrency: 1,
    })],
  ]);
}

function pilotConfigValues() {
  const sourceFeatures = {
    SOURCE_LISTING_WORKFLOW: {
      mode: 'pilot', ownerUserIds: [pilotOwner], shopIds: [shopId],
      listingStage: 'dual_read', platforms: ['OZON'],
    },
    SOURCE_LISTING_EXTENSION_WORKBENCH: { mode: 'pilot', ownerUserIds: [pilotOwner] },
    SOURCE_LISTING_WEB_MEDIA: { mode: 'pilot', ownerUserIds: [pilotOwner] },
  };
  return new Map([
    ['feature_ai_media_workflow_v2', 'true'],
    ['feature_ai_media_image_to_image', 'true'],
    ['feature_ai_media_suite', 'true'],
    ['feature_ai_media_full_edit', 'false'],
    ['feature_ai_media_inpaint', 'false'],
    ['feature_source_listing_workflow', 'true'],
    ['feature_source_listing_web_media', 'true'],
    ['feature_source_listing_extension_workbench', 'true'],
    ['feature_source_ozon_publisher_v2', 'false'],
    ['feature_extension_hosted_ai', 'true'],
    ['feature_extension_byok_ai', 'false'],
    ['feature_extension_byok_ingest', 'false'],
    ['feature_extension_byok_publish', 'false'],
    ['ai_image_generation_enabled', 'false'],
    ['ai_image_provider', 'disabled'],
    ['feature_image_translate', 'false'],
    ['ai_image_translation_provider', 'disabled'],
    ['ai_media_workflow_v2_rollout_policy', JSON.stringify({
      revision: 15, tenantIds: [pilotOwner], mode: 'allowlist',
    })],
    ['source_workflow_rollout_policy', JSON.stringify({
      revision: pilotExpectation.sourcePolicyRevision, features: sourceFeatures,
    })],
    ['extension_byok_admin_policy', JSON.stringify({
      contractVersion: 'extension-byok-admin-policy/v1', revision: 0, mode: 'off',
      ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: [],
      allowedOperations: [], maxConcurrency: 1,
    })],
  ]);
}

function fixtureFetcher(options = {}) {
  const calls = [];
  const config = options.pilot ? pilotConfigValues() : darkConfigValues();
  if (options.enabledFlag) config.set(options.enabledFlag, 'true');
  if (options.approvedCom) {
    for (const key of ['feature_ai_media_full_edit', 'feature_ai_media_inpaint', 'feature_source_ozon_publisher_v2']) {
      config.set(key, 'true');
    }
  }
  if (options.translationPilot || options.approvedCom) {
    config.set('feature_image_translate', 'true');
    config.set('ai_image_translation_provider', 'dashscope-qwen-mt-image');
    config.set('ai_image_translation_model', 'qwen-mt-image');
  }
  let revoked = false;
  let canceled = false;
  let claimed = false;
  let claimedDeviceId = null;
  const fetcher = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({
      method: init.method,
      path: `${url.pathname}${url.search}`,
      headers: init.headers,
      body,
      redirect: init.redirect,
      credentials: init.credentials,
      signal: init.signal,
    });
    assert.equal(url.origin, options.apiOrigin || apiOrigin);
    assert.equal(init.headers.origin, extensionOrigin);
    assert.equal(init.headers['accept-encoding'], 'identity');

    if (url.pathname === '/ready') {
      if (options.oversizedReady) {
        return jsonResponse({ status: 'ready' }, 200, {
          'content-length': String(300 * 1024),
        });
      }
      return jsonResponse({
        status: 'ready',
        checks: { db: 'ok', redis: 'ok' },
        deployment: { gitCommit: options.deployedGitCommit || gitCommit },
      });
    }
    if (url.pathname === '/api/extension-device/byok-media/readiness'
      && init.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': options.badCors ? 'https://wrong.example.com' : extensionOrigin,
          'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
          'access-control-allow-headers': 'authorization,content-type',
        },
      });
    }
    if (url.pathname === '/api/extensions/latest') {
      if (!options.publicationGitCommit) return jsonResponse({ code: 0 }, 404);
      const version = '1.0.266';
      const cloudSha = 'c'.repeat(64);
      const localSha = 'd'.repeat(64);
      return jsonResponse({
        code: 1,
        data: {
          version,
          gitCommit: options.publicationGitCommit,
          signatureStatus: 'EXTERNAL_REQUIRED',
          publicationApprovalSha256: 'f'.repeat(64),
          targets: {
            cloud: {
              filename: `ss-erp-cloud-${version}.zip`,
              downloadUrl: `/api/extensions/download/cloud/${version}/${cloudSha}`,
              sha256: cloudSha,
            },
            local: {
              filename: `ss-erp-local-${version}.zip`,
              downloadUrl: `/api/extensions/download/local/${version}/${localSha}`,
              sha256: localSha,
            },
          },
        },
      });
    }
    if (url.pathname.startsWith('/api/admin/system-config/')) {
      assert.equal(init.headers.authorization, `Bearer ${adminToken}`);
      const key = decodeURIComponent(url.pathname.slice('/api/admin/system-config/'.length));
      assert.ok(REL04_DARK_CONFIG_KEYS.includes(key)
        || ['feature_source_listing_workflow', 'source_workflow_rollout_policy', 'ai_image_translation_model'].includes(key));
      return config.has(key)
        ? jsonResponse({ code: 1, data: { key, value: config.get(key) } })
        : jsonResponse({ code: 0 }, 404);
    }
    if (url.pathname === '/api/shops' && init.method === 'GET') {
      assert.equal(init.headers.authorization, `Bearer ${ownerToken}`);
      return jsonResponse({ code: 1, data: options.shopInventory || [] });
    }
    if (url.pathname === '/api/extension-device/pairing-codes' && init.method === 'POST') {
      assert.equal(init.headers.authorization, `Bearer ${ownerToken}`);
      assert.deepEqual(body.shopIds, [shopId]);
      assert.deepEqual(body.scopes, ['byok:media:ingest']);
      return jsonResponse({
        code: 1,
        data: {
          id: 'pairing-canary-01',
          code: pairingCode,
          deploymentId: 'deployment-canary-01',
          shopIds: [shopId],
          scopes: body.scopes,
        },
      }, 201);
    }
    if (url.pathname === '/api/extension-device/pairing-claims') {
      assert.equal(body.code, pairingCode);
      if (options.rejectClaim) {
        return jsonResponse({ code: 0, errorCode: 'invalid_pairing_code' }, 400);
      }
      claimed = true;
      claimedDeviceId = body.deviceId;
      if (options.loseClaimResponse) throw new Error('simulated response loss after claim commit');
      return jsonResponse({
        code: 1,
        data: {
          session: { id: sessionId },
          accessToken,
          refreshToken,
        },
      }, 201);
    }
    if (url.pathname === '/api/extension-device/shops') {
      if (revoked) {
        return jsonResponse({ code: 0, errorCode: 'invalid_device_token' }, 401);
      }
      assert.equal(init.headers.authorization, `Bearer ${accessToken}`);
      return jsonResponse({
        code: 1,
        data: [{ id: shopId, platform: 'OZON', name: 'Canary', status: 'ACTIVE' }],
      });
    }
    if (url.pathname === '/api/extension-device/refresh') {
      assert.equal(body.refreshToken, refreshToken);
      return jsonResponse({
        code: 1,
        data: {
          session: { id: sessionId },
          accessToken: nextAccessToken,
          refreshToken: nextRefreshToken,
        },
      });
    }
    if (url.pathname === '/api/extension-device/sessions' && init.method === 'GET') {
      assert.equal(init.headers.authorization, `Bearer ${ownerToken}`);
      const pilotSessions = options.pilot ? pilotSessionIds.map((id) => ({
        id,
        deviceId: `device-${id}`,
        status: 'ACTIVE',
        scopes: options.pilotScopes || ['capture:write', 'listing:write', 'listing:review', 'media:execute'],
        shopIds: options.pilotShopIds || [shopId],
        expiresAt: '2030-01-02T00:00:00.000Z',
      })) : [];
      return jsonResponse({
        code: 1,
        data: claimed
          ? [...pilotSessions, { id: sessionId, deviceId: claimedDeviceId, status: revoked ? 'REVOKED' : 'ACTIVE' }]
          : pilotSessions,
      });
    }
    if (url.pathname === '/api/ai-images/suites/readiness') {
      assert.equal(init.headers.authorization, `Bearer ${ownerToken}`);
      return jsonResponse({
        code: 1,
        data: options.pilot ? {
          suiteEnabled: true,
          workflowEnabled: true,
          webMediaEnabled: true,
          ready: true,
          reasonCode: 'READY',
        } : {
          suiteEnabled: false,
          workflowEnabled: false,
          webMediaEnabled: false,
          ready: false,
          reasonCode: 'AI_MEDIA_SUITE_DISABLED',
        },
      });
    }
    if (url.pathname === '/api/extension-device/byok-media/readiness') {
      assert.equal(init.headers.authorization, `Bearer ${nextAccessToken}`);
      assert.equal(body.providerOrigin, 'https://rel04-disabled.invalid');
      return options.allowByok
        ? jsonResponse({ code: 1, data: { allowed: true } })
        : jsonResponse({ code: 0, errorCode: 'byok_readiness_not_ready' }, 409);
    }
    if (url.pathname === '/api/source-listing-workflows/publisher-capability') {
      assert.equal(url.searchParams.get('shopId'), shopId);
      return jsonResponse({
        code: 1,
        data: options.publishCapability || (options.badPublishCapability
          ? {
              enabled: false,
              legacyAllowed: false,
              reason: 'config_unavailable',
              revision: 'unavailable',
            }
          : {
              enabled: false,
              legacyAllowed: true,
              reason: 'master_off',
              revision: 'master-off',
            }),
      });
    }
    if (url.pathname === `/api/source-listing-workflows/${workflowId}/publish-attempts/${attemptId}`) {
      return jsonResponse({
        code: 1,
        data: {
          id: attemptId,
          workflowId,
          shopId,
          state: 'SUBMITTED',
          reconciliationState: 'SUCCEEDED',
          stateVersion: 4,
          reconcileAttemptCount: 1,
          lastReconciledAt: options.staleAttempt
            ? '2029-12-31T23:56:00.000Z'
            : '2029-12-31T23:58:00.000Z',
          completedAt: '2029-12-31T23:59:00.000Z',
        },
      });
    }
    if (url.pathname === `/api/extension-device/sessions/${sessionId}` && init.method === 'DELETE') {
      assert.equal(init.headers.authorization, `Bearer ${ownerToken}`);
      revoked = true;
      return jsonResponse({ code: 1 });
    }
    if (url.pathname === '/api/extension-device/pairing-codes/pairing-canary-01'
      && init.method === 'DELETE') {
      canceled = true;
      return jsonResponse({ code: 1 });
    }
    throw new Error(`unexpected request ${init.method} ${url.pathname}`);
  };
  fetcher.calls = calls;
  fetcher.wasRevoked = () => revoked;
  fetcher.wasCanceled = () => canceled;
  return fetcher;
}

function input(overrides = {}) {
  return {
    apiOrigin,
    expectedGitCommit: gitCommit,
    releaseBinding: releaseBinding(),
    extensionOrigin,
    shopId,
    publishWorkflowId: workflowId,
    publishAttemptId: attemptId,
    publishReconciliationNotBefore: '2029-12-31T23:57:00.000Z',
    expectedPublishCapability: {
      reason: 'master_off',
      revision: 'master-off',
      legacyAllowed: true,
    },
    ownerToken,
    adminToken,
    observedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function releaseBinding() {
  return {
    candidate: {
      gitCommit,
      apiOrigin,
      region: 'COM',
      version: '1.2.3',
      releaseEvidenceSha256: 'c'.repeat(64),
      releaseSignatureSha256: 'd'.repeat(64),
    },
    vpsVerificationSha256: 'f'.repeat(64),
    vpsStartedAt: '2029-12-31T23:58:00.000Z',
    vpsVerifiedAt: '2029-12-31T23:59:00.000Z',
  };
}

function signedCandidateEnvironment(repository, privateRoot, region = 'COM') {
  const candidateApiOrigin = region === 'CN' ? 'https://api.example.cn' : apiOrigin;
  const candidateRoot = path.join(repository, 'candidate');
  mkdirSync(candidateRoot);
  mkdirSync(path.join(repository, 'config'));
  const version = '1.2.3';
  const evidence = parseExtensionReleaseEvidence({
    schemaVersion: 1, gitCommit, version,
    provenance: { commitSource: 'GIT_HEAD', sourceMode: 'REPOSITORY_SOURCE', packageInputsSha256: 'a'.repeat(64) },
    expectedOrigins: {
      web: 'https://app.example.com', admin: 'https://admin.example.com', api: candidateApiOrigin,
      local: 'http://127.0.0.1:3001',
    },
    artifacts: Object.fromEntries(['cloud', 'local'].map((target) => [target, {
      target, filename: `ss-erp-${target}-${version}.zip`, zipSha256: 'b'.repeat(64), fileCount: 1,
    }])),
    checksumFilename: `ss-erp-extension-${version}.sha256`, signature: { status: 'EXTERNAL_REQUIRED' },
  });
  const evidenceBytes = Buffer.from(canonicalExtensionReleaseEvidenceJson(evidence));
  const evidenceName = `ss-erp-extension-${version}.release-evidence.json`;
  writeFileSync(path.join(candidateRoot, evidenceName), evidenceBytes);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'canary-fixture-key';
  writeFileSync(path.join(repository, 'config/extension-release-trusted-keys.json'), canonicalTrustedKeyringJson({
    schemaVersion: 1, kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{ algorithm: 'Ed25519', keyId, status: 'ACTIVE',
      publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }],
  }));
  const signature = {
    schemaVersion: 1, kind: 'SS_ERP_EXTENSION_RELEASE_SIGNATURE', algorithm: 'Ed25519', keyId,
    signedAt: '2030-01-01T00:00:00.000Z', releaseEvidenceFilename: evidenceName,
    releaseEvidenceSha256: sha256(evidenceBytes), signatureBase64: '',
  };
  signature.signatureBase64 = sign(null, releaseSignaturePayload(signature, evidenceBytes), privateKey).toString('base64');
  const signatureFile = path.join(privateRoot, `ss-erp-extension-${version}.release-signature.json`);
  const signatureBytes = Buffer.from(canonicalReleaseSignatureJson(signature));
  writeFileSync(signatureFile, signatureBytes, { mode: 0o600 });
  const vpsFile = path.join(privateRoot, 'vps-verification.json');
  const vps = {
    schemaVersion: 1, kind: 'SS_ERP_VPS_VERIFICATION', scope: 'FULL', status: 'PASS',
    startedAt: '2030-01-01T23:58:00.000Z', completedAt: '2030-01-01T23:59:00.000Z',
    failures: 0, warnings: 1,
    candidate: {
      gitCommit, apiOrigin: candidateApiOrigin, region, version,
      releaseEvidenceSha256: sha256(evidenceBytes), releaseSignatureSha256: sha256(signatureBytes),
    },
  };
  const vpsBytes = Buffer.from(`${JSON.stringify(vps, null, 2)}\n`);
  writeFileSync(vpsFile, vpsBytes, { mode: 0o600 });
  return {
    REL04_REGION: region, REL04_VERSION: version, REL04_RELEASE_BUILD_ROOT: candidateRoot,
    REL04_RELEASE_SIGNATURE_FILE: signatureFile, REL04_RELEASE_SIGNATURE_SHA256: sha256(signatureBytes),
    REL04_RELEASE_EVIDENCE_SHA256: sha256(evidenceBytes),
    REL04_VPS_VERIFICATION_FILE: vpsFile, REL04_VPS_VERIFICATION_SHA256: sha256(vpsBytes),
  };
}

test('new canaries bind the exact regional signed candidate and full VPS verification receipt', async () => {
  const binding = releaseBinding();
  const summary = await runRel04DarkCanary(input({ releaseBinding: binding }), {
    fetcher: fixtureFetcher(),
  });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.schemaVersion, 2);
  assert.deepEqual(summary.bindings.release, binding);
});

test('a CN canary retains its independent regional candidate identity', async () => {
  const cnOrigin = 'https://api.example.cn';
  const binding = releaseBinding();
  binding.candidate.apiOrigin = cnOrigin;
  binding.candidate.region = 'CN';
  const summary = await runRel04DarkCanary(input({ apiOrigin: cnOrigin, releaseBinding: binding }), {
    fetcher: fixtureFetcher({ apiOrigin: cnOrigin }),
  });
  assert.equal(summary.status, 'PASS');
  assert.deepEqual(summary.bindings.release, binding);
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, {
    expectedGitCommit: gitCommit, expectedApiOrigin: cnOrigin, expectedCandidate: binding.candidate,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z',
  }));
});

test('missing or mismatched candidate evidence is rejected before any request', async () => {
  for (const binding of [
    undefined,
    { ...releaseBinding(), candidate: { ...releaseBinding().candidate, gitCommit: 'e'.repeat(40) } },
    { ...releaseBinding(), candidate: { ...releaseBinding().candidate, apiOrigin: 'https://api.example.cn' } },
    { ...releaseBinding(), vpsVerifiedAt: '2029-12-01T00:00:00.000Z' },
  ]) {
    const fetcher = fixtureFetcher();
    await assert.rejects(runRel04DarkCanary(input({ releaseBinding: binding }), { fetcher }));
    assert.equal(fetcher.calls.length, 0);
  }
});

test('new website approvals require candidate-bound evidence while historical v1 remains verifiable', async () => {
  const summary = await runRel04DarkCanary(input({ releaseBinding: releaseBinding() }), {
    fetcher: fixtureFetcher(),
  });
  const legacy = structuredClone(summary);
  legacy.schemaVersion = 1;
  delete legacy.bindings.release;
  const expected = {
    expectedGitCommit: gitCommit, expectedApiOrigin: apiOrigin,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z',
  };
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(legacy, expected));
  assert.throws(() => validateRel04DarkCanarySummary(legacy, {
    ...expected,
    requireReleaseBinding: true,
    expectedCandidate: releaseBinding().candidate,
  }), /candidate|release|v2/iu);
});

test('v2 publication verification requires the complete expected candidate', async () => {
  const summary = await runRel04DarkCanary(input(), { fetcher: fixtureFetcher() });
  const expected = {
    expectedGitCommit: gitCommit, expectedApiOrigin: apiOrigin,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z',
  };
  assert.throws(() => validateRel04DarkCanarySummary(summary, expected), /expected candidate/iu);
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, {
    ...expected, expectedCandidate: releaseBinding().candidate,
  }));
  for (const field of ['version', 'releaseEvidenceSha256', 'releaseSignatureSha256']) {
    assert.throws(() => validateRel04DarkCanarySummary(summary, {
      ...expected, expectedCandidate: { ...releaseBinding().candidate, [field]: field === 'version' ? '9.9.9' : 'e'.repeat(64) },
    }), /candidate/iu);
  }
});

test('runs the bounded dark canary, reads reconciliation, and revokes its device session', async () => {
  const fetcher = fixtureFetcher();
  const summary = await runRel04DarkCanary(input(), {
    fetcher,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.cleanup.completed, true);
  assert.equal(fetcher.wasRevoked(), true);
  assert.deepEqual(summary.checks.map(({ id, status }) => [id, status]), [
    ['deployment-and-publication-isolation', 'PASS'],
    ['default-off-policy', 'PASS'],
    ['hosted-route-regression', 'PASS'],
    ['publish-reconciliation-read', 'PASS'],
    ['device-pairing-active-lifecycle', 'PASS'],
    ['byok-disabled-path', 'PASS'],
    ['device-session-cleanup', 'PASS'],
  ]);
  assert.equal(summary.requestAudit.providerDispatchSent, false);
  assert.equal(summary.requestAudit.erpIngestSent, false);
  assert.equal(summary.requestAudit.ozonMutationSent, false);
  assert.ok(fetcher.calls.every((call) => call.redirect === 'error'));
  assert.ok(fetcher.calls.every((call) => call.credentials === 'omit'));
  assert.ok(fetcher.calls.every((call) => call.signal instanceof AbortSignal));
  const retained = JSON.stringify(summary);
  for (const secret of [
    ownerToken, adminToken, pairingCode, accessToken, nextAccessToken, refreshToken, nextRefreshToken,
  ]) assert.equal(retained.includes(secret), false);
});

test('runs a candidate-bound restricted hosted pilot canary without Provider or Ozon writes', async () => {
  const summary = await runRel04DarkCanary(input({
    rolloutExpectation: 'hosted-pilot',
    hostedPilotExpectation: pilotExpectation,
  }), {
    fetcher: fixtureFetcher({ pilot: true }),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.kind, 'SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY');
  assert.equal(summary.bindings.rollout.expectation, 'hosted-pilot');
  assert.match(summary.bindings.rollout.policySha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(summary.checks.map(({ id }) => id), [
    'deployment-and-publication-isolation',
    'restricted-pilot-policy',
    'hosted-route-readiness',
    'publish-reconciliation-read',
    'device-pairing-active-lifecycle',
    'byok-disabled-path',
    'device-session-cleanup',
  ]);
  assert.equal(summary.requestAudit.providerDispatchSent, false);
  assert.equal(summary.requestAudit.erpIngestSent, false);
  assert.equal(summary.requestAudit.ozonMutationSent, false);
  const expected = {
    expectedGitCommit: gitCommit,
    expectedApiOrigin: apiOrigin,
    expectedCandidate: releaseBinding().candidate,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z',
    requireReleaseBinding: true,
  };
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, expected));
  const tampered = structuredClone(summary);
  tampered.checks.find(({ id }) => id === 'restricted-pilot-policy').evidence.rolloutRevision += 1;
  assert.throws(() => validateRel04DarkCanarySummary(tampered, expected), /pilot|rollout|digest|policy/iu);
});

test('accepts an explicitly restricted translation pilot without issuing translation or Ozon writes', async () => {
  const expectation = { ...pilotExpectation, allowedOperations: ['IMAGE_TO_IMAGE', 'SUITE', 'IMAGE_TRANSLATE'] };
  const summary = await runRel04DarkCanary(input({ rolloutExpectation: 'hosted-pilot', hostedPilotExpectation: expectation }), {
    fetcher: fixtureFetcher({ pilot: true, translationPilot: true }),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(summary.status, 'PASS');
  assert.deepEqual(summary.checks.find(check => check.id === 'restricted-pilot-policy').evidence.allowedOperations, expectation.allowedOperations);
  assert.equal(summary.requestAudit.providerDispatchSent, false); assert.equal(summary.requestAudit.ozonMutationSent, false);
  const expected = { expectedGitCommit: gitCommit, expectedApiOrigin: apiOrigin, expectedCandidate: releaseBinding().candidate,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z', requireReleaseBinding: true };
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, expected));
  const widened = structuredClone(summary);
  const policy = widened.checks.find(check => check.id === 'restricted-pilot-policy').evidence;
  policy.allowedOperations.push('FULL_EDIT');
  widened.bindings.rollout.policySha256 = sha256(Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, 'utf8'));
  assert.throws(() => validateRel04DarkCanarySummary(widened, expected), /pilot|scope/iu);
});

test('reads the exact approved COM configuration without granting publish scopes or dispatching media', async () => {
  const publishCapability = { enabled: false, legacyAllowed: false, reason: 'policy_revision_mismatch', revision: 'source-policy-16' };
  const fetcher = fixtureFetcher({ pilot: true, approvedCom: true, publishCapability });
  const summary = await runRel04DarkCanary(input({ rolloutExpectation: 'hosted-pilot', hostedPilotExpectation: approvedComExpectation,
    publishWorkflowId: null, publishAttemptId: null, publishReconciliationNotBefore: null,
    publishReconciliationRegressionSha256: 'e'.repeat(64),
    expectedPublishCapability: { reason: publishCapability.reason, revision: publishCapability.revision, legacyAllowed: false } }), { fetcher });
  assert.equal(summary.status, 'PASS', JSON.stringify(summary));
  assert.deepEqual(summary.checks.find(check => check.id === 'restricted-pilot-policy').evidence.allowedOperations,
    approvedComExpectation.allowedOperations);
  assert.equal(summary.requestAudit.providerDispatchSent, false);
  assert.equal(summary.requestAudit.erpIngestSent, false);
  assert.equal(summary.requestAudit.ozonMutationSent, false);
  assert.ok(fetcher.calls.filter(call => call.method === 'POST').every(call =>
    ['/api/extension-device/pairing-codes', '/api/extension-device/pairing-claims',
      '/api/extension-device/refresh', '/api/extension-device/byok-media/readiness'].includes(call.path)));
  assert.deepEqual(fetcher.calls.find(call => call.path === '/api/extension-device/pairing-codes').body.scopes, ['byok:media:ingest']);
  const expected = { expectedGitCommit: gitCommit, expectedApiOrigin: apiOrigin, expectedCandidate: releaseBinding().candidate,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z', requireReleaseBinding: true };
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, expected));
  const enabled = structuredClone(summary);
  enabled.checks.find(check => check.id === 'publish-reconciliation-read').evidence.capabilityEnabled = true;
  assert.throws(() => validateRel04DarkCanarySummary(enabled, expected), /reconciliation/iu);
  const cn = structuredClone(summary);
  cn.bindings.apiOrigin = 'https://api.example.cn';
  cn.bindings.release.candidate.apiOrigin = cn.bindings.apiOrigin;
  cn.bindings.release.candidate.region = 'CN';
  assert.throws(() => validateRel04DarkCanarySummary(cn, { ...expected, expectedApiOrigin: cn.bindings.apiOrigin,
    expectedCandidate: cn.bindings.release.candidate }), /pilot|scope/iu);
});

test('approved COM operation contract retains exact scopes, shops and server publisher capability denial', async () => {
  for (const changes of [
    { pilotScopes: ['capture:write', 'listing:review', 'listing:write', 'media:execute', 'listing:publish'] },
    { pilotShopIds: [shopId, 'foreign-shop'] },
    { publishCapability: { enabled: true, legacyAllowed: true, reason: 'master_off', revision: 'master-off' } },
  ]) {
    const fetcher = fixtureFetcher({ pilot: true, approvedCom: true, ...changes });
    const summary = await runRel04DarkCanary(input({ rolloutExpectation: 'hosted-pilot',
      hostedPilotExpectation: approvedComExpectation }), { fetcher });
    assert.equal(summary.status, 'FAIL');
    assert.equal(fetcher.calls.some(call => call.path === '/api/extension-device/pairing-codes'), false);
  }
});

test('approved COM operations cannot be used for a CN candidate or widened before requests', async () => {
  const binding = releaseBinding();
  binding.candidate.apiOrigin = 'https://api.example.cn'; binding.candidate.region = 'CN';
  const fetcher = fixtureFetcher({ pilot: true, approvedCom: true });
  for (const changes of [
    { apiOrigin: binding.candidate.apiOrigin, releaseBinding: binding },
    { hostedPilotExpectation: { ...approvedComExpectation, allowedOperations: [...approvedComExpectation.allowedOperations, 'TEXT_TO_IMAGE'] } },
    { hostedPilotExpectation: { ...approvedComExpectation, ownerUserIds: [pilotOwner, 'foreign-owner'] } },
  ]) {
    await assert.rejects(() => runRel04DarkCanary(input({ rolloutExpectation: 'hosted-pilot',
      hostedPilotExpectation: approvedComExpectation, ...changes }), { fetcher }), /PILOT_EXPECTATION_INVALID/u);
  }
  assert.equal(fetcher.calls.length, 0);
});

test('CN dark canary explicitly accepts an empty shop inventory without treating it as publisher success', async () => {
  const binding = releaseBinding();
  binding.candidate.apiOrigin = 'https://api.example.cn';
  binding.candidate.region = 'CN';
  const summary = await runRel04DarkCanary(input({
    apiOrigin: 'https://api.example.cn',
    releaseBinding: binding,
    shopId: 'cn-dark-no-shop',
    noShopDarkCanary: true,
    publishWorkflowId: null,
    publishAttemptId: null,
    publishReconciliationRegressionSha256: 'e'.repeat(64),
    publishReconciliationNotBefore: null,
    expectedPublishCapability: null,
  }), { fetcher: fixtureFetcher({ apiOrigin: 'https://api.example.cn', noShopDarkCanary: true }) });
  assert.equal(summary.status, 'PASS', JSON.stringify(summary));
  const evidence = summary.checks.find(({ id }) => id === 'publish-reconciliation-read').evidence;
  assert.equal(evidence.shopInventoryCount, 0);
  assert.equal(evidence.publisherCapabilityChecked, false);
  assert.equal(summary.bindings.noShopDarkCanary, true);
  assert.deepEqual(summary.checks.map(({ id }) => id), [
    'deployment-and-publication-isolation', 'default-off-policy',
    'hosted-route-regression', 'publish-reconciliation-read',
  ]);
  assert.equal(summary.requestAudit.requests.some(({ route }) => route.includes('publisher-capability')), false);
  assert.equal(summary.requestAudit.requests.some(({ method }) => method !== 'GET' && method !== 'OPTIONS'), false);
  assert.equal(summary.requestAudit.ozonMutationSent, false);
  const expected = {
    expectedGitCommit: gitCommit,
    expectedApiOrigin: 'https://api.example.cn',
    expectedCandidate: binding.candidate,
    expectedReleaseSignedAt: '2029-12-31T23:57:00.000Z',
    requireReleaseBinding: true,
  };
  assert.doesNotThrow(() => validateRel04DarkCanarySummary(summary, expected));
  const forged = structuredClone(summary);
  forged.checks.find(({ id }) => id === 'publish-reconciliation-read').evidence.publisherCapabilityChecked = true;
  assert.throws(() => validateRel04DarkCanarySummary(forged, expected), /no-shop dark evidence/u);
  const fakeShop = structuredClone(summary);
  fakeShop.bindings.shopIdHash = 'f'.repeat(64);
  assert.throws(() => validateRel04DarkCanarySummary(fakeShop, expected), /no-shop dark canary binding/u);
  const fakeRequest = structuredClone(summary);
  fakeRequest.requestAudit.requests.push({
    route: 'GET /api/source-listing-workflows/publisher-capability',
    method: 'GET', statusCode: 404,
  });
  assert.throws(() => validateRel04DarkCanarySummary(fakeRequest, expected), /not allowlisted/u);
  assert.throws(() => validateRel04DarkCanarySummary(summary, {
    ...expected, expectedCandidate: { ...binding.candidate, region: 'COM' },
  }));
});

test('CN no-shop mode rejects a nonempty owner inventory and never pairs a device', async () => {
  const binding = releaseBinding();
  binding.candidate.apiOrigin = 'https://api.example.cn';
  binding.candidate.region = 'CN';
  const fetcher = fixtureFetcher({ apiOrigin: 'https://api.example.cn', noShopDarkCanary: true,
    shopInventory: [{ id: 'existing-shop' }] });
  const summary = await runRel04DarkCanary(input({
    apiOrigin: 'https://api.example.cn', releaseBinding: binding,
    shopId: 'cn-dark-no-shop', noShopDarkCanary: true,
    publishWorkflowId: null, publishAttemptId: null,
    publishReconciliationRegressionSha256: 'e'.repeat(64), publishReconciliationNotBefore: null,
    expectedPublishCapability: null,
  }), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks.at(-1)?.errorCode, 'CN_OWNER_SHOP_INVENTORY_NOT_EMPTY');
  assert.equal(fetcher.calls.some(({ path: route }) => route.includes('pairing-codes')), false);
});

test('CN no-shop mode fails before I/O outside its exact dark regional scope', async () => {
  const binding = releaseBinding();
  binding.candidate.apiOrigin = 'https://api.example.cn';
  binding.candidate.region = 'CN';
  for (const overrides of [
    { noShopDarkCanary: true },
    { noShopDarkCanary: true, shopId: 'cn-dark-no-shop' },
    { noShopDarkCanary: true, shopId: 'cn-dark-no-shop',
      apiOrigin: 'https://api.example.cn', releaseBinding: binding,
      rolloutExpectation: 'hosted-pilot' },
  ]) {
    const fetcher = fixtureFetcher();
    await assert.rejects(runRel04DarkCanary(input(overrides), { fetcher }),
      /NO_SHOP_DARK_CANARY_SCOPE_INVALID/u);
    assert.equal(fetcher.calls.length, 0);
  }
});

test('binds exact-commit QA-04 reconciliation evidence when no live attempt exists', async () => {
  const fetcher = fixtureFetcher();
  const regressionSha256 = 'e'.repeat(64);
  const summary = await runRel04DarkCanary(input({
    publishWorkflowId: null,
    publishAttemptId: null,
    publishReconciliationRegressionSha256: regressionSha256,
    publishReconciliationNotBefore: null,
  }), { fetcher });
  assert.equal(summary.status, 'PASS');
  assert.deepEqual(summary.bindings.publishReconciliation, {
    mode: 'TARGET_COMMIT_QA04_REGRESSION',
    workflowIdHash: null,
    attemptIdHash: null,
    regressionEvidenceSha256: regressionSha256,
    notBefore: null,
  });
  assert.deepEqual(
    summary.checks.find(({ id }) => id === 'publish-reconciliation-read')?.evidence,
    {
      mode: 'TARGET_COMMIT_QA04_REGRESSION',
      liveAttemptRead: false,
      regressionEvidenceSha256: regressionSha256,
      capabilityEnabled: false,
      capabilityReason: 'master_off',
      capabilityRevision: 'master-off',
      capabilityLegacyAllowed: true,
      ozonMutationRequestSentByCanary: false,
    },
  );
  assert.equal(
    fetcher.calls.some(({ path: value }) => value.includes('/publish-attempts/')),
    false,
  );
});

test('fails closed on another deployed commit before creating a pairing code', async () => {
  const fetcher = fixtureFetcher({ deployedGitCommit: 'e'.repeat(40) });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.deepEqual(summary.checks.map(({ id, status }) => [id, status]), [
    ['deployment-and-publication-isolation', 'FAIL'],
    ['device-session-cleanup', 'PASS'],
  ]);
  assert.equal(summary.cleanup.required, false);
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('fails before pairing when the deployed candidate is already public', async () => {
  const fetcher = fixtureFetcher({ publicationGitCommit: gitCommit });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks[0]?.id, 'deployment-and-publication-isolation');
  assert.equal(summary.checks[0]?.errorCode, 'DEPLOYED_CANDIDATE_PREMATURELY_PUBLISHED');
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('allows a previously approved website release to remain public during a new dark deploy', async () => {
  const fetcher = fixtureFetcher({ publicationGitCommit: 'e'.repeat(40) });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'PASS');
  const isolation = summary.checks[0]?.evidence;
  assert.equal(isolation.deployedGitCommit, gitCommit);
  assert.equal(isolation.deployedCandidatePublic, false);
  assert.equal(isolation.existingPublication.gitCommit, 'e'.repeat(40));
});

test('rejects an enabled BYOK path and still revokes the created device session', async () => {
  const fetcher = fixtureFetcher({ allowByok: true });
  const summary = await runRel04DarkCanary(input({
    publishWorkflowId: null,
    publishAttemptId: null,
    publishReconciliationRegressionSha256: 'e'.repeat(64),
    publishReconciliationNotBefore: null,
  }), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(
    summary.checks.find(({ id }) => id === 'byok-disabled-path')?.status,
    'FAIL',
  );
  assert.equal(summary.checks.at(-1)?.id, 'device-session-cleanup');
  assert.equal(summary.checks.at(-1)?.status, 'PASS');
  assert.equal(fetcher.wasRevoked(), true);
  assert.equal(
    fetcher.calls.some(({ path: value }) => value.includes('/publish-attempts/')),
    false,
  );
});

test('rejects publisher configuration failure before creating a pairing code', async () => {
  const fetcher = fixtureFetcher({ badPublishCapability: true });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks.at(-2)?.id, 'publish-reconciliation-read');
  assert.equal(summary.checks.at(-2)?.errorCode, 'PUBLISH_CAPABILITY_NOT_DARK');
  assert.equal(summary.checks.at(-1)?.id, 'device-session-cleanup');
  assert.equal(summary.cleanup.required, false);
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('rejects a successful reconciliation older than the deployment-bound freshness floor', async () => {
  const fetcher = fixtureFetcher({ staleAttempt: true });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks.at(-2)?.errorCode, 'PUBLISH_RECONCILIATION_STATUS_INVALID');
  assert.equal(summary.cleanup.required, false);
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('rejects oversized JSON before any mutation', async () => {
  const fetcher = fixtureFetcher({ oversizedReady: true });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks[0]?.errorCode, 'HTTP_CONTENT_LENGTH_INVALID');
  assert.equal(summary.cleanup.required, false);
});

test('rejects a bad extension CORS preflight before any pairing mutation', async () => {
  const fetcher = fixtureFetcher({ badCors: true });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks[0]?.errorCode, 'EXTENSION_CORS_PREFLIGHT_FAILED');
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('cancels an issued pairing code when the device claim fails', async () => {
  const fetcher = fixtureFetcher({ rejectClaim: true });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(fetcher.wasCanceled(), true);
  assert.equal(summary.checks.at(-1)?.status, 'PASS');
  assert.equal(summary.checks.at(-1)?.evidence?.action, 'PAIRING_CODE_CANCELED');
  assert.equal(JSON.stringify(summary).includes(pairingCode), false);
});

test('recovers and revokes a committed session when the pairing claim response is lost', async () => {
  const fetcher = fixtureFetcher({ loseClaimResponse: true });
  const summary = await runRel04DarkCanary(input(), {
    fetcher,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(summary.status, 'FAIL');
  assert.equal(fetcher.wasRevoked(), true);
  assert.equal(fetcher.wasCanceled(), false);
  assert.equal(summary.checks.at(-1)?.id, 'device-session-cleanup');
  assert.equal(summary.checks.at(-1)?.status, 'PASS');
  assert.equal(summary.checks.at(-1)?.evidence?.action, 'OWNER_RECOVERED_AND_REVOKED');
  assert.equal(summary.checks.at(-1)?.evidence?.revokedTokenRejected, false);
});

test('fails a non-dark policy before creating a device session', async () => {
  const fetcher = fixtureFetcher({ enabledFlag: 'feature_extension_hosted_ai' });
  const summary = await runRel04DarkCanary(input(), { fetcher });
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.checks[0]?.id, 'deployment-and-publication-isolation');
  assert.equal(summary.checks[1]?.id, 'default-off-policy');
  assert.equal(summary.checks[1]?.status, 'FAIL');
  assert.equal(fetcher.calls.some(({ path: value }) => value.includes('pairing-codes')), false);
});

test('validates exact public API and extension origins before network I/O', async () => {
  let called = false;
  await assert.rejects(
    runRel04DarkCanary(input({ apiOrigin: 'http://127.0.0.1:3001' }), {
      fetcher: async () => { called = true; },
    }),
  );
  await assert.rejects(
    runRel04DarkCanary(input({ extensionOrigin: 'chrome-extension://*' }), {
      fetcher: async () => { called = true; },
    }),
  );
  assert.equal(called, false);
});

test('retains canonical mode-0600 evidence outside the repository and refuses repo output', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-rel04-canary-'));
  roots.push(root);
  const repository = path.join(root, 'repository');
  const outputRoot = path.join(root, 'private');
  mkdirSync(repository);
  mkdirSync(outputRoot);
  const output = path.join(outputRoot, 'rel04-dark-canary.json');
  const summary = {
    schemaVersion: 1,
    kind: 'SS_ERP_REL04_DARK_CANARY',
    status: 'PASS',
  };
  const result = writeRel04DarkCanarySummary(output, summary, repository);
  assert.match(result.outputSha256, /^[a-f0-9]{64}$/u);
  assert.equal(readFileSync(output, 'utf8'), `${JSON.stringify(summary, null, 2)}\n`);
  if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.throws(() => writeRel04DarkCanarySummary(
    path.join(repository, 'forbidden.json'),
    summary,
    repository,
  ));
});

test('CLI configuration verifies canonical target-bound QA-04 evidence outside the repository', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-rel04-config-'));
  roots.push(root);
  const repository = path.join(root, 'repository');
  const privateRoot = path.join(root, 'private');
  mkdirSync(repository);
  mkdirSync(privateRoot);
  const ownerTokenFile = path.join(privateRoot, 'owner.token');
  const adminTokenFile = path.join(privateRoot, 'admin.token');
  const acceptanceFile = path.join(privateRoot, 'qa04-final.json');
  writeFileSync(ownerTokenFile, `${ownerToken}\n`, { mode: 0o600 });
  writeFileSync(adminTokenFile, `${adminToken}\n`, { mode: 0o600 });
  const acceptance = {
    schemaVersion: 1,
    kind: 'QA04_FINAL_ACCEPTANCE',
    taskId: 'QA-04',
    gitCommit,
    completedAt: '2030-01-01T00:00:00.000Z',
    durationSeconds: 120,
    decision: 'PASS',
    qa02Prerequisite: 'COMPLETE',
    command: 'pnpm qa:04:offline',
    gates: [
      'QA04_OFFLINE_CONTRACT',
      'GIT_DIFF_CHECK',
      'WORKSPACE_LINT',
      'WORKSPACE_TYPECHECK',
      'FULL_PREFLIGHT_BUILD',
      'SCOPE_REVOCATION_POSTGRES',
      'AI_MEDIA_POSTGRES',
      'EXTENSION_CLOUD',
      'EXTENSION_LOCAL',
    ],
    extensionVerification: {
      cloud: { passed: 1, warnings: 0, failures: 0 },
      local: { passed: 1, warnings: 2, failures: 0 },
      source: { passed: 1, warnings: 2, failures: 0 },
    },
    externalEffects: {
      providerRequests: 0,
      vpsAccess: false,
      deployment: false,
      featureFlagChanges: 0,
      ozonWrites: 0,
    },
  };
  const acceptanceBytes = Buffer.from(`${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');
  writeFileSync(acceptanceFile, acceptanceBytes, { mode: 0o600 });
  for (const file of [ownerTokenFile, adminTokenFile, acceptanceFile]) chmodSync(file, 0o600);
  const acceptanceSha256 = createHash('sha256').update(acceptanceBytes).digest('hex');
  const environment = {
    ...signedCandidateEnvironment(repository, privateRoot),
    REL04_API_ORIGIN: apiOrigin,
    REL04_TARGET_GIT_COMMIT: gitCommit,
    REL04_EXTENSION_ORIGIN: extensionOrigin,
    REL04_SHOP_ID: shopId,
    REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256: acceptanceSha256,
    REL04_QA04_ACCEPTANCE_FILE: acceptanceFile,
    REL04_EXPECTED_PUBLISH_CAPABILITY_REASON: 'master_off',
    REL04_EXPECTED_PUBLISH_CAPABILITY_REVISION: 'master-off',
    REL04_EXPECTED_PUBLISH_LEGACY_ALLOWED: 'true',
    REL04_OWNER_TOKEN_FILE: ownerTokenFile,
    REL04_ADMIN_TOKEN_FILE: adminTokenFile,
    REL04_CANARY_OUTPUT: path.join(privateRoot, 'canary-output.json'),
  };
  const parse = (env) => parseRel04DarkCanaryEnvironment(env, repository, new Date('2030-01-02T00:00:00.000Z'));
  const parsed = parse(environment);
  assert.equal(parsed.publishReconciliationRegressionSha256, acceptanceSha256);
  assert.equal(parsed.ownerToken, ownerToken);
  assert.equal(parsed.adminToken, adminToken);
  assert.equal(parsed.releaseBinding.candidate.version, '1.2.3');
  assert.equal(parsed.releaseBinding.vpsVerificationSha256, environment.REL04_VPS_VERIFICATION_SHA256);
  // Reused paid execution cannot smuggle a screenshot from another candidate.
  const reuse = { ...acceptance, provenance: { normalErp: { sourceBridge: {
    kind: 'UNCHANGED_HOSTED_SUITE_RUNTIME_V1', requiresFreshTargetUiVerification: true,
    currentUi: { releaseSignatureSha256: environment.REL04_RELEASE_SIGNATURE_SHA256, version: '1.2.3' },
  } } } };
  const checkReuse = value => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); writeFileSync(acceptanceFile, bytes);
    return parse({ ...environment, REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256: sha256(bytes) });
  };
  assert.doesNotThrow(() => checkReuse(reuse));
  const missingUi = structuredClone(reuse); delete missingUi.provenance.normalErp.sourceBridge.currentUi;
  assert.throws(() => checkReuse(missingUi), /QA04_TARGET_UI_BINDING_INVALID/u);
  const wrongUi = structuredClone(reuse); wrongUi.provenance.normalErp.sourceBridge.currentUi.releaseSignatureSha256 = 'e'.repeat(64);
  assert.throws(() => checkReuse(wrongUi), /QA04_TARGET_UI_BINDING_INVALID/u);
  writeFileSync(acceptanceFile, acceptanceBytes);
  const pilotEnvironment = {
    ...environment,
    REL04_AI_MEDIA_ROLLOUT_EXPECTATION: 'hosted-pilot',
    REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify(pilotExpectation),
  };
  const parsedPilot = parse(pilotEnvironment);
  assert.equal(parsedPilot.rolloutExpectation, 'hosted-pilot');
  assert.deepEqual(parsedPilot.hostedPilotExpectation, pilotExpectation);
  const translationExpectation = { ...pilotExpectation, allowedOperations: ['IMAGE_TO_IMAGE', 'SUITE', 'IMAGE_TRANSLATE'] };
  assert.deepEqual(parse({ ...pilotEnvironment, REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify(translationExpectation) }).hostedPilotExpectation, translationExpectation);
  assert.deepEqual(parse({ ...pilotEnvironment, REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify(approvedComExpectation) }).hostedPilotExpectation, approvedComExpectation);
  for (const allowedOperations of [['IMAGE_TRANSLATE'], ['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE'],
    ['IMAGE_TO_IMAGE', 'SUITE', 'IMAGE_TRANSLATE', 'FULL_EDIT'], ['IMAGE_TO_IMAGE', 'SUITE', 'UNKNOWN_OPERATION']]) {
    assert.throws(() => parse({ ...pilotEnvironment,
      REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify({ ...pilotExpectation, allowedOperations }),
    }), /PILOT_EXPECTATION_INVALID/u);
  }
  assert.throws(() => parse({
    ...pilotEnvironment,
    REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: '{',
  }), /PILOT_EXPECTATION_INVALID/u);
  assert.throws(() => parse({
    ...environment,
    REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify(pilotExpectation),
  }), /PILOT_EXPECTATION_INVALID/u);
  const cnRepository = path.join(root, 'cn-repository');
  const cnPrivate = path.join(root, 'cn-private');
  mkdirSync(cnRepository);
  mkdirSync(cnPrivate);
  const cnEnvironment = {
    ...environment, ...signedCandidateEnvironment(cnRepository, cnPrivate, 'CN'),
    REL04_API_ORIGIN: 'https://api.example.cn',
    REL04_SHOP_ID: 'cn-dark-no-shop', REL04_NO_SHOP_DARK_CANARY: 'true',
    REL04_EXPECTED_PUBLISH_CAPABILITY_REASON: undefined,
    REL04_EXPECTED_PUBLISH_CAPABILITY_REVISION: undefined,
    REL04_EXPECTED_PUBLISH_LEGACY_ALLOWED: undefined,
  };
  const parseCn = (env) => parseRel04DarkCanaryEnvironment(
    env, cnRepository, new Date('2030-01-02T00:00:00.000Z'),
  );
  const parsedCn = parseCn(cnEnvironment);
  assert.equal(parsedCn.noShopDarkCanary, true);
  assert.equal(parsedCn.expectedPublishCapability, null);
  const cssCnBytes = Buffer.from(`${JSON.stringify(reuse, null, 2)}\n`);
  writeFileSync(acceptanceFile, cssCnBytes);
  assert.doesNotThrow(() => parseCn({ ...cnEnvironment, REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256: sha256(cssCnBytes) }));
  writeFileSync(acceptanceFile, acceptanceBytes);
  assert.throws(() => parseCn({ ...cnEnvironment, REL04_SHOP_ID: shopId, REL04_NO_SHOP_DARK_CANARY: undefined,
    REL04_EXPECTED_PUBLISH_CAPABILITY_REASON: 'policy_revision_mismatch', REL04_EXPECTED_PUBLISH_CAPABILITY_REVISION: 'source-policy-16',
    REL04_EXPECTED_PUBLISH_LEGACY_ALLOWED: 'false', REL04_AI_MEDIA_ROLLOUT_EXPECTATION: 'hosted-pilot',
    REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON: JSON.stringify(approvedComExpectation) }), /PILOT_EXPECTATION_INVALID/u);
  for (const changes of [
    { REL04_NO_SHOP_DARK_CANARY: 'invalid' },
    { REL04_REGION: 'COM' },
    { REL04_SHOP_ID: shopId },
    { REL04_AI_MEDIA_ROLLOUT_EXPECTATION: 'hosted-pilot' },
    { REL04_EXPECTED_PUBLISH_CAPABILITY_REASON: 'master_off' },
    { REL04_PUBLISH_WORKFLOW_ID: workflowId, REL04_PUBLISH_ATTEMPT_ID: attemptId,
      REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256: undefined,
      REL04_PUBLISH_RECONCILIATION_NOT_BEFORE: '2029-12-31T23:57:00.000Z',
      REL04_QA04_ACCEPTANCE_FILE: undefined },
  ]) assert.throws(() => parseCn({ ...cnEnvironment, ...changes }));
  for (const kind of ['SS_ERP_QA04_OFFLINE_REHEARSAL', 'SS_ERP_DARK_MAINTENANCE_BASELINE',
    'SS_ERP_DARK_MAINTENANCE_ACCEPTANCE', 'SS_ERP_DARK_MAINTENANCE_BACKUP']) {
    const bytes = Buffer.from(`${JSON.stringify({ ...acceptance, kind }, null, 2)}\n`);
    writeFileSync(acceptanceFile, bytes);
    assert.throws(() => parse({ ...environment, REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256: sha256(bytes) }),
      /QA04_ACCEPTANCE_INVALID/u);
  }
  writeFileSync(acceptanceFile, acceptanceBytes);
  for (const key of [
    'REL04_REGION', 'REL04_VERSION', 'REL04_RELEASE_EVIDENCE_SHA256',
    'REL04_RELEASE_SIGNATURE_SHA256', 'REL04_VPS_VERIFICATION_FILE', 'REL04_VPS_VERIFICATION_SHA256',
  ]) {
    assert.throws(() => parse({ ...environment, [key]: '' }), `${key} must be required`);
  }
  for (const replacement of [
    { REL04_REGION: 'CN' }, { REL04_VERSION: '9.9.9' },
    { REL04_RELEASE_EVIDENCE_SHA256: 'e'.repeat(64) },
    { REL04_RELEASE_SIGNATURE_SHA256: 'e'.repeat(64) },
    { REL04_VPS_VERIFICATION_SHA256: 'e'.repeat(64) },
  ]) assert.throws(() => parse({ ...environment, ...replacement }));

  const original = readFileSync(environment.REL04_VPS_VERIFICATION_FILE);
  const receipt = JSON.parse(original);
  for (const mutate of [
    (v) => { v.failures = 1; }, (v) => { v.scope = 'EXTENSION_ONLY'; },
    (v) => { v.candidate.releaseEvidenceSha256 = 'e'.repeat(64); },
    (v) => { v.candidate.releaseSignatureSha256 = 'e'.repeat(64); },
    (v) => { v.candidate.region = 'CN'; }, (v) => { v.candidate.gitCommit = 'e'.repeat(40); },
    (v) => { v.completedAt = '2030-01-02T00:01:00.000Z'; },
    (v) => { v.startedAt = '2029-12-01T00:00:00.000Z'; v.completedAt = '2029-12-01T00:01:00.000Z'; },
  ]) {
    const changed = structuredClone(receipt);
    mutate(changed);
    const bytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`);
    writeFileSync(environment.REL04_VPS_VERIFICATION_FILE, bytes);
    assert.throws(() => parse({ ...environment, REL04_VPS_VERIFICATION_SHA256: sha256(bytes) }));
  }
  writeFileSync(environment.REL04_VPS_VERIFICATION_FILE, original);
});

test('root package exposes the dark canary and focused contract test', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
  assert.equal(packageJson.scripts['canary:rel04:dark'], 'node scripts/rel04-dark-canary.mjs');
  assert.equal(
    packageJson.scripts['test:rel04:dark-canary'],
    'node scripts/rel04-dark-canary.test.mjs',
  );
  assert.match(preflight, /REL-04 dark canary contract[\s\S]*rel04-dark-canary\.test\.mjs/u);
});

test('CLI rejects command-line configuration without echoing a supplied secret', () => {
  const result = spawnSync(process.execPath, [
    'scripts/rel04-dark-canary.mjs',
    '--owner-token',
    ownerToken,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only through environment variables/u);
  assert.equal(`${result.stdout}${result.stderr}`.includes(ownerToken), false);
});
