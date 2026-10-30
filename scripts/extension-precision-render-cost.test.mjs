import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture() {
  const source=readFileSync('extensions/ss-erp/pages/precision-workbench.js','utf8');
  const start=source.indexOf('function renderSourceDiagnostics() {');
  assert.ok(start>=0,'workbench must separate source diagnostics from ordinary rendering');
  const end=source.indexOf('\nfunction ',start+1);
  const modal={hidden:true},output={textContent:''};let conversions=0;
  const context={sourceDiagnosticsProjection:null,projection:{source:{title:'first'}},
    element:id=>id==='process-modal'?modal:output,
    Workflow:{toDonorData(value){conversions++;return{title:value.source.title};}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return{modal,output,context,render:()=>context.renderSourceDiagnostics(),conversions:()=>conversions};
}
test('closed process diagnostics do not convert or serialize source data during UI updates',()=>{
  const f=fixture();for(let i=0;i<20;i++)f.render();
  assert.equal(f.conversions(),0);assert.equal(f.output.textContent,'');
});
test('visible source diagnostics reuse the current projection and refresh on source changes',()=>{
  const f=fixture();f.modal.hidden=false;f.render();
  for(let i=0;i<20;i++)f.render();
  assert.equal(f.conversions(),1);assert.deepEqual(JSON.parse(f.output.textContent),{title:'first'});
  f.modal.hidden=true;f.context.projection={source:{title:'second'}};f.render();
  assert.equal(f.conversions(),1);
  f.modal.hidden=false;f.render();
  assert.equal(f.conversions(),2);assert.deepEqual(JSON.parse(f.output.textContent),{title:'second'});
});
