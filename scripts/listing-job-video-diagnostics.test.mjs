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

console.log('PASS listing job video diagnostics UI');
