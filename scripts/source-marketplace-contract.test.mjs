import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';

const root = process.cwd();
const fixtureRoot = path.join(root, 'scripts', 'fixtures', 'source-collect');
const platforms = ['pdd', 'taobao'];
const ajv = new Ajv({ allErrors: true, strict: true });

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function forbiddenKey(key, contract) {
  return contract.sanitization.forbiddenKeys.some(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
}

const secretValuePatterns = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bLTAI[A-Za-z0-9]{12,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

export function scanMarketplaceSecrets(value, contract, currentPath = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanMarketplaceSecrets(entry, contract, `${currentPath}[${index}]`, findings),
    );
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = `${currentPath}.${key}`;
      if (forbiddenKey(key, contract)) findings.push({ path: entryPath, reason: 'forbidden_key' });
      scanMarketplaceSecrets(entry, contract, entryPath, findings);
    }
    return findings;
  }
  if (typeof value === 'string' && secretValuePatterns.some((pattern) => pattern.test(value))) {
    findings.push({ path: currentPath, reason: 'secret_value' });
  }
  return findings;
}

export function sanitizeMarketplaceCandidate(
  value,
  contract,
  currentPath = '$',
  removedPaths = [],
) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeMarketplaceCandidate(entry, contract, `${currentPath}[${index}]`, removedPaths),
    );
  }
  if (value && typeof value === 'object') {
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = `${currentPath}.${key}`;
      if (forbiddenKey(key, contract)) {
        removedPaths.push(entryPath);
        continue;
      }
      sanitized[key] = sanitizeMarketplaceCandidate(entry, contract, entryPath, removedPaths);
    }
    return sanitized;
  }
  if (typeof value === 'string' && secretValuePatterns.some((pattern) => pattern.test(value))) {
    removedPaths.push(currentPath);
    return '[REDACTED]';
  }
  return value;
}

function validateCommonFixture(fixture, contract) {
  const rejectionCodes = [];
  if (!contract.allowedResponseSignatures.includes(fixture.responseSignature)) {
    rejectionCodes.push('SIGNATURE_NOT_ALLOWED');
  }
  const pageProductId = String(getPath(fixture, contract.identity.pageProductIdPath) || '');
  const responseProductId = String(getPath(fixture, contract.identity.responseProductIdPath) || '');
  if (!pageProductId || !responseProductId) rejectionCodes.push('INVALID_PRODUCT');
  else if (pageProductId !== responseProductId) rejectionCodes.push('IDENTITY_MISMATCH');
  if (scanMarketplaceSecrets(fixture, contract).length > 0) rejectionCodes.push('SENSITIVE_DATA');
  return rejectionCodes;
}

function validatePddFixture(fixture, contract) {
  const rejectionCodes = validateCommonFixture(fixture, contract);
  const skus = getPath(fixture, contract.price.skuCollectionPath);
  if (
    !Array.isArray(skus) ||
    skus.length === 0 ||
    new Set(skus.map((sku) => sku.sku_id)).size !== skus.length
  ) {
    rejectionCodes.push('INVALID_SKU');
  } else {
    const validOptions = skus.every(
      (sku) =>
        Array.isArray(sku.specs) &&
        sku.specs.length > 0 &&
        sku.specs.every(
          (option) => String(option.name || '').trim() && String(option.value || '').trim(),
        ),
    );
    if (!validOptions) rejectionCodes.push('INVALID_SKU');
    if (
      !skus.every(
        (sku) =>
          Number.isSafeInteger(sku.price_fen) && sku.price_fen > contract.price.minimumExclusive,
      )
    ) {
      rejectionCodes.push('INVALID_PRICE');
    }
  }
  return [...new Set(rejectionCodes)];
}

function validateTaobaoFixture(fixture, contract) {
  const rejectionCodes = validateCommonFixture(fixture, contract);
  const skus = getPath(fixture, contract.price.skuCollectionPath);
  const priceMap = getPath(fixture, contract.price.skuPriceMapPath);
  if (
    !Array.isArray(skus) ||
    skus.length === 0 ||
    new Set(skus.map((sku) => sku.skuId)).size !== skus.length
  ) {
    rejectionCodes.push('INVALID_SKU');
  } else {
    if (!skus.every((sku) => String(sku.propPath || '').trim())) rejectionCodes.push('INVALID_SKU');
    const decimalCny = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/u;
    const validPrices = skus.every((sku) => {
      const raw = String(priceMap?.[sku.skuId]?.price?.priceText || '');
      return decimalCny.test(raw) && Number(raw) > contract.price.minimumExclusive;
    });
    if (!validPrices) rejectionCodes.push('INVALID_PRICE');
  }
  return [...new Set(rejectionCodes)];
}

