import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  activateExtensionWebsitePublication,
  assertDeployLockFile,
} from './activate-extension-website-publication.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  canonicalTrustedKeyringJson,
  parseTrustedKeyring,
  sha256,
} from './extension-release-publication-contract.mjs';

const roots = [];
const keyId = 'ss-erp-extension-release-gate-test';
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function darkCanaryFixture(apiOrigin) {
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
    observedAt: '2030-01-01T00:05:00.000Z',
    bindings: {
      apiOrigin,
      expectedGitCommit: gitCommit,
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
        deployedGitCommit: gitCommit,
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
          expectation: 'off', hostedAi: 'absent(default:false)',
          generation: 'absent(default:false)', ingest: 'absent(default:false)',
          publish: 'absent(default:false)', policy: 'absent(default:off)',
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
      timeoutMs: 15_000,
      redirectsAllowed: false,
      credentialsMode: 'omit',
      requests: routes.map(([method, route]) => ({ method, route, statusCode: 200 })),
      providerDispatchSent: false,
      erpIngestSent: false,
      ozonMutationSent: false,
    },
    cleanup: { required: true, completed: true, errorCode: null },
  };
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('requires the same canonical lock used by production deployment', () => {
  assert.throws(
    () => assertDeployLockFile(path.join(os.tmpdir(), 'alternate-deploy.lock')),
    /canonical deployment lock/u,
  );
});

