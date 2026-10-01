import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(60);
  }
  throw new Error(`Timed out: ${label}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params, message.sessionId);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}


const SOURCE_URL='https://detail.1688.com/offer/845581683597.html';
const ROOT=process.cwd();
async function run(){
  const targets=await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const existing=targets.find(target=>target.type==='page'&&target.url.startsWith(SOURCE_URL));
  const version=await (await fetch('http://127.0.0.1:9222/json/version')).json();
  const cdp=await Cdp.connect(version.webSocketDebuggerUrl);
  let targetId=existing?.id;
  if(!targetId)targetId=(await cdp.send('Target.createTarget',{url:SOURCE_URL})).targetId;
  const sessionId=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await cdp.send('Page.enable',{},sessionId);
  await until(async()=>{
    try {
      const response=await cdp.send('Runtime.evaluate',{expression:'location.href.startsWith("'+SOURCE_URL+'") && Boolean(document.querySelector(".title-text")||document.querySelector("h1"))',returnByValue:true},sessionId);
      return response.result?.value===true;
    } catch { return false; }
  },'source document load',25000);
  const world=(await cdp.send('Page.createIsolatedWorld',{frameId:(await cdp.send('Page.getFrameTree',{},sessionId)).frameTree.frame.id,worldName:'SS ERP readonly donor collector'},sessionId)).executionContextId;
  const evaluate=async(expression)=>{
    const response=await cdp.send('Runtime.evaluate',{expression,contextId:world,awaitPromise:true,returnByValue:true},sessionId);
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
    return response.result.value;
  };
  await until(()=>evaluate('Boolean(document.querySelector(".title-text")||document.querySelector("h1"))'),'source product title',20000);
  for(const relative of ['shared/collectors/source-product-core.js','shared/contracts/source-product-capture-v2.js','content/donor/adapter-1688.js','shared/collectors/donor-1688-capture.js']){
    await evaluate(await readFile(path.join(ROOT,'extensions/ss-erp',relative),'utf8'));
  }
  const result=await evaluate(`(async()=>{
    const started=performance.now();
    const product=await SS_ERP_DONOR_1688_CAPTURE.collect({url:location.href,extensionVersion:'readonly-development'});
    return {sourceUrl:product.sourceUrl,sourceProductId:product.productId,
      skuCount:product.captureV2.skus.length,mediaCount:product.captureV2.media.filter(item=>item.kind==='image').length,
      zeroStockCount:product.captureV2.skus.filter(item=>item.stock===0).length,unknownStockCount:product.captureV2.skus.filter(item=>item.stock===null).length,
      durationMs:Math.round(performance.now()-started),collector:product.captureV2.collector.name};
  })()`);
  assert.equal(result.sourceProductId,'845581683597');
  assert.ok(result.skuCount>=2&&result.mediaCount>=1,'real source capture must contain variants and media');
  const output=await mkdtemp(path.join(os.tmpdir(),'ss-erp-donor-live-readonly-'));
  const summary={ok:true,scope:'LIVE_SOURCE_READONLY_ISOLATED_WORLD',...result,providerRequests:0,erpMutations:0,ozonRequests:0,artifact: path.join(output,'summary.json')};
  await writeFile(summary.artifact,JSON.stringify(summary,null,2));
  await cdp.send('Target.detachFromTarget',{sessionId});
  cdp.socket.close();
  console.log(JSON.stringify(summary,null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;setTimeout(()=>process.exit(1),1000)});
