import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const globals = { URL, console };
vm.runInNewContext(fs.readFileSync('extensions/ss-erp/shared/donor-workbench/workspace-contract.js', 'utf8'), globals);
const contract = globals.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const request = { contractVersion: contract.CONTRACT_VERSION, type: 'CHECK_TRANSLATION', requestId: 'status-1', listingWorkflowId: 'draft-1' };

test('translation availability is a read command scoped to one selected listing draft', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(contract.parseFrameCommand(request))), request);
});
test('availability requests cannot smuggle execution, Provider or ownership fields', () => {
  for (const extra of [{ action: 'START' }, { sourceMediaKey: 'image-1' }, { apiKey: 'sentinel' }, { ownerUserId: 'other' }]) {
    assert.throws(() => contract.parseFrameCommand({ ...request, ...extra }));
  }
  assert.throws(() => contract.parseFrameCommand({ ...request, listingWorkflowId: '' }));
});
