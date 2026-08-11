import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectBackground = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');

assert.ok(
  manifest.permissions.includes('alarms'),
  'extension should request alarms permission for periodic Ozon auth/data auto sync',
);

assert.match(
  serviceWorker,
  /SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES\s*=\s*30/,
  'service worker should use a 30 minute Ozon auto sync interval',
);

assert.match(
  serviceWorker,
  /chrome\.alarms\.create\(\s*SS_ERP_OZON_AUTO_SYNC_ALARM_NAME/,
  'service worker should create a recurring Ozon auto sync alarm',
);

assert.match(
  serviceWorker,
  /chrome\.alarms\.onAlarm\.addListener/,
  'service worker should handle recurring Ozon auto sync alarms',
);

assert.match(
  serviceWorker,
  /chrome\.cookies\.onChanged\.addListener[\s\S]*sc_company_id/,
  'service worker should trigger auto sync when the selected Ozon company cookie changes',
);

assert.match(
  serviceWorker,
  /const companyChanged = capturedCompanyId && capturedCompanyId !== state\.lastCompanyId/,
  'auto maintenance should detect when the selected Ozon company changes',
);

assert.match(
  serviceWorker,
  /ozon-calc:auto-sync-maintenance/,
  'service worker should expose an auto sync maintenance runtime message',
);

assert.match(
  serviceWorker,
  /async function readOzonAutoSyncStatus\(\)/,
  'service worker should expose a read-only Ozon auto sync status helper',
);

assert.match(
  serviceWorker,
  /message\.type === 'ozon-calc:auto-sync-status'[\s\S]{0,220}readOzonAutoSyncStatus\(\)/,
  'service worker should answer ERP auto sync status requests without forcing maintenance',
);

assert.match(
  serviceWorker,
  /SS_ERP_COLLECT_BACKGROUND[\s\S]*syncShopAnalyticsToErp/,
  'auto maintenance should directly call the collect background analytics sync flow',
);

assert.match(
  serviceWorker,
  /shopBindingVerified && shouldRunOzonAutoSyncSlot\(\s*state,\s*'analyticsAt',\s*now,\s*force \|\| companyChanged,?\s*\)/,
  'analytics sync should run immediately when the selected Ozon company changes',
);

assert.match(
  serviceWorker,
  /SS_ERP_COLLECT_BACKGROUND[\s\S]*syncShopGraphsToErp/,
  'auto maintenance should directly call the collect background graph sync flow',
);

assert.match(
  serviceWorker,
  /shopBindingVerified && shouldRunOzonAutoSyncSlot\(\s*state,\s*'graphsAt',\s*now,\s*force \|\| companyChanged,?\s*\)/,
  'graph sync should run immediately when the selected Ozon company changes',
);

assert.match(
  serviceWorker,
  /company_binding_unverified/,
  'analytics and graph writes should stop when the live seller binding is not verified',
);

assert.match(
  serviceWorker,
  /nextState\.lastResult\s*=/,
  'auto maintenance should store the latest quiet sync result for diagnostics',
);

assert.doesNotMatch(
  serviceWorker,
  /sendRuntimeMessageForAutoSync|chrome\.runtime\.sendMessage\(\{\s*type:\s*['"]spb-self-hosted:sync-shop-(?:analytics|graphs)['"]/,
  'auto maintenance should not send extension runtime messages to itself for analytics or graphs',
);

assert.match(
  popupJs,
  /ozon-calc:auto-sync-maintenance/,
  'popup should trigger background auto sync maintenance on open',
);

assert.match(
  collectBackground,
  /case "spb-self-hosted:sync-shop-analytics":[\s\S]{0,180}syncShopAnalyticsToErp\(message\.shopId,\s*message\.companyId\)/,
  'manual analytics sync should reuse the same analytics sync helper as auto sync',
);

assert.match(
  collectBackground,
  /case "spb-self-hosted:sync-shop-graphs":[\s\S]{0,180}syncShopGraphsToErp\(message\.shopId,\s*message\.companyId,\s*message\.period \|\| 30\)/,
  'manual graph sync should reuse the same graph sync helper as auto sync',
);

console.log('PASS Ozon auto sync wiring');
