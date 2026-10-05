import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const image = new Uint8Array([255,216,255,224,1,2,3,4]);
const digest = createHash('sha256').update(image).digest('hex');
const input={binding:{snapshotId:'snapshot',supplyGoodsId:'goods',shopId:'shop',listingWorkflowId:'draft',draftRevision:1,draftVersion:1},
  skuKey:'sku',categoryRevision:{catalogRevision:'catalog',schemaRevision:'a'.repeat(64)},
  providerContext:{providerOrigin:'https://model.example.com',model:'vision-model',policyRevision:3}};
function load(transform = value => value, timeoutMs = 15000) {
  const env={TextEncoder,URL,Blob,Uint8Array,crypto:webcrypto,setTimeout,clearTimeout};
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/preparation-image-client.js','utf8'),env);
  let called;
  const client=env.SS_ERP_PREPARATION_IMAGE_CLIENT.createClient({transport:{postRaw:async(path,body)=>{
    called={path,body};const headers={'content-type':'image/jpeg','content-length':String(image.length),
      'x-ss-erp-media-sha256':digest,'x-ss-erp-media-width':'2','x-ss-erp-media-height':'2'};
    return {state:'raw_response',response:transform(new Response(image,{headers}))};
  }},crypto:webcrypto,timeoutMs,inspector:{inspectImageBlob:async()=>({width:2,height:2,mimeType:'image/jpeg'})}});
  return {client,call:()=>called};
}
test('analysis uses its dedicated image owner without hosted media-launch or raw marketplace URL',async()=>{
  const h=load();const result=await h.client.readForBackground(input,'source-image','THUMBNAIL');
  assert.equal(result.sha256,digest);assert.equal(result.byteLength,image.length);
  assert.equal(h.call().path,'/api/extension-device/source-workbench/preparation/image');
  assert.deepEqual(JSON.parse(JSON.stringify(h.call().body)),{...input,sourceMediaKeys:['source-image']});
});

test('a stalled source stream is canceled within the fixed reading deadline', async () => {
  let canceled = false;
  const h = load(response => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: response.headers }), 10);
  await assert.rejects(h.client.readForBackground(input, 'source-image', 'THUMBNAIL'));
  assert.equal(canceled, true);
});
test('bounded source reader rejects oversized bytes, false hash and mismatched dimensions',async()=>{
  for(const overrides of [{'content-length':String(1024*1024+1)}, {'x-ss-erp-media-sha256':'b'.repeat(64)}, {'x-ss-erp-media-width':'3'}]) {
    const h=load(response=>{Object.entries(overrides).forEach(([key,value])=>response.headers.set(key,value));return response;});
    await assert.rejects(h.client.readForBackground(input,'source-image','THUMBNAIL'));
  }
});
test('the real device transport immutable binary snapshot is accepted without requiring a native response stream', async () => {
  const h = load(response => ({ ok: true, status: 200, headers: response.headers,
    arrayBuffer: async () => image.slice().buffer }));
  assert.equal((await h.client.readForBackground(input, 'source-image', 'THUMBNAIL')).sha256, digest);
});
