import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync('apps/web/src/app/(dashboard)/page.tsx', 'utf8');

test('authenticated dashboard exposes the first-party extension download page', () => {
  assert.match(dashboard, /\bDownload\b[\s\S]*from 'lucide-react'/u);
  assert.match(
    dashboard,
    /<Link\s+href="\/download">[\s\S]*?<Download\b[\s\S]*?下载浏览器扩展[\s\S]*?<\/Link>/u,
  );
});