function protectWindowsPrivateKey(file) {
  if (process.platform !== 'win32') return;
  const script = [
    "$ErrorActionPreference='Stop'",
    '$keyPath=$env:SS_ERP_EXTENSION_SIGNING_KEY_PATH',
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '& icacls.exe $keyPath /inheritance:r /grant:r ("*"+$sid+":F") | Out-Null',
    "if($LASTEXITCODE -ne 0){throw 'icacls'}",
  ].join(';');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, SS_ERP_EXTENSION_SIGNING_KEY_PATH: file },
  });
  assert.equal(result.status, 0, result.stderr);
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-website-publication-gate-'));
  roots.push(root);
  const activeRoot = path.join(root, 'active-deploy');
  const activeBuildRoot = path.join(activeRoot, 'build');
  const candidateRoot = path.join(activeBuildRoot, 'extensions');
  const privateRoot = path.join(root, 'private');
  const publicationEvidenceRoot = path.join(root, 'publication-evidence');
  const websitePublicationRoot = path.join(root, 'website-publication');
  for (const directory of [
    candidateRoot,
    privateRoot,
    publicationEvidenceRoot,
    websitePublicationRoot,
    path.join(websitePublicationRoot, 'bundles'),
  ]) mkdirSync(directory, {
    recursive: true,
    mode: directory === privateRoot ? 0o700 : 0o755,
  });

  const version = '1.0.265';
  const cloudBytes = Buffer.from('cloud test archive\n');
  const localBytes = Buffer.from('local test archive\n');
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
      api: 'https://api.example.com',
      local: 'http://127.0.0.1:3001',
    },
    artifacts: {
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
    },
    checksumFilename: `ss-erp-extension-${version}.sha256`,
    signature: { status: 'EXTERNAL_REQUIRED' },
  });
  const evidencePath = path.join(
    candidateRoot,
    `ss-erp-extension-${version}.release-evidence.json`,
  );
  writeFileSync(evidencePath, canonicalExtensionReleaseEvidenceJson(evidence));
  writeFileSync(path.join(candidateRoot, evidence.artifacts.cloud.filename), cloudBytes);
  writeFileSync(path.join(candidateRoot, evidence.artifacts.local.filename), localBytes);
  writeFileSync(
    path.join(candidateRoot, evidence.checksumFilename),
    `${evidence.artifacts.cloud.zipSha256}  ${evidence.artifacts.cloud.filename}\n`
      + `${evidence.artifacts.local.zipSha256}  ${evidence.artifacts.local.filename}\n`,
  );

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(privateRoot, 'release-signing-key.pem');
  writeFileSync(
    privateKeyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  chmodSync(privateKeyPath, 0o600);
  protectWindowsPrivateKey(privateKeyPath);
  const keyringPath = path.join(root, 'trusted-keys.json');
  writeFileSync(keyringPath, canonicalTrustedKeyringJson(parseTrustedKeyring({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{
      algorithm: 'Ed25519',
      keyId,
      publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      status: 'ACTIVE',
    }],
  })));
  const releaseSignaturePath = path.join(
    publicationEvidenceRoot,
    `ss-erp-extension-${version}.release-signature.json`,
  );
  const releaseSigner = spawnSync(process.execPath, [
    'scripts/sign-extension-release.mjs',
    '--evidence', evidencePath,
    '--keyring', keyringPath,
    '--output', releaseSignaturePath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_RELEASE_SIGNING_KEY_PATH: privateKeyPath,
      EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
      EXTENSION_RELEASE_SIGNED_AT: '2030-01-01T00:00:00.000Z',
    },
  });
  assert.equal(releaseSigner.status, 0, `${releaseSigner.stdout}\n${releaseSigner.stderr}`);
  const releaseSignatureSha256 = sha256(readFileSync(releaseSignaturePath));

  const activeSignatureRoot = path.join(activeBuildRoot, 'extension-release-publication');
  mkdirSync(activeSignatureRoot, { mode: 0o755 });
  const activeReleaseSignaturePath = path.join(activeSignatureRoot, path.basename(releaseSignaturePath));
  copyFileSync(releaseSignaturePath, activeReleaseSignaturePath);
  writeFileSync(
    path.join(activeBuildRoot, 'extension-release-signature.sha256'),
    `${releaseSignatureSha256}\n`,
  );

  const darkCanaryPath = path.join(privateRoot, 'rel04-dark-canary-test.json');
  const darkCanary = darkCanaryFixture(evidence.expectedOrigins.api);
  darkCanary.schemaVersion = 2;
  darkCanary.bindings.release = {
    candidate: {
      gitCommit, apiOrigin: evidence.expectedOrigins.api, region: 'COM', version,
      releaseEvidenceSha256: sha256(readFileSync(evidencePath)), releaseSignatureSha256,
    },
    vpsVerificationSha256: 'f'.repeat(64),
    vpsStartedAt: '2030-01-01T00:03:00.000Z',
    vpsVerifiedAt: '2030-01-01T00:04:00.000Z',
  };
  writeFileSync(darkCanaryPath, `${JSON.stringify(darkCanary, null, 2)}\n`, { mode: 0o600 });
  chmodSync(darkCanaryPath, 0o600);
  const darkCanarySha256 = sha256(readFileSync(darkCanaryPath));
  const approvalPath = path.join(
    publicationEvidenceRoot,
    `ss-erp-extension-${version}.website-publication-approval.json`,
  );
  const approvalSigner = spawnSync(process.execPath, [
    'scripts/sign-extension-website-publication.mjs',
    '--evidence', evidencePath,
    '--release-signature', releaseSignaturePath,
    '--expected-release-signature-sha256', releaseSignatureSha256,
    '--dark-canary', darkCanaryPath,
    '--expected-dark-canary-sha256', darkCanarySha256,
    '--distribution-origin', evidence.expectedOrigins.api,
    '--region', 'COM',
    '--keyring', keyringPath,
    '--output', approvalPath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_RELEASE_SIGNING_KEY_PATH: privateKeyPath,
      EXTENSION_RELEASE_SIGNING_KEY_ID: keyId,
      EXTENSION_WEBSITE_PUBLICATION_APPROVED_AT: '2030-01-01T00:06:00.000Z',
    },
  });
  assert.equal(approvalSigner.status, 0, `${approvalSigner.stdout}\n${approvalSigner.stderr}`);
  const approvalSha256 = sha256(readFileSync(approvalPath));
  const activeDeployedCommitPath = path.join(activeRoot, 'DEPLOYED_COMMIT');
  mkdirSync(activeRoot, { recursive: true });
  writeFileSync(activeDeployedCommitPath, `${gitCommit}\n`);
  return {
    approvalPath,
    approvalSha256,
    activeDeployedCommitPath,
    candidateRoot,
    darkCanaryPath,
    expectedDistributionOrigin: evidence.expectedOrigins.api,
    expectedRegion: 'COM',
    keyringPath,
    releaseSignaturePath: activeReleaseSignaturePath,
    externalReleaseSignaturePath: releaseSignaturePath,
    websitePublicationRoot,
  };
}

test('requires a separate signed approval before atomically activating website distribution', () => {
  const value = fixture();
  const pointer = path.join(
    value.websitePublicationRoot,
    'current.website-publication-approval.json',
  );
  assert.equal(readFileSync(value.releaseSignaturePath).length > 0, true);
  assert.throws(() => readFileSync(pointer));

  const result = activateExtensionWebsitePublication({
    ...value,
    publicationRoot: value.websitePublicationRoot,
    expectedApprovalSha256: value.approvalSha256,
    expectedCurrentApprovalSha256: 'NONE',
    expectedDistributionOrigin: value.expectedDistributionOrigin,
    expectedRegion: value.expectedRegion,
    now: new Date('2030-01-01T00:07:00.000Z'),
    requireRoot: false,
    enforceSecureTree: false,
    verifyCandidate() {},
  });
  assert.equal(result.status, 'ACTIVATED');
  assert.equal(result.approvalSha256, value.approvalSha256);
  assert.deepEqual(readFileSync(pointer), readFileSync(value.approvalPath));
  assert.equal(
    readFileSync(path.join(
      value.websitePublicationRoot,
      'bundles',
      value.approvalSha256,
      'DEPLOYED_COMMIT',
    ), 'utf8'),
    `${gitCommit}\n`,
  );
});

