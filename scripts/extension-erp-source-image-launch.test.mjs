import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL, console });
vm.runInContext(readFileSync(new URL('../extensions/ss-erp/shared/erp-adapter/erp-source-image-launch.js', import.meta.url), 'utf8'), context);
const api = context.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH;
const workerSource = readFileSync(new URL('../extensions/ss-erp/background/service-worker.js', import.meta.url), 'utf8');
const sender = { id: 'runtime-id', frameId: 0, documentId: 'erp-document', origin: 'https://app.ss-erp.com', url: 'https://app.ss-erp.com/collect/source', tab: { id: 9, url: 'https://app.ss-erp.com/collect/source' } };
const message = { type: 'ss-erp:erp-source-image-open', launchToken: 'a'.repeat(43), requestId: 'bridge-request' };
const request = { sourcePlatform:'1688',sourceProductId:'fixed-qa-cup',sourceCaptureSnapshotId:'snapshot-a',supplyGoodsId:'goods-a',shopId:'shop-a',workflowId:'draft-a',draftRevision:7,draftVersion:3,preferredSkuKey:'__ss_erp_product_only__',selectionKind:'EXPLICIT' };
function fixture() {
  const calls=[];
  const device={state:'paired',ownerUserId:'owner-a',sessionId:'device-a',endpoint:'https://ss-erp.com',scopes:['listing:review','media:execute']};
  const data={contractVersion:'extension-erp-source-launch/v1',provenance:'ERP_SOURCE',ownerUserId:'owner-a',deviceSessionId:'device-a',apiOrigin:'https://ss-erp.com',mode:'WORKBENCH',sourceMediaKeys:[],launchRequest:structuredClone(request),grantSha256:'b'.repeat(64)};
  const launch={contractVersion:'extension-byok-workbench-launch-context/v1',...request,skuKey:'__ss_erp_product_only__',slotKey:'sku:__ss_erp_product_only__:hero',assignmentMode:'APPEND',assignmentOrdinal:0};
  delete launch.preferredSkuKey;delete launch.selectionKind;
  const options={runtimeId:'runtime-id',apiOrigin:'https://ss-erp.com',erpOrigins:['https://app.ss-erp.com','https://admin.ss-erp.com'],
    readDevice:async()=>structuredClone(device),isSenderCurrent:async()=>true,
    consumeGrant:async token=>{calls.push(['consume',token]);return structuredClone(data);},
    resolveWorkbench:async value=>{calls.push(['resolve',value]);return {state:'READY',context:structuredClone(launch)};},
    openWorkbench:async value=>{calls.push(['workbench',value]);return {state:'workbench_opened',tabId:17};},
    openEditor:async value=>{calls.push(['editor',value]);return {state:'editor_opened',tabId:18,nonce:'c'.repeat(64)};},
  };
  return {options,calls,device,data,launch,run:()=>api.createLauncher(options).open(message,sender)};
}
test('a server-issued ERP_SOURCE grant opens a normal workbench session without BYOK profiles or keys',async()=>{
  const f=fixture();const result=await f.run();
  assert.equal(result.state,'workbench_opened');assert.equal(result.provenance,'ERP_SOURCE');
  const opened=f.calls.find(([name])=>name==='workbench')[1];
  assert.equal(opened.sourceTabId,9);assert.equal(opened.sourceDocumentId,'erp-document');
  assert.equal(opened.erpSourceAuthority.provenance,'ERP_SOURCE');assert.equal(opened.erpSourceAuthority.grantSha256,'b'.repeat(64));
  assert.equal(opened.context.workflowId,'draft-a');assert.equal(JSON.stringify(result).includes(message.launchToken),false);
  assert.deepEqual(f.calls.map(([name])=>name),['consume','resolve','workbench']);
});
test('the configured API origin is an approved ERP sender for the hosted draft page', async () => {
  assert.match(workerSource, /defaults\.erpApiBaseUrl/);
  const f = fixture();
  f.options.erpOrigins.push('https://ss-erp.com');
  const result = await f.options.openWorkbench;
  const apiSender = {
    ...sender,
    origin: 'https://ss-erp.com',
    url: 'https://ss-erp.com/collect/source?workflowId=draft-a',
    tab: { id: 9, url: 'https://ss-erp.com/collect/source?workflowId=draft-a' },
  };
  const opened = await api.createLauncher(f.options).open(message, apiSender);
  assert.equal(opened.state, 'workbench_opened');
  assert.equal(typeof result, 'function');
});
test('foreign sites, other official subdomains, frames and forged sender identity fail before consumption',async()=>{
  for(const patch of [
    {url:'https://evil.example/collect/source',origin:'https://evil.example',tab:{id:9,url:'https://evil.example/collect/source'}},
    {url:'https://unpackaged.ss-erp.com/collect/source',origin:'https://unpackaged.ss-erp.com',tab:{id:9,url:'https://unpackaged.ss-erp.com/collect/source'}},
    {id:'another-extension'},{frameId:1},{documentId:''},{tab:{id:9,url:'https://app.ss-erp.cn/collect/source'}},
  ]){
    const f=fixture();await assert.rejects(api.createLauncher(f.options).open(message,{...sender,...patch}));assert.equal(f.calls.length,0);
  }
});
test('owner/role/context/URL injection in the page message is rejected',async()=>{
  for(const patch of [{ownerUserId:'owner-b'},{role:'ADMIN'},{mode:'BYOK'},{context:request},{url:'https://evil.example'}]){
    const f=fixture();await assert.rejects(api.createLauncher(f.options).open({...message,...patch},sender));assert.equal(f.calls.length,0);
  }
});
test('the consumed grant must match the live paired owner, session and packaged API region',async()=>{
  for(const patch of [{ownerUserId:'owner-b'},{deviceSessionId:'device-b'},{apiOrigin:'https://ss-erp.cn'},{provenance:'native_v2'},{mode:'BYOK'}]){
    const f=fixture();Object.assign(f.data,patch);await assert.rejects(f.run());assert.equal(f.calls.some(([name])=>name==='workbench'||name==='editor'),false);
  }
});
test('a revoked grant or changed device cannot open a tab',async()=>{
  const f=fixture();f.options.consumeGrant=async()=>{throw Error('private dependency detail');};
  await assert.rejects(f.run(),error=>!error.message.includes('private dependency detail'));
  const changed=fixture();let reads=0;changed.options.readDevice=async()=>++reads===1?changed.device:{...changed.device,sessionId:'device-b'};
  await assert.rejects(changed.run());assert.equal(changed.calls.some(([name])=>name==='workbench'),false);
});
test('a navigated ERP document and a stale server launch decision are refused',async()=>{
  const f=fixture();f.options.isSenderCurrent=async()=>false;await assert.rejects(f.run());assert.equal(f.calls.length,0);
  const stale=fixture();stale.launch.draftRevision++;await assert.rejects(stale.run());assert.equal(stale.calls.some(([name])=>name==='workbench'),false);
});
test('INPAINT opens the existing editor with only the server-authorized source selection',async()=>{
  const f=fixture();f.data.mode='INPAINT';f.data.sourceMediaKeys=['white-cup'];f.data.target={skuKey:null,slotKey:'product-main'};
  const result=await f.run();assert.equal(result.state,'editor_opened');assert.equal(Object.hasOwn(result,'nonce'),false);
  const editor=f.calls.find(([name])=>name==='editor')[1];
  assert.equal(editor.grant.mode,'INPAINT');assert.deepEqual(JSON.parse(JSON.stringify(editor.grant.sourceMediaKeys)),['white-cup']);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.grant.target)),{skuKey:null,slotKey:'product-main'});
  assert.equal(editor.erpSourceAuthority.provenance,'ERP_SOURCE');assert.equal(f.calls.some(([name])=>name==='resolve'),false);
});
test('the existing editor coordinator state-only result is a successful open',async()=>{
  const f=fixture();f.data.mode='FULL_EDIT';f.data.sourceMediaKeys=['white-cup'];f.data.target={skuKey:null,slotKey:'product-main'};f.options.openEditor=async()=>({state:'editor_opened'});
  assert.equal((await f.run()).state,'editor_opened');
});
test('missing pairing, missing scopes and unconfigured origins fail closed without grant consumption',async()=>{
  for(const mutate of [f=>{f.device.state='unpaired';},f=>{f.device.scopes=['listing:review'];},f=>{f.options.erpOrigins=[];}]){
    const f=fixture();mutate(f);await assert.rejects(async()=>f.run());assert.equal(f.calls.length,0);
  }
});

