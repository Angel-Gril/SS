#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { compile } from 'json-schema-to-typescript';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(
  root,
  'packages/shared/schemas/source-product-capture-v2.schema.json',
);
const sharedOutputPath = path.join(
  root,
  'packages/shared/src/source-product-capture.ts',
);
const browserOutputPath = path.join(
  root,
  'extensions/ss-erp/shared/contracts/source-product-capture-v2.js',
);
const check = process.argv.includes('--check');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  code: { source: true, lines: true },
});
const validate = ajv.compile(schema);
const standalone = inlineStandaloneRuntime(standaloneCode(ajv, validate));

function inlineStandaloneRuntime(source) {
  const exportMatch = source.match(/module\.exports = (validate\d+);\s*module\.exports\.default = \1;/);
  if (!exportMatch) throw new Error('Unexpected Ajv standalone export shape');
  return source
    .replace(/^"use strict";\s*/u, '')
    .replace(
      /module\.exports = (validate\d+);\s*module\.exports\.default = \1;/u,
      'const ajvValidateSourceProductCaptureV2Submission = $1;',
    )
    .replace(
      /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/u,
      [
        'const $1 = function ucs2length(value) {',
        '  var length = 0;',
        '  var index = 0;',
        '  while (index < value.length) {',
        '    var first = value.charCodeAt(index++);',
        '    if (first >= 0xd800 && first <= 0xdbff && index < value.length) {',
        '      var second = value.charCodeAt(index);',
        '      if (second >= 0xdc00 && second <= 0xdfff) index += 1;',
        '    }',
        '    length += 1;',
        '  }',
        '  return length;',
        '};',
      ].join('\n'),
    );
}

