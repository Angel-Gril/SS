#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStoredZip } from './verify-extension-archive.mjs';
import { verifyExtensionReleaseSignature } from './verify-extension-release-signature.mjs';
import { runExtensionActiveWorkerAttestation, normalizeCdpOrigin, fetchBrowserIdentity } from './extension-active-worker-attestation.mjs';
import { verifySuiteSourceBridge } from './qa04-suite-source-bridge.mjs';
import { readQa04GitProvenance } from './qa04-offline-gate.mjs';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';
import { canonicalJson, evidenceReader, privateOutputPath, realDirectory, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';
import { verifyCurrentSuiteUiEvidence } from './qa04-suite-target-ui.mjs';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = 'QA04_SUITE_TARGET_UI_REQUIRED';

export function verifyInstalledUiTree(directory, entries) {
  const root = realDirectory(path.resolve(directory), CODE), actual = new Map();
  const walk = (absolute, relative = '') => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const file = path.join(absolute, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
      requireThat(!entry.isSymbolicLink(), CODE);
      if (entry.isDirectory()) walk(file, name);
      else { requireThat(entry.isFile() && lstatSync(file).size <= 50 * 1024 * 1024, CODE); actual.set(name, sha256(readFileSync(file))); }
    }
  };
  walk(root);
  const expected = new Map(entries.map(entry => [entry.parts.slice(1).join('/'), sha256(entry.data)]));
  requireThat(sortedJson([...actual].sort()) === sortedJson([...expected].sort()), CODE);
  return sha256(sortedJson([...actual].sort()));
}

class Connection {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map();
    socket.addEventListener('message', e => {
      if (String(e.data).length > 24 * 1024 * 1024) { this.close(); return; }
      const value = JSON.parse(String(e.data)), pending = this.pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(value.id);
      if (value.error) pending.reject(new Error(CODE)); else pending.resolve(value.result || {});
    });
  }
  send(method, params = {}, sessionId) {
    requireThat(['Target.getTargets', 'Target.attachToTarget', 'Runtime.evaluate', 'Page.getFrameTree', 'Page.captureScreenshot'].includes(method), CODE);
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(CODE)); }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async attach(targetId) { return (await this.send('Target.attachToTarget', { targetId, flatten: true })).sessionId; }
  async evaluate(sessionId, expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false }, sessionId);
    requireThat(!result.exceptionDetails, CODE); return result.result?.value;
  }
  close() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(CODE)); } this.pending.clear(); this.socket.close(); }
}

