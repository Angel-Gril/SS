#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PAGE_ORIGIN = 'https://detail.1688.com';
const PAGE_URL = `${PAGE_ORIGIN}/pages/source-workbench-shell.html`;
const IMAGE_ORIGIN = 'https://images.ss-erp-fixture.invalid';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(60);
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
        if (message.error) pending.reject(new Error(message.error.message));
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
      const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
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
      }, 15_000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  return executable;
}

function historyProjection(reviewStatus = 'PENDING', application = null, receipt = null) {
  return {
    state: 'ready', listingWorkflowId: 'draft-fixture', error: '',
    context: {
      snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture', shopId: 'shop-doth',
      listingWorkflowId: 'draft-fixture', revision: 2, draftVersion: 2,
    },
    items: [{
      id: 'media-history-1', operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED',
      reviewStatus, revision: reviewStatus === 'PENDING' ? 3 : 4,
      contextSkuKey: 'sku-white-small', contextSlotKey: 'sku:sku-white-small:hero',
      selectedOutputAssetId: reviewStatus === 'PENDING' ? null : 'asset-output-1',
      outputs: [{
        id: 'asset-output-1', url: `${IMAGE_ORIGIN}/generated.png`, mimeType: 'image/png',
        width: 900, height: 1200,
      }],
      application,
      createdAt: '2026-09-27T07:00:00.000Z', updatedAt: '2026-09-27T07:01:00.000Z',
    }],
    nextCursor: null,
    receipt,
  };
}

function projection({ withDraft, preferredSkuKey = '', history = null }) {
  return {
    contractVersion: 'ss-erp-donor-workbench/v1',
    source: {
      platform: '1688',
      sourceProductId: '990499606077',
      title: 'Synthetic transparent storage organizer with three compartments',
      canonicalUrl: 'https://detail.1688.com/offer/990499606077.html',
      categoryName: 'Storage organizers',
      categoryPath: ['Home', 'Storage', 'Organizers'],
      preferredSkuKey,
    },
    skus: [
      { key: 'sku-white-small', label: 'Color: White / Size: Small', imageUrl: `${IMAGE_ORIGIN}/white-small.png` },
      { key: 'sku-white-large', label: 'Color: White / Size: Large', imageUrl: `${IMAGE_ORIGIN}/white-large.png` },
      { key: 'sku-green-large', label: 'Color: Green / Size: Large', imageUrl: `${IMAGE_ORIGIN}/green-large.png` },
    ],
    media: [
      { key: 'media-main', role: 'product_main', url: `${IMAGE_ORIGIN}/main.png`, skuKeys: [] },
      { key: 'media-detail-1', role: 'product_detail', url: `${IMAGE_ORIGIN}/detail-1.png`, skuKeys: [] },
      { key: 'media-detail-2', role: 'product_detail', url: `${IMAGE_ORIGIN}/detail-2.png`, skuKeys: [] },
      { key: 'media-sku-green', role: 'sku', url: `${IMAGE_ORIGIN}/green-large.png`, skuKeys: ['sku-green-large'] },
    ],
    shops: [{ id: 'shop-doth', name: 'DOTH', status: 'ACTIVE' }],
    handoff: {
      snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture',
      sourceProductId: '990499606077', platform: '1688',
    },
    workbench: {
      state: 'ready', reason: '',
      status: {
        snapshot: { current: true },
        listing: {
          truncated: false,
          items: withDraft ? [{
            id: 'draft-fixture', shopId: 'shop-doth', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
            runState: 'ACTIVE', revision: 2, draftVersion: 2, selectedSkuCount: 3,
            mediaAssignmentCount: 1, blockerCount: 0, warningCount: 1,
            blockers: [], warnings: [{ code: 'MISSING_DETAIL_MEDIA', message: 'Detail media remains under review' }],
            updatedAt: '2026-09-27T07:00:00.000Z',
          }] : [],
        },
        media: {
          actionableCount: withDraft ? 3 : 0,
          items: withDraft ? [{
            id: 'task-fixture', operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED',
            reviewStatus: 'PENDING', revision: 3, actionable: true, allowedActions: [],
            updatedAt: '2026-09-27T07:00:00.000Z',
          }, {
            id: 'task-retry', operation: 'FULL_EDIT', status: 'FAILED',
            reviewStatus: 'NOT_READY', revision: 5, actionable: true, allowedActions: ['RETRY'],
            updatedAt: '2026-09-27T07:00:01.000Z',
          }, {
            id: 'task-cancel', operation: 'INPAINT', status: 'RUNNING',
            reviewStatus: 'NOT_READY', revision: 2, actionable: true, allowedActions: ['CANCEL'],
            updatedAt: '2026-09-27T07:00:02.000Z',
          }] : [],
        },
      },
    },
    history: history || {
      state: 'idle', listingWorkflowId: '', error: '', context: null,
      items: [], nextCursor: null, receipt: null,
    },
    busy: false,
    error: '',
    updatedAt: '2026-09-27T07:00:00.000Z',
  };
}

