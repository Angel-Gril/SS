import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const page = fs.readFileSync('apps/web/src/app/(dashboard)/listing-logs/page.tsx', 'utf8');
const list = fs.readFileSync('apps/web/src/components/listing-job-list.tsx', 'utf8');
const detail = fs.readFileSync('apps/web/src/components/listing-job-detail-dialog.tsx', 'utf8');
const dashboardLayout = fs.readFileSync('apps/web/src/app/(dashboard)/layout.tsx', 'utf8');
const dashboardSession = fs.readFileSync('apps/web/src/lib/dashboard-session.ts', 'utf8');
const login = fs.readFileSync('apps/web/src/app/(auth)/login/page-client.tsx', 'utf8');
const api = fs.readFileSync('apps/web/src/lib/api.ts', 'utf8');
const authReturnTo = fs.readFileSync('apps/web/src/lib/auth-return-to.ts', 'utf8');
const reviewContract = fs.readFileSync('apps/web/src/lib/browser-one-click-review.ts', 'utf8');
const sourcePage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');

const parserResult = spawnSync(process.execPath, [
  'apps/server/node_modules/tsx/dist/cli.mjs',
  'apps/web/scripts/browser-one-click-review-contract.ts',
], { encoding: 'utf8' });
assert.equal(parserResult.status, 0, `${parserResult.stdout}\n${parserResult.stderr}`);
assert.match(parserResult.stdout, /PASS Web browser one-click review parser contract/u);