export async function readTargetSuiteUi(options) {
  const root = ROOT, output = privateOutputPath(options.output, root), screenshotPath = privateOutputPath(output + '.png', root);
  const runner = (command, args, extra) => spawnSync(command, [...gitCommitTreeSafeDirectoryArgs(root), ...args],
    { ...extra, env: gitCommitTreeEnvironment(), timeout: 30_000, maxBuffer: 1024 * 1024 });
  requireThat(readQa04GitProvenance({ repositoryRoot: root, runner }).gitCommit === options.commit, CODE);
  const bridge = verifySuiteSourceBridge(root, options.executionCommit, options.commit);
  const styles = bridge.changes.filter(change => change.kind === 'CSS_PRESENTATION');
  requireThat(styles.length > 0 && styles.every(change => change.path.startsWith('extensions/ss-erp/pages/')), CODE);
  const signature = verifyExtensionReleaseSignature({ buildRoot: options.buildRoot, signaturePath: options.signature,
    expectedGitCommit: options.commit, expectedSignatureSha256: options.signatureSha256 });
  const evidence = JSON.parse(readFileSync(path.join(options.buildRoot, 'ss-erp-extension-' + signature.version + '.release-evidence.json')));
  const archive = readFileSync(path.join(options.buildRoot, evidence.artifacts.cloud.filename));
  requireThat(archive.length <= 100 * 1024 * 1024 && sha256(archive) === evidence.artifacts.cloud.zipSha256, CODE);
  const entries = parseStoredZip(archive, 'ss-erp-cloud');
  const installedTreeSha256 = verifyInstalledUiTree(options.extensionDirectory, entries);
  const active = await runExtensionActiveWorkerAttestation({ cdpUrl: options.cdpUrl, extensionId: options.extensionId,
    extensionDirectory: options.extensionDirectory, expectedVersion: signature.version });
  const browser = await fetchBrowserIdentity(normalizeCdpOrigin(options.cdpUrl));
  const socket = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(CODE)), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(CODE)); }, { once: true });
  });
  const c = new Connection(socket);
  try {
    const targets = (await c.send('Target.getTargets')).targetInfos;
    const frameUrl = 'chrome-extension://' + options.extensionId + '/pages/precision-workbench.html';
    requireThat(targets.some(t => t.targetId === options.frameTarget && t.type === 'iframe' && t.url === frameUrl)
      && targets.some(t => t.targetId === options.pageTarget && t.type === 'page' && /^https:\/\/detail\.1688\.com\/offer\/\d+\.html/u.test(t.url)), CODE);
    const frame = await c.attach(options.frameTarget), page = await c.attach(options.pageTarget);
    const parentFrames = await c.send('Page.getFrameTree', {}, page);
    const containsFrame = node => node?.frame?.id === options.frameTarget
      || (node?.childFrames || []).some(containsFrame);
    requireThat(containsFrame(parentFrames.frameTree), CODE);
    const surface = await c.evaluate(frame, `(()=>{const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};return{visible:!document.hidden,controlsVisible:['category-select-btn','start-btn','image-workflow-start-btn','erp-refresh-btn'].every(id=>visible(document.getElementById(id))),scale:devicePixelRatio}})()`);
    const source = await c.evaluate(page, `(()=>{const e=[...document.querySelectorAll('iframe')].find(e=>e.src===${JSON.stringify(frameUrl)});if(!e)return null;const r=e.getBoundingClientRect();return{visible:!document.hidden&&r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,width:innerWidth,height:innerHeight,scale:devicePixelRatio}})()`);
    requireThat(surface?.visible && surface.controlsVisible && source?.visible && source.scale === 1, CODE);
    const css = [];
    for (const change of styles) {
      const entry = entries.find(entry => entry.parts.slice(1).join('/') === change.path.slice('extensions/ss-erp/'.length));
      requireThat(entry, CODE);
      requireThat(createHash('sha1').update(Buffer.from('blob ' + entry.data.length + '\0')).update(entry.data).digest('hex') === change.targetObjectId, CODE);
      const applied = await c.evaluate(frame, `(()=>{const sheet=[...document.styleSheets].find(s=>s.href===${JSON.stringify('chrome-extension://' + options.extensionId + '/' + change.path.slice('extensions/ss-erp/'.length))});if(!sheet||sheet.disabled)return false;const expected=new CSSStyleSheet();expected.replaceSync(${JSON.stringify(entry.data.toString('utf8'))});return expected.cssRules.length>0&&JSON.stringify([...expected.cssRules].map(r=>r.cssText))===JSON.stringify([...sheet.cssRules].map(r=>r.cssText))})()`);
      requireThat(applied === true, CODE); css.push({ path: change.path, targetObjectId: change.targetObjectId, applied });
    }
    const captured = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page);
    const screenshot = Buffer.from(captured.data, 'base64');
    requireThat(screenshot.length > 0 && screenshot.length <= 32 * 1024 * 1024, CODE);
    const value = { schemaVersion: 1, kind: 'SS_ERP_SUITE_TARGET_UI_READBACK', gitCommit: options.commit,
      version: signature.version, observedAt: new Date().toISOString(), releaseSignatureSha256: signature.releaseSignatureSha256,
      cloudZipSha256: evidence.artifacts.cloud.zipSha256, installedTreeSha256,
      workerScriptSha256: active.worker.diskSha256, runtimeWorkerScriptSha256: active.worker.activeSha256,
      visible: true, sourcePageVisible: true, controlsVisible: true, mutations: 0,
      viewport: { width: source.width, height: source.height }, css,
      screenshot: { path: screenshotPath, sha256: sha256(screenshot) } };
    requireThat(verifyInstalledUiTree(options.extensionDirectory, entries) === installedTreeSha256, CODE);
    requireThat(readQa04GitProvenance({ repositoryRoot: root, runner }).gitCommit === options.commit, CODE);
    writeNewArtifactDurably(screenshotPath, screenshot, { mode: 0o600 });
    const bytes = Buffer.from(canonicalJson(value));
    // Use the exact consumer, including actual PNG decoding, before writing PASS evidence.
    const reader = evidenceReader();
    verifyCurrentSuiteUiEvidence({ ...reader, json: () => value }, { sha256: sha256(bytes) }, bridge, value.observedAt, value.observedAt);
    writeNewArtifactDurably(output, bytes, { mode: 0o600 });
    return { status: 'WRITTEN', gitCommit: options.commit, sha256: sha256(bytes), providerRequests: 0, ozonWrites: 0 };
  } finally { c.close(); }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Read-only target UI evidence from an already open dedicated browser. Never opens/reloads/clicks a page or sends business mutations.');
    console.log('--commit --execution-commit --build-root --signature --signature-sha256 --extension-directory --extension-id --cdp-url --frame-target --page-target --output'); return 0;
  }
  const names = { '--commit': 'commit', '--execution-commit': 'executionCommit', '--build-root': 'buildRoot', '--signature': 'signature',
    '--signature-sha256': 'signatureSha256', '--extension-directory': 'extensionDirectory', '--extension-id': 'extensionId', '--cdp-url': 'cdpUrl',
    '--frame-target': 'frameTarget', '--page-target': 'pageTarget', '--output': 'output' }, options = {};
  requireThat(args.length === Object.keys(names).length * 2, CODE);
  for (let i = 0; i < args.length; i += 2) { const key = names[args[i]]; requireThat(key && !(key in options) && args[i + 1], CODE); options[key] = args[i + 1]; }
  console.log(JSON.stringify(await readTargetSuiteUi(options))); return 0;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch { console.error(CODE); process.exitCode = 1; }
}