test('ERP_SOURCE launch consumes its one-time grant through the real device transport', async () => {
  const transportContext = vm.createContext({
    URL, AbortController, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    Blob, FormData, setTimeout, clearTimeout,
  });
  vm.runInContext(readFileSync(new URL('../extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js', import.meta.url), 'utf8'), transportContext);
  const consumePath = '/api/extension-device/erp-launch-grants/consume';
  for (const mode of ['WORKBENCH', 'IMAGE_TO_IMAGE', 'INPAINT']) {
    const f = fixture(), requests = [];
    f.data.mode = mode;
    f.data.sourceMediaKeys = mode === 'WORKBENCH' ? [] : ['white-cup'];
    if (mode !== 'WORKBENCH') f.data.target = { skuKey: null, slotKey: 'product-main' };
    const transport = transportContext.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
      credentials: {
        async beginOperation() {
          return { state: 'paired', epoch: 0, baseUrl: 'https://ss-erp.com',
            deploymentId: 'deployment-a', deviceId: 'device-a', ownerUserId: 'owner-a',
            sessionId: 'device-a', scopes: ['listing:review', 'media:execute'],
            accessToken: 'synthetic-device-token', expiresAt: '2030-01-01T00:00:00.000Z' };
        },
        async isOperationCurrent() { return true; },
        async clearIfCurrent() { return true; },
      },
      async fetchImpl(url, init) {
        requests.push({ url, init });
        return { status: 200, ok: true, headers: { get() { return null; } }, body: null,
          async text() { return JSON.stringify({ code: 1, data: f.data }); } };
      },
    });
    f.options.consumeGrant = async launchToken => {
      const result = await transport.post(consumePath, { launchToken }, { requiredScope: 'media:execute' });
      assert.equal(result.state, 'response');
      return result.body.data;
    };
    const opened = await f.run();
    assert.equal(opened.state, mode === 'WORKBENCH' ? 'workbench_opened' : 'editor_opened');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://ss-erp.com' + consumePath);
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.credentials, 'omit');
    assert.equal(requests[0].init.redirect, 'error');
    assert.deepEqual(JSON.parse(requests[0].init.body), { launchToken: message.launchToken });
    for (const rejected of [consumePath + '/', consumePath + '?again=1', consumePath + '#fragment',
      '/api/extension-device/erp-launch-grants/issue', 'https://ss-erp.com' + consumePath]) {
      await assert.rejects(transport.post(rejected, { launchToken: message.launchToken }), /source workbench path is invalid/u);
    }
    await assert.rejects(transport.get(consumePath), /source workbench path is invalid/u);
    assert.equal(requests.length, 1, 'rejected path variants must not reach the network');
  }
});

test('an ERP editor grant cannot omit or disguise its target as caller authority', async () => {
  for (const target of [undefined, { skuKey: null, slotKey: '' },
    { skuKey: null, slotKey: 'product-main', ownerUserId: 'owner-b' }]) {
    const f = fixture(); f.data.mode = 'IMAGE_TO_IMAGE'; f.data.sourceMediaKeys = ['white-cup'];
    if (target !== undefined) f.data.target = target;
    await assert.rejects(f.run());
    assert.equal(f.calls.some(([name]) => name === 'editor'), false);
  }
});
