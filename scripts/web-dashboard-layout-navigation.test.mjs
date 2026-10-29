import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync('apps/web/src/app/(dashboard)/layout.tsx', 'utf8');

// Navigating between dashboard pages must not invalidate the authenticated
// layout session. The pathname is still used by the permission guard below;
// it must not be part of the identity request key.
assert.match(layout, /const sessionRequest = useMemo\(\(\) => \(\{ attempt: sessionAttempt \}\), \[sessionAttempt\]\);/u);
assert.doesNotMatch(layout, /const sessionRequest = useMemo\(\(\) => \(\{ pathname, attempt: sessionAttempt \}\), \[pathname, sessionAttempt\]\);/u);
assert.match(layout, /loadDashboardSession\(\{ signal: controller\.signal \}\)/u);

console.log('PASS dashboard navigation keeps the authenticated layout session');
