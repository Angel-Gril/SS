import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MAX_LOG = 64 * 1024 * 1024;
function readFile(file, maximum) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Invalid local validation artifact');
  return readFileSync(file);
}
function resumable(step) {
  const localContracts = new Set(['preflight-process-exit', 'qa04-final-acceptance', 'change-validation-plan',
    'change-validation-runner', 'change-validation', 'qa04-suite-source-bridge']);
  return localContracts.has(step.id) && step.command === 'node' && step.args.some(arg => /^scripts\/[a-zA-Z0-9_.-]+\.test\.mjs$/u.test(arg))
    && step.args.every(arg => arg.startsWith('-') || /^scripts\/[a-zA-Z0-9_.-]+\.test\.mjs$/u.test(arg));
}
function previousSteps(resumePath, input, planSha256) {
  if (!resumePath) return [];
  const previous = JSON.parse(readFile(resumePath, 1024 * 1024));
  if (previous.kind !== 'SS_ERP_LOCAL_CHANGE_VALIDATION_RECEIPT' || previous.schemaVersion !== 1
    || previous.formalReleaseEvidence !== false || !same(previous.input, input)
    || previous.planSha256 !== planSha256 || !Array.isArray(previous.steps)) return [];
  return previous.steps.map(step => ({ ...step, previousRoot: path.dirname(resumePath) }));
}

// Local acceleration only. Formal QA04/publication consumers do not accept this receipt.
export async function executeChangeValidation({ plan, input, outputDirectory, resumePath, readInput, runStep, onStep = () => {} }) {
  if (plan?.kind !== 'SS_ERP_LOCAL_CHANGE_VALIDATION_PLAN' || plan.formalReleaseEvidence !== false
    || !Array.isArray(plan.steps) || new Set(plan.steps.map(step => step.id)).size !== plan.steps.length) throw new Error('Invalid local validation plan');
  const directory = path.resolve(outputDirectory);
  if (realpathSync(directory).toLowerCase() !== directory.toLowerCase() || lstatSync(directory).isSymbolicLink()
    || readdirSync(directory).length) throw new Error('Local validation output must be one empty real directory');
  const planSha256 = hash(json(plan));
  const previous = previousSteps(resumePath, input, planSha256);
  const receipt = { schemaVersion: 1, kind: 'SS_ERP_LOCAL_CHANGE_VALIDATION_RECEIPT',
    startedAt: new Date().toISOString(), formalReleaseEvidence: false, input, planSha256,
    profile: plan.profile, requiredEvidence: plan.requiredEvidence, steps: [], status: 'RUNNING', exitCode: 0 };
  const save = (name, value) => writeNewArtifactDurably(path.join(directory, name), Buffer.isBuffer(value) ? value : json(value), { mode: 0o600 });
  const check = async (phase = 'step') => { if (!same(await readInput({ phase }), input)) throw new Error('Validation inputs changed during execution'); };
  save('plan.json', plan);
  for (const step of plan.steps) {
    await check();
    const started = performance.now(); let reused = false, result;
    const old = previous.find(row => row.id === step.id && row.exitCode === 0 && same(row.command, { command: step.command, args: step.args }));
    if (old && resumable(step) && /^[a-zA-Z0-9_.-]+\.log$/u.test(old.logFilename || '')) {
      try {
        const log = readFile(path.join(old.previousRoot, old.logFilename), MAX_LOG);
        if (hash(log) === old.logSha256) { result = { status: 0, log }; reused = true; }
      } catch { /* Missing or altered originals rerun the current trusted command. */ }
    }
    onStep({ id: step.id, state: reused ? 'REUSED_LOCAL' : 'START' });
    if (!result) result = await runStep(step);
    const exitCode = result.signal || !Number.isInteger(result.status) ? 1 : result.status;
    const log = Buffer.isBuffer(result.log) ? result.log : Buffer.from(result.log || '');
    if (log.length > MAX_LOG) throw new Error('Validation log exceeds limit');
    const logFilename = String(receipt.steps.length + 1).padStart(3, '0') + '-' + step.id + '.log';
    if (!/^[a-zA-Z0-9_.-]+$/u.test(logFilename)) throw new Error('Invalid validation step ID');
    save(logFilename, log);
    receipt.steps.push({ id: step.id, command: { command: step.command, args: step.args }, exitCode,
      durationMs: Math.round(performance.now() - started), reused, logFilename, logSha256: hash(log) });
    await check();
    onStep({ id: step.id, state: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, reused });
    receipt.exitCode = exitCode;
    if (exitCode !== 0) { receipt.status = 'FAILED'; break; }
    save(String(receipt.steps.length).padStart(3, '0') + '-checkpoint.json', receipt);
  }
  if (receipt.status === 'RUNNING') receipt.status = !plan.steps.length ? 'NO_CHANGES' : 'PASSED_LOCAL';
  await check('final');
  receipt.completedAt = new Date().toISOString();
  save('receipt.json', receipt);
  return receipt;
}