function imageFixture(name) {
  const green = name.includes('green');
  const detail = name.includes('detail');
  const fill = green ? '#5f8f71' : detail ? '#d7dde5' : '#f2f4f6';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#fff"/><rect x="46" y="74" width="228" height="174" rx="14" fill="${fill}" stroke="#52606d" stroke-width="5"/><path d="M122 76v170M198 76v170M52 132h216" fill="none" stroke="#8995a3" stroke-width="4"/><rect x="84" y="52" width="152" height="24" rx="8" fill="#c48a2c"/></svg>`);
}

async function terminateProfileChromium(profile) {
  const script = [
    '$profilePath = $args[0]',
    "$processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\chrome.exe' -and ([string]$_.CommandLine).Contains($profilePath) }",
    '$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  const process = spawn('powershell.exe', ['-NoProfile', '-Command', script, profile], {
    windowsHide: true, stdio: 'ignore',
  });
  await Promise.race([
    new Promise((resolve) => process.once('exit', resolve)),
    pause(5_000),
  ]);
}

async function run() {
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-workbench-evidence-'));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-workbench-profile-')));
  const summary = {
    contractVersion: 'ss-erp-donor-workbench-browser-acceptance/v1',
    ok: false,
    artifacts,
    screenshots: [],
    pageErrors: [],
    blockedRequests: [],
    productionMutations: 0,
    providerRequests: 0,
    ozonRequests: 0,
  };
  let child;
  let cdp;
  try {
    child = spawn(chromeExecutable(), [
      '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const activePort = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u); } catch { return null; }
    }, 'Chromium startup');
    cdp = await Cdp.connect(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    cdp.on('Runtime.exceptionThrown', (event, observedSession) => {
      if (observedSession === sessionId) summary.pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, observedSession) => {
      if (observedSession !== sessionId) return;
      void (async () => {
        const url = new URL(event.request.url);
        if (url.origin === PAGE_ORIGIN) {
          const relative = decodeURIComponent(url.pathname).replace(/^\//u, '');
          if (relative === 'favicon.ico') {
            await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 });
            return;
          }
          const allowed = new Set([
            'pages/source-workbench-shell.html', 'pages/source-workbench-shell.css',
            'pages/source-workbench-shell.js', 'shared/donor-workbench/workspace-contract.js',
            'shared/donor-workbench/prompt-adapter.js',
          ]);
          assert.ok(allowed.has(relative), `Unexpected workbench resource: ${relative}`);
          const body = await readFile(path.join(EXTENSION_ROOT, relative));
          const contentType = relative.endsWith('.html') ? 'text/html; charset=utf-8'
            : relative.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
          await send('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: contentType }], body: body.toString('base64'),
          });
          return;
        }
        if (url.origin === IMAGE_ORIGIN) {
          const body = imageFixture(url.pathname);
          await send('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }], body: body.toString('base64'),
          });
          return;
        }
        summary.blockedRequests.push({ method: event.request.method, url: event.request.url });
        await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      })().catch(async (error) => {
        summary.pageErrors.push(error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PAGE_URL });
    await until(() => evaluate('document.readyState === "complete" && !!window.SS_ERP_DONOR_WORKBENCH_CONTRACT'), 'workbench ready');

    const postProjection = (value) => evaluate(`window.postMessage(${JSON.stringify({
      contractVersion: 'ss-erp-donor-workbench/v1', type: 'PROJECTION', projection: value,
    })}, ${JSON.stringify(PAGE_ORIGIN)})`);
    await postProjection(projection({ withDraft: false }));
    await until(() => evaluate('document.querySelector("[data-view=draft]").hidden === false'), 'draft stage');
    assert.equal(await evaluate('document.querySelector("[data-action=create-draft]").disabled'), false);
    assert.equal(await evaluate('document.querySelectorAll(".sku-row").length'), 3);

    const click = async (selector) => {
      const point = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); n.scrollIntoView({block:'center'}); const r=n.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    };
    await click('[data-stage="media"]');
    await until(() => evaluate('document.querySelector("[data-view=media]").hidden === false'), 'media stage');
    assert.equal(await evaluate('document.querySelectorAll(".image-tile").length'), 4);
    assert.equal(await evaluate('document.querySelector("[data-role=json-state]").textContent'), '有效');
    assert.equal(await evaluate('document.querySelectorAll("[data-role=media-sku-select] option").length'), 3);
    assert.equal(await evaluate('document.querySelector("[data-role=media-sku-select]").value'), 'sku-white-small');
    assert.match(await evaluate('document.querySelector("[data-role=prompt-text]").value'), /White \/ Size: Small/u);
    assert.match(await evaluate('document.querySelector("[data-role=negative-prompt-text]").value'), /watermark/u);
    assert.equal(await evaluate(`(() => {
      const value = JSON.parse(document.querySelector('[data-role=prompt-json]').value);
      return value.visualDescription.evidencePolicy === 'verified-source-only';
    })()`), true);

    await evaluate(`(() => {
      const select = document.querySelector('[data-role=media-sku-select]');
      select.value = 'sku-green-large';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(() => evaluate('document.querySelector("[data-role=prompt-text]").value.includes("Green / Size: Large")'),
      'selected SKU prompt refresh');

    await postProjection(projection({ withDraft: true }));
    await until(() => evaluate('document.querySelectorAll(".queue-row").length === 3'), 'server task projection');
    assert.equal(await evaluate('document.querySelector("[data-action=create-draft]").disabled'), true);
    assert.equal(await evaluate('document.querySelector("[data-role=queue-count]").textContent'), '3 项');
    assert.equal(await evaluate('document.querySelectorAll("[data-task-action=RETRY]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("[data-task-action=CANCEL]").length'), 1);

    await evaluate(`window.__donorCommands = [];
      window.addEventListener('message', (event) => {
        if (event.data?.contractVersion === 'ss-erp-donor-workbench/v1'
          && typeof event.data?.type === 'string') window.__donorCommands.push(event.data);
      });`);
    await click('[data-action="open-ai-workbench"]');
    const mediaCommand = await until(async () => {
      const command = await evaluate('window.__donorCommands.at(-1) || null');
      return command || null;
    }, 'donor media launch command');
    assert.equal(mediaCommand.preferredSkuKey, 'sku-green-large');
    assert.equal(mediaCommand.sourceSelectionKey, null);
    assert.match(mediaCommand.promptDraft.prompt, /Green \/ Size: Large/u);
    assert.match(mediaCommand.promptDraft.negativePrompt, /watermark/u);

    await postProjection(projection({
      withDraft: true,
      preferredSkuKey: 'sku-white-small',
      history: historyProjection(),
    }));
    await until(() => evaluate(`document.querySelector('[data-role=media-sku-select]').value === 'sku-white-small'`),
      'source-selected SKU lock');
    assert.equal(await evaluate('document.querySelector("[data-role=media-sku-select]").disabled'), true);
    assert.match(await evaluate('document.querySelector("[data-role=prompt-text]").value'), /White \/ Size: Small/u);

    const screenshot = async (name) => {
      await send('Page.bringToFront');
      await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await pause(80);
      const value = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      const filename = path.join(artifacts, `${name}.png`);
      await writeFile(filename, Buffer.from(value.data, 'base64'));
      summary.screenshots.push(filename);
    };
    const desktopWidth = await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth})');
    assert.ok(desktopWidth.document <= desktopWidth.viewport && desktopWidth.body <= desktopWidth.viewport);
    await screenshot('media-desktop');

    await click('[data-stage="review"]');
    await until(() => evaluate('document.querySelector("[data-view=review]").hidden === false'), 'review stage');
    assert.equal(await evaluate('document.querySelectorAll(".issue-row").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll(".review-candidate").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll(".review-candidate img").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("[data-media-action=REVIEW_APPROVE]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("[data-media-action=REVIEW_REJECT]").length'), 1);
    await click('[data-media-action="REVIEW_APPROVE"]');
    const reviewCommand = await until(async () => {
      const command = await evaluate(`window.__donorCommands.filter((item) => item.type === 'PREPARE_MEDIA_MUTATION').at(-1) || null`);
      return command || null;
    }, 'donor review command');
    assert.deepEqual(reviewCommand, {
      contractVersion: 'ss-erp-donor-workbench/v1', type: 'PREPARE_MEDIA_MUTATION',
      requestId: reviewCommand.requestId, listingWorkflowId: 'draft-fixture',
      mediaWorkflowId: 'media-history-1', outputAssetId: 'asset-output-1',
      expectedRevision: 3, action: 'REVIEW_APPROVE',
    });

    await postProjection(projection({
      withDraft: true,
      preferredSkuKey: 'sku-white-small',
      history: historyProjection('APPROVED'),
    }));
    await until(() => evaluate('document.querySelectorAll("[data-media-action=APPLY_APPEND]").length === 1'),
      'approved candidate apply action');
    await click('[data-media-action="APPLY_APPEND"]');
    const applyCommand = await until(async () => {
      const command = await evaluate(`window.__donorCommands.filter((item) => item.action === 'APPLY_APPEND').at(-1) || null`);
      return command || null;
    }, 'donor apply command');
    assert.equal(applyCommand.expectedRevision, 4);
    assert.equal(applyCommand.outputAssetId, 'asset-output-1');

    await postProjection(projection({
      withDraft: true,
      preferredSkuKey: 'sku-white-small',
      history: historyProjection('APPROVED', {
        id: 'application-1', mode: 'append', state: 'APPLIED', targetId: 'draft-fixture',
        contextSkuKey: 'sku-white-small', contextSlotKey: 'sku:sku-white-small:hero',
        appliedAt: '2026-09-27T07:02:00.000Z', rolledBackAt: null,
      }, {
        kind: 'MUTATION_COMPLETED', replay: true, at: '2026-09-27T07:02:01.000Z',
      }),
    }));
    await until(() => evaluate('document.querySelector("[data-role=mutation-receipt]")?.textContent.includes("幂等回放")'),
      'idempotency replay receipt');

    await click('[data-task-action="RETRY"]');
    const taskCommand = await until(async () => {
      const command = await evaluate(`window.__donorCommands.filter((item) => item.type === 'EXECUTE_MEDIA_TASK').at(-1) || null`);
      return command || null;
    }, 'donor task retry command');
    assert.equal(taskCommand.mediaWorkflowId, 'task-retry');
    assert.equal(taskCommand.expectedRevision, 5);
    assert.equal(taskCommand.action, 'RETRY');
    await postProjection(projection({
      withDraft: true,
      preferredSkuKey: 'sku-white-small',
      history: historyProjection('APPROVED', {
        id: 'application-1', mode: 'append', state: 'APPLIED', targetId: 'draft-fixture',
        contextSkuKey: 'sku-white-small', contextSlotKey: 'sku:sku-white-small:hero',
        appliedAt: '2026-09-27T07:02:00.000Z', rolledBackAt: null,
      }, null),
    }));
    const taskReceiptMessage = {
      contractVersion: 'ss-erp-donor-workbench/v1', type: 'COMMAND_RESULT',
      requestId: taskCommand.requestId, ok: true, error: '',
      receipt: { kind: 'MEDIA_TASK', action: 'RETRY', replay: false, at: '2026-09-27T07:03:00.000Z' },
    };
    await evaluate(`window.postMessage(${JSON.stringify(taskReceiptMessage)}, ${JSON.stringify(PAGE_ORIGIN)})`);
    await until(() => evaluate('document.querySelector("[data-role=process-receipt]")?.textContent.includes("安全重试")'),
      'task command receipt');
    await screenshot('review-desktop');

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await pause(120);
    const mobileWidth = await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth})');
    assert.ok(mobileWidth.document <= mobileWidth.viewport && mobileWidth.body <= mobileWidth.viewport,
      `Mobile horizontal overflow: ${JSON.stringify(mobileWidth)}`);
    await click('[data-stage="media"]');
    await screenshot('media-mobile');

    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(summary.blockedRequests, []);
    summary.ok = true;
    summary.browser = (await cdp.send('Browser.getVersion')).product;
    summary.desktopWidth = desktopWidth;
    summary.mobileWidth = mobileWidth;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch {}
    }
    await terminateProfileChromium(profile);
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
