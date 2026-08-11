import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceWorker = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectBackground = readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

assert.match(
  serviceWorker,
  /https:\/\/global-help\.ozon\.com\/zh\/commissions\/ozon-fees\/commissions\?region=CHN/,
  'commission sync should use the current Ozon global-help CHN commission page',
);

assert.match(
  serviceWorker,
  /OZON_COMMISSION_FALLBACK_SNAPSHOT/,
  'commission sync should have a local fallback snapshot when Ozon help pages reject background fetches',
);

assert.match(
  serviceWorker,
  /fetchStoredOzonCompanyIdForSync/,
  'cookie sync should read the ERP-stored shop companyId as an automatic fallback',
);

assert.match(
  serviceWorker,
  /https:\/\/api\.seller\.ozon\.ru\//,
  'cookie sync should include api.seller.ozon.ru cookies required by Seller media upload APIs',
);

assert.match(
  serviceWorker,
  /domain:\s*['"]api\.seller\.ozon\.ru['"]/,
  'cookie sync should query api.seller.ozon.ru host-only cookies, not only shared ozon.ru cookies',
);

const companyIdCandidateMatch = serviceWorker.match(
  /const companyIdCandidates\s*=\s*requireCompanyMatch\s*\?\s*\[([^\]]+)\]\s*:\s*preferStoredCompanyId\s*\?\s*\[([^\]]+)\]\s*:\s*\[([^\]]+)\]/,
);
assert.ok(companyIdCandidateMatch, 'cookie sync should define explicit companyId candidate orders');
const candidateNames = (value) => value.split(',').map((name) => name.trim());
assert.deepEqual(
  candidateNames(companyIdCandidateMatch[1]),
  ['payloadCompanyId'],
  'automatic sync should use only the exact companyId resolved for the authorized shop',
);
assert.deepEqual(
  candidateNames(companyIdCandidateMatch[2]),
  ['storedCompanyId', 'payloadCompanyId', 'tabCompanyId', 'capturedCompanyId', 'cookieCompanyId'],
  'an explicit stored-shop sync should prefer the selected shop companyId',
);
assert.deepEqual(
  candidateNames(companyIdCandidateMatch[3]),
  ['tabCompanyId', 'payloadCompanyId', 'capturedCompanyId', 'cookieCompanyId', 'storedCompanyId'],
  'normal sync should prefer live browser evidence and keep stored companyId as the final fallback',
);
assert.match(
  serviceWorker,
  /requireCompanyMatch[\s\S]{0,320}liveCompanyIds\.length === 0/,
  'automatic sync should fail closed when no live seller companyId is available',
);
assert.match(
  serviceWorker,
  /if \(matches\.length === 1 && matches\[0\]\.id\)/,
  'automatic shop resolution should reject an ambiguous companyId match',
);
assert.match(
  serviceWorker,
  /companyIdCandidates\.find\(\(value\)\s*=>\s*normalizeOzonCompanyIdForSync\(value\)\)/,
  'cookie sync should select the first valid companyId from the ordered candidates',
);

assert.match(
  serviceWorker,
  /readOzonSellerCookieValueFromOpenTabForSync/,
  'cookie sync should fall back to reading sc_company_id from an already-open seller tab',
);

assert.match(
  serviceWorker,
  /syncCurrentOzonCookieForSync/,
  'quick Cookie binding should have a background path that resolves the current Ozon shop automatically',
);

assert.match(
  serviceWorker,
  /function\s+ensureCurrentOzonCookieSyncedForInsights/,
  'seller KPI aggregation should have a throttled guard that syncs the currently logged-in Ozon seller cookie automatically',
);

assert.match(
  collectBackground,
  /ensureCurrentOzonCookieSyncedForInsights[\s\S]*recordInsightSourceError\(sourceErrors,\s*["']cookie-sync["']/,
  'seller KPI aggregation should record cookie auto-sync failures as source diagnostics instead of silently showing empty Premium data',
);

assert.match(
  serviceWorker,
  /ozon-calc:sync-current-ozon-cookie/,
  'content-script quick Cookie buttons should call a direct sync message instead of opening settings.html#cookie',
);

assert.match(
  collectBackground,
  /readOzonSellerCookieValueFromOpenTab/,
  'seller API collection should also read sc_company_id from an already-open seller tab when chrome.cookies misses it',
);

assert.match(
  collectBackground,
  /readOzonSellerCookieValueFromOpenTab\("sc_company_id"\)/,
  'seller company id lookup should specifically use the seller tab cookie fallback for sc_company_id',
);

assert.match(
  collectBackground,
  /const capturedCompanyId = await getCapturedOzonCompanyId\(\);[\s\S]{0,260}readOzonSellerCookieValueFromOpenTab\("sc_company_id"\)/,
  'seller API collection should prefer the current seller x-o3-company-id capture before stale sc_company_id cookies',
);

console.log('PASS Ozon sync maintenance guards');
