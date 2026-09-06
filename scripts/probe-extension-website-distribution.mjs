#!/usr/bin/env node
import { createPublicKey, sign, verify } from 'node:crypto';
import { resolve4, resolve6 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { loadProtectedSigningKey } from './sign-extension-release.mjs';
import {
  MAX_LATEST_BYTES,
  MAX_PUBLICATION_APPROVAL_BYTES,
  assertPublicationOutputOutsideCandidate,
  canonicalDistributionReceiptJson,
  canonicalJson,
  parseWebsitePublicationApproval,
  distributionReceiptPayload,
  parseDistributionReceipt,
  parseReleaseSignature,
  publicOriginForPublication,
  releaseSignaturePayload,
  sha256,
  websitePublicationApprovalPayload,
} from './extension-release-publication-contract.mjs';
import { parseExtensionReleaseEvidence } from './extension-release-contract.mjs';
import {
  readStablePublicationFile,
  verifyRel04DarkCanaryEvidence,
} from './extension-website-publication-approval.mjs';

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const args = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedIpv4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
]) blockedIpv6.addSubnet(network, prefix, 'ipv6');

function publicAddress(address, family) {
  const normalizedFamily = family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : 0;
  if (normalizedFamily < 1 || isIP(address) !== normalizedFamily) return false;
  return normalizedFamily === 4
    ? !blockedIpv4.check(address, 'ipv4')
    : !blockedIpv6.check(address, 'ipv6');
}

async function systemResolve(hostname) {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const [v4, v6] = await Promise.all([
    resolve4(hostname).catch((error) => (
      ['ENODATA', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code) ? [] : Promise.reject(error)
    )),
    resolve6(hostname).catch((error) => (
      ['ENODATA', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code) ? [] : Promise.reject(error)
    )),
  ]);
  return [
    ...v4.map((address) => ({ address, family: 4 })),
    ...v6.map((address) => ({ address, family: 6 })),
  ];
}

function responseHeaders(headers) {
  return {
    get(name) {
      const value = headers[String(name).toLowerCase()];
      return Array.isArray(value) ? value.join(', ') : value === undefined ? null : String(value);
    },
  };
}

export function createPinnedLookup(pinnedAddress) {
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && options.all === true) {
      callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
      return;
    }
    callback(null, pinnedAddress.address, pinnedAddress.family);
  };
}

