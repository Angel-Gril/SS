import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const modulePath = 'apps/web/src/lib/api.ts';
const source = fs.readFileSync(modulePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

async function run503(body) {
  const sandbox = {
    exports: {},
    module: { exports: {} },
    process: { env: {} },
    fetch: async () => ({ status: 503, json: async () => body }),
    Headers,
    URL,
    window: undefined,
  };
  vm.runInNewContext(compiled, sandbox, { filename: modulePath });
  const apiModule = Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.exports;
  return apiModule.apiFetch('/api/test');
}

assert.deepEqual(JSON.parse(JSON.stringify(await run503({ code: 'PROVIDER_NOT_READY', msg: 'provider gate' }))), {
  code: 'PROVIDER_NOT_READY',
  msg: 'provider gate',
});
assert.deepEqual(JSON.parse(JSON.stringify(await run503({ maintenance: true, msg: 'maintenance window' }))), {
  code: 0,
  msg: 'maintenance window',
  maintenance: true,
});

console.log('PASS web API 503 business-code preservation contract');
