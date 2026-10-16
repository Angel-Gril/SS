import { preflightSteps } from './preflight.mjs';

const diff = { id: 'diff-check', name: 'Git whitespace check', command: 'git', args: ['diff', '--check'] };
const protectedName = /(?:^|[/_.-])(?:auth|session|permission|policy|billing|payment|quota|wallet|ai|image|media|provider|publish|device|config|middleware)(?:[/_.-]|$)/i;
const docs = name => /^(?:docs|dev-docs)\/.+\.(?:md|txt)$/u.test(name)
  || /^(?:README(?:\.[a-zA-Z-]+)?|CHANGELOG|CONTRIBUTING)\.md$/u.test(name);
const css = name => /^(?:apps\/web\/src|extensions\/ss-erp\/(?:pages|content))\/.+\.css$/u.test(name);
const ordinaryWeb = name => /^apps\/web\/src\/(?:app|components)\/.+\.(?:tsx|ts|jsx|js)$/u.test(name) && !protectedName.test(name);
const ordinaryOrder = name => /^apps\/server\/src\/(?:services|repositories|routes|__tests__)\/orders?(?:[-./][^/]*)?\.(?:ts|tsx)$/u.test(name)
  && !protectedName.test(name);

export function validationPath(value) {
  if (typeof value !== 'string' || !value || value.length > 800 || /[\\:$`;&|<>]/u.test(value)
    || [...value].some(character => character.charCodeAt(0) < 32)
    || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe validation path');
  }
  return value;
}

function category(change) {
  const name = validationPath(change.path);
  if (change.oldPath) validationPath(change.oldPath);
  if (!/^(?:M|A|D|\?\?|R\d{1,3})$/u.test(change.status || '')
    || change.oldPath || change.mode && change.mode !== '100644') return 'full';
  if (docs(name)) return 'documentation';
  if (css(name)) return 'presentation';
  if (ordinaryWeb(name)) return 'web';
  if (ordinaryOrder(name)) return 'orders';
  return 'full';
}

export function buildChangeValidationPlan({ changes, build = false } = {}) {
  if (!Array.isArray(changes) || changes.length > 10_000 || typeof build !== 'boolean') throw new Error('Invalid validation changes');
  const kinds = new Set(changes.map(category));
  const profile = !changes.length ? 'no_changes' : kinds.has('full') ? 'full'
    : [...kinds].every(kind => kind === 'documentation') ? 'documentation'
      : [...kinds].every(kind => ['documentation', 'presentation'].includes(kind)) ? 'presentation'
        : kinds.has('orders') ? 'orders' : 'web';
  const catalog = preflightSteps({ build });
  const web = changes.some(change => change.path.startsWith('apps/web/'));
  const extension = changes.some(change => change.path.startsWith('extensions/'));
  const requiredEvidence = [];
  let steps = [];
  if (profile !== 'no_changes') steps.push(diff);
  if (profile === 'full') {
    steps.push(...catalog);
    requiredEvidence.push('formal_release_gates');
  } else if (!['documentation', 'no_changes'].includes(profile)) {
    if (web) steps.push(...catalog.filter(step => step.id === 'web-typecheck'
      || step.id.startsWith('web-') && step.id !== 'web-build'));
    if (profile === 'orders') {
      steps.push(...catalog.filter(step => step.id === 'server-typecheck'));
      const related = changes.filter(change => ordinaryOrder(change.path) && change.status !== 'D').map(change => change.path.slice('apps/server/'.length));
      if (related.length) steps.push({ id: 'order-related-tests', name: 'Order owner and dependent Vitest tests', command: 'pnpm',
        args: ['--filter', 'server', 'exec', 'vitest', 'related', '--run', ...related] });
      else steps.push(...catalog.filter(step => step.id === 'server-test'));
    }
    if (extension) steps.push(...catalog.filter(step => step.id === 'extension-verify'));
    if (build && web) steps.push(...catalog.filter(step => step.id === 'web-build'));
    if (build && profile === 'orders') steps.push(...catalog.filter(step => step.id === 'server-build'));
    if (build && extension) for (const target of ['cloud', 'local']) steps.push({ id: 'extension-' + target + '-build',
      name: target + ' extension build and verification', command: 'pnpm', args: ['build:extension:' + target] });
    requiredEvidence.push('browser_changed_surface', 'formal_release_gates');
    if (profile === 'orders') requiredEvidence.push('order_database_state_if_changed');
  }
  steps = [...new Map(steps.map(step => [step.id, step])).values()];
  return {
    schemaVersion: 1, kind: 'SS_ERP_LOCAL_CHANGE_VALIDATION_PLAN', profile,
    changes: changes.map(change => ({ ...change })), build, steps,
    requiredEvidence, formalReleaseEvidence: false,
    freshHostedSuite: profile === 'full' ? 'required_or_prove_unchanged_runtime' : 'not_required_by_local_change',
    deployment: 'NOT_EXECUTED', publication: 'NOT_EXECUTED',
  };
}
