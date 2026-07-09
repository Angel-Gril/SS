import assert from 'node:assert/strict';
import fs from 'node:fs';

const detailDialog = fs.readFileSync('apps/web/src/components/listing-job-detail-dialog.tsx', 'utf8');
const jobList = fs.readFileSync('apps/web/src/components/listing-job-list.tsx', 'utf8');

function extractBlock(source, pattern, name) {
  const match = source.match(pattern);
  assert.ok(match, `${name} should exist`);
  return match[0];
}

assert.match(
  jobList,
  /videoTrace\?:\s*Array/,
  'listing job payload type should include videoTrace diagnostics',
);
assert.match(
  detailDialog,
  /视频上架诊断/,
  'listing job detail dialog should show video publish diagnostics',
);
assert.match(
  detailDialog,
  /videoPublishStatusLabel/,
  'listing job detail dialog should summarize video publish status',
);
assert.match(
  detailDialog,
  /未自动上架/,
  'listing job detail dialog should explain skipped videos instead of hiding them',
);
assert.match(
  jobList,
  /manual_required/,
  'listing job payload type should distinguish manual-required videos from failed uploads',
);
assert.match(
  detailDialog,
  /manual_required/,
  'listing job detail dialog should render manual-required video status',
);
assert.match(
  detailDialog,
  /待手动处理/,
  'listing job detail dialog should not present manual-required videos as upload failures',
);
assert.match(
  detailDialog,
  /待更正/,
  'listing job detail dialog should label imported rows with blocking Ozon review errors as needing correction',
);
assert.match(
  detailDialog,
  /blockingError\s*\?\s*'待更正'/,
  'listing job detail dialog should compute the visible import status from blocking Ozon errors',
);
const needsRemoteRefresh = extractBlock(jobList, /function needsRemoteRefresh[\s\S]*?\n}/, 'needsRemoteRefresh');
assert.match(
  needsRemoteRefresh,
  /row\.payload\?\.failedCount/,
  'listing job list should auto-refresh legacy SUCCESS rows that already carry failedCount',
);
const canManualRefresh = extractBlock(detailDialog, /const canManualRefresh[\s\S]*?\n  \);/, 'canManualRefresh');
assert.match(
  canManualRefresh,
  /data\.payload\?\.failedCount/,
  'listing job detail dialog should allow manual refresh for legacy SUCCESS rows with failedCount',
);

console.log('PASS listing job video diagnostics UI');