function requestBytes(requestImpl, url, init, pinnedAddress) {
  return new Promise((resolve, reject) => {
    const expectedType = String(init.headers?.Accept || '').toLowerCase();
    const maxBytes = expectedType === 'application/json' ? MAX_LATEST_BYTES : MAX_ZIP_BYTES;
    const parsed = new URL(url);
    const request = requestImpl(parsed, {
      method: 'GET',
      headers: init.headers,
      rejectUnauthorized: true,
      servername: parsed.hostname,
      lookup: createPinnedLookup(pinnedAddress),
    }, (incoming) => {
      const declared = Number(incoming.headers['content-length']);
      if (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes) {
        incoming.destroy();
        reject(new Error('website response Content-Length is invalid'));
        return;
      }
      const chunks = [];
      let total = 0;
      incoming.on('data', (chunk) => {
        total += chunk.length;
        if (total > declared || total > maxBytes) {
          incoming.destroy(new Error('website response exceeded its declared bound'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.once('error', reject);
      incoming.once('end', () => {
        if (total !== declared) {
          reject(new Error('website response body length does not match Content-Length'));
          return;
        }
        const bytes = Buffer.concat(chunks, total);
        resolve({
          status: incoming.statusCode || 0,
          redirected: false,
          url,
          headers: responseHeaders(incoming.headers),
          async arrayBuffer() { return bytes; },
        });
      });
    });
    request.once('error', reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('website request timed out')));
    if (init.signal) {
      if (init.signal.aborted) request.destroy(new Error('website request aborted'));
      else init.signal.addEventListener('abort', () => request.destroy(new Error('website request aborted')), { once: true });
    }
    request.end();
  });
}

export async function createPinnedWebsiteFetcher(origin, {
  resolveDns = systemResolve,
  requestImpl = httpsRequest,
} = {}) {
  const distributionOrigin = publicOriginForPublication(origin);
  const hostname = new URL(distributionOrigin).hostname;
  const resolved = await resolveDns(hostname);
  if (!Array.isArray(resolved) || resolved.length < 1
    || resolved.some(({ address, family }) => !publicAddress(address, family))) {
    fail('website distribution DNS must resolve only to public addresses');
  }
  const unique = [...new Map(resolved.map((entry) => [`${entry.family}:${entry.address}`, entry])).values()]
    .sort((left, right) => left.family - right.family || left.address.localeCompare(right.address));
  const pinnedAddress = unique[0];
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.origin !== distributionOrigin || parsed.protocol !== 'https:') {
      fail('website request escaped the pinned distribution origin');
    }
    return requestBytes(requestImpl, url, init, pinnedAddress);
  };
  fetcher.pinnedAddresses = unique;
  return fetcher;
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function assertArguments() {
  const allowed = new Set([
    '--origin', '--evidence', '--signature', '--approval', '--dark-canary', '--output',
  ]);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || seen.has(args[index])
      || !args[index + 1] || args[index + 1].startsWith('--')) {
      fail('unknown or malformed distribution probe option');
    }
    seen.add(args[index]);
  }
  for (const required of [
    '--origin', '--evidence', '--signature', '--approval', '--dark-canary', '--output',
  ]) {
    if (!option(required)) fail(`${required} is required`);
  }
}

function readRegularFile(file, maxBytes, label) {
  return readStablePublicationFile(file, maxBytes, label);
}

function readCanonical(file, parser, maxBytes, label) {
  const bytes = readRegularFile(file, maxBytes, label);
  const text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) fail(`${label} must be canonical UTF-8 JSON`);
  let raw;
  try { raw = JSON.parse(text); } catch { fail(`${label} must be valid JSON`); }
  const value = parser(raw);
  if (text !== canonicalJson(value)) fail(`${label} must use canonical JSON`);
  return { bytes, value };
}

function requestUrl(origin, value, expectedPath) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) fail('download URL is invalid');
  let parsed;
  try { parsed = new URL(value, origin); } catch { fail('download URL is invalid'); }
  if (parsed.origin !== origin || parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== expectedPath) {
    fail('download URL is not bound to the approved website origin and release path');
  }
  return parsed.toString();
}

function header(response, name, field) {
  const value = response.headers.get(name);
  if (!value || value.length > 4096 || value.includes('\r') || value.includes('\n')) fail(`${field} response header is invalid`);
  return value;
}

function assertIdentityEncoding(response, field) {
  const value = response.headers.get('content-encoding');
  if (value && value.trim().toLowerCase() !== 'identity') fail(`${field} response is content-encoded`);
}

function exactObject(value, expectedKeys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    fail(`${field} has an invalid field set`);
  }
  return value;
}

function contentDispositionFilename(value, expected) {
  const match = value.match(/^attachment;\s*filename="([A-Za-z0-9][A-Za-z0-9._-]{0,255})"$/u);
  if (!match || match[1] !== expected) fail('download Content-Disposition is invalid');
  return value;
}

async function fetchBytes(fetcher, url, maxBytes, label) {
  const response = await fetcher(url, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/zip', 'Accept-Encoding': 'identity' },
  });
  if (response.status !== 200) fail(`${label} returned HTTP ${response.status}`);
  if (response.redirected || (response.url && response.url !== url)) fail(`${label} was redirected`);
  assertIdentityEncoding(response, label);
  if (header(response, 'content-type', label).split(';')[0].trim().toLowerCase() !== 'application/zip') {
    fail(`${label} Content-Type is invalid`);
  }
  const contentLength = Number(header(response, 'content-length', label));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes) {
    fail(`${label} Content-Length is invalid`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== contentLength) fail(`${label} body length does not match Content-Length`);
  return { response, bytes, contentLength };
}

