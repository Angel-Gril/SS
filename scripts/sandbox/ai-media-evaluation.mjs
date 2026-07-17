#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const DEFAULT_FIXTURES_DIR = path.resolve('scripts/fixtures/ai-media-evaluation');
const SCHEMA_FILE = 'policy.schema.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function validateEvaluationPolicy(policy, validateSchema) {
  const errors = [];
  if (!validateSchema(policy)) {
    errors.push(
      ...(validateSchema.errors || []).map(
        (error) => `schema ${error.instancePath || '/'} ${error.message}`,
      ),
    );
    return errors;
  }

  const { minimum, maximum } = policy.metric.validRange;
  const { operator, value } = policy.metric.threshold;
  if (!(minimum < maximum)) errors.push('metric.validRange.minimum must be less than maximum');
  if (value < minimum || value > maximum)
    errors.push('metric.threshold.value must be inside the valid range');
  if (policy.metric.direction === 'higher_is_better' && operator !== 'gte') {
    errors.push('higher_is_better metrics require a gte threshold');
  }
  if (policy.metric.direction === 'lower_is_better' && operator !== 'lte') {
    errors.push('lower_is_better metrics require an lte threshold');
  }
  return errors;
}

export function validateEvaluationDirectory(fixturesDir = DEFAULT_FIXTURES_DIR) {
  const schemaPath = path.join(fixturesDir, SCHEMA_FILE);
  if (!fs.existsSync(schemaPath))
    throw new Error(`Missing evaluation policy schema: ${schemaPath}`);
  const schema = readJson(schemaPath);
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateSchema = ajv.compile(schema);
  const policyFiles = fs
    .readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json') && name !== SCHEMA_FILE)
    .sort();
  if (policyFiles.length === 0) throw new Error('No AI media evaluation policies found');

  const failures = [];
  const metricKeys = new Set();
  for (const name of policyFiles) {
    let policy;
    try {
      policy = readJson(path.join(fixturesDir, name));
    } catch (error) {
      failures.push(`${name}: invalid JSON (${error.message})`);
      continue;
    }
    for (const error of validateEvaluationPolicy(policy, validateSchema))
      failures.push(`${name}: ${error}`);
    if (policy?.metric?.key) {
      if (metricKeys.has(policy.metric.key))
        failures.push(`${name}: duplicate metric key ${policy.metric.key}`);
      metricKeys.add(policy.metric.key);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return { policyCount: policyFiles.length, metricKeys: [...metricKeys].sort() };
}

function main() {
  const requestedDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FIXTURES_DIR;
  try {
    const result = validateEvaluationDirectory(requestedDir);
    console.log(
      `PASS AI media evaluation policies (${result.policyCount}); policy only, no image corpus or quality results`,
    );
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
