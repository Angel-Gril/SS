#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DONOR_WORKBENCH_ALLOWLIST_KEY,
  DONOR_WORKBENCH_FEATURE_KEY,
  buildDonorWorkbenchLiveCanaryReceipt,
  parseDonorWorkbenchLiveCanaryOptions,
  recordDonorWorkbenchExtensionMutation,
  selectAuthorized1688Cookies,
} from './extension-donor-workbench-live-canary-contract.mjs';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import { verifyExtensionReleaseSignature } from './verify-extension-release-signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONOR_TRIGGER = '#ss-erp-donor-workbench-trigger';
const DONOR_FRAME = '#ss-erp-donor-workbench-frame';
const LEGACY_TRIGGER = '#ss-erp-source-costing-fab';
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params, message.sessionId);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('CDP connection failed'));
      }, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)']
      && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA
      && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    process.env.LOCALAPPDATA
      && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  return executable;
}

async function terminateProfileChromium(profile) {
  if (process.platform !== 'win32') return;
  const script = [
    '$profilePath = $args[0]',
    "$processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\chrome.exe' -and ([string]$_.CommandLine).Contains($profilePath) }",
    '$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  const terminator = spawn('powershell.exe', ['-NoProfile', '-Command', script, profile], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await Promise.race([new Promise((resolve) => terminator.once('exit', resolve)), pause(5_000)]);
}

async function extensionTreeSha256(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new Error(`extension tree contains an unsupported entry: ${absolute}`);
    }
  }
  await walk(root);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cookieFingerprint(cookies) {
  return cookies.map((cookie) => [
    cookie.name,
    cookie.value,
    cookie.domain,
    cookie.path,
    cookie.httpOnly,
    cookie.secure,
    cookie.sameSite || '',
    cookie.expires || 0,
    cookie.priority || '',
    cookie.sameParty ?? null,
    cookie.sourceScheme || '',
    cookie.sourcePort ?? null,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function importAuthorized1688Cookies(targetCdp, sourceOrigin, urls) {
  const versionUrl = `${sourceOrigin}/json/version`;
  const response = await fetch(versionUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || response.url !== versionUrl) {
    throw new Error('authorized cookie source CDP version endpoint is unavailable');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) {
    throw new Error('authorized cookie source CDP version response is too large');
  }
  let version;
  try {
    version = JSON.parse(text);
  } catch {
    throw new Error('authorized cookie source CDP version response is invalid');
  }
  let socketUrl;
  try {
    socketUrl = new URL(version.webSocketDebuggerUrl);
  } catch {
    throw new Error('authorized cookie source CDP WebSocket is invalid');
  }
  const source = new URL(sourceOrigin);
  if (socketUrl.protocol !== 'ws:'
    || socketUrl.hostname !== '127.0.0.1'
    || socketUrl.port !== source.port || socketUrl.username || socketUrl.password
    || socketUrl.search || socketUrl.hash
    || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(socketUrl.pathname)) {
    throw new Error('authorized cookie source CDP WebSocket escaped loopback');
  }
  const sourceCdp = await Cdp.connect(socketUrl.href);
  let selected;
  let sourceSession = '';
  try {
    const targets = (await sourceCdp.send('Target.getTargets')).targetInfos || [];
    const page = targets.find((target) => {
      if (target.type !== 'page' || !target.targetId) return false;
      try {
        const hostname = new URL(target.url).hostname.toLowerCase();
        return hostname === '1688.com' || hostname.endsWith('.1688.com');
      } catch {
        return false;
      }
    });
    if (!page) throw new Error('authorized cookie source has no active 1688 page');
    sourceSession = (await sourceCdp.send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    })).sessionId;
    const sourceCookies = await sourceCdp.send('Network.getCookies', { urls }, sourceSession);
    selected = selectAuthorized1688Cookies(sourceCookies.cookies);
  } finally {
    if (sourceSession) {
      try { await sourceCdp.send('Target.detachFromTarget', { sessionId: sourceSession }); } catch {}
    }
    sourceCdp.close();
  }
  await targetCdp.send('Storage.setCookies', { cookies: selected.cookies });
  const targetCookies = selectAuthorized1688Cookies(
    (await targetCdp.send('Storage.getCookies')).cookies,
  );
  if (JSON.stringify(cookieFingerprint(targetCookies.cookies))
    !== JSON.stringify(cookieFingerprint(selected.cookies))) {
    throw new Error('authorized 1688 cookie import verification failed');
  }
  return selected.summary;
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return String(result.stdout || '').trim();
}

function extensionException(event) {
  const details = event?.exceptionDetails;
  const urls = [
    details?.url,
    ...(details?.stackTrace?.callFrames || []).map((frame) => frame.url),
  ].filter(Boolean);
  if (!urls.some((url) => String(url).startsWith('chrome-extension://'))) return '';
  return details.exception?.description || details.text || 'Extension exception';
}

async function run() {
  const options = parseDonorWorkbenchLiveCanaryOptions(process.argv.slice(2), { repoRoot: ROOT });
  assert.equal(gitOutput(['rev-parse', 'HEAD']), options.gitCommit,
    'active Git HEAD does not match the live canary commit');
  assert.equal(gitOutput(['status', '--porcelain=v1']), '',
    'live canary requires a clean worktree');
  const signature = verifyExtensionReleaseSignature({
    buildRoot: options.releaseBuildRoot,
    signaturePath: options.releaseSignature,
    expectedSignatureSha256: options.releaseSignatureSha256,
    expectedGitCommit: options.gitCommit,
  });
  assert.equal(signature.version, options.version,
    'release signature version does not match the live canary');
  const evidencePath = path.join(
    options.releaseBuildRoot,
    `ss-erp-extension-${options.version}.release-evidence.json`,
  );
  const evidenceBytes = await readFile(evidencePath);
  assert.equal(sha256(evidenceBytes), signature.releaseEvidenceSha256,
    'release evidence changed after signature verification');
  const evidence = parseExtensionReleaseEvidence(JSON.parse(evidenceBytes.toString('utf8')));
  assert.equal(
    evidenceBytes.toString('utf8'),
    canonicalExtensionReleaseEvidenceJson(evidence),
    'release evidence is not canonical',
  );
  assert.equal(evidence.gitCommit, options.gitCommit,
    'release evidence commit does not match the live canary');
  const cloudArtifact = evidence.artifacts.cloud;
  const archiveVerification = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-extension-archive.mjs'),
    '--zip', path.join(options.releaseBuildRoot, cloudArtifact.filename),
    '--dir', options.extensionDir,
    '--target', 'cloud',
    '--version', options.version,
    '--expected-sha256', cloudArtifact.zipSha256,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (archiveVerification.status !== 0) {
    throw new Error(`candidate cloud directory verification failed: ${archiveVerification.stderr}`);
  }
  const manifest = JSON.parse(await readFile(path.join(options.extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, options.version, 'extension manifest version does not match the candidate');
  const candidateTreeSha256 = await extensionTreeSha256(options.extensionDir);
  assert.equal(
    candidateTreeSha256,
    options.extensionTreeSha256,
    'extension tree SHA-256 does not match the candidate',
  );

  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-live-profile-')));
  const screenshotPath = path.join(
    path.dirname(options.output),
    `${path.basename(options.output, '.json')}.png`,
  );
  if (existsSync(screenshotPath)) throw new Error(`screenshot already exists: ${screenshotPath}`);
  const network = {
    providerRequests: 0,
    ozonRequests: 0,
    erpMutations: 0,
    unexpectedExtensionMutations: [],
  };
  const pageErrors = [];
  let child;
  let cdp;
  try {
    child = spawn(chromeExecutable(), [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-sync',
      '--enable-unsafe-extension-debugging',
      'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const activePort = await until(async () => {
      try {
        return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
          .trim().split(/\r?\n/u);
      } catch {
        return null;
      }
    }, 'live canary Chromium startup');
    cdp = await Cdp.connect(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
    const cookieImport = await importAuthorized1688Cookies(cdp, options.cookieSourceCdp, [
      options.product.url,
      options.negativeProduct.url,
    ]);
    let extensionId = '';
    let workerSession = '';
    let iframeObserverArmed = false;
    const extensionSessions = new Set();
    const observerTasks = new Set();
    const observerErrors = [];
    const trackObserver = (promise, label, rejectReady) => {
      const tracked = promise.catch((error) => {
        const observed = error instanceof Error ? error : new Error(String(error));
        observerErrors.push(`${label}: ${observed.message}`);
        if (rejectReady) rejectReady(observed);
      }).finally(() => observerTasks.delete(tracked));
      observerTasks.add(tracked);
    };
    const settleObservers = async () => {
      while (observerTasks.size) await Promise.all([...observerTasks]);
      assert.deepEqual(observerErrors, [], `target observation failed: ${observerErrors.join('; ')}`);
    };
    cdp.on('Network.requestWillBeSent', (event, sessionId) => {
      if (!extensionId) return;
      recordDonorWorkbenchExtensionMutation(network, event, {
        extensionId,
        extensionSessions,
        sessionId,
      });
    });
    cdp.on('Runtime.exceptionThrown', (event, sessionId) => {
      if (!extensionSessions.has(sessionId)) return;
      const error = event?.exceptionDetails?.exception?.description || event?.exceptionDetails?.text;
      if (error) pageErrors.push(error);
    });
    let workerReadyResolve;
    let workerReadyReject;
    const workerReady = new Promise((resolve, reject) => {
      workerReadyResolve = resolve;
      workerReadyReject = reject;
    });
    cdp.on('Target.attachedToTarget', (event) => {
      const childSession = event?.sessionId;
      if (!childSession || (event.targetInfo?.type === 'iframe' && iframeObserverArmed)) return;
      trackObserver((async () => {
        let failure;
        try {
          if (event.targetInfo?.type === 'service_worker'
            && /^chrome-extension:\/\/[^/]+\/background\/service-worker\.js$/u.test(
              event.targetInfo.url || '',
            )) {
            const candidateId = new URL(event.targetInfo.url).hostname;
            if (extensionId && extensionId !== candidateId) {
              throw new Error('multiple extension worker identities were observed');
            }
            extensionId = candidateId;
            workerSession = childSession;
            extensionSessions.add(childSession);
            await cdp.send('Runtime.enable', {}, childSession);
            await cdp.send('Network.enable', {}, childSession);
          }
        } catch (error) {
          failure = error;
        } finally {
          try {
            await cdp.send('Runtime.runIfWaitingForDebugger', {}, childSession);
          } catch (error) {
            failure ||= error;
          }
        }
        if (failure) throw failure;
        if (childSession === workerSession) workerReadyResolve(childSession);
      })(), 'startup target', workerReadyReject);
    });
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    let loadedExtension;
    try {
      loadedExtension = await cdp.send('Extensions.loadUnpacked', { path: options.extensionDir });
    } catch (error) {
      throw new Error(`selected Chromium lacks monitored extension loading: ${error.message}`);
    }
    await Promise.race([
      workerReady,
      pause(30_000).then(() => { throw new Error('Timed out: monitored extension startup'); }),
    ]);
    assert.equal(loadedExtension.id, extensionId, 'loaded extension ID does not match its Worker');
    await settleObservers();
    const identity = await until(async () => {
      try {
        const result = await cdp.send('Runtime.evaluate', {
          expression: 'typeof chrome === "object" ? chrome.runtime?.getManifest?.() || null : null',
          returnByValue: true,
        }, workerSession);
        return result.exceptionDetails || !result.result?.value?.version
          ? null
          : result.result.value;
      } catch {
        return null;
      }
    }, 'release-bound Worker identity', 10_000);
    assert.ok(identity.name?.startsWith('SS ERP - 松鼠跨境卖家助手')
      && identity.version === options.version,
    'release-bound SS ERP Worker identity is invalid');

    const storage = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, workerSession);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const setRollout = (enabled, allowlist) => storage(`new Promise((resolve, reject) => {
      chrome.storage.local.set({
        ${JSON.stringify(DONOR_WORKBENCH_FEATURE_KEY)}: ${JSON.stringify(enabled)},
        ${JSON.stringify(DONOR_WORKBENCH_ALLOWLIST_KEY)}: ${JSON.stringify(allowlist)}
      }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true));
    })`);
    const clearRollout = () => storage(`new Promise((resolve, reject) => {
      chrome.storage.local.remove([
        ${JSON.stringify(DONOR_WORKBENCH_FEATURE_KEY)},
        ${JSON.stringify(DONOR_WORKBENCH_ALLOWLIST_KEY)}
      ], () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true));
    })`);
    await clearRollout();
    await setRollout(true, []);

    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const pageSession = (await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })).sessionId;
    const send = (method, params = {}) => cdp.send(method, params, pageSession);
    const frameNavigations = new Map();
    let iframeSession = '';
    let iframeReadyResolve;
    let iframeReadyReject;
    const iframeReady = new Promise((resolve, reject) => {
      iframeReadyResolve = resolve;
      iframeReadyReject = reject;
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    cdp.on('Runtime.exceptionThrown', (event, sessionId) => {
      if (sessionId !== pageSession) return;
      const error = extensionException(event);
      if (error) pageErrors.push(error);
    });
    cdp.on('Page.frameNavigated', (event, sessionId) => {
      if (sessionId !== pageSession || !event?.frame?.id || event.frame.parentId) return;
      frameNavigations.set(event.frame.id, {
        loaderId: event.frame.loaderId || '',
        url: event.frame.url || '',
      });
    });
    iframeObserverArmed = true;
    cdp.on('Target.attachedToTarget', (event) => {
      const childSession = event?.sessionId;
      if (!childSession || event.targetInfo?.type !== 'iframe') return;
      const expectedIframe = event.targetInfo.url
        === `chrome-extension://${extensionId}/pages/source-workbench-shell.html`;
      trackObserver((async () => {
        let failure;
        try {
          if (expectedIframe) {
            iframeSession = childSession;
            extensionSessions.add(childSession);
            await cdp.send('Runtime.enable', {}, childSession);
            await cdp.send('Network.enable', {}, childSession);
          }
        } catch (error) {
          failure = error;
        } finally {
          try {
            await cdp.send('Runtime.runIfWaitingForDebugger', {}, childSession);
          } catch (error) {
            failure ||= error;
          }
        }
        if (failure) throw failure;
        if (expectedIframe) iframeReadyResolve(childSession);
      })(), 'iframe target', expectedIframe ? iframeReadyReject : null);
    });
    await send('Page.enable');
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    }, pageSession);
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const navigate = async (url, label) => {
      const navigation = await send('Page.navigate', { url });
      if (navigation.errorText) throw new Error(`${label} navigation failed: ${navigation.errorText}`);
      if (!navigation.frameId || !navigation.loaderId) {
        throw new Error(`${label} navigation did not create a document loader`);
      }
      const finalNavigation = await until(() => {
        const observed = frameNavigations.get(navigation.frameId);
        return observed?.loaderId && observed.url === url ? observed : null;
      }, `${label} exact frame navigation`, 45_000);
      await until(
        () => evaluate(`document.readyState !== "loading" && location.href === ${JSON.stringify(url)}`),
        `${label} exact document readiness`,
        45_000,
      );
      const currentFrame = (await send('Page.getFrameTree')).frameTree?.frame;
      if (currentFrame?.id !== navigation.frameId
        || currentFrame.loaderId !== finalNavigation.loaderId
        || currentFrame.url !== url) {
        throw new Error(`${label} active document loader changed after readiness`);
      }
    };
    const remainsAbsent = async (selector, label, duration = 3_000) => {
      const deadline = Date.now() + duration;
      while (Date.now() < deadline) {
        if (await evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`)) {
          throw new Error(`${label} appeared during the rejection stability window`);
        }
        await pause(100);
      }
      return true;
    };
    await navigate(options.product.url, 'positive real product');
    const finalUrl = await evaluate('location.href');
    assert.equal(finalUrl, options.product.url, 'real product redirected away from the exact offer');
    const flagOnlyBlocked = await remainsAbsent(DONOR_TRIGGER, 'flag-only donor trigger');
    const legacyBefore = Boolean(await until(
      () => evaluate(`document.querySelector(${JSON.stringify(LEGACY_TRIGGER)}) !== null`),
      'legacy source workbench before cutover',
      15_000,
    ));

    await setRollout(true, [options.product.sourceKey]);
    const allowlistedMounted = Boolean(await until(
      () => evaluate(`document.querySelector(${JSON.stringify(DONOR_TRIGGER)}) !== null`),
      'allowlisted donor trigger',
    ));
    const point = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(DONOR_TRIGGER)});
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
    const iframeOpened = Boolean(await until(
      () => evaluate(`document.querySelector(${JSON.stringify(DONOR_FRAME)})?.hidden === false`),
      'donor workbench iframe open',
    ));

    await Promise.race([
      iframeReady,
      pause(30_000).then(() => { throw new Error('Timed out: paused donor extension iframe'); }),
    ]);
    const iframeEvaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, iframeSession);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const title = await until(async () => {
      const value = await iframeEvaluate(
        'document.querySelector("[data-role=source-title]")?.textContent?.trim() || ""',
      );
      return value && value !== '正在读取商品' ? value : null;
    }, 'real product projection');
    assert.doesNotMatch(title, /^1688 商品\s+[1-9][0-9]*$/u,
      'real product projection used the collector fallback title');
    assert.doesNotMatch(title, /登录|验证码|安全验证|访问受限|login|captcha|verify/iu,
      'real product projection resolved to an authentication or risk-control page');
    const titleSha256 = sha256(Buffer.from(title, 'utf8'));
    assert.equal(titleSha256, options.expectedTitleSha256,
      'real product title does not match the approved source fact');
    assert.equal(
      await iframeEvaluate('document.querySelector("[data-role=product-id]")?.textContent?.trim()'),
      options.product.productId,
      'donor projection product ID does not match the real offer',
    );
    const mediaCount = await iframeEvaluate('document.querySelectorAll(".media-thumb").length');
    const skuCount = await iframeEvaluate('document.querySelectorAll(".sku-row").length');
    assert.ok(Number.isSafeInteger(mediaCount) && mediaCount > 0,
      'real product projection does not contain source media');
    assert.ok(Number.isSafeInteger(skuCount) && skuCount > 0,
      'real product projection does not contain source SKUs');
    await send('Page.bringToFront');
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const screenshotBytes = Buffer.from(screenshot.data, 'base64');
    writeNewArtifactDurably(screenshotPath, screenshotBytes, { mode: 0o600 });

    await navigate(options.negativeProduct.url, 'distinct negative product');
    const negativePageTitle = String(await evaluate('document.title.trim()'));
    assert.doesNotMatch(negativePageTitle, /登录|验证码|安全验证|访问受限|login|captcha|verify/iu,
      'negative product resolved to an authentication or risk-control page');
    const negativePageTitleSha256 = sha256(Buffer.from(negativePageTitle, 'utf8'));
    assert.equal(negativePageTitleSha256, options.expectedNegativeTitleSha256,
      'negative product page title does not match the approved source fact');
    assert.ok(await evaluate('document.body?.innerText?.trim().length > 100'),
      'negative product page does not contain a real document body');
    assert.ok(await evaluate('document.images.length > 0'),
      'negative product page does not contain product media');
    const negativeBlocked = await remainsAbsent(DONOR_TRIGGER, 'distinct-product donor trigger');

    await navigate(options.product.url, 'rollback positive product');
    await until(
      () => evaluate(`document.querySelector(${JSON.stringify(DONOR_TRIGGER)}) !== null`),
      'donor trigger before rollback',
    );
    await clearRollout();
    const rollbackUnmounted = Boolean(await until(
      () => evaluate(`document.querySelector(${JSON.stringify(DONOR_TRIGGER)}) === null`),
      'donor workbench rollback unmount',
    ));
    const legacyAfterRollback = Boolean(await until(
      () => evaluate(`document.querySelector(${JSON.stringify(LEGACY_TRIGGER)}) !== null`),
      'legacy source workbench after rollback',
      15_000,
    ));
    const stored = await storage(`new Promise((resolve) => chrome.storage.local.get([
      ${JSON.stringify(DONOR_WORKBENCH_FEATURE_KEY)},
      ${JSON.stringify(DONOR_WORKBENCH_ALLOWLIST_KEY)}
    ], resolve))`);
    const storageCleared = stored && Object.keys(stored).length === 0;
    assert.equal(storageCleared, true, 'donor rollout storage keys were not cleared');
    await settleObservers();
    assert.deepEqual(pageErrors, []);
    assert.equal(network.unexpectedExtensionMutations.length, 0,
      `extension mutations were observed: ${JSON.stringify(network.unexpectedExtensionMutations)}`);
    assert.equal(await extensionTreeSha256(options.extensionDir), candidateTreeSha256,
      'extension candidate tree changed during the live canary');

    const receipt = buildDonorWorkbenchLiveCanaryReceipt({
      observedAt: new Date().toISOString(),
      gitCommit: options.gitCommit,
      version: options.version,
      extensionTreeSha256: options.extensionTreeSha256,
      extensionId,
      browser: (await cdp.send('Browser.getVersion')).product,
      worktreeClean: true,
      releaseBinding: {
        releaseEvidenceSha256: signature.releaseEvidenceSha256,
        releaseSignatureSha256: signature.releaseSignatureSha256,
        cloudZipSha256: cloudArtifact.zipSha256,
        keyId: signature.keyId,
        signedAt: signature.signedAt,
      },
      cookieImport,
      product: {
        url: options.product.url,
        sourceKey: options.product.sourceKey,
        finalUrl,
        title,
        titleSha256,
        mediaCount,
        skuCount,
      },
      negativeProduct: {
        url: options.negativeProduct.url,
        sourceKey: options.negativeProduct.sourceKey,
        pageTitle: negativePageTitle,
        pageTitleSha256: negativePageTitleSha256,
        blocked: negativeBlocked,
      },
      cutover: {
        flagOnlyBlocked,
        allowlistedMounted,
        iframeOpened,
        rollbackUnmounted,
        legacyBefore,
        legacyAfterRollback,
        storageCleared,
      },
      network,
      pageErrors,
      screenshotSha256: sha256(screenshotBytes),
    });
    writeNewArtifactDurably(options.output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      status: receipt.status,
      kind: receipt.kind,
      gitCommit: receipt.gitCommit,
      version: receipt.version,
      output: options.output,
      outputSha256: sha256(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)),
      screenshot: screenshotPath,
      screenshotSha256: receipt.screenshotSha256,
    }, null, 2));
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch {}
    }
    if (child && child.exitCode === null) child.kill();
    await terminateProfileChromium(profile);
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