function timestamp() {
  const value = process.env.EXTENSION_RELEASE_OBSERVED_AT || new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || new Date(value).toISOString() !== value) fail('EXTENSION_RELEASE_OBSERVED_AT must be canonical UTC');
  return value;
}

export async function probeWebsiteDistribution({
  origin,
  evidence,
  evidenceBytes,
  signature,
  signatureBytes,
  approval,
  approvalBytes,
  darkCanaryPath,
  fetcher,
  signKey,
  keyId,
  observedAt = timestamp(),
  now = new Date(),
}) {
  const distributionOrigin = publicOriginForPublication(origin);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(nowMs)) fail('distribution probe now must be a valid Date');
  if (!Number.isFinite(observedAtMs)) fail('distribution observation must be a valid timestamp');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS certificate verification must remain enabled');
  if (evidence.signature?.status !== 'EXTERNAL_REQUIRED') fail('evidence is not awaiting external publication');
  if (distributionOrigin !== evidence.expectedOrigins.api) {
    fail('website distribution origin must match the release evidence API origin');
  }
  if (signature.releaseEvidenceFilename !== `ss-erp-extension-${evidence.version}.release-evidence.json`
    || signature.releaseEvidenceSha256 !== sha256(evidenceBytes)) {
    fail('release signature is not bound to the release evidence');
  }
  const keyPath = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_PATH || '').trim();
  if (!signKey && !keyPath) fail('EXTENSION_RELEASE_SIGNING_KEY_PATH is required');
  const privateKey = signKey || loadProtectedSigningKey(keyPath);
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('distribution signing key must be Ed25519');
  if ((keyId || signature.keyId) !== signature.keyId) fail('distribution signing keyId must match release signature');
  if (approval.keyId !== signature.keyId
    || approval.gitCommit !== evidence.gitCommit
    || approval.version !== evidence.version
    || approval.distributionOrigin !== distributionOrigin
    || approval.releaseEvidenceFilename !== signature.releaseEvidenceFilename
    || approval.releaseEvidenceSha256 !== sha256(evidenceBytes)
    || approval.releaseSignatureFilename !== `ss-erp-extension-${evidence.version}.release-signature.json`
    || approval.releaseSignatureSha256 !== sha256(signatureBytes)) {
    fail('website publication approval is not bound to the signed release');
  }
  if (!darkCanaryPath || path.basename(darkCanaryPath) !== approval.darkCanaryFilename) {
    fail('REL-04 dark canary does not match the website publication approval');
  }
  const darkCanary = verifyRel04DarkCanaryEvidence({
    darkCanaryPath,
    expectedSha256: approval.darkCanarySha256,
    expectedGitCommit: evidence.gitCommit,
    expectedApiOrigin: distributionOrigin,
    approvedAt: approval.approvedAt,
    now,
  });
  if (observedAtMs < Date.parse(approval.approvedAt)
    || Date.parse(approval.approvedAt) < Date.parse(signature.signedAt)
    || Date.parse(darkCanary.observedAt) < Date.parse(signature.signedAt)) {
    fail('distribution observation predates its signed publication approval');
  }
  if (observedAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
    fail('distribution observation is too far in the future');
  }
  if (!verify(
    null,
    releaseSignaturePayload(signature, evidenceBytes),
    createPublicKey(privateKey),
    Buffer.from(signature.signatureBase64, 'base64'),
  )) {
    fail('release signature does not match the distribution signing key');
  }
  if (!verify(
    null,
    websitePublicationApprovalPayload(approval),
    createPublicKey(privateKey),
    Buffer.from(approval.signatureBase64, 'base64'),
  )) {
    fail('website publication approval does not match the distribution signing key');
  }
  const websiteFetcher = fetcher || await createPinnedWebsiteFetcher(distributionOrigin);
  if (typeof websiteFetcher !== 'function') fail('fetch is unavailable');
  const approvalSha256 = sha256(approvalBytes);
  const latestUrl = `${distributionOrigin}/api/extensions/latest`;
  const latestResponse = await websiteFetcher(latestUrl, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
  });
  if (latestResponse.status !== 200) fail(`website latest returned HTTP ${latestResponse.status}`);
  if (latestResponse.redirected || (latestResponse.url && latestResponse.url !== latestUrl)) {
    fail('website latest was redirected');
  }
  assertIdentityEncoding(latestResponse, 'website latest');
  if (header(latestResponse, 'content-type', 'website latest').split(';')[0].trim().toLowerCase()
    !== 'application/json') {
    fail('website latest Content-Type is invalid');
  }
  const latestContentLength = Number(header(latestResponse, 'content-length', 'website latest'));
  if (!Number.isSafeInteger(latestContentLength)
    || latestContentLength < 1
    || latestContentLength > MAX_LATEST_BYTES) fail('website latest Content-Length is invalid');
  const latestBytes = Buffer.from(await latestResponse.arrayBuffer());
  if (latestBytes.length !== latestContentLength) fail('website latest body length does not match Content-Length');
  let latest;
  try { latest = JSON.parse(latestBytes.toString('utf8')); } catch { fail('website latest response is not JSON'); }
  exactObject(latest, ['code', 'data'], 'website latest response');
  const latestData = exactObject(
    latest.data,
    ['gitCommit', 'publicationApprovalSha256', 'signatureStatus', 'targets', 'version'],
    'website latest data',
  );
  const latestTargets = exactObject(latestData.targets, ['cloud', 'local'], 'website latest targets');
  if (latest.code !== 1 || latestData.version !== evidence.version
    || latest.data.gitCommit !== evidence.gitCommit
    || latest.data.publicationApprovalSha256 !== approvalSha256
    || latest.data.signatureStatus !== 'EXTERNAL_REQUIRED') {
    fail('website latest response does not match the approved release');
  }
  const targets = {};
  for (const target of ['cloud', 'local']) {
    const artifact = evidence.artifacts[target];
    const targetData = exactObject(
      latestTargets[target],
      ['downloadUrl', 'filename', 'sha256'],
      `website latest ${target} target`,
    );
    if (!targetData || targetData.filename !== artifact.filename || targetData.sha256 !== artifact.zipSha256) {
      fail(`website latest ${target} metadata does not match release evidence`);
    }
    const expectedPath = `/api/extensions/download/${target}/${evidence.version}/${artifact.zipSha256}`;
    const url = requestUrl(distributionOrigin, targetData.downloadUrl, expectedPath);
    const result = await fetchBytes(
      websiteFetcher,
      url,
      MAX_ZIP_BYTES,
      `${target} extension download`,
    );
    const contentDisposition = contentDispositionFilename(
      header(result.response, 'content-disposition', `${target} extension download`),
      artifact.filename,
    );
    const xContentSha256 = header(result.response, 'x-content-sha256', `${target} extension download`);
    const publicationApprovalSha256 = header(
      result.response,
      'x-publication-approval-sha256',
      `${target} extension download`,
    );
    if (xContentSha256 !== artifact.zipSha256
      || publicationApprovalSha256 !== approvalSha256
      || sha256(result.bytes) !== artifact.zipSha256) {
      fail(`${target} extension download SHA-256 does not match release evidence`);
    }
    targets[target] = {
      url,
      statusCode: result.response.status,
      filename: artifact.filename,
      contentLength: result.contentLength,
      contentDisposition,
      bodySha256: sha256(result.bytes),
      xContentSha256,
      publicationApprovalSha256,
    };
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_WEBSITE_DISTRIBUTION_RECEIPT',
    algorithm: 'Ed25519',
    channel: 'FIRST_PARTY_WEBSITE',
    keyId: keyId || signature.keyId,
    observedAt,
    distributionOrigin,
    releaseEvidenceFilename: `ss-erp-extension-${evidence.version}.release-evidence.json`,
    releaseEvidenceSha256: sha256(evidenceBytes),
    releaseSignatureFilename: `ss-erp-extension-${evidence.version}.release-signature.json`,
    releaseSignatureSha256: sha256(signatureBytes),
    websitePublicationApprovalFilename:
      `ss-erp-extension-${evidence.version}.website-publication-approval.json`,
    websitePublicationApprovalSha256: approvalSha256,
    darkCanarySha256: approval.darkCanarySha256,
    latest: {
      url: latestUrl,
      statusCode: latestResponse.status,
      responseSha256: sha256(latestBytes),
      publicationApprovalSha256: approvalSha256,
      version: latestData.version,
      gitCommit: latestData.gitCommit,
      signatureStatus: latestData.signatureStatus,
      targets,
    },
    signatureBase64: '',
  };
  const signed = sign(null, distributionReceiptPayload({
    ...receipt,
    signatureBase64: Buffer.alloc(64).toString('base64'),
  }), privateKey);
  receipt.signatureBase64 = signed.toString('base64');
  return parseDistributionReceipt(receipt);
}

