import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

test('the actual device transport admits exact copy and vision routes with bounded analysis deadlines', async () => {
  const timers = [], requests = [];
  const context = { URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, AbortController,
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.push(delay); return timer; }, clearTimeout };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js', 'utf8'), context);
  const operation = { state: 'paired', baseUrl: 'https://ss-erp.com', accessToken: 'synthetic-device-token',
    scopes: ['listing:review', 'listing:write', 'media:execute'] };
  const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({ credentials: {
    beginOperation: async () => operation, isOperationCurrent: async () => true,
  }, fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ code: 1, data: {} }), { headers: { 'Content-Type': 'application/json' } }); } });
  for (const [path, scope] of [['editor/copy-capability', 'listing:review'], ['editor/copy-generate', 'listing:write'],
    ['vision/capability', 'listing:review'], ['vision/analyze', 'media:execute']]) {
    assert.equal((await transport.post('/api/extension-device/source-workbench/' + path, { binding: {} }, { requiredScope: scope })).state, 'response');
  }
  assert.equal(requests.length, 4);
  assert.deepEqual(timers, [10000, 210000, 10000, 210000]);
  await assert.rejects(transport.post('/api/extension-device/source-workbench/vision/execute-anything', {}, { requiredScope: 'media:execute' }));
  assert.equal(requests.length, 4);
});

test('the real device transport admits the independent preparation image with immutable bounded bytes', async () => {
  const context = { URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js', 'utf8'), context);
  const bytes = new Uint8Array([255,216,255,224,1,2,3,4]);
  const operation = { state:'paired',baseUrl:'https://ss-erp.com',accessToken:'synthetic-only',
    scopes:['listing:review','listing:write','media:execute'] };
  let request;
  const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({credentials:{
    beginOperation:async()=>operation,isOperationCurrent:async()=>true,
  },fetchImpl:async(url,init)=>{request={url,init};return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length)}});}});
  const result=await transport.postRaw('/api/extension-device/source-workbench/preparation/image',{binding:{}},
    {requiredScopes:['listing:review','listing:write','media:execute']});
  assert.equal(result.state,'raw_response');
  assert.deepEqual([...new Uint8Array(await result.response.arrayBuffer())],[...bytes]);
  assert.match(request.init.headers.Accept,/image\/jpeg/u);
});
