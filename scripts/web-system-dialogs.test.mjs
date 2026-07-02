import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['apps/web/src/app', 'apps/web/src/components'];
const allowedFiles = new Set([
  path.normalize('apps/web/src/components/system-dialog-provider.tsx'),
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

const offenders = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const normalized = path.normalize(file);
    if (allowedFiles.has(normalized)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/\bwindow\.(confirm|alert|prompt)\s*\(|(?<![\w.])(?:confirm|alert|prompt)\s*\(/.test(text)) {
      offenders.push(file);
    }
  }
}

assert.deepEqual(
  offenders,
  [],
  `front-end UI should use the ERP system dialog provider instead of native browser dialogs: ${offenders.join(', ')}`,
);

const provider = fs.readFileSync('apps/web/src/components/providers.tsx', 'utf8');
assert.match(provider, /SystemDialogProvider/, 'root providers should install the system dialog provider');

console.log('PASS web system dialogs');
