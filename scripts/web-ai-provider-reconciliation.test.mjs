import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  aiProviderReconciliationActions,
  createAiProviderReconciliationRequestId,
} from '../apps/web/src/lib/ai-provider-reconciliation.ts';

const component = fs.readFileSync('apps/web/src/components/admin/ai-provider-reconciliation-panel.tsx', 'utf8');
const page = fs.readFileSync('apps/web/src/app/(dashboard)/admin/ops/page.tsx', 'utf8');
const route = fs.readFileSync('apps/server/src/routes/admin-ai-provider-reconciliations.ts', 'utf8');

assert.ok(
  page.indexOf('<AiProviderReconciliationPanel />') < page.indexOf('<AiCostReconciliationPanel />'),
  'Provider-result recovery must remain separate from and precede cost reconciliation',
);
assert.match(component, /status=\$\{encodeURIComponent\(statusFilter\)\}/u);
assert.match(component, /cursor=\$\{encodeURIComponent\(cursor\)\}/u);
assert.match(component, /value=\{statusFilter\}/u);
assert.match(component, /setStatusFilter\(event\.target\.value as AiProviderReconciliationListStatus\)/u);
assert.match(component, /response\.data\.nextCursor/u);
assert.match(component, /加载更多/u);
assert.match(component, /\/api\/admin\/ai-provider-reconciliations\/\$\{encodeURIComponent\(decision\.item\.id\)\}\/resolve/u);
assert.match(component, /expectedStatus:\s*'MANUAL_REVIEW'/u);
assert.match(component, /expectedRevision:\s*decision\.item\.revision/u);
assert.match(component, /expectedEvidenceHash:\s*decision\.item\.evidenceHash/u);
assert.match(component, /requestId:\s*decision\.requestId/u);
assert.match(component, /网络响应未确认，可在同一窗口使用相同请求重试/u);
assert.match(component, /providerJobId:\s*providerJobId\.trim\(\)/u);
assert.match(component, /providerAcceptedAt:\s*acceptedAt/u);
assert.match(component, /disabled=\{Boolean\(decision\.item\.providerJobId \|\| decision\.item\.costProviderJobId\)\}/u);
assert.match(component, /setProviderAcceptedAt\(item\.providerAcceptedAt \|\| ''\)/u);
assert.doesNotMatch(component, /setProviderAcceptedAt\(item\.providerDispatchedAt/u);
assert.match(component, /调度开始：\{formatDate\(item\.providerDispatchedAt\)\}/u);
assert.match(component, /disabled=\{Boolean\(decision\.item\.providerAcceptedAt\)\}/u);
assert.match(component, /overflow-x-auto/u);
assert.doesNotMatch(component, /SUCCESS|成功结果/u, 'manual resolution must not manufacture success');
assert.doesNotMatch(component, /\/submit/u, 'reconciliation must never submit a replacement Provider task');

const withTask = {
  status: 'MANUAL_REVIEW', workflowId: 'workflow-1', providerJobId: 'provider-task-1',
  allowedActions: ['RESUME', 'NO_OUTPUT'],
};
const withoutTask = {
  status: 'MANUAL_REVIEW', workflowId: 'workflow-1', providerJobId: null,
  allowedActions: ['RESUME', 'NOT_SUBMITTED'],
};
assert.deepEqual(aiProviderReconciliationActions(withTask), ['RESUME', 'NO_OUTPUT']);
assert.deepEqual(aiProviderReconciliationActions(withoutTask), ['RESUME', 'NOT_SUBMITTED']);
assert.deepEqual(
  aiProviderReconciliationActions({ ...withTask, workflowId: null }),
  ['RESUME', 'NO_OUTPUT'],
  'standalone manual actions use the server-derived audited contract',
);
assert.deepEqual(
  aiProviderReconciliationActions({ ...withoutTask, workflowId: null }),
  ['RESUME', 'NOT_SUBMITTED'],
);
assert.deepEqual(aiProviderReconciliationActions({ ...withTask, status: 'PENDING', allowedActions: [] }), []);

const requestIds = new Set(Array.from({ length: 8 }, createAiProviderReconciliationRequestId));
assert.equal(requestIds.size, 8);
for (const requestId of requestIds) {
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
}

assert.match(route, /requireSuperAdmin/u);
assert.match(route, /account_session/u);
assert.match(route, /isSubAccount/u);
assert.match(route, /action:\s*z\.enum\(\['NOT_SUBMITTED', 'NO_OUTPUT', 'RESUME', 'ABANDON'\]\)/u);
assert.match(route, /value\.action === 'RESUME'[\s\S]*!value\.providerJobId \|\| !value\.providerAcceptedAt/u);
assert.match(route, /\.strict\(\)\.superRefine/u);

console.log('PASS admin AI Provider-result reconciliation UI contract');
