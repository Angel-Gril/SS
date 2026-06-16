import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceWorker = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

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

console.log('PASS Ozon sync maintenance guards');
