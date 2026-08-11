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
  /change\.removed[\s\S]{0,300}ozonSellerCookieRemovalPending = true[\s\S]{0,300}scheduleOzonSellerCookieLifecycleSync\(\)/,
  'removed Seller auth Cookies should debounce a guarded resnapshot or clear',
);

assert.match(
  serviceWorker,
  /clearIfMissingAuth[\s\S]{0,1800}authCookieState === false[\s\S]{0,2200}clearCookie:\s*true/,
  'Cookie removal should clear ERP state only after confirming no replacement auth Cookie exists',
);

assert.match(
  serviceWorker,
  /completedQueries === queries\.length \? false : null/,
  'partial Cookie API failures must not be treated as a confirmed Seller logout',
);

assert.match(
  serviceWorker,
  /result && result\.cleared === true[\s\S]{0,260}authCookieState === false[\s\S]{0,180}clearRuntimeOzonCompanyIdForSync\(\)[\s\S]{0,220}broadcastOzonCompanyContextChanged\(\)/,
  'a confirmed Seller logout should clear captured company context and invalidate cached metrics',
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
  /function handleOzonSellerCookieChange[\s\S]{0,700}cookie\.name === 'sc_company_id'/,
  'service worker should handle selected Ozon company Cookie changes',
);

assert.match(
  serviceWorker,
  /chrome\.cookies\.onChanged\.addListener\(handleOzonSellerCookieChange\)/,
  'service worker should register the named Ozon Seller Cookie change handler',
);

assert.match(
  serviceWorker,
  /SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS\s*=\s*750/,
  'ordinary Seller Cookie lifecycle events should be debounced',
);

assert.match(
  serviceWorker,
  /function runOzonCookieOnlySyncSingleFlight[\s\S]{0,500}if \(ozonCookieOnlySyncInFlight\)[\s\S]{0,500}syncCurrentOzonCookieForSync/,
  'ordinary Seller Cookie lifecycle events should share one cookie-only in-flight request',
);

assert.match(
  serviceWorker,
  /function scheduleOzonSellerCookieLifecycleSync\(\)[\s\S]{0,500}clearTimeout\(ozonSellerCookieLifecycleTimer\)[\s\S]{0,500}setTimeout\([\s\S]{0,180}SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS/,
  'Seller Cookie lifecycle scheduling should collapse bursts into one delayed run',
);

const cookieOnlyLifecycle = serviceWorker.slice(
  serviceWorker.indexOf('function runOzonCookieOnlySyncSingleFlight'),
  serviceWorker.indexOf('function shouldRunOzonAutoSyncSlot'),
);
assert.ok(cookieOnlyLifecycle.length > 0, 'cookie-only lifecycle block should be present');
assert.doesNotMatch(
  cookieOnlyLifecycle,
  /runOzonAutoSyncMaintenance|syncShopAnalyticsToErp|syncShopGraphsToErp/,
  'ordinary Seller Cookie lifecycle runs must not invoke analytics, graphs, or full maintenance',
);

assert.match(
  serviceWorker,
  /chrome\.tabs\.onUpdated\.addListener\([\s\S]{0,300}changeInfo\.status !== 'complete'[\s\S]{0,300}isOzonSellerTabUrlForSync[\s\S]{0,180}scheduleOzonSellerCookieLifecycleSync\(\)/,
  'a completed seller.ozon.ru tab should schedule cookie-only sync',
);

assert.match(
  serviceWorker,
  /scheduleOzonSellerCookieLifecycleSyncWhenTabExists[\s\S]{0,500}chrome\.tabs\.query\(\{ url: 'https:\/\/seller\.ozon\.ru\/\*' \}\)[\s\S]{0,300}scheduleOzonSellerCookieLifecycleSync\(\)/,
  'startup sync should only be scheduled when a Seller tab already exists',
);

assert.match(
  serviceWorker,
  /chrome\.runtime\.onStartup\.addListener\([\s\S]{0,240}scheduleOzonSellerCookieLifecycleSyncWhenTabExists\(\)/,
  'browser startup should check for an existing Seller tab before cookie-only sync',
);

assert.match(
  serviceWorker,
  /isRelevantOzonSellerAuthCookieForSync\(cookie\)[\s\S]{0,700}change\.removed[\s\S]{0,400}cookie\.name === 'sc_company_id'[\s\S]{0,300}scheduleOzonCompanyMaintenance\(companyId\)[\s\S]{0,200}return;[\s\S]{0,160}scheduleOzonSellerCookieLifecycleSync\(\)/,
  'company changes should retain full maintenance while other auth cookies use cookie-only sync',
);

assert.match(
  serviceWorker,
  /function enqueueOzonAutoSyncMaintenance[\s\S]{0,500}ozonAutoSyncMaintenanceQueue\.then[\s\S]{0,500}runOzonAutoSyncMaintenance/,
  'full Ozon maintenance should be serialized across alarm, company-change, and manual triggers',
);

assert.match(
  serviceWorker,
  /function scheduleOzonCompanyMaintenance[\s\S]{0,700}clearTimeout\(ozonCompanyMaintenanceTimer\)[\s\S]{0,400}flushOzonCompanyMaintenance/,
  'company Cookie replacement bursts should coalesce to the latest company before maintenance',
);

assert.match(
  serviceWorker,
  /message\.type === 'ss-erp:extension-device-claim'[\s\S]{0,500}deviceStatus\.state === 'paired'[\s\S]{0,220}broadcastOzonCompanyContextChanged\(\)[\s\S]{0,180}scheduleOzonSellerCookieLifecycleSync\(\)/,
  'a successful extension-device claim should invalidate old context and schedule cookie-only sync',
);

assert.match(
  serviceWorker,
  /message\.type === 'ss-erp:extension-device-clear'[\s\S]{0,700}getLogisticsDeviceCredentials\(\)\.clear\(\)[\s\S]{0,240}broadcastOzonCompanyContextChanged\(\)/,
  'clearing a device session should invalidate background and content Seller context',
);

assert.match(
  serviceWorker,
  /message\.type === 'ss-erp:ozon-company-id-captured'[\s\S]{0,180}handleCapturedOzonCompanyIdForSync/,
  'captured Seller company changes should flow through the cache invalidation handler',
);

assert.doesNotMatch(
  serviceWorker,
  /chrome\.tabs\.reload\(/,
  'Seller Cookie lifecycle automation must not reload user pages',
);

assert.doesNotMatch(
  serviceWorker,
  /console\.(?:log|warn|error)\([^\n;]*(?:cookie\.value|message\.token|conn\.token)/i,
  'service-worker logs must not include Cookie or token values',
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
