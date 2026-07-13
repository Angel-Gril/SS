import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const statePath = 'apps/web/src/components/logistics-rules/official-input-unit-contract-state.mjs';
const panelPath = 'apps/web/src/components/logistics-rules/official-input-unit-contract-panel.tsx';
const workspacePath = 'apps/web/src/components/logistics-rules/logistics-capture-workspace.tsx';

async function loadState() {
  assert.ok(fs.existsSync(statePath), `${statePath} must exist`);
  return import(`../${statePath}`);
}

test('unit verification starts blank and requires explicit attestation plus review evidence', async () => {
  const state = await loadState();

  assert.deepEqual(state.EMPTY_OFFICIAL_INPUT_UNIT_FORM, {
    weightIncrementG: '',
    dimensionIncrementMm: '',
    currencyMinorIncrement: '',
    unitAttested: false,
    reviewNote: '',
  });

  const complete = {
    assignmentId: 'assignment-1',
    candidateId: 'candidate-1',
    expectedCandidateChecksum: 'a'.repeat(64),
    expectedCurrentContractId: null,
    weightIncrementG: '0.1',
    dimensionIncrementMm: '0.25',
    currencyMinorIncrement: '10',
    unitAttested: true,
    reviewNote: '已对照 Official 请求与报价响应确认单位',
  };

  assert.equal(state.canVerifyOfficialInputUnitContract(complete), true);
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, weightIncrementG: '' }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, dimensionIncrementMm: '0' }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, weightIncrementG: 'Infinity' }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract(
      { ...complete, expectedCandidateChecksum: 'not-a-checksum' },
    ),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, currencyMinorIncrement: '1.5' }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, unitAttested: false }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, reviewNote: '短' }),
    false,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, reviewNote: 'a'.repeat(1000) }),
    true,
  );
  assert.equal(
    state.canVerifyOfficialInputUnitContract({ ...complete, reviewNote: 'a'.repeat(1001) }),
    false,
  );
});

test('verification payload is an exact server-owned evidence allowlist', async () => {
  const state = await loadState();
  const payload = state.buildOfficialInputUnitContractVerifyPayload({
    assignmentId: ' assignment-1 ',
    candidateId: ' candidate-1 ',
    expectedCandidateChecksum: ` ${'B'.repeat(64)} `,
    expectedCurrentContractId: ' contract-0 ',
    weightIncrementG: '0.1',
    dimensionIncrementMm: '0.25',
    currencyMinorIncrement: '10',
    unitAttested: true,
    reviewNote: '  已核对输入单位  ',
    scope: { forged: true },
    sourceChecksum: 'client-must-not-send',
    validUntil: 'client-must-not-send',
  });

  assert.deepEqual(payload, {
    assignmentId: 'assignment-1',
    candidateId: 'candidate-1',
    expectedCandidateChecksum: 'b'.repeat(64),
    weightIncrementG: 0.1,
    dimensionIncrementMm: 0.25,
    currencyMinorIncrement: 10,
    unitAttestation: {
      currency: 'CNY',
      weightUnit: 'g',
      dimensionUnit: 'mm',
      priceInputUnit: 'CNY_MAJOR',
    },
    reviewNote: '已核对输入单位',
    expectedCurrentContractId: 'contract-0',
  });
});

