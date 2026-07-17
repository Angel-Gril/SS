import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync('apps/web/src/components/admin/ai-cost-reconciliation-panel.tsx', 'utf8');
const page = fs.readFileSync('apps/web/src/app/(dashboard)/admin/ops/page.tsx', 'utf8');
const route = fs.readFileSync('apps/server/src/routes/admin-ai-cost-reconciliations.ts', 'utf8');
const service = fs.readFileSync('apps/server/src/services/ai-cost-reconciliation-admin.ts', 'utf8');

assert.match(page, /AiCostReconciliationPanel/u);
assert.match(component, /\/api\/admin\/ai-cost-reconciliations\?limit=50/u);
assert.match(component, /expectedEvidenceHash/u);
assert.match(component, /createReconciliationRequestId\(\)/u);
assert.match(component, /crypto\.getRandomValues/u);
assert.match(component, /requestId:\s*decision\.requestId/u);
assert.match(component, /同一窗口重试/u);
assert.doesNotMatch(component, /String\(item\.estimatedCostMinor\)/u);
assert.match(component, /Provider 后台核对/u);
assert.match(component, /写入不可变审计记录/u);
assert.match(component, /actualCostMinor/u);
assert.match(component, /billedUnits/u);
assert.match(route, /requireSuperAdmin/u);
assert.match(route, /account_session/u);
assert.match(route, /isSubAccount/u);
assert.match(route, /\.strict\(\)\.superRefine/u);
assert.match(service, /runAiMediaSerializableTransaction/u);
assert.match(service, /evidenceHash/u);
assert.match(service, /IDEMPOTENCY_KEY_CONFLICT/u);
assert.doesNotMatch(component, /requestFingerprint/u);
assert.doesNotMatch(component, /errorMessage/u);

console.log('PASS admin AI cost reconciliation UI contract');
