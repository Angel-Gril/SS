// Read-only UI refresh. It neither advances a suite nor submits/retries a job.
const activeStates = new Set(['PLANNED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
// Presentation cache only. Mutation controls keep consuming the current ERP
// projection; a loading transition must not reset a running poll's budget.
export function createImageProcessContext() {
  let base = '', last = null;
  const retiredKeys = new Set();
  return { read(nextBase, context, billingState, historyState) {
    if (nextBase !== base) { base = nextBase; last = null; retiredKeys.clear(); }
    if (context.billing?.suite) {
      const key = JSON.stringify([base, context.billing.quote?.previewHash || '']);
      if (last && retiredKeys.has(key)) return last;
      if (last && last.key !== key) {
        retiredKeys.add(last.key);
        if (retiredKeys.size > 16) retiredKeys.delete(retiredKeys.values().next().value);
      }
      last = { key, status: context.billing.suite.status,
        presentation: { ...context, history: context.history || (historyState === 'loading' ? last?.presentation.history : null) } };
      return last;
    }
    if (base && billingState === 'loading' && last) return last;
    last = null;
    return { key: '', status: undefined, presentation: context };
  } };
}
export function createImageProcessPoller({ getContext, read, onError = () => {}, onExhausted = () => {},
  intervalMs = 3000, maxAttempts = 80, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let key = '', attempts = 0, timer = 0, epoch = 0, reading = false, disposed = false, exhausted = false;
  const clear = () => { if (timer) clearTimer(timer); timer = 0; };
  function sync() {
    if (disposed) return;
    const context = getContext() || {};
    if ((context.key || '') !== key) {
      clear(); key = context.key || ''; attempts = 0; epoch += 1; reading = false; exhausted = false;
    }
    if (!key || !activeStates.has(context.status)) { clear(); return; }
    if (timer || reading) return;
    if (attempts >= maxAttempts) {
      if (!exhausted) { exhausted = true; onExhausted(context); }
      return;
    }
    const observedEpoch = epoch;
    timer = setTimer(async () => {
      timer = 0;
      if (disposed || observedEpoch !== epoch || getContext()?.key !== key) return;
      reading = true; attempts += 1;
      try { await read({ key, epoch: observedEpoch }); }
      catch (error) { if (!disposed && observedEpoch === epoch && getContext()?.key === key) onError(error); }
      finally { if (!disposed && observedEpoch === epoch) { reading = false; sync(); } }
    }, intervalMs);
  }
  return { sync, restart() { if (!disposed) { clear(); attempts = 0; exhausted = false; sync(); } },
    dispose() { disposed = true; epoch += 1; clear(); },
    state: () => ({ key, attempts, reading, exhausted, disposed }) };
}
