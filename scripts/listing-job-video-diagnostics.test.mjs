import assert from 'node:assert/strict';
import fs from 'node:fs';

const detailDialog = fs.readFileSync('apps/web/src/components/listing-job-detail-dialog.tsx', 'utf8');
const jobList = fs.readFileSync('apps/web/src/components/listing-job-list.tsx', 'utf8');

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

console.log('PASS listing job video diagnostics UI');