const validators = { pdd: validatePddFixture, taobao: validateTaobaoFixture };
let fixtureCount = 0;

for (const platform of platforms) {
  const directory = path.join(fixtureRoot, platform);
  const contract = readJson(path.join(directory, 'contract.json'));
  const schema = readJson(path.join(directory, 'fixture.schema.json'));
  const validateSchema = ajv.compile(schema);

  assert.equal(contract.contractVersion, 'source-marketplace-network-contract/v1');
  assert.equal(contract.platform, platform);
  assert.ok(contract.allowedResponseSignatures.length > 0);
  assert.equal(
    new Set(contract.sanitization.forbiddenKeys.map((key) => key.toLowerCase())).size,
    contract.sanitization.forbiddenKeys.length,
  );

  const fixtureFiles = fs
    .readdirSync(directory)
    .filter(
      (name) => name.endsWith('.json') && !['contract.json', 'fixture.schema.json'].includes(name),
    )
    .sort();
  assert.ok(
    fixtureFiles.length >= 3,
    `${platform} requires accept, identity-reject, and price-reject fixtures`,
  );

  const decisions = new Set();
  const rejectionCoverage = new Set();
  for (const name of fixtureFiles) {
    const file = path.join(directory, name);
    const fixture = readJson(file);
    const bytes = fs.statSync(file).size;
    assert.ok(
      bytes <= contract.sanitization.maxFixtureBytes,
      `${name} exceeds the bounded fixture size`,
    );
    assert.equal(
      validateSchema(fixture),
      true,
      `${name} schema errors: ${ajv.errorsText(validateSchema.errors)}`,
    );
    assert.deepEqual(
      scanMarketplaceSecrets(fixture, contract),
      [],
      `${name} contains forbidden secret material`,
    );

    const rejectionCodes = validators[platform](fixture, contract);
    const decision = rejectionCodes.length === 0 ? 'accept' : 'reject';
    assert.equal(decision, fixture.expected.decision, `${name} decision drift`);
    assert.deepEqual(
      rejectionCodes.sort(),
      [...fixture.expected.rejectionCodes].sort(),
      `${name} rejection drift`,
    );
    decisions.add(decision);
    rejectionCodes.forEach((code) => rejectionCoverage.add(code));
    fixtureCount += 1;
  }
  assert.deepEqual(
    decisions,
    new Set(['accept', 'reject']),
    `${platform} must cover both decisions`,
  );
  assert.ok(
    rejectionCoverage.has('IDENTITY_MISMATCH'),
    `${platform} must reject a foreign product response`,
  );
  assert.ok(
    rejectionCoverage.has('INVALID_PRICE'),
    `${platform} must reject zero or invalid prices`,
  );

  const accepted = readJson(path.join(directory, 'accept-basic.json'));
  const sensitiveKey = contract.sanitization.forbiddenKeys.find((key) => key === 'authorization');
  const unsafe = structuredClone(accepted);
  unsafe.responseBody.debug = {
    [sensitiveKey]: ['Bea', 'rer ', 'synthetic-contract-value'].join(''),
    nested: { access_token: ['synthetic', '-token-value'].join('') },
  };
  assert.ok(
    scanMarketplaceSecrets(unsafe, contract).length >= 2,
    `${platform} scanner must detect unsafe raw candidates`,
  );
  assert.ok(validators[platform](unsafe, contract).includes('SENSITIVE_DATA'));
  const removedPaths = [];
  const sanitized = sanitizeMarketplaceCandidate(unsafe, contract, '$', removedPaths);
  assert.ok(removedPaths.some((entry) => entry.endsWith('.authorization')));
  assert.ok(removedPaths.some((entry) => entry.endsWith('.access_token')));
  assert.deepEqual(scanMarketplaceSecrets(sanitized, contract), []);
  delete sanitized.responseBody.debug;
  assert.deepEqual(validators[platform](sanitized, contract), []);

  const unknownSignature = structuredClone(accepted);
  unknownSignature.responseSignature = `${platform}.not-allowlisted`;
  assert.ok(validators[platform](unknownSignature, contract).includes('SIGNATURE_NOT_ALLOWED'));
}

assert.equal(fixtureCount, 6);
console.log(`PASS source marketplace network contract (${fixtureCount} sanitized fixtures)`);
