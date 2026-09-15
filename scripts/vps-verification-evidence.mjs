#!/usr/bin/env node
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseVpsVerificationEvidence } from '../packages/shared/src/rel04-release-evidence.ts';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { readStablePublicationFile } from './extension-website-publication-approval.mjs';
import { sha256 } from './extension-release-publication-contract.mjs';

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
}

export function createVpsVerificationEvidence(input, now = new Date()) {
  const result = input.releaseVerification;
  const signature = result?.signature;
  const deployedCommit = readStablePublicationFile(
    path.join(input.deploymentRoot, 'DEPLOYED_COMMIT'), 64, 'deployed commit',
  ).toString('utf8');
  if (!/^[a-f0-9]{40}\n?$/u.test(deployedCommit)
    || deployedCommit.trim() !== input.initialGitCommit
    || result?.schemaVersion !== 1 || result.gitCommit !== input.initialGitCommit
    || result.cloudLogisticsEnabled !== false
    || signature?.gitCommit !== result.gitCommit || signature?.version !== result.version
    || !Number.isFinite(Date.parse(signature?.signedAt))
    || new Date(signature.signedAt).toISOString() !== signature.signedAt
    || Date.parse(signature.signedAt) > Date.parse(input.startedAt)) {
    throw new Error('VPS verification candidate is unsigned or changed during verification');
  }
  return parseVpsVerificationEvidence({
    schemaVersion: 1, kind: 'SS_ERP_VPS_VERIFICATION', scope: 'FULL', status: 'PASS',
    startedAt: input.startedAt, completedAt: now.toISOString(),
    failures: input.failures, warnings: input.warnings,
    candidate: {
      gitCommit: result.gitCommit, apiOrigin: input.apiOrigin, region: input.region,
      version: result.version,
      releaseEvidenceSha256: signature.releaseEvidenceSha256,
      releaseSignatureSha256: signature.releaseSignatureSha256,
    },
  });
}

export function writeVpsVerificationEvidence(output, value, deploymentRoot) {
  const target = path.resolve(output);
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  if (inside(repositoryRoot, target) || inside(path.resolve(deploymentRoot), target)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(path.basename(target))) {
    throw new Error('VPS verification evidence must remain outside the source and deployed release');
  }
  const parent = path.dirname(target);
  let current = path.parse(parent).root;
  for (const segment of path.relative(current, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('VPS verification evidence directory is unsafe');
    }
  }
  const parentStat = lstatSync(parent);
  if (process.platform !== 'win32'
    && (parentStat.uid !== process.geteuid() || (parentStat.mode & 0o077) !== 0)) {
    throw new Error('VPS verification evidence requires a private directory');
  }
  if (inside(realpathSync.native(deploymentRoot), path.join(realpathSync.native(parent), path.basename(target)))) {
    throw new Error('VPS verification evidence must remain outside the deployed release');
  }
  const receipt = parseVpsVerificationEvidence(value);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  writeNewArtifactDurably(target, bytes, { mode: 0o600 });
  return { outputSha256: sha256(bytes) };
}

function main() {
  const names = [
    '--output', '--deployment-root', '--initial-git-commit', '--api-origin',
    '--region', '--started-at', '--failures', '--warnings', '--release-verification',
  ];
  const args = process.argv.slice(2);
  const values = new Map();
  if (args.length !== names.length * 2) throw new Error('invalid arguments');
  for (let index = 0; index < args.length; index += 2) {
    if (!names.includes(args[index]) || values.has(args[index]) || !args[index + 1]) {
      throw new Error('invalid arguments');
    }
    values.set(args[index], args[index + 1]);
  }
  for (const name of ['--failures', '--warnings']) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(values.get(name))) throw new Error('invalid count');
  }
  const receipt = createVpsVerificationEvidence({
    deploymentRoot: values.get('--deployment-root'),
    initialGitCommit: values.get('--initial-git-commit'),
    apiOrigin: values.get('--api-origin'), region: values.get('--region'),
    startedAt: values.get('--started-at'),
    failures: Number(values.get('--failures')), warnings: Number(values.get('--warnings')),
    releaseVerification: JSON.parse(values.get('--release-verification')),
  });
  console.log(JSON.stringify(writeVpsVerificationEvidence(
    values.get('--output'), receipt, values.get('--deployment-root'),
  )));
}

if (import.meta.main) {
  try { main(); } catch {
    console.error('FAIL VPS verification evidence was not retained; check counts, candidate binding and private output');
    process.exitCode = 1;
  }
}
