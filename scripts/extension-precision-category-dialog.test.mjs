import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sourcePath = 'extensions/ss-erp/pages/donor/category-dialog.js';
const dialogStyles = await readFile('extensions/ss-erp/pages/donor/ui/panel.css', 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await check()) return; await pause(15); }
  throw new Error('Timeout: ' + label);
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.counter = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const reply = JSON.parse(String(event.data)), pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.error) pending.reject(new Error(reply.error.message)); else pending.resolve(reply.result);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async run(statements) {
    const result = await this.send('Runtime.evaluate', { expression: '(async()=>{' + statements + '})()', awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
}

async function browser(t) {
  const executable = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe')].filter(Boolean).find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-category-dialog-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let cdp;
  t.after(async () => {
    // 被启动的 chrome.exe 只是启动器，真正的浏览器进程由它拉起后启动器即以 0 退出：
    // 只结束 child 结束不了浏览器，必须经调试连接让浏览器自己退出。
    await cdp?.send('Browser.close').catch(() => {});
    cdp?.socket.close();
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await Promise.race([exited, pause(2000)]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  let port;
  await until(async () => { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return !!port; } catch { return false; } }, 'Chromium launch');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new Cdp(socket); return cdp;
}

async function install(cdp) {
  const source = await readFile(sourcePath, 'utf8');
  const adaptedStyles = await readFile('extensions/ss-erp/pages/donor/category-dialog.css', 'utf8');
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  await cdp.run(`
    document.body.replaceChildren();
    const {createCategoryDialog}=await import(${JSON.stringify(moduleUrl)});
    document.head.replaceChildren();const style=document.createElement('style');style.textContent=${JSON.stringify(dialogStyles)}+${JSON.stringify(adaptedStyles)};document.head.append(style);
    const root=document.createElement('div');root.className='settings-modal';document.body.append(root);
    const binding={snapshotId:'snapshot',supplyGoodsId:'source',shopId:'shop',listingWorkflowId:'draft',draftRevision:1,draftVersion:1};
    const shirt={categoryId:20,typeId:201,label:'服装 / 上衣 / 双面德绒打底衫',typeLabel:'双面德绒打底衫',path:[{categoryId:10,label:'服装'},{categoryId:20,label:'上衣'}]};
    const dress={categoryId:20,typeId:202,label:'服装 / 上衣 / 连衣裙',typeLabel:'连衣裙',path:shirt.path};
    const hanger={categoryId:30,typeId:301,label:'家居 / 衣架',typeLabel:'衣架',path:[{categoryId:30,label:'家居'}]};
    const catalog={catalogRevision:'catalog-v1',entries:[shirt,dress,hanger],truncated:false,total:3,
      recommendations:[{...shirt,match:'recommended',reasons:['来源类目：女式T恤','命中：德绒打底衫']},{...dress,match:'optional',reasons:['商品词：上衣']},{categoryId:99,typeId:991,label:'伪造推荐',reasons:['不在官方目录']}],
      tree:[{categoryId:10,label:'服装',types:[],children:[{categoryId:20,label:'上衣',children:[],types:[shirt,dress]}]},{categoryId:30,label:'家居',children:[],types:[hanger]}]};
    const calls=[],errors=[]; const deferred=[];
    let catalogLoader=async(_binding,query)=>{calls.push(['catalog',query]);return catalog;};
    let previewLoader=async(_binding,selection)=>{calls.push(['preview',selection]);return {fields:[{attributeId:7,name:'俄罗斯尺码',valueType:'string',required:true},{attributeId:8,name:'颜色',valueType:'dictionary',required:false}]};};
    let afterSave=()=>{};
    const dialog=createCategoryDialog({root,getBinding:()=>binding,getProduct:()=>({title:'女式德绒打底衫'}),
      loadCatalog:(...args)=>catalogLoader(...args),loadAttributePreview:async(b,s)=>({...s,...await previewLoader(b,s)}),
      saveSelection:async(...args)=>{calls.push(['save',...args]);afterSave();return {saved:true};},onError:error=>errors.push(error)});
    window.fixture={root,binding,shirt,dress,hanger,catalog,calls,errors,deferred,dialog,
      setCatalogLoader:fn=>{catalogLoader=fn;},setPreviewLoader:fn=>{previewLoader=fn;},
      setAfterSave:fn=>{afterSave=fn;},
      input:query=>{const input=root.querySelector('[data-category-search]');input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));},
      click:selector=>{const node=root.querySelector(selector);if(!node)throw new Error('Missing '+selector);node.click();}};
  `);
}

test('precision category dialog preserves donor tree, recommendation and preview interaction', async t => {
  assert.ok(existsSync(sourcePath), 'a category tree dialog must replace the native select');
  const cdp = await browser(t);
  await t.test('official hierarchy and recommendations replace a native dropdown without invented scores', async () => {
    await install(cdp); await cdp.run('await fixture.dialog.open();');
    assert.equal(await cdp.run('return fixture.root.querySelectorAll("select").length;'), 0);
    assert.equal(await cdp.run('return fixture.root.querySelectorAll(".category-auto-card").length;'), 2);
    assert.equal(await cdp.run('return fixture.root.textContent.includes("98%");'), false);
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), true);
    assert.equal(await cdp.run('return getComputedStyle(fixture.root.querySelector(".category-dialog")).display;'), 'flex');
    assert.equal(await cdp.run('const r=fixture.root.querySelector(".category-dialog").getBoundingClientRect();return r.height<=innerHeight*.89;'), true);
    await cdp.run('fixture.root.querySelector("details").open=true;await new Promise(r=>setTimeout(r,30));fixture.root.querySelector("details details").open=true;await new Promise(r=>setTimeout(r,30));');
    assert.equal(await cdp.run('return fixture.root.querySelectorAll("[data-category-leaf]").length;'), 2);
    assert.equal(await cdp.run('return fixture.calls.filter(c=>c[0]==="save").length;'), 0);
  });
  await t.test('explicit official leaf waits for attribute preview then saves only the exact owner selection', async () => {
    await install(cdp); await cdp.run('fixture.setPreviewLoader((_b,s)=>new Promise(resolve=>fixture.deferred.push({s,resolve})));await fixture.dialog.open();fixture.click(".category-auto-card");');
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), true);
    await cdp.run('fixture.deferred[0].resolve({attributes:[{attributeId:7,name:"俄罗斯尺码",type:"string",required:true}]});await new Promise(r=>setTimeout(r,20));');
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), false);
    assert.match(await cdp.run('return fixture.root.querySelector("[data-category-attributes]").textContent;'), /必填.*俄罗斯尺码/u);
    await cdp.run('fixture.click("[data-category-confirm]");await new Promise(r=>setTimeout(r,20));');
    assert.deepEqual(await cdp.run('return fixture.calls.find(c=>c[0]==="save")[2];'), {categoryId:20,typeId:201,catalogRevision:'catalog-v1'});
    assert.equal(await cdp.run('return fixture.dialog.state().open;'), false);
  });
  await t.test('search response superseded by a new query cannot restore old results', async () => {
    await install(cdp); await cdp.run('await fixture.dialog.open();fixture.setCatalogLoader((_b,query)=>new Promise(resolve=>fixture.deferred.push({query,resolve})));fixture.input("衣服");');
    await until(()=>cdp.run('return fixture.deferred.length===1;'), 'first search');
    await cdp.run('fixture.input("打底衫");');
    await until(()=>cdp.run('return fixture.deferred.length===2;'), 'second search');
    await cdp.run('fixture.deferred[1].resolve({...fixture.catalog,tree:[],entries:[fixture.shirt],recommendations:[],total:1});await new Promise(r=>setTimeout(r,20));fixture.deferred[0].resolve({...fixture.catalog,tree:[],entries:[fixture.hanger],recommendations:[],total:1});await new Promise(r=>setTimeout(r,20));');
    assert.match(await cdp.run('return fixture.root.querySelector("[data-category-tree]").textContent;'), /打底衫/u);
    assert.doesNotMatch(await cdp.run('return fixture.root.querySelector("[data-category-tree]").textContent;'), /衣架/u);
  });
  await t.test('closing and reopening fences late catalog responses', async () => {
    await install(cdp); await cdp.run('fixture.setCatalogLoader(()=>new Promise(resolve=>fixture.deferred.push({resolve})));window.oldOpen=fixture.dialog.open();fixture.dialog.close();window.newOpen=fixture.dialog.open();fixture.deferred[1].resolve(fixture.catalog);await newOpen;fixture.deferred[0].resolve({...fixture.catalog,catalogRevision:"old"});await oldOpen;');
    assert.equal(await cdp.run('return fixture.dialog.state().catalogRevision;'), 'catalog-v1');
    assert.equal(await cdp.run('return fixture.dialog.state().open;'), true);
  });
  await t.test('shop or draft changes invalidate pending previews and every saved selection', async () => {
    await install(cdp); await cdp.run('fixture.setPreviewLoader(()=>new Promise(resolve=>fixture.deferred.push({resolve})));await fixture.dialog.open();fixture.click(".category-auto-card");fixture.binding.draftRevision++;fixture.dialog.syncBinding();fixture.deferred[0].resolve({attributes:[{attributeId:7,name:"迟到属性",required:true}]});await new Promise(r=>setTimeout(r,20));');
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), true);
    assert.equal(await cdp.run('return fixture.dialog.state().selected;'), null);
    assert.doesNotMatch(await cdp.run('return fixture.root.textContent;'), /迟到属性/u);
    await cdp.run('fixture.click("[data-category-confirm]");');
    assert.equal(await cdp.run('return fixture.calls.filter(c=>c[0]==="save").length;'), 0);
  });
  await t.test('selecting another leaf rejects a stale attribute preview', async () => {
    await install(cdp); await cdp.run('fixture.setPreviewLoader((_b,s)=>new Promise(resolve=>fixture.deferred.push({s,resolve})));await fixture.dialog.open();fixture.root.querySelectorAll(".category-auto-card")[0].click();fixture.root.querySelectorAll(".category-auto-card")[1].click();fixture.deferred[1].resolve({attributes:[{attributeId:2,name:"连衣裙材质",required:true}]});await new Promise(r=>setTimeout(r,20));fixture.deferred[0].resolve({attributes:[{attributeId:1,name:"旧上衣属性",required:true}]});await new Promise(r=>setTimeout(r,20));');
    assert.match(await cdp.run('return fixture.root.querySelector("[data-category-attributes]").textContent;'), /连衣裙材质/u);
    assert.doesNotMatch(await cdp.run('return fixture.root.querySelector("[data-category-attributes]").textContent;'), /旧上衣属性/u);
    assert.equal(await cdp.run('return fixture.dialog.state().selected.typeId;'), 202);
  });
  await t.test('attribute preview failure blocks confirmation without exposing raw transport errors', async () => {
    await install(cdp); await cdp.run('fixture.setPreviewLoader(async()=>{throw new Error("secret-fixture-sentinel");});await fixture.dialog.open();fixture.click(".category-auto-card");await new Promise(r=>setTimeout(r,20));');
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), true);
    assert.doesNotMatch(await cdp.run('return fixture.root.textContent;'), /secret-fixture-sentinel/u);
    assert.equal(await cdp.run('return fixture.errors.length;'), 1);
  });
  await t.test('the owner save increments the draft revision and still closes the completed dialog', async () => {
    await install(cdp); await cdp.run('fixture.setAfterSave(()=>{fixture.binding.draftRevision++;fixture.dialog.syncBinding();});await fixture.dialog.open();fixture.click(".category-auto-card");await new Promise(r=>setTimeout(r,20));fixture.click("[data-category-confirm]");await new Promise(r=>setTimeout(r,20));');
    assert.equal(await cdp.run('return fixture.calls.filter(c=>c[0]==="save").length;'), 1);
    assert.equal(await cdp.run('return fixture.dialog.state().open;'), false);
  });
  await t.test('a mismatched preview cannot enable saving a different official category', async () => {
    await install(cdp); await cdp.run('fixture.setPreviewLoader(async()=>({categoryId:30,typeId:301,catalogRevision:"catalog-v1",fields:[]}));await fixture.dialog.open();fixture.click(".category-auto-card");await new Promise(r=>setTimeout(r,20));');
    assert.equal(await cdp.run('return fixture.root.querySelector("[data-category-confirm]").disabled;'), true);
    assert.equal(await cdp.run('return fixture.calls.filter(c=>c[0]==="save").length;'), 0);
  });
});