test('uses a compare-and-swap digest and preserves the current pointer on failure', () => {
  const value = fixture();
  const activate = (expectedCurrentApprovalSha256) => activateExtensionWebsitePublication({
    ...value,
    publicationRoot: value.websitePublicationRoot,
    expectedApprovalSha256: value.approvalSha256,
    expectedCurrentApprovalSha256,
    expectedDistributionOrigin: value.expectedDistributionOrigin,
    expectedRegion: value.expectedRegion,
    now: new Date('2030-01-01T00:07:00.000Z'),
    requireRoot: false,
    enforceSecureTree: false,
    verifyCandidate() {},
  });
  activate('NONE');
  const pointer = path.join(
    value.websitePublicationRoot,
    'current.website-publication-approval.json',
  );
  const before = readFileSync(pointer);
  assert.equal(activate('NONE').status, 'ALREADY_ACTIVATED');
  assert.deepEqual(readFileSync(pointer), before);
  assert.equal(activate(value.approvalSha256).status, 'ALREADY_ACTIVATED');
});

test('binds activation to the active deployed candidate, sealed signature, and digest sidecar', () => {
  const value = fixture();
  const base = {
    ...value,
    publicationRoot: value.websitePublicationRoot,
    expectedApprovalSha256: value.approvalSha256,
    expectedCurrentApprovalSha256: 'NONE',
    expectedDistributionOrigin: value.expectedDistributionOrigin,
    expectedRegion: value.expectedRegion,
    now: new Date('2030-01-01T00:07:00.000Z'),
    requireRoot: false,
    enforceSecureTree: false,
    verifyCandidate() {},
  };
  assert.throws(() => activateExtensionWebsitePublication({
    ...base,
    candidateRoot: value.activeDeployedCommitPath,
  }), /active deployed extension candidate/u);
  assert.throws(() => activateExtensionWebsitePublication({
    ...base,
    releaseSignaturePath: value.externalReleaseSignaturePath,
  }), /active deployed sealed signature/u);

  const sidecar = path.join(
    path.dirname(value.activeDeployedCommitPath),
    'build',
    'extension-release-signature.sha256',
  );
  writeFileSync(sidecar, `${'f'.repeat(64)}\n`);
  assert.throws(() => activateExtensionWebsitePublication(base), /SHA-256 does not match/u);
});

test('rejects an active candidate with files outside the approved four-file set', () => {
  const value = fixture();
  writeFileSync(path.join(value.candidateRoot, 'unexpected.txt'), 'unexpected\n');
  assert.throws(() => activateExtensionWebsitePublication({
    ...value,
    publicationRoot: value.websitePublicationRoot,
    expectedApprovalSha256: value.approvalSha256,
    expectedCurrentApprovalSha256: 'NONE',
    expectedDistributionOrigin: value.expectedDistributionOrigin,
    expectedRegion: value.expectedRegion,
    now: new Date('2030-01-01T00:07:00.000Z'),
    requireRoot: false,
    enforceSecureTree: false,
    verifyCandidate() {},
  }), /exactly the approved four files/u);
});

test('reports an ambiguous pointer write and resumes as already activated', () => {
  const value = fixture();
  const options = {
    ...value,
    publicationRoot: value.websitePublicationRoot,
    expectedApprovalSha256: value.approvalSha256,
    expectedCurrentApprovalSha256: 'NONE',
    expectedDistributionOrigin: value.expectedDistributionOrigin,
    expectedRegion: value.expectedRegion,
    now: new Date('2030-01-01T00:07:00.000Z'),
    requireRoot: false,
    enforceSecureTree: false,
    verifyCandidate() {},
    replacePointer(pointerPath, bytes) {
      writeFileSync(pointerPath, bytes, { mode: 0o644 });
      throw new Error('simulated post-rename durability failure');
    },
  };
  const unknown = activateExtensionWebsitePublication(options);
  assert.equal(unknown.status, 'UNKNOWN_OUTCOME');
  const resumed = activateExtensionWebsitePublication({
    ...options,
    replacePointer: undefined,
  });
  assert.equal(resumed.status, 'ALREADY_ACTIVATED');
});