const runtimeSource = String.raw`
const SOURCE_CAPTURE_SORTED_STRING_ARRAY_KEYS = new Set([
  'derivedFrom',
  'estimatedFieldPaths',
  'mediaKeys',
  'missingFieldPaths',
  'packagingKeys',
  'skuKeys',
]);

function sourceCaptureCompareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceCaptureSortKey(parentKey, value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (parentKey === 'truncations') return String(value.stage || '') + '\u0000' + String(value.fieldPath || '');
  if (parentKey === 'counts') return String(value.fieldPath || '');
  if (parentKey === 'sections') return String(value.section || '');
  if (parentKey === 'prices') {
    return [value.role, value.skuKey, value.minQuantity, value.key].map(function (item) {
      return item == null ? '' : String(item);
    }).join('\u0000');
  }
  if (typeof value.ordinal === 'number') {
    return String(value.ordinal).padStart(12, '0') + '\u0000' + String(value.key || value.name || '');
  }
  if (typeof value.key === 'string') return value.key;
  if (typeof value.name === 'string') return value.name + '\u0000' + String(value.value || '');
  return JSON.stringify(value);
}

function sourceCaptureShouldSortArray(parentKey, values) {
  if (SOURCE_CAPTURE_SORTED_STRING_ARRAY_KEYS.has(parentKey)) return true;
  if (['attributes', 'counts', 'media', 'packaging', 'path', 'prices', 'sections', 'skus', 'truncations'].includes(parentKey)) return true;
  return values.every(function (item) { return typeof item === 'string'; }) && parentKey.endsWith('Keys');
}

function sourceCaptureNormalizeCanonical(value, parentKey) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical source capture requires finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    for (var index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError('Canonical source capture arrays cannot be sparse');
      }
    }
    var normalized = value.map(function (item) {
      return sourceCaptureNormalizeCanonical(item, '');
    });
    if (sourceCaptureShouldSortArray(parentKey || '', normalized)) {
      normalized.sort(function (left, right) {
        var leftKey = sourceCaptureSortKey(parentKey || '', left);
        var rightKey = sourceCaptureSortKey(parentKey || '', right);
        var keyOrder = sourceCaptureCompareCodeUnits(leftKey, rightKey);
        return keyOrder || sourceCaptureCompareCodeUnits(JSON.stringify(left), JSON.stringify(right));
      });
    }
    return normalized;
  }
  if (typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') {
    throw new TypeError('Canonical source capture supports plain JSON objects only');
  }
  var result = Object.create(null);
  Object.keys(value).sort(sourceCaptureCompareCodeUnits).forEach(function (key) {
    if (value[key] === undefined) {
      throw new TypeError('Canonical source capture does not allow undefined');
    }
    result[key] = sourceCaptureNormalizeCanonical(value[key], key);
  });
  return result;
}

function sourceProductCaptureCanonicalStringify(capture) {
  return JSON.stringify(sourceCaptureNormalizeCanonical(capture, ''));
}

function sourceProductCapturePayloadBytes(capture) {
  if (typeof TextEncoder !== 'function') throw new Error('TextEncoder support is unavailable');
  return new TextEncoder().encode(sourceProductCaptureCanonicalStringify(capture)).byteLength;
}

async function hashSourceProductCaptureV2(capture) {
  if (!globalThis.crypto || !globalThis.crypto.subtle || typeof TextEncoder !== 'function') {
    throw new Error('SHA-256 Web Crypto support is unavailable');
  }
  var bytes = new TextEncoder().encode(sourceProductCaptureCanonicalStringify(capture));
  var digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

function sourceCaptureValidationError(instancePath, keyword, message) {
  return { instancePath: instancePath, keyword: keyword, message: message };
}

function sourceCaptureNormalizeAjvErrors(errors) {
  return (Array.isArray(errors) ? errors : []).map(function (error) {
    return sourceCaptureValidationError(
      String(error.instancePath || ''),
      String(error.keyword || 'schema'),
      String(error.message || 'is invalid'),
    );
  });
}

function sourceCaptureScalarEquals(left, right) {
  return left === right || (typeof left === 'number' && typeof right === 'number' && Object.is(left, -0) && right === 0);
}

function sourceCaptureCheckEvidence(value, evidence, instancePath, errors) {
  if (!sourceCaptureScalarEquals(value, evidence.value)) {
    errors.push(sourceCaptureValidationError(instancePath + '/value', 'evidenceValue', 'must match the captured field value'));
  }
}

function sourceCaptureCheckEvidenceMap(value, evidence, keys, instancePath, errors) {
  keys.forEach(function (key) {
    sourceCaptureCheckEvidence(value[key], evidence[key], instancePath + '/' + key, errors);
  });
}

function sourceCaptureCheckRowEvidence(evidence, instancePath, errors) {
  if (evidence.value !== true) {
    errors.push(sourceCaptureValidationError(instancePath, 'rowEvidence', 'row evidence value must be true'));
  }
}

function sourceCaptureCollectEvidence(value, out) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'sourceType')
    && Object.prototype.hasOwnProperty.call(value, 'sourcePath')
    && Object.prototype.hasOwnProperty.call(value, 'isEstimated')) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(function (item) { sourceCaptureCollectEvidence(item, out); });
    return;
  }
  Object.keys(value).forEach(function (key) { sourceCaptureCollectEvidence(value[key], out); });
}

function sourceCaptureCheckUniqueKeys(rows, instancePath, errors) {
  var seen = new Set();
  rows.forEach(function (row, index) {
    if (seen.has(row.key)) {
      errors.push(sourceCaptureValidationError(instancePath + '/' + index + '/key', 'uniqueKey', 'must be unique'));
    }
    seen.add(row.key);
  });
}

function sourceCaptureSemanticErrors(submission) {
  var capture = submission.capture;
  var errors = [];
  sourceCaptureCheckEvidenceMap(
    capture.sourceIdentity,
    capture.sourceIdentity.fieldEvidence,
    ['productId', 'canonicalUrl', 'host'],
    '/capture/sourceIdentity/fieldEvidence',
    errors,
  );
  sourceCaptureCheckEvidenceMap(
    capture.sourceCategory,
    capture.sourceCategory.fieldEvidence,
    ['id', 'name'],
    '/capture/sourceCategory/fieldEvidence',
    errors,
  );
  capture.sourceCategory.path.forEach(function (node, index) {
    sourceCaptureCheckEvidenceMap(node, node.fieldEvidence, ['id', 'name'], '/capture/sourceCategory/path/' + index + '/fieldEvidence', errors);
  });
  sourceCaptureCheckEvidenceMap(
    capture.facts,
    capture.fieldEvidence,
    Object.keys(capture.facts),
    '/capture/fieldEvidence',
    errors,
  );
  capture.attributes.forEach(function (row, index) {
    sourceCaptureCheckRowEvidence(row.rowEvidence, '/capture/attributes/' + index + '/rowEvidence', errors);
    sourceCaptureCheckEvidenceMap(row, row.fieldEvidence, ['sourceAttributeId', 'name', 'value', 'isSaleAttribute'], '/capture/attributes/' + index + '/fieldEvidence', errors);
  });
  capture.prices.forEach(function (row, index) {
    sourceCaptureCheckEvidenceMap(row, row.fieldEvidence, ['skuKey', 'minQuantity', 'amountCny', 'maxAmountCny', 'currency', 'displayText'], '/capture/prices/' + index + '/fieldEvidence', errors);
    if (row.role === 'conservative_fallback' && (!row.fieldEvidence.amountCny.isEstimated || row.fieldEvidence.amountCny.sourceType !== 'derived')) {
      errors.push(sourceCaptureValidationError('/capture/prices/' + index + '/fieldEvidence/amountCny', 'fallbackEvidence', 'conservative fallback must be estimated derived evidence'));
    }
  });
  capture.skus.forEach(function (row, index) {
    sourceCaptureCheckRowEvidence(row.rowEvidence, '/capture/skus/' + index + '/rowEvidence', errors);
    sourceCaptureCheckEvidenceMap(row, row.fieldEvidence, ['sourceSkuId', 'specText', 'priceCny', 'stock'], '/capture/skus/' + index + '/fieldEvidence', errors);
    row.attributes.forEach(function (attribute, attributeIndex) {
      sourceCaptureCheckEvidenceMap(attribute, attribute.fieldEvidence, ['name', 'value'], '/capture/skus/' + index + '/attributes/' + attributeIndex + '/fieldEvidence', errors);
    });
  });
  capture.media.forEach(function (row, index) {
    sourceCaptureCheckRowEvidence(row.rowEvidence, '/capture/media/' + index + '/rowEvidence', errors);
    sourceCaptureCheckEvidenceMap(row, row.fieldEvidence, ['role', 'url', 'width', 'height', 'mimeType'], '/capture/media/' + index + '/fieldEvidence', errors);
  });
  capture.packaging.forEach(function (row, index) {
    sourceCaptureCheckRowEvidence(row.rowEvidence, '/capture/packaging/' + index + '/rowEvidence', errors);
    sourceCaptureCheckEvidenceMap(row, row.fieldEvidence, ['weightG', 'lengthMm', 'widthMm', 'heightMm', 'volumeCm3'], '/capture/packaging/' + index + '/fieldEvidence', errors);
    row.selectors.forEach(function (selector, selectorIndex) {
      sourceCaptureCheckEvidenceMap(selector, selector.fieldEvidence, ['name', 'value'], '/capture/packaging/' + index + '/selectors/' + selectorIndex + '/fieldEvidence', errors);
    });
  });

  if (capture.facts.shippingCny === 0) {
    ['shippingCny', 'shippingFree'].forEach(function (field) {
      if (!['network', 'main_world', 'script', 'dom', 'manual'].includes(capture.fieldEvidence[field].sourceType)) {
        errors.push(sourceCaptureValidationError('/capture/fieldEvidence/' + field + '/sourceType', 'explicitFreeShipping', 'zero freight requires direct free-shipping evidence'));
      }
    });
  }
  if (capture.facts.totalCostCny !== null) {
    var totalEvidence = capture.fieldEvidence.totalCostCny;
    if (totalEvidence.sourceType !== 'derived'
      || !totalEvidence.derivedFrom.includes('/facts/shippingCny')
      || !totalEvidence.derivedFrom.some(function (item) { return item.startsWith('/prices/'); })) {
      errors.push(sourceCaptureValidationError('/capture/fieldEvidence/totalCostCny', 'derivedCost', 'total cost must reference price and freight evidence'));
    }
  }

  var actualCounts = {
    '/attributes': capture.attributes.length,
    '/prices': capture.prices.length,
    '/skus': capture.skus.length,
    '/media': capture.media.length,
    '/media/product_main': capture.media.filter(function (row) {
      return row.role === 'product_main' && row.disposition === 'accepted';
    }).length,
    '/media/product_detail': capture.media.filter(function (row) {
      return row.role === 'product_detail' && row.disposition === 'accepted';
    }).length,
    '/media/rejected': capture.media.filter(function (row) {
      return row.disposition === 'rejected';
    }).length,
    '/packaging': capture.packaging.length,
    '/truncations': capture.truncations.length,
  };
  var countPaths = new Set();
  capture.counts.forEach(function (count, index) {
    if (countPaths.has(count.fieldPath)) {
      errors.push(sourceCaptureValidationError('/capture/counts/' + index + '/fieldPath', 'uniqueCountPath', 'count fieldPath must be unique'));
    }
    countPaths.add(count.fieldPath);
    if (count.submittedCount > count.capturedCount) {
      errors.push(sourceCaptureValidationError('/capture/counts/' + index + '/submittedCount', 'stageCount', 'submittedCount cannot exceed capturedCount'));
    }
    if (count.totalCount !== null && count.capturedCount > count.totalCount) {
      errors.push(sourceCaptureValidationError('/capture/counts/' + index + '/capturedCount', 'stageCount', 'capturedCount cannot exceed totalCount'));
    }
    if (Object.prototype.hasOwnProperty.call(actualCounts, count.fieldPath)
      && count.submittedCount !== actualCounts[count.fieldPath]) {
      errors.push(sourceCaptureValidationError('/capture/counts/' + index + '/submittedCount', 'stageCount', 'submittedCount must match the canonical array length'));
    }
    if (!count.truncated && count.totalCount !== null && count.totalCount > count.capturedCount) {
      errors.push(sourceCaptureValidationError('/capture/counts/' + index + '/truncated', 'stageCount', 'known collection loss must be marked truncated'));
    }
  });

  sourceCaptureCheckUniqueKeys(capture.attributes, '/capture/attributes', errors);
  sourceCaptureCheckUniqueKeys(capture.prices, '/capture/prices', errors);
  sourceCaptureCheckUniqueKeys(capture.skus, '/capture/skus', errors);
  sourceCaptureCheckUniqueKeys(capture.media, '/capture/media', errors);
  sourceCaptureCheckUniqueKeys(capture.packaging, '/capture/packaging', errors);
  var skuKeys = new Set(capture.skus.map(function (row) { return row.key; }));
  var mediaKeys = new Set(capture.media.map(function (row) { return row.key; }));
  var packagingKeys = new Set(capture.packaging.map(function (row) { return row.key; }));
  if (capture.facts.selectedSkuKey !== null && !skuKeys.has(capture.facts.selectedSkuKey)) {
    errors.push(sourceCaptureValidationError('/capture/facts/selectedSkuKey', 'reference', 'selectedSkuKey must reference a captured SKU'));
  }
  capture.skus.forEach(function (row, index) {
    row.mediaKeys.forEach(function (key, keyIndex) {
      if (!mediaKeys.has(key)) errors.push(sourceCaptureValidationError('/capture/skus/' + index + '/mediaKeys/' + keyIndex, 'reference', 'must reference captured media'));
    });
    row.packagingKeys.forEach(function (key, keyIndex) {
      if (!packagingKeys.has(key)) errors.push(sourceCaptureValidationError('/capture/skus/' + index + '/packagingKeys/' + keyIndex, 'reference', 'must reference captured packaging'));
    });
  });
  capture.media.forEach(function (row, index) {
    row.skuKeys.forEach(function (key, keyIndex) {
      if (!skuKeys.has(key)) errors.push(sourceCaptureValidationError('/capture/media/' + index + '/skuKeys/' + keyIndex, 'reference', 'must reference a captured SKU'));
    });
  });
  capture.packaging.forEach(function (row, index) {
    row.skuKeys.forEach(function (key, keyIndex) {
      if (!skuKeys.has(key)) errors.push(sourceCaptureValidationError('/capture/packaging/' + index + '/skuKeys/' + keyIndex, 'reference', 'must reference a captured SKU'));
    });
  });

  var evidenceRows = [];
  sourceCaptureCollectEvidence(capture, evidenceRows);
  var hasEstimatedValues = evidenceRows.some(function (evidence) { return evidence.isEstimated === true; });
  if (hasEstimatedValues !== capture.completeness.hasEstimatedValues) {
    errors.push(sourceCaptureValidationError('/capture/completeness/hasEstimatedValues', 'completeness', 'must match captured evidence'));
  }
  if (capture.provenanceMode === 'native_v2' && evidenceRows.some(function (evidence) { return evidence.sourceType === 'legacy'; })) {
    errors.push(sourceCaptureValidationError('/capture/provenanceMode', 'provenance', 'native capture cannot contain legacy evidence'));
  }
  if (capture.provenanceMode === 'legacy_adapted' && capture.collector.captureChannel !== 'legacy_adapter') {
    errors.push(sourceCaptureValidationError('/capture/collector/captureChannel', 'provenance', 'legacy-adapted capture requires the legacy adapter channel'));
  }
  try {
    if (submission.payloadBytes !== sourceProductCapturePayloadBytes(capture)) {
      errors.push(sourceCaptureValidationError('/payloadBytes', 'payloadBytes', 'must match canonical capture UTF-8 bytes'));
    }
  } catch (error) {
    errors.push(sourceCaptureValidationError('/capture', 'canonicalJson', error && error.message ? error.message : 'capture is not canonical JSON'));
  }
  return errors;
}

function validateSourceProductCaptureV2Submission(value) {
  if (!ajvValidateSourceProductCaptureV2Submission(value)) {
    return { valid: false, errors: sourceCaptureNormalizeAjvErrors(ajvValidateSourceProductCaptureV2Submission.errors) };
  }
  var errors = sourceCaptureSemanticErrors(value);
  return errors.length ? { valid: false, errors: errors } : { valid: true, errors: [] };
}

async function createSourceProductCaptureV2Submission(capture) {
  return {
    capture: capture,
    captureHash: await hashSourceProductCaptureV2(capture),
    payloadBytes: sourceProductCapturePayloadBytes(capture),
  };
}

async function verifySourceProductCaptureV2Submission(value) {
  var validation = validateSourceProductCaptureV2Submission(value);
  if (!validation.valid) return validation;
  var expectedHash = await hashSourceProductCaptureV2(value.capture);
  if (expectedHash !== value.captureHash) {
    return {
      valid: false,
      errors: [sourceCaptureValidationError('/captureHash', 'captureHash', 'capture hash does not match capture')],
    };
  }
  return validation;
}
`;

