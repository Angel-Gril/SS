import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  canonicalDistributionReceiptJson,
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  canonicalWebsitePublicationApprovalJson,
  distributionReceiptPayload,
  parseDistributionReceipt,
  parseReleaseSignature,
  parseTrustedKeyring,
  parseWebsitePublicationApproval,
  sha256,
  websitePublicationApprovalPayload,
} from './extension-release-publication-contract.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  createPinnedLookup,
  createPinnedWebsiteFetcher,
  probeWebsiteDistribution,
} from './probe-extension-website-distribution.mjs';
import { verifyExtensionPublication } from './verify-extension-publication.mjs';

const roots = [];
const keyId = 'ss-erp-extension-release-test-01';
const signedAt = '2030-01-01T00:00:00.000Z';
const canaryObservedAt = '2030-01-01T00:01:00.000Z';
const approvedAt = '2030-01-01T00:02:00.000Z';
const observedAt = '2030-01-01T00:05:00.000Z';
const origin = 'https://releases.example.com';

test('release signature verification reads only the bounded opened-file snapshot', () => {
  const verifier = readFileSync('scripts/verify-extension-release-signature.mjs', 'utf8');
  assert.match(verifier, /Buffer\.allocUnsafe\(Number\(opened\.size\)\)/u);
  assert.match(
    verifier,
    /readSync\(descriptor, bytes, offset, bytes\.length - offset, offset\)/u,
  );
  assert.doesNotMatch(verifier, /readFileSync\(descriptor\)/u);
});