assert.match(page, /useSearchParams\(\)[\s\S]*searchParams\.get\('jobId'\)/u);
assert.match(page, /<Suspense[\s\S]*<ListingLogsContent\s*\/>[\s\S]*<\/Suspense>/u);
assert.match(page, /normalizeListingLogJobId[\s\S]*initialJobId=\{initialJobId\}/u);
assert.match(page, /useState<'all' \| 'follow' \| 'clone'>\('all'\)[\s\S]*modeFilter=\{modeFilter\}/u);
assert.match(list, /useEffect\(\(\)\s*=>\s*\{\s*setDetailId\(normalizeListingLogJobId\(initialJobId\)\)/u);
assert.match(
  list,
  /parseBrowserOneClickReviewHandoff\(payload\.browserOneClickPublishHandoff\)/u,
);
assert.match(list, /rows\.filter\(needsRemoteRefresh\)/u);
assert.match(list, /reviewRequired[\s\S]*待审核/u);
assert.match(list, /reviewFailed[\s\S]*审核交接失败/u);
assert.match(list, /reviewInvalid[\s\S]*审核交接异常/u);
assert.match(list, /isBrowserOneClickReviewInvalid[\s\S]*stage === 'review_required'/u);

assert.match(authReturnTo, /LISTING_JOB_ID_MAX_LENGTH\s*=\s*200/u);
assert.ok(authReturnTo.includes('/^[A-Za-z0-9_-]+$/u.test(normalized)'));
assert.match(authReturnTo, /value === EXTENSION_PUBLISH_RETURN_TO/u);
assert.match(authReturnTo, /target\.pathname !== LISTING_LOGS_PATH/u);
assert.match(authReturnTo, /target\.searchParams\.size !== 1/u);
assert.match(authReturnTo, /target\.searchParams\.getAll\('jobId'\)\.length !== 1/u);
assert.match(authReturnTo, /return value === canonical \? canonical : ''/u);
assert.match(dashboardLayout, /loadDashboardSession\(\{ signal: controller\.signal \}\)/u);
assert.match(dashboardSession, /api\.get<AuthUser>\('\/api\/user\/me', options\)/u);
assert.match(api, /encodeURIComponent\(returnTo\)/u);
assert.doesNotMatch(dashboardLayout, /useSearchParams/u);
assert.match(login, /normalizeLoginReturnTo\(searchParams\.get\('returnTo'\)\)/u);
assert.match(login, /router\.push\(returnTo \|\| '\/orders'\)/u);
assert.match(api, /normalizeLoginReturnTo\(`\$\{path\}\$\{window\.location\.search\}`\)/u);

assert.match(reviewContract, /browser-one-click-v2-handoff\/v1/u);
assert.match(reviewContract, /candidate\.contractVersion\s*!==\s*BROWSER_ONE_CLICK_V2_HANDOFF_VERSION/u);
assert.match(reviewContract, /candidate\.state\s*!==\s*'REVIEW_REQUIRED'/u);
assert.match(reviewContract, /candidate\.drafts\.length === 0[\s\S]*BROWSER_ONE_CLICK_MAX_ITEMS/u);
assert.match(reviewContract, /for \(const raw of candidate\.drafts\)[\s\S]*if \(!draft\) return null/u);
assert.match(reviewContract, /supplyGoodsIds\.has\(supplyGoodsId\)[\s\S]*draftIds\.has\(draftId\)/u);
assert.match(reviewContract, /SOURCE_LISTING_HANDOFF_ID_MAX_LENGTH\s*=\s*200/u);
assert.match(reviewContract, /function hasAsciiControl[\s\S]*charCodeAt\(index\)[\s\S]*code <= 31 \|\| code === 127/u);
assert.match(
  reviewContract,
  /const supplyGoodsId = exactId\(draft\.supplyGoodsId\)[\s\S]*const snapshotId = exactId\(draft\.snapshotId\)[\s\S]*const draftId = exactId\(draft\.draftId\)/u,
);
assert.match(reviewContract, /new URLSearchParams\(\)/u);
assert.match(reviewContract, /query\.set\('supplyGoodsId', supplyGoodsId\)/u);
assert.match(reviewContract, /query\.set\('snapshotId', snapshotId\)/u);
assert.match(reviewContract, /query\.set\('workflowId', draftId\)/u);
assert.match(reviewContract, /query\.set\('section', 'listing'\)/u);
assert.match(detail, /reviewHandoff\.drafts\.map/u);
assert.match(detail, /reviewHandoff\.failures\.map/u);
assert.match(detail, /const draftHref\s*=\s*browserOneClickReviewDraftHref\(draft\)[\s\S]*draftHref\s*\?\s*\([\s\S]*<Link[\s\S]*href=\{draftHref\}[\s\S]*target="_blank"/u);
assert.doesNotMatch(detail, /href=\{browserOneClickReviewDraftHref\(draft\)\}/u);
assert.match(detail, /encodeURIComponent\(jobId\)/u);
assert.match(detail, /loadRequestVersion[\s\S]*finally[\s\S]*setLoading\(false\)/u);
assert.match(detail, /loadError \|\| '任务详情加载失败'[\s\S]*重试/u);
assert.match(
  detail,
  /function isBrowserOneClickPreHandoffStage[\s\S]*stage === 'preparing_browser_data' \|\| stage === 'collecting'/u,
);
assert.match(
  detail,
  /browserOneClickNeedsErpPolling[\s\S]*data\.status === 'RUNNING'[\s\S]*isBrowserOneClickPreHandoffStage\(payloadRecord\?\.stage\)[\s\S]*!hasOzonTaskId[\s\S]*!reviewHandoff/u,
);
assert.match(
  detail,
  /if \(!browserOneClickNeedsErpPolling\) return;[\s\S]*load\(true\)[\s\S]*window\.setTimeout\(\(\) => void poll\(\), 15000\)/u,
);
assert.match(detail, /const canRefreshOzon = !browserOneClickSource \|\| hasOzonTaskId/u);
assert.match(detail, /shouldAutoRefresh = !!data && canRefreshOzon/u);
assert.match(detail, /canManualRefresh = !!data && canRefreshOzon/u);
assert.match(detail, /draft\.draftVersion != null && <span>版本 \{draft\.draftVersion\}<\/span>/u);
assert.match(detail, /draft\.revision != null && <span>修订 \{draft\.revision\}<\/span>/u);
assert.match(reviewContract, /parseBrowserOneClickReviewFailure[\s\S]*candidate\.missingSkus[\s\S]*candidate\.unknownSkus[\s\S]*candidate\.duplicateSkus/u);
assert.match(detail, /reviewFailureMarked[\s\S]*stage === 'review_handoff_failed'/u);
assert.match(detail, /审核交接失败[\s\S]*任务已停止且不会发布/u);
assert.match(detail, /缺失 SKU[\s\S]*任务外 SKU[\s\S]*重复 SKU[\s\S]*采集 \/ 草稿诊断/u);
assert.match(detail, /交接诊断数据格式异常/u);
assert.match(detail, /reviewHandoffInvalid[\s\S]*审核交接异常[\s\S]*不会查询 Ozon 状态/u);
assert.match(detail, /!reviewHandoff && !reviewFailureMarked && !reviewHandoffInvalid/u);
assert.doesNotMatch(detail, /reviewHandoff\.rollout|handoff\.rollout/u);
assert.match(sourcePage, /requested:\s*true[\s\S]*parseSourceListingHandoff\(query\)/u);
assert.match(sourcePage, /if \(!handoffState\.requested\) loadItems\(\)[\s\S]*\[handoffState\.requested\]/u);
assert.match(
  sourcePage,
  /if \(handoffState\.requested\) \{[\s\S]*<SourceListingWorkbench handoff=\{handoffState\.handoff\}[\s\S]*\}\s*return \([\s\S]*1688商品采集/u,
);

console.log('PASS Web browser one-click review handoff contract');
