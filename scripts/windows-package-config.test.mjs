import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readProjectFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

test('windows package config provides encryption key to the production server', () => {
  const buildScript = readProjectFile('build', 'scripts', 'build-windows.ps1');
  const startBat = readProjectFile('build', 'scripts', 'start.bat');
  const bootstrapConfig = readProjectFile('apps', 'server', 'src', 'bootstrap-config.ts');

  assert.match(buildScript, /\$encryptionKey\s*=/);
  assert.match(buildScript, /"encryptionKey": "\$encryptionKey"/);

  assert.match(startBat, /c\.encryptionKey/);
  assert.match(startBat, /set "ENCRYPTION_KEY=%%i"/);

  assert.match(bootstrapConfig, /cfg\.encryptionKey[\s\S]{0,160}process\.env\.ENCRYPTION_KEY/);
});

test('windows launcher can repair older packages that lack encryptionKey', () => {
  const startBat = readProjectFile('build', 'scripts', 'start.bat');

  assert.match(startBat, /crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(startBat, /fs\.writeFileSync\(p,\s*JSON\.stringify\(c,\s*null,\s*2\)/);

  const match = startBat.match(/-e "([^"]*c\.encryptionKey[^"]*)"`\) do set "ENCRYPTION_KEY=%%i"/);
  assert.ok(match, 'could not find ENCRYPTION_KEY launcher script');

  const tempDir = mkdtempSync(join(tmpdir(), 'ss-erp-start-'));
  writeFileSync(join(tempDir, 'config.json'), JSON.stringify({ webPort: 3400, serverPort: 3401 }), 'utf8');

  const result = spawnSync(process.execPath, ['-e', match[1]], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^[0-9a-f]{64}$/);

  const config = JSON.parse(readFileSync(join(tempDir, 'config.json'), 'utf8'));
  assert.equal(config.encryptionKey, result.stdout);
});