function schemaForTypeGeneration(value) {
  if (Array.isArray(value)) return value.map(schemaForTypeGeneration);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'if' || key === 'then' || key === 'else') continue;
    if (key === 'allOf' && Array.isArray(child) && child.every((entry) => entry && typeof entry === 'object' && Object.hasOwn(entry, 'if'))) {
      continue;
    }
    next[key] = schemaForTypeGeneration(child);
  }
  return next;
}

const generatedTypes = await compile(
  schemaForTypeGeneration(schema),
  'SourceProductCaptureV2Submission',
  {
  bannerComment: '',
  format: false,
  unknownAny: false,
  unreachableDefinitions: true,
  },
);

const sharedRuntimeSource = runtimeSource
  .replace(
    'function sourceProductCaptureCanonicalStringify(capture) {',
    'function sourceProductCaptureCanonicalStringify(capture: SourceProductCaptureV2): string {',
  )
  .replace(
    'function sourceProductCapturePayloadBytes(capture) {',
    'function sourceProductCapturePayloadBytes(capture: SourceProductCaptureV2): number {',
  )
  .replace(
    'async function hashSourceProductCaptureV2(capture) {',
    'async function hashSourceProductCaptureV2(capture: SourceProductCaptureV2): Promise<string> {',
  )
  .replace(
    'function validateSourceProductCaptureV2Submission(value) {',
    'function validateSourceProductCaptureV2Submission(value: unknown): SourceProductCaptureV2ValidationResult {',
  )
  .replace(
    'async function createSourceProductCaptureV2Submission(capture) {',
    'async function createSourceProductCaptureV2Submission(capture: SourceProductCaptureV2): Promise<SourceProductCaptureV2Submission> {',
  )
  .replace(
    'async function verifySourceProductCaptureV2Submission(value) {',
    'async function verifySourceProductCaptureV2Submission(value: unknown): Promise<SourceProductCaptureV2ValidationResult> {',
  );