async function main() {
  assertArguments();
  const evidencePath = path.resolve(option('--evidence'));
  const signaturePath = path.resolve(option('--signature'));
  const approvalPath = path.resolve(option('--approval'));
  const darkCanaryPath = path.resolve(option('--dark-canary'));
  const output = path.resolve(option('--output'));
  assertPublicationOutputOutsideCandidate(evidencePath, output, 'distribution receipt output');
  const evidence = readCanonical(evidencePath, parseExtensionReleaseEvidence, 65_536, 'release evidence');
  const signature = readCanonical(signaturePath, parseReleaseSignature, 16_384, 'release signature');
  const approval = readCanonical(
    approvalPath,
    parseWebsitePublicationApproval,
    MAX_PUBLICATION_APPROVAL_BYTES,
    'website publication approval',
  );
  if (path.basename(evidencePath) !== `ss-erp-extension-${evidence.value.version}.release-evidence.json`
    || path.basename(signaturePath) !== `ss-erp-extension-${evidence.value.version}.release-signature.json`
    || path.basename(approvalPath)
      !== `ss-erp-extension-${evidence.value.version}.website-publication-approval.json`
    || path.basename(output) !== `ss-erp-extension-${evidence.value.version}.distribution-receipt.json`) {
    fail('publication evidence, signature, and receipt must use their canonical versioned filenames');
  }
  const origin = publicOriginForPublication(option('--origin'));
  const keyId = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_ID || signature.value.keyId).trim();
  const receipt = await probeWebsiteDistribution({
    origin,
    evidence: evidence.value,
    evidenceBytes: evidence.bytes,
    signature: signature.value,
    signatureBytes: signature.bytes,
    approval: approval.value,
    approvalBytes: approval.bytes,
    darkCanaryPath,
    keyId,
  });
  writeNewArtifactDurably(output, canonicalDistributionReceiptJson(receipt));
  console.log(JSON.stringify({
    schemaVersion: 1,
    output: path.basename(output),
    outputSha256: sha256(Buffer.from(canonicalDistributionReceiptJson(receipt), 'utf8')),
    distributionOrigin: receipt.distributionOrigin,
    version: receipt.latest.version,
    gitCommit: receipt.latest.gitCommit,
    targets: Object.fromEntries(Object.entries(receipt.latest.targets).map(([target, value]) => [target, {
      filename: value.filename,
      bodySha256: value.bodySha256,
      contentLength: value.contentLength,
    }])),
  }, null, 2));
}

if (import.meta.main) {
  try { await main(); } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
