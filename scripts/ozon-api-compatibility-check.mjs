import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = 'apps/server/src/services/ozon-client.ts';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const LIMITATIONS = [
  'This is an offline public OpenAPI alert check; no authenticated seller requests are made.',
  'Only fixed request paths and HTTP methods in explicitly selected source files are checked.',
  'Reachable schema warnings do not establish field usage or complete request/response compatibility.',
  'Beta and matching News entries require human review; seller permissions and runtime behavior remain unverified.',
  'Premium source files are excluded. No cookies, API keys, or browser state are read.',
];

function ensureSourceAllowed(source) {
  if (/(^|[^a-z])premium([^a-z]|$)/i.test(source.replaceAll('\\', '/'))) {
    throw new Error('Premium source is explicitly excluded from this check');
  }
}

/** Extract fixed calls without executing or importing the source under inspection. */
export function extractOzonCalls(sourceText, source = '<source>') {
  ensureSourceAllowed(source);
  const ast = ts.createSourceFile(source, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error(`Source syntax error in ${source}`);
  // Bind only this in-memory file; no imported code, library files or source
  // execution is needed to distinguish a constant from a shadowing parameter.
  const compilerOptions = { noLib: true, noResolve: true, noEmit: true };
  const host = {
    ...ts.createCompilerHost(compilerOptions),
    getSourceFile: (name) => name === source ? ast : undefined,
    fileExists: (name) => name === source,
    readFile: (name) => name === source ? sourceText : undefined,
    writeFile: () => {},
  };
  const checker = ts.createProgram([source], compilerOptions, host).getTypeChecker();
  const literal = (node, seen = new Set()) => {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration)
        && ts.isVariableDeclarationList(declaration.parent)
        && declaration.parent.flags & ts.NodeFlags.Const
        && declaration.initializer && !seen.has(declaration)) {
        return literal(declaration.initializer, new Set([...seen, declaration]));
      }
    }
    return undefined;
  };
  const calls = [];
  const unresolved = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['request', 'requestBinary'].includes(node.expression.name.text)) {
      const location = { source, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 };
      const fixedPath = literal(node.arguments[0]);
      let method = 'POST';
      let reason;
      if (!fixedPath || !/^\/v\d+\/[a-zA-Z0-9/_{}.-]+$/.test(fixedPath)) reason = 'Request path is not a fixed Seller API path';
      const options = node.arguments[1];
      if (node.expression.name.text !== 'requestBinary' && options) {
        if (!ts.isObjectLiteralExpression(options)) reason = 'Request options are dynamic; HTTP method cannot be established';
        else {
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
              reason = 'Spread/computed request options may override HTTP method';
              continue;
            }
            const key = property.name?.text;
            if (key === 'method') {
              method = ts.isPropertyAssignment(property) ? literal(property.initializer) : undefined;
              if (!method || !HTTP_METHODS.has(method.toUpperCase())) reason = 'HTTP method is not a fixed supported verb';
            }
          }
        }
      }
      if (reason) unresolved.push({ ...location, reason });
      else calls.push({ ...location, path: fixedPath, method: method.toUpperCase() });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { calls, unresolved };
}

function retirementWarning(value) {
  const text = value.replace(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ');
  return /\bdeprecated\b|\b(?:will (?:be|no longer be)|is|was|has been|to be)\s+(?:[a-z-]+\s+){0,3}(?:removed|disabled|deactivated|discontinued|retired|shut down|unavailable|unsupported)\b|\bno longer (?:be )?(?:supported|available|used)\b|\bscheduled for (?:removal|retirement|deactivation)\b|\b(?:sunset|decommission(?:ed|ing)?)\b/i.test(text)
    || /(?:метод|поле|параметр|интерфейс|верси[яи])[^.!?\n]{0,120}(?:отключ[её]н|удал[её]н|устар[её]л|не поддержива|прекратит|перестанет)/iu.test(text)
    || /(?:接口|方法|字段|参数|版本)[^。！？\n]{0,80}(?:停用|弃用|废弃|移除|下线|不再支持)/u.test(text);
}

function referenceValue(spec, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined;
  return reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, key) => current && Object.hasOwn(current, key) ? current[key] : undefined, spec);
}