test('rejects approval, canary, and active-commit digest drift before switching the pointer', () => {
  for (const mutate of ['approval', 'canary', 'commit']) {
    const value = fixture();
    if (mutate === 'approval') value.approvalSha256 = 'f'.repeat(64);
    if (mutate === 'canary') writeFileSync(value.darkCanaryPath, '{}\n');
    if (mutate === 'commit') writeFileSync(value.activeDeployedCommitPath, `${'c'.repeat(40)}\n`);
    assert.throws(() => activateExtensionWebsitePublication({
      ...value,
      publicationRoot: value.websitePublicationRoot,
      expectedApprovalSha256: value.approvalSha256,
      expectedCurrentApprovalSha256: 'NONE',
      expectedDistributionOrigin: value.expectedDistributionOrigin,
      expectedRegion: value.expectedRegion,
      now: new Date('2030-01-01T00:07:00.000Z'),
      requireRoot: false,
      enforceSecureTree: false,
      verifyCandidate() {},
    }));
    assert.throws(() => readFileSync(path.join(
      value.websitePublicationRoot,
      'current.website-publication-approval.json',
    )));
  }
});

test('keeps deployment scripts separate from the website publication pointer', () => {
  for (const script of ['deploy.sh', 'deploy-app-dir.sh', 'deploy-staging.sh']) {
    const source = readFileSync(path.join('scripts', script), 'utf8');
    assert.doesNotMatch(source, /current\.website-publication-approval\.json/u);
    assert.doesNotMatch(source, /activate-extension-website-publication/u);
  }
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['sign:extension-website-publication'],
    'node scripts/sign-extension-website-publication.mjs',
  );
  assert.equal(
    packageJson.scripts['activate:extension-website-publication'],
    'node scripts/activate-extension-website-publication.mjs',
  );
  const serverEntry = readFileSync('apps/server/src/index.ts', 'utf8');
  assert.match(
    serverEntry,
    /publicationRoot:\s*process\.env\.EXTENSION_WEBSITE_PUBLICATION_ROOT\s*\|\|\s*undefined/u,
  );
  const vpsVerifier = readFileSync('scripts/verify-vps-deploy.sh', 'utf8');
  assert.match(
    vpsVerifier,
    /VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED="\$\{VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED:-false\}"/u,
  );
  assert.match(
    vpsVerifier,
    /--expected-cloud-logistics-enabled "\$expected_cloud_extension"/u,
  );
  assert.match(
    vpsVerifier,
    /check_extension_website_distribution_state[\s\\]+"\$expected_website_publication" "\$deployed_commit" "\$expected_api_origin"/u,
  );
  assert.doesNotMatch(
    vpsVerifier,
    /check_extension_website_distribution_state[\s\\]+"\$expected_cloud_extension"/u,
  );
});

test('critical release CLIs reject invalid input when invoked through a symlinked release path', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-release-cli-link-'));
  roots.push(root);
  const linkedScripts = path.join(root, 'current-scripts');
  try {
    symlinkSync(
      path.resolve('scripts'),
      linkedScripts,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    t.skip('platform does not permit an unprivileged directory symlink');
    return;
  }

  for (const script of [
    'activate-extension-website-publication.mjs',
    'probe-extension-website-distribution.mjs',
    'verify-extension-release-signature.mjs',
    'verify-vps-extension-release.mjs',
  ]) {
    const result = spawnSync(process.execPath, [path.join(linkedScripts, script), '--invalid'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${script} silently skipped its CLI entrypoint`);
    assert.match(result.stderr, /FAIL/u);
  }
});

test('critical release modules do not resolve a mutable host entry path when imported', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-release-cli-import-'));
  roots.push(root);
  const missingHostEntry = path.join(root, 'deleted-host-entry.mjs');

  for (const script of [
    'activate-extension-website-publication.mjs',
    'probe-extension-website-distribution.mjs',
    'verify-extension-release-signature.mjs',
    'verify-vps-extension-release.mjs',
  ]) {
    const scriptPath = path.resolve('scripts', script);
    const source = readFileSync(scriptPath, 'utf8');
    assert.match(source, /if \(import\.meta\.main\)/u, `${script} must use runtime module identity`);

    const program = [
      `process.argv[1] = ${JSON.stringify(missingHostEntry)};`,
      `await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${script} import failed: ${result.stderr}`);
    assert.equal(result.stdout, '', `${script} ran its CLI while imported`);
    assert.equal(result.stderr, '', `${script} emitted an import-time error`);
  }
});
