import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const background = await readFile(
  new URL('../extensions/ss-erp/background/collect-background.js', import.meta.url),
  'utf8',
);
const serviceWorker = await readFile(
  new URL('../extensions/ss-erp/background/service-worker.js', import.meta.url),
  'utf8',
);
const transport = await readFile(
  new URL(
    '../extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js',
    import.meta.url,
  ),
  'utf8',
);
const deviceRoutes = await readFile(
  new URL('../apps/server/src/routes/extension-device-browser-one-click.ts', import.meta.url),
  'utf8',
);
const listingRoutes = await readFile(
  new URL('../apps/server/src/routes/listing.ts', import.meta.url),
  'utf8',
);
const serverEntry = await readFile(
  new URL('../apps/server/src/index.ts', import.meta.url),
  'utf8',
);
const overlay = await readFile(
  new URL('../extensions/ss-erp/content/ozon-list-overlay.js', import.meta.url),
  'utf8',
);
const product = await readFile(
  new URL('../extensions/ss-erp/content/collect-content-script.js', import.meta.url),
  'utf8',
);
const pairingDialog = await readFile(
  new URL('../apps/web/src/components/extension-token-dialog.tsx', import.meta.url),
  'utf8',
);

function functionBody(name, nextName) {
  const expression = new RegExp(
    `async function ${name}\\([^]*?\\n}\\n\\n(?:async )?function ${nextName}`,
  );
  const match = background.match(expression);
  assert.ok(match, `expected ${name} body`);
  return match[0];
}

const createJob = functionBody(
  'createOzonWorkbenchPublishJob',
  'submitOzonWorkbenchPublishJob',
);
const watermark = functionBody(
  'getWatermarkTemplates',
  'requestProductSelectionRuleCenter',
);

