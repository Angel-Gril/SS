import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSuitePrimaryAction } from '../extensions/ss-erp/pages/donor/suite-primary-action.js';
const ready = { draftId:'draft-1', busy:false, billing:{state:'ready',listingWorkflowId:'draft-1',quote:null,suite:null}, lock:null };
test('a confirmed frozen plan with a delayed readback reads the existing plan instead of creating again',()=>{
  assert.equal(resolveSuitePrimaryAction({...ready,lock:{status:'frozen'}}).action,'READ');
});
test('while a plan is submitting the primary button cannot submit again',()=>{
  assert.equal(resolveSuitePrimaryAction({...ready,lock:{status:'submitting'}}).disabled,true);
});
test('a missing, loading or failed quote reads state before offering a mutation',()=>{
  for(const state of ['idle','loading','error'])assert.equal(resolveSuitePrimaryAction({...ready,billing:{...ready.billing,state}}).action,'READ');
  assert.equal(resolveSuitePrimaryAction({...ready,billing:{...ready.billing,listingWorkflowId:'other'}}).action,'READ');
});
test('the primary action follows prepare, confirm, continue and review without changing frozen input',()=>{
  assert.equal(resolveSuitePrimaryAction(ready).action,'PREPARE');
  const quote={previewHash:'a'.repeat(64)};
  assert.equal(resolveSuitePrimaryAction({...ready,billing:{...ready.billing,quote}}).action,'START');
  assert.equal(resolveSuitePrimaryAction({...ready,billing:{...ready.billing,quote,suite:{status:'RUNNING'}}}).action,'CONTINUE');
  assert.equal(resolveSuitePrimaryAction({...ready,billing:{...ready.billing,quote,suite:{status:'SUCCEEDED'}}}).action,'REVIEW');
});
test('no draft and busy workflows cannot trigger images',()=>{
  assert.equal(resolveSuitePrimaryAction({...ready,draftId:''}).disabled,true);
  assert.equal(resolveSuitePrimaryAction({...ready,busy:true}).disabled,true);
});
