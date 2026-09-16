import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('the ERP source launcher message is allowed only from the ERP content bridge',()=>{
  const context=vm.createContext({URL,Set});vm.runInContext(readFileSync('extensions/ss-erp/shared/message-security/runtime-message-policy.js','utf8'),context);
  const policy=context.SS_ERP_RUNTIME_MESSAGE_POLICY;
  const sender=url=>({id:'runtime-id',frameId:0,documentId:'document',url,origin:new URL(url).origin,tab:{id:9,url}});
  const type='ss-erp:erp-source-image-open';
  assert.equal(policy.isKnownRuntimeMessageType(type),true);
  assert.equal(policy.isAllowedRuntimeMessageSender(type,sender('https://app.ss-erp.com/collect/source'),'runtime-id'),true);
  for(const url of ['https://detail.1688.com/offer/1.html','https://foreign.example/','chrome-extension://runtime-id/pages/settings.html','chrome-extension://runtime-id/pages/ai-image-workbench.html']){
    assert.equal(policy.isAllowedRuntimeMessageSender(type,sender(url),'runtime-id'),false,url);
  }
});

test('the injected ERP bridge verifies its current document without accepting a page-supplied authority',()=>{
  const listeners=[],forwarded=[];
  const window={location:new URL('https://app.ss-erp.com/collect/source'),addEventListener(){},postMessage(){}};
  const context=vm.createContext({
    window,URL,document:{documentElement:{setAttribute(){}}},
    SS_ERP_DEPLOYMENT_DEFAULTS:{erpBaseUrl:'https://app.ss-erp.com',erpAdminBaseUrl:'https://admin.ss-erp.com'},
    chrome:{runtime:{id:'runtime-id',onMessage:{addListener(fn){listeners.push(fn);}},sendMessage(message,done){forwarded.push(message);done({ok:true});}}},
  });
  vm.runInContext(readFileSync('extensions/ss-erp/content/erp-collect-bridge.js','utf8'),context);
  let response;
  for(const listener of listeners)listener({type:'ss-erp:erp-source-launch-current'},{id:'runtime-id'},value=>response=value);
  assert.deepEqual(JSON.parse(JSON.stringify(response)),{ok:true,origin:'https://app.ss-erp.com'});
  response=undefined;
  for(const listener of listeners)listener({type:'ss-erp:erp-source-launch-current'},{id:'foreign-runtime'},value=>response=value);
  assert.equal(response,undefined);assert.equal(forwarded.length,0);
});
