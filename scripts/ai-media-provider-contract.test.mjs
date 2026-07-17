import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const script = path.join(root, 'scripts', 'sandbox', 'ai-media-provider-contract.mjs');
const output = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
assert.match(output, /PASS AI media provider foundation contract/);
console.log('PASS AI media provider contract test');