function textIncludesIdentifier(text, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_/-])${escaped}(?![A-Za-z0-9_/-])`).test(text);
}

function relevantNews(spec, operations) {
  const description = (spec.tags || []).find((tag) => tag.name === 'News')?.description;
  if (typeof description !== 'string') return [];
  const result = [];
  let date = null;
  for (const paragraph of description.split(/\r?\n\s*\r?\n|(?=^#{1,6}\s)/m)) {
    const dates = [...paragraph.matchAll(/\b(?:20\d{2}[-/.]\d{2}[-/.]\d{2}|\d{2}[./]\d{2}[./]20\d{2})\b/g)];
    if (dates.length) date = dates[0][0];
    const mentions = operations.filter((operation) => textIncludesIdentifier(paragraph, operation.path)
      || operation.operationId && textIncludesIdentifier(paragraph, operation.operationId));
    if (!mentions.length) continue;
    result.push({
      date,
      operations: mentions.map(({ method, path: apiPath }) => `${method} ${apiPath}`),
      excerpt: paragraph.trim().slice(0, 2400),
      truncated: paragraph.trim().length > 2400,
      requiresHumanReview: true,
    });
  }
  return result;
}

/** No network, credentials, source execution, or business writes occur in this analysis. */
export function analyzeOzonCompatibility(spec, { calls = [], unresolved = [] } = {}) {
  if (!spec || typeof spec !== 'object' || !/^3\./.test(spec.openapi || '')
    || !spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) {
    throw new Error('Expected a saved OpenAPI 3 JSON object with paths');
  }
  const findings = [];
  const grouped = new Map();
  for (const call of calls) {
    if (!call || typeof call.path !== 'string' || !HTTP_METHODS.has(call.method)) throw new Error('Invalid extracted call');
    const key = `${call.method} ${call.path}`;
    if (!grouped.has(key)) grouped.set(key, { path: call.path, method: call.method, sources: [] });
    grouped.get(key).sources.push({ source: call.source, line: call.line });
  }
  const add = (operation, code, severity, extra = {}) => {
    findings.push({ code, severity, ...(operation ? { path: operation.path, method: operation.method, operationId: operation.operationId } : {}), ...extra });
  };
  for (const item of unresolved) add(null, 'SOURCE_CALL_UNRESOLVED', 'error', item);
  if (!grouped.size) add(null, 'NO_FIXED_CALLS', 'error');
  const operations = [...grouped.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  for (const operation of operations) {
    const pathItem = spec.paths[operation.path];
    if (!pathItem || typeof pathItem !== 'object') {
      add(operation, 'PATH_MISSING', 'error');
      continue;
    }
    const contract = pathItem[operation.method.toLowerCase()];
    if (!contract || typeof contract !== 'object') {
      add(operation, 'HTTP_METHOD_MISSING', 'error');
      continue;
    }
    operation.operationId = typeof contract.operationId === 'string' ? contract.operationId : null;
    operation.tags = Array.isArray(contract.tags) ? contract.tags : [];
    if (contract.deprecated === true) add(operation, 'OPERATION_DEPRECATED', 'error');
    if (operation.tags.some((tag) => /^BetaMethod$/i.test(tag))) add(operation, 'BETA_METHOD', 'warning');
    const seenObjects = new WeakSet();
    const visitedRefs = new Set();
    const inspect = (node, location, operationLevel = false) => {
      if (!node || typeof node !== 'object' || seenObjects.has(node)) return;
      seenObjects.add(node);
      if (Array.isArray(node)) {
        node.forEach((child, index) => inspect(child, `${location}/${index}`));
        return;
      }
      if (node.$ref) {
        const resolved = referenceValue(spec, node.$ref);
        if (!resolved) add(operation, 'SPEC_REFERENCE_UNRESOLVED', 'error', { location, reference: node.$ref });
        else if (!visitedRefs.has(node.$ref)) {
          visitedRefs.add(node.$ref);
          inspect(resolved, `${location} -> ${node.$ref}`);
        }
      }
      if (!operationLevel && node.deprecated === true) add(operation, 'FIELD_DEPRECATED', 'error', { location });
      for (const key of ['summary', 'description']) {
        if (typeof node[key] === 'string' && retirementWarning(node[key])) {
          add(operation, operationLevel ? 'OPERATION_RETIREMENT_WARNING' : 'FIELD_RETIREMENT_WARNING', 'error', {
            location: `${location}/${key}`, excerpt: node[key].slice(0, 1800), truncated: node[key].length > 1800,
          });
        }
      }
      for (const [key, child] of Object.entries(node)) {
        // Only schema/parameter structures are followed; examples and vendor metadata may contain arbitrary prose.
        if (['$ref', 'example', 'examples', 'externalDocs', 'summary', 'description'].includes(key) || key.startsWith('x-')) continue;
        if (child && typeof child === 'object') inspect(child, `${location}/${key}`);
      }
    };
    inspect(contract, `paths/${operation.path}/${operation.method.toLowerCase()}`, true);
    if (pathItem.parameters) inspect(pathItem.parameters, `paths/${operation.path}/parameters`);
  }
  const exitCode = findings.some((finding) => finding.severity === 'error') ? 1 : 0;
  return {
    status: exitCode ? 'requires_review' : 'no_alerts_in_checked_scope',
    exitCode,
    specVersion: typeof spec.info?.version === 'string' ? spec.info.version : null,
    coverage: { onlineVerified: false, completeSchemaCompatibility: false, fixedCalls: calls.length, operations: operations.length, unresolvedCalls: unresolved.length, limitations: LIMITATIONS },
    operations, findings, news: relevantNews(spec, operations),
  };
}

function readBounded(file) {
  if (!statSync(file).isFile() || statSync(file).size > MAX_FILE_BYTES) throw new Error('Input is not a file or exceeds 64 MiB');
  return readFileSync(file, 'utf8');
}

export function runCli(argv = process.argv.slice(2)) {
  let json = false;
  try {
    let specPath;
    const sources = [];
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index];
      if (arg === '--json') json = true;
      else if (arg === '--spec' || arg === '--source') {
        const value = argv[++index];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a local file path`);
        if (arg === '--spec') {
          if (specPath) throw new Error('--spec must be provided once');
          specPath = value;
        } else sources.push(value);
      } else if (arg === '--help' || arg === '-h') {
        process.stdout.write('Usage: node scripts/ozon-api-compatibility-check.mjs --spec <saved-official-openapi.json> [--source <fixed-request-source.ts> ...] [--json]\nDefault source: apps/server/src/services/ozon-client.ts. Explicit --source replaces the default; repeat it to include the client and groupage service.\nExit: 0 no alerts in checked scope; 1 review required; 2 invalid input. This offline scan is not full schema or live-seller acceptance.\n');
        return 0;
      } else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!specPath) throw new Error('--spec is required; obtain public OpenAPI JSON using the normal official documentation browser');
    const raw = readBounded(path.resolve(specPath));
    let spec;
    try { spec = JSON.parse(raw); } catch { throw new Error('Saved OpenAPI file is not valid JSON'); }
    const extracted = { calls: [], unresolved: [] };
    for (const file of [...new Set(sources.length ? sources : [path.join(SCRIPT_ROOT, DEFAULT_SOURCE)])]) {
      ensureSourceAllowed(file);
      const result = extractOzonCalls(readBounded(path.resolve(file)), file);
      extracted.calls.push(...result.calls);
      extracted.unresolved.push(...result.unresolved);
    }
    const report = analyzeOzonCompatibility(spec, extracted);
    report.specSha256 = createHash('sha256').update(raw).digest('hex');
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`Ozon public-spec check: ${report.status}\n${report.coverage.operations} operations, ${report.findings.length} findings, ${report.news.length} matching News excerpts.\n`);
      for (const finding of report.findings) process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.method || ''} ${finding.path || ''} ${finding.location || finding.reason || ''}\n`);
      for (const item of report.news) process.stdout.write(`[News; human review] ${item.date || 'date not parsed'} ${item.operations.join(', ')}\n${item.excerpt}\n`);
      process.stdout.write('No live seller verification or complete schema compatibility was performed. Use --json for the complete report.\n');
    }
    return report.exitCode;
  } catch (error) {
    const report = { status: 'input_error', exitCode: 2, message: error instanceof Error ? error.message : 'Check failed', coverage: { onlineVerified: false, completeSchemaCompatibility: false } };
    if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stderr.write(`Ozon public-spec check failed: ${report.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runCli();
}
