import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

async function fixture(responses = {}) {
  const calls = [];
  const runtime = { lastError: null, sendMessage(message, callback) {
    calls.push(structuredClone(message));
    callback(Object.hasOwn(responses, message.type) ? responses[message.type] : { ok: true, data: {} });
  } };
  const context = { URL, console, setTimeout, clearTimeout, BroadcastChannel: class {}, globalThis: null };
  context.globalThis = context;
  for (const file of ['profile-schema.js', 'provider-settings-client.js', 'workbench-client.js', 'product-analysis-page-client.js']) {
    vm.runInNewContext(readFileSync('extensions/ss-erp/shared/byok/' + file, 'utf8'), context);
  }
  const source = readFileSync('extensions/ss-erp/pages/donor/precision-private-runtime.js', 'utf8');
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const permissions = { request(input, callback) { calls.push({permissionRequest:structuredClone(input)});callback(true); } };
  const adapter = module.createPrecisionPrivateRuntime({ runtime, globals: context, permissions });
  return { adapter, calls };
}

test('settings require actual iframe registration and media requires actual MEDIA_READY', async () => {
  const f = await fixture({
    'ss-erp:precision-frame-ui-register': { ok: true, data: { state: 'UI_REGISTERED', registered: true } },
    'ss-erp:byok-provider-profiles-list': { ok: true, data: { profiles: [] } },
  });
  await assert.rejects(f.adapter.settings.listProfiles(), /REGISTRATION_REQUIRED/);
  assert.equal(f.calls.length, 0);
  await f.adapter.registerUi();
  assert.equal((await f.adapter.settings.listProfiles()).profiles.length, 0);
  await assert.rejects(f.adapter.media.getPublicState(), /MEDIA_SESSION_REQUIRED/);
  assert.equal(f.calls.some(call => call.type === 'ss-erp:ai-image-workbench-state'), false);
});

test('analysis origin permission requires a prepared current ticket and trusted click, with Chrome request before async commit', async () => {
  const input = {binding:{},profileId:'profile-1',skuKey:'sku-1',analysisModel:'qwen-vl-plus'};
  const prepared = {permissionTicket:'permission-ticket-1',pattern:'https://provider.example/*',providerOrigin:'https://provider.example',expiresAt:Date.now()+30000};
  const f=await fixture({
    'ss-erp:precision-frame-ui-register':{ok:true,data:{state:'UI_REGISTERED',registered:true}},
    'ss-erp:product-analysis-permission-prepare':{ok:true,data:prepared},
    'ss-erp:product-analysis-permission-commit':{ok:true,data:{granted:true}},
  });
  await f.adapter.registerUi();
  let ticket=await f.adapter.prepareProductAnalysisPermission(input);
  assert.throws(()=>f.adapter.authorizeProductAnalysis({isTrusted:false},ticket),/GESTURE/);
  ticket=await f.adapter.prepareProductAnalysisPermission(input);
  const beforeClick=f.calls.length;
  const resultPromise=f.adapter.authorizeProductAnalysis({isTrusted:true},ticket);
  assert.equal(f.calls[beforeClick].permissionRequest.origins[0],prepared.pattern);
  const result=await resultPromise;assert.equal(result.granted,true);
  assert.equal(f.calls.at(-1).type,'ss-erp:product-analysis-permission-commit');
  assert.deepEqual(f.calls.at(-1).payload,{...input,permissionTicket:prepared.permissionTicket});
  assert.throws(()=>f.adapter.authorizeProductAnalysis({isTrusted:true},ticket),/TICKET/);
  ticket=await f.adapter.prepareProductAnalysisPermission(input);
  assert.throws(()=>f.adapter.authorizeProductAnalysis({isTrusted:true},{...ticket,pattern:'https://*/*'}),/TICKET/);
  f.adapter.invalidate();
});

test('product analysis and checkpoint stay inside registered private runtime without requiring image MEDIA_READY', async () => {
  const checkpoint = { version: 1, context: { mode: 'BYOK' } };
  const f = await fixture({
    'ss-erp:precision-frame-ui-register': { ok: true, data: { state: 'UI_REGISTERED', registered: true } },
    'ss-erp:product-analysis-analyze': { ok: true, data: { analysisInput: {}, analysis: { report: { reviewState: 'CANDIDATE' } } } },
    'ss-erp:product-analysis-read': { ok: true, data: { status: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false } },
    'ss-erp:preparation-checkpoint-read': { ok: true, data: checkpoint },
  });
  await assert.rejects(f.adapter.analyzeProduct({}), /REGISTRATION_REQUIRED/);
  assert.equal(f.calls.length, 0);
  await f.adapter.registerUi();
  assert.equal((await f.adapter.analyzeProduct({})).analysis.report.reviewState, 'CANDIDATE');
  assert.equal((await f.adapter.readProductAnalysis({})).status, 'UNKNOWN_OUTCOME');
  assert.deepEqual(await f.adapter.checkpoint.read({ binding: {} }), checkpoint);
  f.adapter.invalidate();
  await assert.rejects(f.adapter.checkpoint.clear({ binding: {} }), /REGISTRATION_REQUIRED/);
});

test('a key goes only through private runtime and response secrets are refused', async () => {
  const f = await fixture({
    'ss-erp:precision-frame-ui-register': { ok: true, data: { state: 'MEDIA_READY', registered: true } },
    'ss-erp:byok-provider-session-key-set': { ok: true, data: { hasKey: true } },
    'ss-erp:byok-provider-profile-state': { ok: true, data: { apiKey: 'fixture-secret' } },
  });
  await f.adapter.registerUi();
  const state = await f.adapter.settings.setSessionKey('profile-fixture', 'fixture-secret');
  assert.equal(state.hasKey, true);
  assert.equal(f.calls.at(-1).type, 'ss-erp:byok-provider-session-key-set');
  assert.equal(f.calls.at(-1).payload.apiKey, 'fixture-secret');
  await assert.rejects(f.adapter.settings.getProfileState('profile-fixture'), /PRIVATE_RESPONSE_INVALID/);
  assert.equal(f.adapter.state().mediaReady, true);
});
