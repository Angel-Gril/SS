import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
async function cdp(port) {
  const response=await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(5000)});
  const info=await response.json(),socket=new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  let sequence=0;const pending=new Map(),listeners=new Set();
  socket.addEventListener('message',event=>{
    const reply=JSON.parse(String(event.data)),task=pending.get(reply.id);
    if(!task){for(const fn of listeners)fn(reply);return;}
    pending.delete(reply.id);clearTimeout(task.timer);
    reply.error?task.reject(Error('CDP_'+task.method)):task.resolve(reply.result);
  });
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT_'+method))},30000);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  const attach=async targetId=>(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  const evaluate=async(session,expression)=>{
    const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);
    if(reply.exceptionDetails)throw Error('BROWSER_EVALUATION_FAILED');return reply.result?.value;
  };
  return{send,attach,evaluate,on(fn){listeners.add(fn);return()=>listeners.delete(fn)},close(){socket.close()}};
}
// Explicit local browser regression: synthetic responses, no logged-in profile or external writes.
// CHROME_PATH may select the existing Chrome binary on another operating system.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-ozon-regression-'));
const profile = path.join(root, 'profile');
const child = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--window-size=1440,1000', 'about:blank'],
{ windowsHide: true, detached: true, stdio: 'ignore' }); child.unref();
const until = async (fn, label) => { const end = Date.now() + 20000; while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 100)); } throw Error(label); };
await until(() => fs.existsSync(path.join(profile, 'DevToolsActivePort')), 'owned Chrome ready');
const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
assert.notEqual(port, 9222); const c = await cdp(port); const errors = [], network = [];
const card = n => `<article data-index="${n}" style="width:330px;min-height:400px;border:1px solid #ddd;padding:10px"><a href="https://www.ozon.ru/product/test-${123456789+n}/"><span>商品测试 ${n}</span></a><div data-widget="webPrice">1 200 ₽</div></article>`;
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:20px;font-family:Arial"><h1>Ozon 商品列表交互回归（隔离数据）</h1><div id="layoutPage" style="display:flex;gap:20px">'+card(0)+card(1)+'</div></body></html>';
let session;
const off = c.on(event => {
  if(event.method === 'Fetch.requestPaused') {
    const { requestId, request } = event.params; network.push(request.url);
    const body = request.url.startsWith('https://www.ozon.ru/') ? html : '';
    void c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{name:'Content-Type',value:'text/html; charset=utf-8'}], body:Buffer.from(body).toString('base64') }, event.sessionId);
  }
  if(event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
});
try {
  const target = await c.send('Target.createTarget', {url:'about:blank'}); session = await c.attach(target.targetId);
  await c.send('Page.enable', {}, session); await c.send('Runtime.enable', {}, session);
  await c.send('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false }, session);
  await c.send('Fetch.enable', {patterns:[{urlPattern:'*',requestStage:'Request'}]}, session);
  await c.send('Page.navigate', {url:'https://www.ozon.ru/category/fixture/'}, session);
  await until(() => c.evaluate(session, 'document.readyState==="complete"'), 'fixture page ready');
  const runtimeBootstrap = `(()=>{window.__messages=[];window.__pendingCollect=null;window.chrome={runtime:{id:'fixture',lastError:null,getManifest:()=>({version:'1.0.458'}),getURL:p=>'https://extension-fixture.invalid/'+p,onMessage:{addListener(){}},sendMessage(message,callback){window.__messages.push(message);if(message.type==='spb-self-hosted:fetch-ozon-product-to-erp'){window.__pendingCollect=callback;return}const item={soldCount:296,soldSum:54000,price:1200,priceCurrency:'RUB',weightGrams:350};const data=message.type==='spb-self-hosted:list-product-selection-rules'?{rules:[]}:{};queueMicrotask(()=>callback({ok:true,data,item,sources:['public-entrypoint']}))}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};return true})()`;
  await c.evaluate(session, runtimeBootstrap);
  const general = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json')).content_scripts.find(g=>g.js?.includes('content/ozon-injector.js'));
  for(const filename of general.js) await c.evaluate(session, fs.readFileSync('extensions/ss-erp/'+filename,'utf8'));
  await c.evaluate(session, '(()=>{const s=document.createElement("style");s.textContent='+JSON.stringify(fs.readFileSync('extensions/ss-erp/content/ozon-panel.css','utf8'))+';document.head.append(s);return true})()');
  await c.evaluate(session, fs.readFileSync('extensions/ss-erp/shared/currency/price-currency.js','utf8'));
  await c.evaluate(session, fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js','utf8'));
  await until(() => c.evaluate(session, 'document.querySelectorAll(".ss-erp-overlay-card").length===2&&document.querySelector(".ss-erp-metrics")?.innerText.includes("296")'), 'two rendered source cards');
  const click = async selector => {
    const point = await c.evaluate(session, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await c.send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1},session);
    await c.send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1},session);
  };
  assert.equal(await c.evaluate(session, '__messages.filter(m=>m.type.includes("fetch-ozon-product-to-erp")).length'),0);
  await click('.ss-erp-expand-btn');
  await until(()=>c.evaluate(session,'[...document.querySelectorAll(".ss-erp-expanded")].some(e=>e.style.display==="block"&&e.innerText.includes("296"))'),'physical expand opens');
  fs.writeFileSync(path.join(root,'list-expanded.png'),Buffer.from((await c.send('Page.captureScreenshot',{format:'png'},session)).data,'base64'),{flag:'wx'});
  await click('.ss-erp-expand-btn');
  assert.equal(await c.evaluate(session,'[...document.querySelectorAll(".ss-erp-expanded")].every(e=>e.style.display==="none")'),true);
  await click('#ss-erp-list-quick-actions [data-role="quick-profit"]');
  assert.equal(await c.evaluate(session,'document.getElementById("ozon-calc-drawer").classList.contains("open")'),true);
  await until(()=>c.evaluate(session,'document.querySelector("[data-action=compute]")!==null'),'calculator computes available');
  await click('#ozon-calc-drawer [data-action="compute"]');
  await c.evaluate(session,'chrome.storage.local.get=()=>{throw new Error("Extension context invalidated.")}');
  await click('#ozon-calc-drawer .ozon-calc-refresh');
  await until(()=>c.evaluate(session,'document.getElementById("ozon-calc-drawer").innerText.includes("扩展已更新，请刷新")'),'old-context refresh guidance');
  await c.evaluate(session,'chrome.storage.local.get=async()=>({})');
  await click('#ozon-calc-drawer .ozon-calc-close');
  await click('[data-role="collect-follow"]'); await click('[data-role="collect-follow"]');
  assert.equal(await c.evaluate(session,'__messages.filter(m=>m.type==="spb-self-hosted:fetch-ozon-product-to-erp").length'),1);
  await c.evaluate(session,'__pendingCollect({ok:true,data:{collected:1,pushed:{code:1,data:{saved:1}},errors:[]}})');
  await until(()=>c.evaluate(session,'document.querySelector("[data-role=collect-follow]").textContent.includes("已采集")'),'saved acknowledgement');
  await c.evaluate(session, 'document.getElementById("layoutPage").insertAdjacentHTML("beforeend",'+JSON.stringify(card(2))+')');
  await until(()=>c.evaluate(session,'document.querySelectorAll(".ss-erp-overlay-card").length===3'),'dynamic observer still active');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'list-final.png'),Buffer.from((await c.send('Page.captureScreenshot',{format:'png'},session)).data,'base64'),{flag:'wx'});
  await c.send('Page.navigate',{url:'https://www.ozon.ru/product/fixture-123456789/'},session);
  await until(()=>c.evaluate(session,'location.pathname.includes("/product/")&&document.readyState==="complete"'),'detail fixture ready');
  await c.evaluate(session,runtimeBootstrap);
  for(const filename of general.js) await c.evaluate(session,fs.readFileSync('extensions/ss-erp/'+filename,'utf8'));
  const detail=JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json')).content_scripts.find(g=>g.js?.includes('content/collect-content-script.js'));
  for(const filename of detail.js) await c.evaluate(session,fs.readFileSync('extensions/ss-erp/'+filename,'utf8'));
  await until(()=>c.evaluate(session,'document.querySelector("#ss-erp-ozon-quick-actions [data-role=quick-collect]")!==null'),'detail capture entry');
  assert.equal(await c.evaluate(session,'__messages.filter(m=>m.type==="spb-self-hosted:fetch-ozon-product-to-erp").length'),0);
  await click('#ss-erp-ozon-quick-actions [data-role="quick-collect"]');
  await click('#ss-erp-ozon-quick-actions [data-role="quick-collect"]');
  assert.equal(await c.evaluate(session,'__messages.filter(m=>m.type==="spb-self-hosted:fetch-ozon-product-to-erp").length'),1);
  await c.evaluate(session,'__pendingCollect({ok:true,data:{collected:1,pushed:{code:1,data:{saved:1,errors:[]}},errors:[]}})');
  await until(()=>c.evaluate(session,'document.querySelector("#ss-erp-ozon-quick-actions [data-role=quick-status]").textContent.includes("已采集 1")'),'detail saved acknowledgement');
  await c.evaluate(session,'history.pushState(null,"","/product/fixture-987654321/")');
  await until(()=>c.evaluate(session,'document.getElementById("ss-erp-ozon-quick-actions").dataset.productId==="987654321"'),'detail SPA new product');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'detail-final.png'),Buffer.from((await c.send('Page.captureScreenshot',{format:'png'},session)).data,'base64'),{flag:'wx'});
  const report={status:'PASS',at:new Date().toISOString(),scope:'REAL_ISOLATED_CHROME_WITH_SYNTHETIC_RUNTIME_AND_NETWORK',
    physicalExpandCollapse:true,listQuickProfit:true,calculatorCompute:true,oldContextCaught:true,explicitCaptureSingleFlight:true,dynamicNewCard:true,
    detailCapture:true,detailSpaProductIdentity:true,
    errors,providerRequests:0,ozonWrites:0,productionWrites:0,root,ownedBrowserPort:port};
  fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(report,null,2),{flag:'wx'}); console.log(JSON.stringify(report));
} catch(error) {
  console.error(JSON.stringify({error:error.message,root,errors,state:session?await c.evaluate(session,'({url:location.href,cards:document.querySelectorAll(".ss-erp-overlay-card").length,text:document.body.innerText.slice(-1600),messages:__messages?.map(m=>m.type)})').catch(()=>null):null}));
  throw error;
} finally { off(); await c.send('Browser.close').catch(()=>{});c.close(); }