function darkCanaryFixture({
  apiOrigin = origin,
  expectedGitCommit,
  observedAt: at = canaryObservedAt,
}) {
  const hash = 'a'.repeat(64);
  const routes = [
    ['GET', 'GET /ready'],
    ['GET', 'GET /api/extensions/latest'],
    ['OPTIONS', 'OPTIONS /api/extension-device/byok-media/readiness'],
    ['GET', 'GET /api/admin/system-config/:key'],
    ['GET', 'GET /api/ai-images/suites/readiness'],
    ['GET', 'GET /api/source-listing-workflows/publisher-capability'],
    ['POST', 'POST /api/extension-device/pairing-codes'],
    ['POST', 'POST /api/extension-device/pairing-claims'],
    ['GET', 'GET /api/extension-device/shops'],
    ['POST', 'POST /api/extension-device/refresh'],
    ['GET', 'GET /api/extension-device/sessions'],
    ['POST', 'POST /api/extension-device/byok-media/readiness'],
    ['DELETE', 'DELETE /api/extension-device/sessions/:sessionId'],
    ['GET', 'GET /api/extension-device/shops (revoked)'],
  ];
  return {
    schemaVersion: 1,
    kind: 'SS_ERP_REL04_DARK_CANARY',
    status: 'PASS',
    observedAt: at,
    bindings: {
      apiOrigin,
      expectedGitCommit,
      extensionOrigin: `chrome-extension://${'a'.repeat(32)}`,
      shopIdHash: hash,
      publishReconciliation: {
        mode: 'TARGET_COMMIT_QA04_REGRESSION',
        workflowIdHash: null,
        attemptIdHash: null,
        regressionEvidenceSha256: hash,
        notBefore: null,
      },
    },
    checks: [
      { id: 'deployment-and-publication-isolation', status: 'PASS', evidence: {
        deployedGitCommit: expectedGitCommit,
        deployedCandidatePublic: false,
        existingPublication: null,
        extensionCorsPreflight: true,
      } },
      { id: 'default-off-policy', status: 'PASS', evidence: {
        master: 'absent', imageToImage: 'absent', suite: 'absent', fullEdit: 'absent',
        inpaint: 'absent', webMedia: 'absent', extensionWorkbench: 'absent',
        ozonPublisher: 'absent', legacyGeneration: 'absent/disabled',
        imageTranslation: 'absent/disabled', policy: 'absent',
        extensionByok: {
          expectation: 'off', hostedAi: 'absent(default:false)', generation: 'absent(default:false)',
          ingest: 'absent(default:false)', publish: 'absent(default:false)', policy: 'absent(default:off)',
        },
      } },
      { id: 'hosted-route-regression', status: 'PASS', evidence: {
        routeReachable: true, providerDispatchMethodUsed: false, suiteEnabled: false,
        workflowEnabled: false, reasonCode: 'AI_MEDIA_SUITE_DISABLED',
      } },
      { id: 'publish-reconciliation-read', status: 'PASS', evidence: {
        mode: 'TARGET_COMMIT_QA04_REGRESSION', liveAttemptRead: false,
        regressionEvidenceSha256: hash, capabilityEnabled: false,
        capabilityReason: 'master_off', capabilityRevision: 'master-off',
        capabilityLegacyAllowed: true, ozonMutationRequestSentByCanary: false,
      } },
      { id: 'device-pairing-active-lifecycle', status: 'PASS', evidence: {
        deploymentIdHash: hash, deviceIdHash: hash, sessionIdHash: hash,
        authorizedShopIdHash: hash, refreshRotated: true,
      } },
      { id: 'byok-disabled-path', status: 'PASS', evidence: {
        rejectedBeforeExecutionIntent: true, providerRequestSentByCanary: false,
        erpIngestRequestSentByCanary: false, statusCode: 409,
        errorCode: 'byok_readiness_not_ready',
      } },
      { id: 'device-session-cleanup', status: 'PASS', evidence: {
        action: 'OWNER_REVOKED', sessionIdHash: hash, revokedTokenRejected: true,
      } },
    ],
    requestAudit: {
      timeoutMs: 15000, redirectsAllowed: false, credentialsMode: 'omit',
      requests: routes.map(([method, route]) => ({ method, route, statusCode: 200 })),
      providerDispatchSent: false, erpIngestSent: false, ozonMutationSent: false,
    },
    cleanup: { required: true, completed: true, errorCode: null },
  };
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function canonicalWrite(file, value, canonicalizer = (entry) => `${JSON.stringify(entry, null, 2)}\n`) {
  writeFileSync(file, canonicalizer(value), { flag: 'wx', mode: 0o644 });
}

function response(bytes, { status = 200, headers = {} } = {}) {
  return new Response(bytes, { status, headers });
}

function protectWindowsPrivateKey(file) {
  if (process.platform !== 'win32') return;
  const executable = path.join(
    String(process.env.SystemRoot || 'C:\\Windows'),
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    '$keyPath=$env:SS_ERP_EXTENSION_SIGNING_KEY_PATH',
    "if([string]::IsNullOrWhiteSpace($keyPath)){throw 'path'}",
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '& icacls.exe $keyPath /inheritance:r /grant:r ("*"+$sid+":F") | Out-Null',
    "if($LASTEXITCODE -ne 0){throw 'icacls'}",
  ].join(';');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    env: { ...process.env, SS_ERP_EXTENSION_SIGNING_KEY_PATH: file },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
}

function protectWindowsDirectory(directory) {
  if (process.platform !== 'win32') return;
  const sid = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(sid.status, 0, sid.stderr);
  const result = spawnSync('icacls.exe', [
    directory,
    '/inheritance:r',
    '/grant:r',
    `*${sid.stdout.trim()}:(OI)(CI)F`,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-publication-'));
  roots.push(root);
  const version = '1.0.265';
  const gitCommit = 'a'.repeat(40);
  const cloudBytes = Buffer.from('canonical cloud release bytes\n', 'utf8');
  const localBytes = Buffer.from('canonical local release bytes\n', 'utf8');
  const artifacts = {
    cloud: {
      target: 'cloud',
      filename: `ss-erp-cloud-${version}.zip`,
      zipSha256: sha256(cloudBytes),
      fileCount: 1,
    },
    local: {
      target: 'local',
      filename: `ss-erp-local-${version}.zip`,
      zipSha256: sha256(localBytes),
      fileCount: 1,
    },
  };
  const evidence = parseExtensionReleaseEvidence({
    schemaVersion: 1,
    gitCommit,
    provenance: {
      commitSource: 'GIT_HEAD',
      sourceMode: 'REPOSITORY_SOURCE',
      packageInputsSha256: 'b'.repeat(64),
    },
    version,
    expectedOrigins: {
      web: 'https://app.example.com',
      admin: 'https://admin.example.com',
      api: origin,
      local: 'http://127.0.0.1:3001',
    },
    artifacts,
    checksumFilename: `ss-erp-extension-${version}.sha256`,
    signature: { status: 'EXTERNAL_REQUIRED' },
  });
  const candidateRoot = path.join(root, 'candidate');
  const publicationRoot = path.join(root, 'publication');
  mkdirSync(candidateRoot);
  mkdirSync(publicationRoot);
  const evidencePath = path.join(candidateRoot, `ss-erp-extension-${version}.release-evidence.json`);
  const signaturePath = path.join(publicationRoot, `ss-erp-extension-${version}.release-signature.json`);
  const darkCanaryPath = path.join(publicationRoot, `ss-erp-extension-${version}.rel04-dark-canary.json`);
  const approvalPath = path.join(
    publicationRoot,
    `ss-erp-extension-${version}.website-publication-approval.json`,
  );
  const receiptPath = path.join(publicationRoot, `ss-erp-extension-${version}.distribution-receipt.json`);
  const keyringPath = path.join(root, 'trusted-keys.json');
  const privateKeyPath = path.join(root, 'release-signing-key.pem');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  canonicalWrite(evidencePath, evidence, canonicalExtensionReleaseEvidenceJson);
  writeFileSync(path.join(candidateRoot, artifacts.cloud.filename), cloudBytes, { flag: 'wx' });
  writeFileSync(path.join(candidateRoot, artifacts.local.filename), localBytes, { flag: 'wx' });
  writeFileSync(
    path.join(candidateRoot, evidence.checksumFilename),
    `${artifacts.cloud.zipSha256}  ${artifacts.cloud.filename}\n`
      + `${artifacts.local.zipSha256}  ${artifacts.local.filename}\n`,
    { flag: 'wx' },
  );
  writeFileSync(
    privateKeyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  protectWindowsPrivateKey(privateKeyPath);
  const keyring = parseTrustedKeyring({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{
      algorithm: 'Ed25519',
      keyId,
      publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      status: 'ACTIVE',
    }],
  });
  canonicalWrite(keyringPath, keyring, canonicalTrustedKeyringJson);
  const darkCanary = darkCanaryFixture({ expectedGitCommit: gitCommit });
  canonicalWrite(darkCanaryPath, darkCanary);
  return {
    root,
    candidateRoot,
    version,
    gitCommit,
    evidence,
    evidencePath,
    signaturePath,
    darkCanaryPath,
    approvalPath,
    receiptPath,
    keyringPath,
    privateKeyPath,
    privateKey,
    publicKey,
    darkCanary,
    darkCanaryBytes: readFileSync(darkCanaryPath),
    cloudBytes,
    localBytes,
  };
}

function runWebsiteApprovalSigner(value, overrides = {}) {
  return spawnSync(process.execPath, [
    'scripts/sign-extension-website-publication.mjs',
    '--dark-canary', value.darkCanaryPath,
    '--distribution-origin', origin,
    '--evidence', value.evidencePath,
    '--expected-dark-canary-sha256', sha256(value.darkCanaryBytes),
    '--expected-release-signature-sha256', sha256(value.signatureBytes),
    '--keyring', value.keyringPath,
    '--output', value.approvalPath,
    '--region', 'COM',
    '--release-signature', value.signaturePath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_RELEASE_SIGNING_KEY_PATH: value.privateKeyPath,
      EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
      EXTENSION_WEBSITE_PUBLICATION_APPROVED_AT: approvedAt,
      ...overrides,
    },
  });
}

function bindCandidate(value) {
  value.darkCanary.schemaVersion = 2;
  value.darkCanary.bindings.release = {
    candidate: {
      gitCommit: value.gitCommit, apiOrigin: origin, region: 'COM', version: value.version,
      releaseEvidenceSha256: sha256(readFileSync(value.evidencePath)),
      releaseSignatureSha256: sha256(value.signatureBytes),
    },
    vpsVerificationSha256: 'f'.repeat(64),
    vpsStartedAt: '2030-01-01T00:00:15.000Z',
    vpsVerifiedAt: '2030-01-01T00:00:30.000Z',
  };
  writeFileSync(value.darkCanaryPath, `${JSON.stringify(value.darkCanary, null, 2)}\n`);
  value.darkCanaryBytes = readFileSync(value.darkCanaryPath);
}

function bindRestrictedPilotCandidate(value) {
  bindCandidate(value);
  const policy = {
    expectation: 'hosted-pilot',
    ownerUserIds: ['owner-pilot-01'],
    shopIds: ['shop-pilot-01'],
    deviceSessionIds: ['device-session-01', 'device-session-02'],
    rolloutRevision: 15,
    sourcePolicyRevision: 'pilot-source-revision-15',
    allowedOperations: ['IMAGE_TO_IMAGE', 'SUITE'],
  };
  value.darkCanary.schemaVersion = 3;
  value.darkCanary.kind = 'SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY';
  value.darkCanary.bindings.rollout = {
    expectation: 'hosted-pilot',
    policySha256: sha256(Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, 'utf8')),
  };
  value.darkCanary.checks = value.darkCanary.checks.map((check) => {
    if (check.id === 'default-off-policy') {
      return { id: 'restricted-pilot-policy', status: 'PASS', evidence: policy };
    }
    if (check.id === 'hosted-route-regression') {
      return { id: 'hosted-route-readiness', status: 'PASS', evidence: {
        routeReachable: true,
        providerDispatchMethodUsed: false,
        suiteEnabled: true,
        workflowEnabled: true,
        webMediaEnabled: true,
        ready: true,
        reasonCode: 'READY',
      } };
    }
    return check;
  });
  writeFileSync(value.darkCanaryPath, `${JSON.stringify(value.darkCanary, null, 2)}\n`);
  value.darkCanaryBytes = readFileSync(value.darkCanaryPath);
}

function runSigner(value, overrides = {}) {
  return spawnSync(process.execPath, [
    'scripts/sign-extension-release.mjs',
    '--evidence', value.evidencePath,
    '--keyring', value.keyringPath,
    '--output', value.signaturePath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_RELEASE_SIGNING_KEY_PATH: value.privateKeyPath,
      EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
      EXTENSION_RELEASE_SIGNED_AT: signedAt,
      ...overrides,
    },
  });
}

