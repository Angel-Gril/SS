import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Real Chromium DOM and the actual editor/flow controllers; only the private
// runtime's registration/settings/media boundary is a local synthetic fixture.
const editorSource = await readFile('extensions/ss-erp/pages/donor/byok-editor.js', 'utf8');
const confirmationSource = await readFile('extensions/ss-erp/pages/donor/inline-confirmation.js', 'utf8');
const flowSource = await readFile('extensions/ss-erp/shared/donor-workbench/precision-byok-flow.js', 'utf8');
const editFlowSource = await readFile('extensions/ss-erp/shared/donor-workbench/precision-byok-edit-flow.js', 'utf8');
const editorUrl = 'data:text/javascript;base64,' + Buffer.from(editorSource.replace("'./inline-confirmation.js'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(confirmationSource).toString('base64')))).toString('base64');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await check()) return; await pause(20); }
  throw new Error('Timed out: ' + label);
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.index = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const reply = JSON.parse(String(event.data)), pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.error) pending.reject(new Error(reply.error.message)); else pending.resolve(reply.result || {});
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.index;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    // REPL mode returns an async IIFE as {} before it settles in Chromium;
    // normal evaluation must await fixture installation and every async result.
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result?.value;
  }
  run(statements) { return this.evaluate('(async () => { ' + statements + ' })()'); }
  async click(id) {
    const { x, y } = await this.evaluate(`(() => { const node = document.getElementById(${JSON.stringify(id)}); node.scrollIntoView({block:'center'}); const rect=node.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
  }
}

async function browser(t) {
  const executable = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe')].filter(Boolean).find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-byok-registration-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let cdp;
  t.after(async () => {
    // 被启动的 chrome.exe 只是启动器，真正的浏览器进程由它拉起后启动器即以 0 退出：
    // 只结束 child 结束不了浏览器，必须经调试连接让浏览器自己退出。
    await cdp?.send('Browser.close').catch(() => {});
    cdp?.socket.close();
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) {
      let stopTimer;
      child.kill();
      await Promise.race([exited, new Promise(resolve => { stopTimer = setTimeout(resolve, 2000); })]);
      clearTimeout(stopTimer);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  let port;
  await until(async () => { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return Boolean(port); } catch { return false; } }, 'isolated Chromium launch');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new Cdp(socket);
  return cdp;
}

async function fixture(cdp, mode = 'success') {
  const installed = await cdp.evaluate(`(async () => {
    document.body.replaceChildren();
    ${flowSource}
    ${editFlowSource}
    const {createByokEditor}=await import(${JSON.stringify(editorUrl)});
    const calls=[];
    const binding={sourcePlatform:'1688',sourceProductId:'fixture-product',sourceCaptureSnapshotId:'fixture-snapshot',supplyGoodsId:'fixture-source',shopId:'fixture-shop',workflowId:'fixture-workflow',draftRevision:1,draftVersion:1,skuKey:'fixture-sku'};
    const context={...binding,contractVersion:'extension-byok-workbench-launch-context/v1',slotKey:'sku:fixture-sku:hero',assignmentMode:'APPEND',assignmentOrdinal:0};
    const profile={id:'fixture-profile',name:'测试接口',baseUrl:'https://provider.ss-erp-fixture.invalid/v1',model:'fixture-image-model',allowedOperations:['TEXT_TO_IMAGE','IMAGE_TO_IMAGE','FULL_EDIT'],preferences:{defaultSize:'1024x1024',quality:'auto',outputFormat:'png'}};
    let first=true,resolveRegistration;
    const runtime={
      registerUi:async () => { calls.push('register');
        if (${JSON.stringify(mode)}==='deferred'&&first) { first=false; return new Promise(resolve=>{resolveRegistration=resolve;}); }
        if (${JSON.stringify(mode)}==='failure'&&first) {first=false; const error=new Error('fixture-secret-sentinel');error.code='SS_ERP_PRECISION_UI_REGISTRATION_FAILED';throw error;}
        if (${JSON.stringify(mode)}==='timeout') {const error=new Error('fixture-secret-sentinel');error.code='SS_ERP_PRECISION_UI_REGISTRATION_TIMEOUT';throw error;}
        return {registered:true,state:'MEDIA_READY'};
      },
      settings:{
        listProfiles:async()=>{calls.push('profiles');return {profiles:[profile]};},
        getProfileState:async()=>({profile,hasKey:true,evidence:[]}),
        getPermissionStatus:async()=>({granted:true}),
        invalidatePreparedPermissions:()=>{},
        saveProfile:async input=>{calls.push('save-profile');Object.assign(profile,input);return {profile,hasKey:true};},
        setSessionKey:async()=>{calls.push('set-key');return {profile,hasKey:true};},
        clearSessionKey:async()=>({profile,hasKey:false})
      },
      media:{
        getPublicState:async()=>{calls.push('media-state');return {contractVersion:'extension-byok-workbench-public-state/v1',executionMode:'BYOK',context,generationOutcome:null,result:window.fixtureCandidate||null};},
        getEditState:async()=>({contractVersion:'extension-byok-workbench-edit-controller/v1',alternatives:[]}),
        getSourceCatalog:async()=>({contractVersion:'extension-byok-workbench-source-catalog/v1',items:[{sourceMediaKey:'first',role:'product_main',label:'主图'},{sourceMediaKey:'second',role:'product_detail',label:'详情图'}]}),
        generate:async()=>{calls.push('provider');throw new Error('Unexpected Provider dispatch');},
        ingestApproved:async()=>{calls.push('ingest');throw new Error('Unexpected ingest');}
      }
    };
    const editor=createByokEditor({root:document.body,container:document.body,runtime:${JSON.stringify(mode)}==='missing'?null:runtime,getShopId:()=>binding.shopId,getBinding:()=>binding,openSession:async()=>{calls.push('launch');return {state:'workbench_embedded'};},onModeChange:()=>{}});
    editor.setMode('byok');window.fixtureCandidate=null;
    window.fixture={mode:${JSON.stringify(mode)},editor,calls,runtime,resolveRegistration:()=>resolveRegistration({registered:true,state:'MEDIA_READY'})};
    return ${JSON.stringify(mode)};
  })()`);
  assert.equal(installed, mode, 'the requested fixture finished installing before its assertions');
}

test('precision BYOK registration recovery and stable controls use real DOM', async t => {
  const cdp = await browser(t);
  await t.test('concurrent initialization shares registration; later initialization preserves controls', async () => {
    await fixture(cdp, 'deferred');
    await cdp.run('window.firstInitialization=fixture.editor.initialize();window.secondInitialization=fixture.editor.initialize();');
    assert.equal(await cdp.evaluate('fixture.calls.filter(call=>call==="register").length'), 1);
    assert.equal(await cdp.evaluate('fixture.editor.state().initializing'), true);
    assert.equal(await cdp.evaluate('fixture.editor.hasPendingMedia()'), false, 'read-only initialization must not refuse a precise ERP draft entry');
    await cdp.run('fixture.resolveRegistration();await Promise.all([firstInitialization,secondInitialization]);');
    assert.equal(await cdp.evaluate('fixture.editor.state().registered'), true);
    assert.equal(await cdp.evaluate('fixture.editor.initialize()'), true);
    assert.equal(await cdp.evaluate('fixture.calls.filter(call=>call==="register").length'), 1);
    assert.equal(await cdp.evaluate('fixture.calls.filter(call=>call==="profiles").length'), 1);
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-config").disabled'), false);
  });
  await t.test('failed early registration exposes safe error and trusted reconnect restores settings', async () => {
    await fixture(cdp, 'failure');
    assert.equal(await cdp.evaluate('fixture.editor.initialize()'), false);
    const before = await cdp.evaluate('({text:document.getElementById("precision-byok-state").textContent,button:document.getElementById("precision-byok-reconnect")?.textContent,disabled:document.getElementById("precision-byok-reconnect")?.disabled,config:document.getElementById("precision-byok-config").disabled})');
    assert.match(before.text, /注册|授权|连接失败/u);
    assert.doesNotMatch(before.text, /fixture-secret-sentinel/u);
    assert.equal(before.button, '重新连接扩展');assert.equal(before.disabled, false);assert.equal(before.config, true);
    await cdp.run('fixture.editor.render();fixture.editor.setMode("byok");document.getElementById("precision-byok-reconnect").click();');
    assert.equal(await cdp.evaluate('fixture.calls.filter(call=>call==="register").length'), 1, 'render and synthetic events never retry registration');
    await cdp.click('precision-byok-reconnect');
    await until(() => cdp.evaluate('fixture.editor.state().registered'), 'trusted reconnect');
    assert.equal(await cdp.evaluate('fixture.calls.filter(call=>call==="register").length'), 2);
    await cdp.click('precision-byok-config');
    await until(() => cdp.evaluate('!document.getElementById("precision-byok-config-modal").hidden'), 'recovered same-window settings');
    assert.equal(await cdp.evaluate('fixture.calls.includes("provider")||fixture.calls.includes("ingest")'), false);
  });
  await t.test('registration timeout is recoverable and no unregistered media controls dispatch', async () => {
    await fixture(cdp, 'timeout');
    const result = await cdp.evaluate('(async()=>({mode:fixture.mode,result:await fixture.editor.initialize(),calls:fixture.calls.slice(),state:fixture.editor.state()}))()');
    assert.equal(result.result, false, JSON.stringify(result));
    assert.match(await cdp.evaluate('document.getElementById("precision-byok-state").textContent'), /超时/u);
    for (const id of ['precision-byok-generation-submit','precision-byok-generation-refresh','precision-byok-generation-ingest','precision-byok-edit-load','precision-byok-edit-start']) {
      assert.equal(await cdp.evaluate(`document.getElementById(${JSON.stringify(id)}).disabled`), true, id);
      await cdp.run(`document.getElementById(${JSON.stringify(id)}).click();`);
    }
    assert.equal(await cdp.evaluate('fixture.calls.includes("provider")||fixture.calls.includes("ingest")||fixture.calls.includes("media-state")'), false);
  });
  await t.test('missing SDK asks to reload instead of offering an ineffective reconnect', async () => {
    await fixture(cdp, 'missing');
    assert.equal(await cdp.evaluate('fixture.editor.initialize()'), false);
    assert.equal(await cdp.evaluate('fixture.editor.state().available'), false);
    assert.match(await cdp.evaluate('document.getElementById("precision-byok-state").textContent'), /重新加载/u);
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-reconnect").disabled'), true);
    assert.equal(await cdp.evaluate('fixture.calls.length'), 0);
  });
  await t.test('reentrant initialize retains an existing candidate and editable prompt', async () => {
    await fixture(cdp);
    await cdp.run('await fixture.editor.initialize();window.fixtureCandidate={resultId:"br_"+"a".repeat(48),reviewState:"CANDIDATE_READY",deliveryState:"NOT_INGESTED"};await fixture.editor.readMediaState();document.getElementById("precision-byok-generation-prompt").value="保留已编辑方向";window.beforeCalls=fixture.calls.length;');
    assert.equal(await cdp.evaluate('fixture.editor.initialize()'), true);
    assert.equal(await cdp.evaluate('fixture.calls.length'), await cdp.evaluate('beforeCalls'));
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-generation-prompt").value'), '保留已编辑方向');
    assert.match(await cdp.evaluate('document.getElementById("precision-byok-generation-meta").textContent'), /CANDIDATE_READY/u);
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-generation-show-preview").disabled'), false);
    assert.equal(await cdp.evaluate('fixture.editor.hasPendingMedia()'), true, 'an unbound candidate must prevent losing its original context');
  });
  await t.test('state renders retain selected source and its actual DOM nodes', async () => {
    await fixture(cdp);
    await cdp.run('await fixture.editor.initialize();');
    await cdp.click('precision-byok-edit-load');
    await until(() => cdp.evaluate('document.getElementById("precision-byok-edit-source").options.length===2'), 'edit source catalog');
    await cdp.run('document.getElementById("precision-byok-edit-source").value="second";window.sourceOption=document.getElementById("precision-byok-edit-source").options[1];window.referenceInput=document.querySelector("#precision-byok-edit-sources input");fixture.editor.render();');
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-edit-source").value'), 'second');
    assert.equal(await cdp.evaluate('document.getElementById("precision-byok-edit-source").options[1]===sourceOption'), true);
    assert.equal(await cdp.evaluate('document.querySelector("#precision-byok-edit-sources input")===referenceInput'), true);
  });
});
