import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const background = await readFile(
  new URL('../extensions/ss-erp/background/collect-background.js', import.meta.url),
  'utf8',
);
const product = await readFile(
  new URL('../extensions/ss-erp/content/collect-content-script.js', import.meta.url),
  'utf8',
);
const overlay = await readFile(
  new URL('../extensions/ss-erp/content/ozon-list-overlay.js', import.meta.url),
  'utf8',
);

function functionBody(name, nextName) {
  const declarationIndex = (functionName) => {
    const indexes = [
      background.indexOf(`async function ${functionName}(`),
      background.indexOf(`function ${functionName}(`),
    ].filter((index) => index >= 0);
    return indexes.length ? Math.min(...indexes) : -1;
  };
  const start = declarationIndex(name);
  const end = declarationIndex(nextName);
  assert.ok(start >= 0 && end > start, `expected ${name} body`);
  return background.slice(start, end);
}

function occurrences(source, expression) {
  return [...source.matchAll(new RegExp(expression.source, expression.flags.includes('g')
    ? expression.flags
    : `${expression.flags}g`))].length;
}

const flushQueue = functionBody(
  'flushOzonWorkbenchPublishPayloadQueue',
  'inferOzonWorkbenchReviewWebBaseUrl',
);
const openReviewTab = functionBody(
  'openOzonWorkbenchReviewTab',
  'finalizeOzonWorkbenchPublishPayloadJob',
);
const finalizePayload = functionBody(
  'finalizeOzonWorkbenchPublishPayloadJob',
  'normalizeRichDescriptionText',
);
const recordRetry = functionBody(
  'recordOzonWorkbenchPublishPayloadRetry',
  'isOzonWorkbenchPublishPayloadDue',
);
const completePayload = functionBody(
  'completeOzonWorkbenchPublishJobPayload',
  'ensureOzonWorkbenchPublishCookieSynced',
);
const handoffValidator = functionBody(
  'isOzonWorkbenchReviewHandoff',
  'normalizeRichDescriptionText',
);

assert.match(
  flushQueue,
  /if \(result && result\.ok === true\) \{\s*await finalizeOzonWorkbenchPublishPayloadJob\(job\.jobId\);\s*\}/,
  'successful completion should use the non-replay recovery boundary',
);
assert.match(
  flushQueue,
  /if \(job\.terminal === true\) \{\s*await finalizeOzonWorkbenchPublishPayloadJob\(job\.jobId\);\s*continue;\s*\}/,
  'legacy parked terminal entries should be consumed through the same non-replay recovery boundary',
);
assert.doesNotMatch(
  flushQueue,
  /chrome\.tabs\.(?:create|sendMessage)|removeOzonWorkbenchPublishPayloadJob/,
  'queue flushing should not split durable removal from best-effort navigation',
);

const removeIndex = finalizePayload.indexOf('await removeOzonWorkbenchPublishPayloadJob(normalizedJobId);');
const openIndex = finalizePayload.indexOf('return openOzonWorkbenchReviewTab(normalizedJobId);');
assert.ok(removeIndex >= 0 && openIndex > removeIndex, 'persisted completion must be removed before navigation');
assert.equal(
  occurrences(finalizePayload, /removeOzonWorkbenchPublishPayloadJob\(/),
  1,
  'successful completion should remove its persisted queue entry exactly once',
);
assert.equal(
  occurrences(finalizePayload, /openOzonWorkbenchReviewTab\(/),
  1,
  'successful completion should request exactly one recovery tab',
);

assert.match(openReviewTab, /\/listing-logs\?jobId=" \+ encodeURIComponent\(normalizedJobId\)/);
assert.ok(
  background.includes('&& /^[A-Za-z0-9_-]+$/.test(normalized)'),
  'the extension review job ID must match the Web login recovery allowlist',
);
assert.equal(
  occurrences(openReviewTab, /chrome\.tabs\.create\(/),
  1,
  'recovery should create exactly one listing-log tab',
);
assert.match(
  openReviewTab,
  /try \{\s*await chrome\.tabs\.create\(\{ url, active: true \}\);\s*return true;\s*\} catch \(_error\) \{[^]*return false;\s*\}/,
  'tab-open failure must be contained after durable queue removal',
);
assert.doesNotMatch(
  `${flushQueue}\n${finalizePayload}\n${openReviewTab}`,
  /chrome\.tabs\.sendMessage/,
  'review recovery must not depend on an unhandled content-script handoff',
);
assert.doesNotMatch(
  finalizePayload,
  /recordOzonWorkbenchPublishPayloadRetry|upsertOzonWorkbenchPublishPayloadJob|writeOzonWorkbenchPublishPayloadQueue/,
  'navigation failure must not recreate or retry a completed queue entry',
);
assert.match(
  recordRetry,
  /isOzonWorkbenchPublishPayloadTerminalError\(error\)[^]*await finalizeOzonWorkbenchPublishPayloadJob\(normalized\.jobId\)/,
  'terminal handoff failures must consume the queue and open the same ERP log recovery entry',
);
const terminalRetryBranch = recordRetry.slice(
  recordRetry.indexOf('if (isOzonWorkbenchPublishPayloadTerminalError(error))'),
  recordRetry.indexOf('const attempts ='),
);
assert.doesNotMatch(
  terminalRetryBranch,
  /terminalJob|terminalAt|writeOzonWorkbenchPublishPayloadQueue/,
  'terminal handoff failures must not be parked in durable storage',
);
assert.match(
  completePayload,
  /if \(!isOzonWorkbenchPublishPayloadTerminalError\(completionError\)\) \{[^]*browserPayloadRetrying:\s*true/,
  'terminal review-handoff failures must not be overwritten with a retrying collection state',
);
assert.match(
  completePayload,
  /if \(!isOzonWorkbenchReviewHandoff\(handoff\)\) \{[^]*browser_one_click_handoff_invalid[^]*terminal:\s*true/,
  'a 2xx response must not consume the durable queue unless it carries a complete review handoff',
);
assert.match(handoffValidator, /value\.drafts\.length === 0[^]*value\.drafts\.length > 100/);
assert.match(handoffValidator, /draft\.supplyGoodsId[^]*draft\.snapshotId[^]*draft\.draftId[^]*draft\.skuKey[^]*draft\.sourceSku/);
assert.match(handoffValidator, /Number\.isSafeInteger\(draft\.draftVersion\)[^]*Number\.isSafeInteger\(draft\.revision\)/);
assert.match(
  background,
  /if \(errorCode === "browser_payload_conflict"\) return false;/,
  'CAS conflicts must remain retryable',
);
assert.match(
  background,
  /terminal:\s*result && result\.terminal === true/,
  'server terminal state must reach the durable queue classifier',
);

for (const content of [background, product, overlay]) {
  assert.match(content, /完成后请在 ERP 上架日志审核草稿/);
}

console.log('PASS Ozon workbench opens one non-replaying review recovery tab');