function signedFixture({ restrictedPilot = false } = {}) {
  const value = fixture();
  const result = runSigner(value);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BEGIN PRIVATE KEY|MC4CAQ/iu);
  value.signatureBytes = readFileSync(value.signaturePath);
  value.signature = parseReleaseSignature(JSON.parse(value.signatureBytes));
  assert.equal(value.signatureBytes.toString('utf8'), canonicalReleaseSignatureJson(value.signature));
  if (restrictedPilot) bindRestrictedPilotCandidate(value);
  else bindCandidate(value);
  const approvalResult = runWebsiteApprovalSigner(value);
  assert.equal(approvalResult.status, 0, `${approvalResult.stdout}\n${approvalResult.stderr}`);
  assert.doesNotMatch(`${approvalResult.stdout}\n${approvalResult.stderr}`, /BEGIN PRIVATE KEY|MC4CAQ/iu);
  value.approvalBytes = readFileSync(value.approvalPath);
  value.approval = parseWebsitePublicationApproval(JSON.parse(value.approvalBytes));
  assert.equal(
    value.approvalBytes.toString('utf8'),
    canonicalWebsitePublicationApprovalJson(value.approval),
  );
  return value;
}

test('new website approval refuses a legacy canary before accessing the signing key', () => {
  const value = fixture();
  const signed = runSigner(value);
  assert.equal(signed.status, 0, signed.stderr);
  value.signatureBytes = readFileSync(value.signaturePath);
  const result = runWebsiteApprovalSigner(value, {
    EXTENSION_RELEASE_SIGNING_KEY_PATH: path.join(value.root, 'missing-signing-key.pem'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /v2 candidate-bound/u);
  assert.equal(existsSync(value.approvalPath), false);
});

test('new website approval rejects VPS evidence completed before the candidate signature', () => {
  const value = fixture();
  const signed = runSigner(value);
  assert.equal(signed.status, 0, signed.stderr);
  value.signatureBytes = readFileSync(value.signaturePath);
  bindCandidate(value);
  value.darkCanary.bindings.release.vpsVerifiedAt = '2029-12-31T23:59:00.000Z';
  value.darkCanary.bindings.release.vpsStartedAt = '2029-12-31T23:58:00.000Z';
  writeFileSync(value.darkCanaryPath, `${JSON.stringify(value.darkCanary, null, 2)}\n`);
  value.darkCanaryBytes = readFileSync(value.darkCanaryPath);
  const result = runWebsiteApprovalSigner(value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VPS.*signature|VPS.*order/iu);
  assert.equal(existsSync(value.approvalPath), false);
});

test('new website approval rejects a VPS run started before signing even if it finishes later', () => {
  const value = fixture();
  const signed = runSigner(value);
  assert.equal(signed.status, 0, signed.stderr);
  value.signatureBytes = readFileSync(value.signaturePath);
  bindCandidate(value);
  value.darkCanary.bindings.release.vpsStartedAt = '2029-12-31T23:59:00.000Z';
  writeFileSync(value.darkCanaryPath, `${JSON.stringify(value.darkCanary, null, 2)}\n`);
  value.darkCanaryBytes = readFileSync(value.darkCanaryPath);
  const result = runWebsiteApprovalSigner(value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VPS.*signature/iu);
  assert.equal(existsSync(value.approvalPath), false);
});

function latestBytes(value, mutate) {
  const latest = {
    code: 1,
    data: {
      version: value.version,
      gitCommit: value.gitCommit,
      publicationApprovalSha256: sha256(value.approvalBytes),
      signatureStatus: 'EXTERNAL_REQUIRED',
      targets: Object.fromEntries(['cloud', 'local'].map((target) => {
        const artifact = value.evidence.artifacts[target];
        return [target, {
          filename: artifact.filename,
          downloadUrl: `/api/extensions/download/${target}/${value.version}/${artifact.zipSha256}`,
          sha256: artifact.zipSha256,
        }];
      })),
    },
  };
  mutate?.(latest);
  return Buffer.from(JSON.stringify(latest), 'utf8');
}

function fetcher(value, options = {}) {
  const latest = latestBytes(value, options.mutateLatest);
  const calls = [];
  const execute = async (url, init) => {
    calls.push({ url, init });
    if (url === `${origin}/api/extensions/latest`) {
      return response(latest, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(latest.length),
        },
      });
    }
    for (const target of ['cloud', 'local']) {
      const artifact = value.evidence.artifacts[target];
      const expected = `${origin}/api/extensions/download/${target}/${value.version}/${artifact.zipSha256}`;
      if (url !== expected) continue;
      if (options.failTarget === target) return response('rejected', { status: 404 });
      const original = target === 'cloud' ? value.cloudBytes : value.localBytes;
      const bytes = options.tamperTarget === target ? Buffer.from('tampered') : original;
      return response(bytes, {
        headers: {
          'content-type': 'application/zip',
          'content-length': String(bytes.length),
          'content-disposition': `attachment; filename="${artifact.filename}"`,
          'x-content-sha256': artifact.zipSha256,
          'x-publication-approval-sha256': options.responseApprovalSha256
            || sha256(value.approvalBytes),
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  execute.calls = calls;
  execute.latestBytes = latest;
  return execute;
}

async function completePublication(value, options = {}) {
  const mockFetch = fetcher(value, options);
  const receipt = await probeWebsiteDistribution({
    origin,
    evidence: value.evidence,
    evidenceBytes: readFileSync(value.evidencePath),
    signature: value.signature,
    signatureBytes: value.signatureBytes,
    approval: options.approval || value.approval,
    approvalBytes: options.approvalBytes || value.approvalBytes,
    darkCanaryPath: value.darkCanaryPath,
    fetcher: mockFetch,
    signKey: value.privateKey,
    keyId,
    observedAt,
    now: new Date('2030-01-01T00:06:00.000Z'),
  });
  canonicalWrite(value.receiptPath, receipt, canonicalDistributionReceiptJson);
  return { receipt, mockFetch };
}

function verificationInput(value, overrides = {}) {
  return {
    evidencePath: value.evidencePath,
    signaturePath: value.signaturePath,
    approvalPath: value.approvalPath,
    darkCanaryPath: value.darkCanaryPath,
    receiptPath: value.receiptPath,
    keyringPath: value.keyringPath,
    now: new Date('2030-01-01T00:06:00.000Z'),
    ...overrides,
  };
}

test('signs the immutable release, probes both exact website downloads, and verifies publication', async () => {
  const value = signedFixture();
  const { receipt, mockFetch } = await completePublication(value);
  assert.equal(receipt.latest.targets.cloud.bodySha256, value.evidence.artifacts.cloud.zipSha256);
  assert.equal(receipt.latest.targets.local.bodySha256, value.evidence.artifacts.local.zipSha256);
  assert.deepEqual(mockFetch.calls.map((call) => call.url), [
    `${origin}/api/extensions/latest`,
    receipt.latest.targets.cloud.url,
    receipt.latest.targets.local.url,
  ]);
  for (const call of mockFetch.calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.headers['Accept-Encoding'], 'identity');
    assert.equal(Object.hasOwn(call.init.headers, 'Authorization'), false);
    assert.equal(Object.hasOwn(call.init.headers, 'Cookie'), false);
  }
  const verified = verifyExtensionPublication(verificationInput(value));
  assert.equal(verified.version, value.version);
  assert.equal(verified.distributionOrigin, origin);
  assert.equal(verified.keyId, keyId);
  assert.equal(verified.websitePublicationApprovalSha256, sha256(value.approvalBytes));
  assert.equal(verified.darkCanarySha256, sha256(value.darkCanaryBytes));
});

test('signs, probes, and verifies a restricted hosted pilot publication canary', async () => {
  const value = signedFixture({ restrictedPilot: true });
  const { receipt } = await completePublication(value);
  assert.equal(receipt.darkCanarySha256, sha256(value.darkCanaryBytes));
  const verified = verifyExtensionPublication(verificationInput(value));
  assert.equal(verified.version, value.version);
  assert.equal(verified.gitCommit, value.gitCommit);
  assert.equal(verified.darkCanarySha256, sha256(value.darkCanaryBytes));
});

test('rejects a REL-04 observation that predates its release signature at every publication stage', async () => {
  const lateSignedAt = '2030-01-01T00:01:30.000Z';
  const signing = fixture();
  const signatureResult = runSigner(signing, {
    EXTENSION_RELEASE_SIGNED_AT: lateSignedAt,
  });
  assert.equal(signatureResult.status, 0, `${signatureResult.stdout}\n${signatureResult.stderr}`);
  signing.signatureBytes = readFileSync(signing.signaturePath);
  signing.signature = parseReleaseSignature(JSON.parse(signing.signatureBytes));
  bindCandidate(signing);
  const approvalResult = runWebsiteApprovalSigner(signing);
  assert.notEqual(approvalResult.status, 0);
  assert.match(approvalResult.stderr, /VPS verification started before the release signature/u);

  const value = signedFixture();
  const { receipt } = await completePublication(value);
  rmSync(value.signaturePath);
  const replacementSignature = runSigner(value, {
    EXTENSION_RELEASE_SIGNED_AT: lateSignedAt,
  });
  assert.equal(
    replacementSignature.status,
    0,
    `${replacementSignature.stdout}\n${replacementSignature.stderr}`,
  );
  value.signatureBytes = readFileSync(value.signaturePath);
  value.signature = parseReleaseSignature(JSON.parse(value.signatureBytes));

  bindCandidate(value);
  const unsignedApproval = parseWebsitePublicationApproval({
    ...value.approval,
    releaseSignatureSha256: sha256(value.signatureBytes),
    darkCanarySha256: sha256(value.darkCanaryBytes),
    signatureBase64: Buffer.alloc(64).toString('base64'),
  });
  value.approval = parseWebsitePublicationApproval({
    ...unsignedApproval,
    signatureBase64: sign(
      null,
      websitePublicationApprovalPayload(unsignedApproval),
      value.privateKey,
    ).toString('base64'),
  });
  rmSync(value.approvalPath);
  canonicalWrite(
    value.approvalPath,
    value.approval,
    canonicalWebsitePublicationApprovalJson,
  );
  value.approvalBytes = readFileSync(value.approvalPath);

  const unsignedReceipt = parseDistributionReceipt({
    ...receipt,
    releaseSignatureSha256: sha256(value.signatureBytes),
    websitePublicationApprovalSha256: sha256(value.approvalBytes),
    darkCanarySha256: sha256(value.darkCanaryBytes),
    signatureBase64: Buffer.alloc(64).toString('base64'),
  });
  const replacementReceipt = parseDistributionReceipt({
    ...unsignedReceipt,
    signatureBase64: sign(
      null,
      distributionReceiptPayload(unsignedReceipt),
      value.privateKey,
    ).toString('base64'),
  });
  rmSync(value.receiptPath);
  canonicalWrite(value.receiptPath, replacementReceipt, canonicalDistributionReceiptJson);

  const noNetwork = fetcher(value);
  await assert.rejects(probeWebsiteDistribution({
    origin,
    evidence: value.evidence,
    evidenceBytes: readFileSync(value.evidencePath),
    signature: value.signature,
    signatureBytes: value.signatureBytes,
    approval: value.approval,
    approvalBytes: value.approvalBytes,
    darkCanaryPath: value.darkCanaryPath,
    fetcher: noNetwork,
    signKey: value.privateKey,
    keyId,
    observedAt,
    now: new Date('2030-01-01T00:06:00.000Z'),
  }), /VPS verification started before the release signature/u);
  assert.equal(noNetwork.calls.length, 0);
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /VPS verification started before the release signature/u,
  );
});

test('uses one environment-selected keyring for release and website approval verification', () => {
  const value = fixture();
  const releaseResult = runSigner(value);
  assert.equal(releaseResult.status, 0, `${releaseResult.stdout}\n${releaseResult.stderr}`);
  value.signatureBytes = readFileSync(value.signaturePath);

  bindCandidate(value);
  const result = spawnSync(process.execPath, [
    'scripts/sign-extension-website-publication.mjs',
    '--dark-canary', value.darkCanaryPath,
    '--distribution-origin', origin,
    '--evidence', value.evidencePath,
    '--expected-dark-canary-sha256', sha256(value.darkCanaryBytes),
    '--expected-release-signature-sha256', sha256(value.signatureBytes),
    '--output', value.approvalPath,
    '--region', 'COM',
    '--release-signature', value.signaturePath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_RELEASE_SIGNING_KEY_PATH: value.privateKeyPath,
      EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
      EXTENSION_RELEASE_TRUSTED_KEYRING_PATH: value.keyringPath,
      EXTENSION_WEBSITE_PUBLICATION_APPROVED_AT: approvedAt,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(value.approvalPath), true);
});

test('CLI verification rejects an operator-supplied alternate trust root', async () => {
  const value = signedFixture();
  await completePublication(value);
  const result = spawnSync(process.execPath, [
    'scripts/verify-extension-publication.mjs',
    '--evidence', value.evidencePath,
    '--signature', value.signaturePath,
    '--approval', value.approvalPath,
    '--dark-canary', value.darkCanaryPath,
    '--receipt', value.receiptPath,
    '--keyring', value.keyringPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository trusted keyring/u);
});

test('refuses to overwrite an existing release signature and never prints key material', () => {
  const value = signedFixture();
  const second = runSigner(value);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /EEXIST|already exists|exist/iu);
  assert.doesNotMatch(`${second.stdout}\n${second.stderr}`, /BEGIN PRIVATE KEY|MC4CAQ/iu);
});

test('creates one protected Ed25519 key outside the repository without printing private material', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-release-key-'));
  roots.push(root);
  chmodSync(root, 0o700);
  protectWindowsDirectory(root);
  const keyPath = path.join(root, 'release-key.pkcs8.pem');
  const environment = {
    ...process.env,
    EXTENSION_RELEASE_SIGNING_KEY_PATH: keyPath,
    EXTENSION_RELEASE_SIGNING_KEY_ID: 'ss-erp-extension-release-test-create-01',
  };
  const created = spawnSync(process.execPath, [
    'scripts/create-extension-release-signing-key.mjs',
  ], { cwd: process.cwd(), encoding: 'utf8', env: environment });
  assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`);
  assert.doesNotMatch(created.stdout, /BEGIN PRIVATE KEY|PRIVATE KEY/u);
  assert.match(readFileSync(keyPath, 'utf8'), /^-----BEGIN PRIVATE KEY-----/u);
  const result = JSON.parse(created.stdout);
  assert.equal(result.key.algorithm, 'Ed25519');
  assert.equal(result.key.status, 'ACTIVE');
  assert.match(result.publicKeySha256, /^[a-f0-9]{64}$/u);
  const duplicate = spawnSync(process.execPath, [
    'scripts/create-extension-release-signing-key.mjs',
  ], { cwd: process.cwd(), encoding: 'utf8', env: environment });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /already exists/u);
});

test('requires an explicit signature output outside the immutable four-file candidate', () => {
  const value = fixture();
  const baseArgs = [
    'scripts/sign-extension-release.mjs',
    '--evidence', value.evidencePath,
    '--keyring', value.keyringPath,
  ];
  const environment = {
    ...process.env,
    EXTENSION_RELEASE_SIGNING_KEY_PATH: value.privateKeyPath,
    EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
    EXTENSION_RELEASE_SIGNED_AT: signedAt,
  };
  const missing = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(), encoding: 'utf8', env: environment,
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--output is required/u);
  const insideCandidate = spawnSync(process.execPath, [
    ...baseArgs,
    '--output', path.join(value.candidateRoot, 'forbidden.release-signature.json'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', env: environment,
  });
  assert.notEqual(insideCandidate.status, 0);
  assert.match(insideCandidate.stderr, /outside the immutable four-file candidate/u);
  const nested = path.join(value.candidateRoot, 'nested');
  mkdirSync(nested);
  const nestedCandidate = spawnSync(process.execPath, [
    ...baseArgs,
    '--output', path.join(nested, 'forbidden.release-signature.json'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', env: environment,
  });
  assert.notEqual(nestedCandidate.status, 0);
  assert.match(nestedCandidate.stderr, /outside the immutable four-file candidate/u);
  const wrongName = spawnSync(process.execPath, [
    ...baseArgs,
    '--output', path.join(path.dirname(value.signaturePath), 'wrong.release-signature.json'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', env: environment,
  });
  assert.notEqual(wrongName.status, 0);
  assert.match(wrongName.stderr, /canonical versioned filenames/u);
});

test('requires an explicit receipt output outside the immutable four-file candidate before probing', () => {
  const value = signedFixture();
  const baseArgs = [
    'scripts/probe-extension-website-distribution.mjs',
    '--origin', origin,
    '--evidence', value.evidencePath,
    '--signature', value.signaturePath,
    '--approval', value.approvalPath,
    '--dark-canary', value.darkCanaryPath,
  ];
  const missing = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(), encoding: 'utf8', env: process.env,
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--output is required/u);
  const insideCandidate = spawnSync(process.execPath, [
    ...baseArgs,
    '--output', path.join(value.candidateRoot, 'forbidden.distribution-receipt.json'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', env: process.env,
  });
  assert.notEqual(insideCandidate.status, 0);
  assert.match(insideCandidate.stderr, /outside the immutable four-file candidate/u);
  assert.doesNotMatch(insideCandidate.stderr, /fetch|network|TLS/u);
  const wrongName = spawnSync(process.execPath, [
    ...baseArgs,
    '--output', path.join(path.dirname(value.receiptPath), 'wrong.distribution-receipt.json'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', env: process.env,
  });
  assert.notEqual(wrongName.status, 0);
  assert.match(wrongName.stderr, /canonical versioned filenames/u);
  assert.doesNotMatch(wrongName.stderr, /fetch|network|TLS/u);
});

test('rejects a signing key with group or world permissions on POSIX', { skip: process.platform === 'win32' }, () => {
  const value = fixture();
  chmodSync(value.privateKeyPath, 0o644);
  const result = runSigner(value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /group\/world/u);
});

test('rejects a signing key readable by Everyone on Windows', { skip: process.platform !== 'win32' }, () => {
  const value = fixture();
  const result = spawnSync('icacls.exe', [value.privateKeyPath, '/grant', '*S-1-1-0:R'], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const signed = runSigner(value);
  assert.notEqual(signed.status, 0);
  assert.match(signed.stderr, /Windows ACL/u);
});

test('rejects a signing key that has another hard link', () => {
  const value = fixture();
  linkSync(value.privateKeyPath, path.join(value.root, 'linked-release-signing-key.pem'));
  const signed = runSigner(value);
  assert.notEqual(signed.status, 0);
  assert.match(signed.stderr, /hard links/u);
});

test('rejects signing when the trusted public keyring does not bind the private key', () => {
  const value = fixture();
  const ring = JSON.parse(readFileSync(value.keyringPath, 'utf8'));
  ring.keys[0].status = 'REVOKED';
  writeFileSync(value.keyringPath, canonicalTrustedKeyringJson(ring));
  const result = runSigner(value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not the active key/u);
});

test('rejects a definite failed download and a body whose digest does not match evidence', async () => {
  const value = signedFixture();
  await assert.rejects(completePublication(value, { failTarget: 'cloud' }), /HTTP 404/u);
  await assert.rejects(completePublication(value, { tamperTarget: 'local' }), /SHA-256/u);
});

test('rejects private, proxy fake-IP, and mixed DNS answers before website I/O', async () => {
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '198.18.0.22', family: 4 }],
    [{ address: '255.255.255.255', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '::1', family: 6 }],
    [{ address: '2002:7f00:1::', family: 6 }],
  ]) {
    let requested = false;
    await assert.rejects(createPinnedWebsiteFetcher(origin, {
      resolveDns: async () => addresses,
      requestImpl() { requested = true; },
    }), /only to public addresses/u);
    assert.equal(requested, false);
  }
  const fetcher = await createPinnedWebsiteFetcher(origin, {
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl() { throw new Error('not called'); },
  });
  assert.deepEqual(fetcher.pinnedAddresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('the pinned DNS lookup honors Node all:true and scalar callback contracts', () => {
  const lookup = createPinnedLookup({ address: '93.184.216.34', family: 4 });
  lookup('releases.example.com', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
  });
  lookup('releases.example.com', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  });
});

test('the pinned transport aborts a body that exceeds its declared Content-Length', async () => {
  function requestImpl(_url, _options, callback) {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.end = () => {
      const incoming = Readable.from([Buffer.from('too large')]);
      incoming.statusCode = 200;
      incoming.headers = {
        'content-type': 'application/json',
        'content-length': '2',
      };
      callback(incoming);
    };
    request.destroy = (error) => request.emit('error', error);
    return request;
  }
  const fetcher = await createPinnedWebsiteFetcher(origin, {
    resolveDns: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl,
  });
  await assert.rejects(fetcher(`${origin}/api/extensions/latest`, {
    headers: { Accept: 'application/json' },
  }), /exceeded its declared bound/u);
});

test('rejects latest metadata from another version, origin path, or release digest', async () => {
  const value = signedFixture();
  await assert.rejects(completePublication(value, {
    mutateLatest(latest) { latest.data.version = '1.0.266'; },
  }), /does not match/u);
  await assert.rejects(completePublication(value, {
    mutateLatest(latest) { latest.data.targets.cloud.downloadUrl = 'https://evil.example/release.zip'; },
  }), /approved website origin/u);
  await assert.rejects(completePublication(value, {
    mutateLatest(latest) { latest.data.targets.local.sha256 = 'f'.repeat(64); },
  }), /metadata does not match/u);
});

test('rejects a website approval bound to another commit before website I/O', async () => {
  const value = signedFixture();
  const noNetwork = fetcher(value);
  await assert.rejects(probeWebsiteDistribution({
    origin,
    evidence: value.evidence,
    evidenceBytes: readFileSync(value.evidencePath),
    signature: value.signature,
    signatureBytes: value.signatureBytes,
    approval: { ...value.approval, gitCommit: 'c'.repeat(40) },
    approvalBytes: value.approvalBytes,
    darkCanaryPath: value.darkCanaryPath,
    fetcher: noNetwork,
    signKey: value.privateKey,
    keyId,
    observedAt,
    now: new Date('2030-01-01T00:06:00.000Z'),
  }), /approval is not bound to the signed release/u);
  assert.equal(noNetwork.calls.length, 0);
});

test('rejects website responses whose publication approval SHA does not match', async () => {
  const value = signedFixture();
  await assert.rejects(completePublication(value, {
    mutateLatest(latest) { latest.data.publicationApprovalSha256 = 'f'.repeat(64); },
  }), /latest response does not match the approved release/u);
  await assert.rejects(completePublication(value, {
    responseApprovalSha256: 'f'.repeat(64),
  }), /download SHA-256 does not match release evidence/u);
});

test('rejects REL-04 evidence whose SHA no longer matches the signed website approval', async () => {
  const value = signedFixture();
  await completePublication(value);
  writeFileSync(value.darkCanaryPath, `${JSON.stringify({
    ...value.darkCanary,
    observedAt: '2030-01-01T00:01:01.000Z',
  }, null, 2)}\n`);
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /dark canary SHA-256 does not match operator approval/u,
  );
});

test('rejects hard-linked website approval evidence during final verification', async () => {
  const value = signedFixture();
  await completePublication(value);
  linkSync(value.approvalPath, `${value.approvalPath}.link`);
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /bounded non-writable regular file/u,
  );
});

test('rejects forged receipt bytes and a revoked or unknown trusted key', async () => {
  const value = signedFixture();
  const { receipt } = await completePublication(value);
  const forged = {
    ...receipt,
    latest: {
      ...receipt.latest,
      responseSha256: 'f'.repeat(64),
    },
  };
  rmSync(value.receiptPath);
  canonicalWrite(value.receiptPath, {
    ...forged,
    signatureBase64: receipt.signatureBase64,
  }, canonicalDistributionReceiptJson);
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /receipt signature verification failed/u,
  );

  rmSync(value.receiptPath);
  canonicalWrite(value.receiptPath, receipt, canonicalDistributionReceiptJson);
  const revoked = JSON.parse(readFileSync(value.keyringPath, 'utf8'));
  revoked.keys[0].status = 'REVOKED';
  writeFileSync(value.keyringPath, canonicalTrustedKeyringJson(revoked));
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /unavailable/u,
  );

  writeFileSync(value.keyringPath, canonicalTrustedKeyringJson({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [],
  }));
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /unavailable/u,
  );
});

test('rejects local archive replacement even when the signed receipt remains unchanged', async () => {
  const value = signedFixture();
  await completePublication(value);
  writeFileSync(path.join(value.candidateRoot, value.evidence.artifacts.cloud.filename), 'replaced');
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /archive SHA-256 mismatch/u,
  );
});

test('rejects a separately signed receipt replayed against another origin or version', async () => {
  const value = signedFixture();
  const { receipt } = await completePublication(value);
  const replay = {
    ...receipt,
    distributionOrigin: 'https://other.example.com',
    latest: {
      ...receipt.latest,
      url: 'https://other.example.com/api/extensions/latest',
      targets: Object.fromEntries(Object.entries(receipt.latest.targets).map(([target, entry]) => [target, {
        ...entry,
        url: entry.url.replace(origin, 'https://other.example.com'),
      }])),
    },
    signatureBase64: '',
  };
  replay.signatureBase64 = sign(
    null,
    distributionReceiptPayload({
      ...replay,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    }),
    value.privateKey,
  ).toString('base64');
  writeFileSync(value.receiptPath, canonicalDistributionReceiptJson(replay));
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /latest observation does not match/u,
  );
});

test('rejects stale and future receipts even when their signatures remain valid', async () => {
  const value = signedFixture();
  await completePublication(value);
  const input = verificationInput(value);
  assert.throws(() => verifyExtensionPublication({
    ...input,
    now: new Date('2030-01-02T00:05:00.001Z'),
  }), /stale or too far in the future/u);
  assert.throws(() => verifyExtensionPublication({
    ...input,
    now: new Date('invalid'),
  }), /now must be a valid Date/u);
  assert.throws(() => verifyExtensionPublication({
    ...input,
    now: new Date('2029-12-31T23:59:59.999Z'),
  }), /stale or too far in the future/u);
  const noNetwork = fetcher(value);
  await assert.rejects(probeWebsiteDistribution({
    origin,
    evidence: value.evidence,
    evidenceBytes: readFileSync(value.evidencePath),
    signature: value.signature,
    signatureBytes: value.signatureBytes,
    approval: value.approval,
    approvalBytes: value.approvalBytes,
    darkCanaryPath: value.darkCanaryPath,
    fetcher: noNetwork,
    signKey: value.privateKey,
    keyId,
    observedAt,
    now: new Date('2029-12-31T23:59:59.999Z'),
  }), /too far in the future/u);
  assert.equal(noNetwork.calls.length, 0);
  await assert.rejects(probeWebsiteDistribution({
    origin,
    evidence: value.evidence,
    evidenceBytes: readFileSync(value.evidencePath),
    signature: value.signature,
    signatureBytes: value.signatureBytes,
    approval: value.approval,
    approvalBytes: value.approvalBytes,
    darkCanaryPath: value.darkCanaryPath,
    fetcher: noNetwork,
    signKey: value.privateKey,
    keyId,
    observedAt,
    now: new Date('invalid'),
  }), /now must be a valid Date/u);
  assert.equal(noNetwork.calls.length, 0);
});

test('publication schemas reject extra fields, noncanonical key order, and malformed signature bytes', () => {
  const value = signedFixture();
  assert.throws(() => parseReleaseSignature({ ...value.signature, extra: true }), /field set/u);
  assert.throws(() => parseWebsitePublicationApproval({
    ...value.approval,
    extra: true,
  }), /field set/u);
  assert.throws(() => parseWebsitePublicationApproval({
    ...value.approval,
    region: 'CN',
  }), /region does not match its origin/u);
  assert.throws(() => parseReleaseSignature({
    ...value.signature,
    signatureBase64: Buffer.alloc(63).toString('base64'),
  }), /canonical base64/u);
  const ring = JSON.parse(readFileSync(value.keyringPath, 'utf8'));
  ring.keys.push({ ...ring.keys[0], keyId: 'aaa-first' });
  assert.throws(() => parseTrustedKeyring(ring), /sorted/u);
  assert.throws(() => parseDistributionReceipt({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_WEBSITE_DISTRIBUTION_RECEIPT',
  }), /field set/u);

  const reorderedSignature = {
    signatureBase64: value.signature.signatureBase64,
    signedAt: value.signature.signedAt,
    schemaVersion: value.signature.schemaVersion,
    releaseEvidenceSha256: value.signature.releaseEvidenceSha256,
    releaseEvidenceFilename: value.signature.releaseEvidenceFilename,
    kind: value.signature.kind,
    keyId: value.signature.keyId,
    algorithm: value.signature.algorithm,
  };
  writeFileSync(value.signaturePath, `${JSON.stringify(reorderedSignature, null, 2)}\n`);
  assert.throws(
    () => verifyExtensionPublication(verificationInput(value)),
    /release signature is not canonical JSON/u,
  );
});

test('the repository keyring is canonical and binds the active first-party release key', () => {
  const file = 'config/extension-release-trusted-keys.json';
  const text = readFileSync(file, 'utf8');
  const parsed = parseTrustedKeyring(JSON.parse(text));
  assert.equal(text, canonicalTrustedKeyringJson(parsed));
  assert.deepEqual(parsed.keys.map(({ keyId, status }) => ({ keyId, status })), [{
    keyId: 'ss-erp-extension-release-2026-08-02-01',
    status: 'ACTIVE',
  }, {
    keyId: 'ss-erp-extension-release-2026-09-05-01',
    status: 'ACTIVE',
  }]);
  assert.equal(
    sha256(Buffer.from(parsed.keys[0].publicKeyBase64, 'base64')),
    '78b7e0cf06c3c08a8903b59674216d1f11e1f908aef156fff410d06fa757a9a9',
  );
  assert.equal(
    sha256(Buffer.from(parsed.keys[1].publicKeyBase64, 'base64')),
    '4686ac85b999132a0f994be3cb83ec8d3da25101b7aea6c56086ce2e973d43ff',
  );
});