const sharedOutput = [
  '/* eslint-disable */',
  '// @ts-nocheck',
  '// Generated by scripts/generate-source-capture-contract.mjs. Do not edit.',
  '',
  generatedTypes.trim(),
  '',
  `export const sourceProductCaptureV2Schema = ${JSON.stringify(schema, null, 2)} as const;`,
  '',
  standalone.trim(),
  sharedRuntimeSource.trim(),
  '',
  'export interface SourceProductCaptureV2ValidationError {',
  '  instancePath: string;',
  '  keyword: string;',
  '  message: string;',
  '}',
  '',
  'export type SourceProductCaptureV2ValidationResult =',
  '  | { valid: true; errors: [] }',
  '  | { valid: false; errors: SourceProductCaptureV2ValidationError[] };',
  '',
  'export {',
  '  createSourceProductCaptureV2Submission,',
  '  hashSourceProductCaptureV2,',
  '  sourceProductCaptureCanonicalStringify,',
  '  sourceProductCapturePayloadBytes,',
  '  validateSourceProductCaptureV2Submission,',
  '  verifySourceProductCaptureV2Submission,',
  '};',
  '',
].join('\n');

const browserOutput = [
  '// Generated by scripts/generate-source-capture-contract.mjs. Do not edit.',
  '(function (root) {',
  "  'use strict';",
  indent(standalone.trim(), 2),
  indent(runtimeSource.trim(), 2),
  '  root.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2 = Object.freeze({',
  '    createSourceProductCaptureV2Submission: createSourceProductCaptureV2Submission,',
  '    hashSourceProductCaptureV2: hashSourceProductCaptureV2,',
  '    sourceProductCaptureCanonicalStringify: sourceProductCaptureCanonicalStringify,',
  '    sourceProductCapturePayloadBytes: sourceProductCapturePayloadBytes,',
  '    validateSourceProductCaptureV2Submission: validateSourceProductCaptureV2Submission,',
  '    verifySourceProductCaptureV2Submission: verifySourceProductCaptureV2Submission,',
  '  });',
  "})(typeof globalThis !== 'undefined' ? globalThis : self);",
  '',
].join('\n');

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => prefix + line).join('\n');
}

function writeOrCheck(filePath, expected) {
  if (check) {
    let current = '';
    try {
      current = readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`Generated source capture artifact is missing: ${path.relative(root, filePath)}`);
    }
    if (current !== expected) {
      throw new Error(`Generated source capture artifact is stale: ${path.relative(root, filePath)}`);
    }
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, expected, 'utf8');
}

writeOrCheck(sharedOutputPath, sharedOutput);
writeOrCheck(browserOutputPath, browserOutput);
console.log(check ? 'PASS source capture contract artifacts are current' : 'Generated source capture contract artifacts');
