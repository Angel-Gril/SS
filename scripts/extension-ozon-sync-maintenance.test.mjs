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
  /payloadCompanyId\s*\|\|\s*capturedCompanyId\s*\|\|\s*cookieCompanyId\s*\|\|\s*storedCompanyId/,
  'companyId fallback order should include saved shop companyId after current browser evidence',
);

assert.match(
  serviceWorker,
  /readOzonSellerCookieValueFromOpenTabForSync/,
  'cookie sync should fall back to reading sc_company_id from an already-open seller tab',
);

assert.match(
  serviceWorker,
  /tabCompanyId\s*\|\|\s*payloadCompanyId\s*\|\|\s*capturedCompanyId\s*\|\|\s*cookieCompanyId\s*\|\|\s*storedCompanyId/,
  'companyId fallback order should prefer live seller tab evidence before stale saved values',
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

console.log('PASS Ozon sync maintenance guards');