assert.doesNotMatch(createJob, /getStoredErpConnection|conn\.token|\/api\/listing\//);
assert.match(createJob, /SS_ERP_EXTENSION_DEVICE_ONE_CLICK/);
assert.doesNotMatch(watermark, /getStoredErpConnection|conn\.token|\/api\/watermark-templates/);
assert.match(watermark, /SS_ERP_EXTENSION_DEVICE_ONE_CLICK/);

assert.match(serviceWorker, /SS_ERP_EXTENSION_DEVICE_ONE_CLICK\s*=\s*Object\.freeze/);
assert.match(serviceWorker, /terminal:\s*result\.body\.terminal === true/);
assert.match(serviceWorker, /ambiguousHttpOutcome[\s\S]*408,\s*425,\s*429[\s\S]*automaticRetryAllowed:\s*false/);
assert.match(
  serviceWorker,
  /body\.outcome\s*===\s*'UNKNOWN_OUTCOME'[\s\S]*outcome:\s*'UNKNOWN_OUTCOME'[\s\S]*body\.automaticRetryAllowed\s*===\s*false[\s\S]*automaticRetryAllowed:\s*false[\s\S]*body\.requestDispatched\s*===\s*true[\s\S]*requestDispatched:\s*true/,
  'one-click device responses should preserve bounded UNKNOWN outcome metadata',
);
assert.match(serviceWorker, /authMode:\s*'device'/);
assert.match(serviceWorker, /message\.type === 'ozon-calc:erp-endpoint-get'[^]*readExtensionDeviceBrowserOneClickStatus/);
assert.match(serviceWorker, /connected:\s*devicePaired/);
assert.match(
  serviceWorker,
  /canPublish:\s*devicePaired[\s\S]*scopes\.includes\('capture:write'\)[\s\S]*scopes\.includes\('listing:publish'\)/,
);
assert.doesNotMatch(serviceWorker, /canPublish:[^\n]+Boolean\(token\)/);

assert.match(transport, /extension-device\/browser-one-click\/jobs/);
assert.match(transport, /browserOneClickJobWritePath[\s\S]*MAX_PUBLISH_REQUEST_BYTES/);
assert.match(transport, /browserOneClickJobWriteRequest[\s\S]*MAX_PUBLISH_RESPONSE_BYTES/);
assert.match(transport, /browserOneClickJobReadPath/);
assert.match(transport, /extension-device\/browser-one-click\/status\/read/);
assert.match(transport, /extension-device\/browser-one-click\/watermark-templates/);
assert.match(deviceRoutes, /requiredScopes:[^=]+=[\s\S]*'capture:write'[\s\S]*'listing:publish'/);
assert.match(deviceRoutes, /app\.post\('\/status\/read'[\s\S]*deviceContext\(request,\s*reply,\s*null\)/);
assert.match(deviceRoutes, /requiredScopes\?\.find[\s\S]*device\.scopes![\s\S]*includes\(scope\)/);
assert.match(deviceRoutes, /deviceContext\(request,\s*reply,\s*\['capture:write'\]\)/);
assert.match(serviceWorker, /requiredScopes:\s*\['capture:write',\s*'listing:publish'\]/);
assert.match(transport, /configuredRequiredScopes[\s\S]*operation\.scopes[\s\S]*includes\(scope\)/);
assert.match(deviceRoutes, /allowedShopIds/);
assert.match(listingRoutes, /device_publish_state_forbidden/);
assert.match(serviceWorker, /readExtensionDeviceBrowserOneClickJob[\s\S]*\/read/);
assert.match(background, /automaticRetryAllowed\s*===\s*false/);
assert.match(background, /automaticRetryAllowed:\s*parsed\s*&&\s*parsed\.automaticRetryAllowed/);
assert.match(background, /browser_payload_outcome_unknown/);
assert.match(background, /requestedRowHashes[\s\S]*acceptedRowHashes[\s\S]*reconciled/);
assert.match(listingRoutes, /device_authority_changed/);
assert.match(serverEntry, /extensionDeviceBrowserOneClickRoutes/);
assert.match(transport, /scopeExemptRequest\s*=\s*path\s*===\s*BROWSER_ONE_CLICK_STATUS_PATH/);
assert.match(
  serviceWorker,
  /browser-one-click\/status\/read',\s*\{\},\s*\)/,
  'live scope introspection must not be blocked by stale local scope claims',
);

assert.match(overlay, /authMode === 'device'/);
assert.match(overlay, /缺少上架授权/);
assert.match(overlay, /\/collect\?extensionAuth=publish/);
assert.match(product, /function\s+loadOzonWorkbenchConnectionStatus/);
assert.match(product, /modal\.__ssErpCanPublish\s*!==\s*true/);
assert.match(product, /\/collect\?extensionAuth=publish/);
assert.match(pairingDialog, /params\.get\('extensionAuth'\)\s*!==\s*'publish'/);
assert.match(pairingDialog, /PUBLISH_DEVICE_SCOPES|setSelectedScopes[\s\S]*'listing:publish'/);
assert.match(
  background,
  /OZON_WORKBENCH_PUBLISH_PAYLOAD_TERMINAL_ERROR_CODES[\s\S]*device_authorization_required[\s\S]*device_publish_scope_required[\s\S]*device_unpaired[\s\S]*device_repair_required[\s\S]*device_authority_changed/,
  'device authorization and scope failures should have an explicit terminal error allowlist',
);
assert.match(
  background,
  /async function\s+recordOzonWorkbenchPublishPayloadRetry[\s\S]*isOzonWorkbenchPublishPayloadTerminalError\(error\)[\s\S]*finalizeOzonWorkbenchPublishPayloadJob\(normalized\.jobId\)[\s\S]*terminal:\s*true/,
  'terminal device failures should consume the durable queue entry and open the ERP log instead of retrying forever',
);
assert.match(
  background,
  /if \(job\.terminal === true\) \{\s*await finalizeOzonWorkbenchPublishPayloadJob\(job\.jobId\);\s*continue;\s*\}/,
  'payload queue flush should consume legacy parked terminal jobs after worker restart and alarm wakeups',
);
assert.match(
  background,
  /errorCode:\s*normalizeErrorCode\(error\)/,
  'payload completion should preserve the device transport error code for retry classification',
);
assert.match(background, /terminal:\s*result && result\.terminal === true/);
assert.doesNotMatch(
  overlay,
  /response\.endpoint\s*&&\s*response\.hasToken\s*\?[^:]+:\s*['"]#dc2626/,
);

console.log('PASS Ozon workbench uses scoped device authentication');