test('measurement inputs allow decimal steps while currency minor stays integral', () => {
  const panel = fs.readFileSync(panelPath, 'utf8');

  assert.match(panel, /step=\{field === 'currencyMinorIncrement' \? '1' : 'any'\}/);
  assert.match(panel, /inputMode=\{field === 'currencyMinorIncrement' \? 'numeric' : 'decimal'\}/);
});
test('revocation payload only carries the reason and current-pointer CAS', async () => {
  const state = await loadState();

  assert.deepEqual(
    state.buildOfficialInputUnitContractRevokePayload({
      reason: '  Official 单位样本已漂移  ',
      expectedCurrentContractId: ' contract-1 ',
      candidateId: 'client-must-not-send',
      evidence: { forged: true },
    }),
    {
      reason: 'Official 单位样本已漂移',
      expectedCurrentContractId: 'contract-1',
    },
  );
  assert.equal(
    state.buildOfficialInputUnitContractRevokePayload({ reason: '短', expectedCurrentContractId: 'contract-1' }),
    null,
  );
  assert.equal(
    state.buildOfficialInputUnitContractRevokePayload({ reason: '四个字符', expectedCurrentContractId: 'contract-1' }),
    null,
  );
  assert.deepEqual(
    state.buildOfficialInputUnitContractRevokePayload({
      reason: 'r'.repeat(500),
      expectedCurrentContractId: 'contract-1',
    }),
    {
      reason: 'r'.repeat(500),
      expectedCurrentContractId: 'contract-1',
    },
  );
  assert.equal(
    state.buildOfficialInputUnitContractRevokePayload({ reason: 'r'.repeat(501), expectedCurrentContractId: 'contract-1' }),
    null,
  );
});

test('only an unexpired verified current contract unlocks the matrix', async () => {
  const state = await loadState();
  const now = new Date('2026-07-13T08:00:00.000Z');
  const active = {
    id: 'contract-1',
    status: 'VERIFIED',
    validUntil: '2026-07-20T08:00:00.000Z',
    state: 'ACTIVE',
  };

  assert.equal(state.isEffectiveOfficialInputUnitContract(active, now), true);
  assert.equal(
    state.isEffectiveOfficialInputUnitContract({ ...active, status: undefined }, now),
    false,
  );
  assert.equal(
    state.isEffectiveOfficialInputUnitContract({ ...active, state: undefined }, now),
    false,
  );
  assert.equal(
    state.isEffectiveOfficialInputUnitContract({ ...active, state: 'UNKNOWN' }, now),
    false,
  );
  assert.equal(
    state.isEffectiveOfficialInputUnitContract({ ...active, state: 'REVOKED' }, now),
    false,
  );
  assert.equal(
    state.isEffectiveOfficialInputUnitContract(
      { ...active, validUntil: '2026-07-13T07:59:59.999Z' },
      now,
    ),
    false,
  );
  assert.equal(state.isEffectiveOfficialInputUnitContract(null, now), false);
  assert.equal(state.officialInputUnitContractStateKey(active, now), 'contract-1:active');
  assert.equal(
    state.officialInputUnitContractStateKey({ ...active, state: 'REVOKED' }, now),
    'contract-1:inactive',
  );
});

test('admin workspace renders the contract gate before matrix actions and clears derived state', () => {
  assert.ok(fs.existsSync(panelPath), `${panelPath} must exist`);
  const panel = fs.readFileSync(panelPath, 'utf8');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  assert.match(panel, /official-input-unit-contracts\?assignmentId=/);
  assert.match(panel, /official-input-unit-contracts\/verify/);
  assert.match(panel, /official-input-unit-contracts\/\$\{encodeURIComponent\([^)]*\)\}\/revoke/);
  assert.match(panel, /buildOfficialInputUnitContractVerifyPayload/);
  assert.match(panel, /expectedCurrentContractId/);
  assert.match(panel, /weightIncrementG/);
  assert.match(panel, /dimensionIncrementMm/);
  assert.match(panel, /currencyMinorIncrement/);
  assert.match(panel, /unitAttested/);
  assert.match(panel, /reviewNote/);
  assert.match(panel, /history/);
  assert.match(panel, /candidates/);

  const panelPosition = workspace.indexOf('<OfficialInputUnitContractPanel');
  const matrixPosition = workspace.indexOf('aria-labelledby="capture-freeze-title"');
  assert.ok(panelPosition >= 0, 'workspace must render the input-unit contract panel');
  assert.ok(matrixPosition > panelPosition, 'input-unit contract gate must render before matrix actions');
  assert.match(workspace, /officialInputUnitContractState\.valid/);
  assert.match(
    workspace,
    /setMatrixPreview\(null\)[\s\S]{0,250}setFrozenCandidateSet\(null\)[\s\S]{0,250}setCreatedDraft\(null\)/,
  );
});
