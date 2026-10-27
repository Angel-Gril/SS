import { canonicalTimestamp, exactKeys, isSha256, pngEvidence, requireThat } from './qa04-final-evidence.mjs';
const CODE = 'QA04_SUITE_TARGET_UI_REQUIRED';
export function verifyCurrentSuiteUiEvidence(reader, reference, bridge, offlineCompletedAt, now, options = {}) {
  requireThat(reference, CODE);
  const value = reader.json(reference, CODE, { nativeCompact: true });
  exactKeys(value, ['schemaVersion', 'kind', 'gitCommit', 'version', 'observedAt', 'releaseSignatureSha256',
    'cloudZipSha256', 'installedTreeSha256', 'workerScriptSha256', 'runtimeWorkerScriptSha256',
    'visible', 'sourcePageVisible', 'controlsVisible', 'mutations', 'viewport', 'css', 'screenshot'], CODE);
  const at = canonicalTimestamp(value.observedAt, CODE), current = canonicalTimestamp(now, CODE);
  const minimumObservedAt = options.minimumObservedAt || offlineCompletedAt;
  const requireRecent = options.requireRecent !== false;
  requireThat(value.schemaVersion === 1 && value.kind === 'SS_ERP_SUITE_TARGET_UI_READBACK'
    && value.gitCommit === bridge.targetCommit && /^\d+\.\d+\.\d+$/u.test(value.version || '')
    && at >= canonicalTimestamp(minimumObservedAt, CODE) && at <= current
    && (!requireRecent || current - at <= 60 * 60 * 1000)
    && ['releaseSignatureSha256', 'cloudZipSha256', 'installedTreeSha256', 'workerScriptSha256'].every(key => isSha256(value[key]))
    && value.workerScriptSha256 === value.runtimeWorkerScriptSha256 && value.mutations === 0
    && value.visible === true && value.sourcePageVisible === true && value.controlsVisible === true, CODE);
  exactKeys(value.viewport, ['width', 'height'], CODE);
  requireThat(Number.isInteger(value.viewport.width) && value.viewport.width >= 800 && value.viewport.width <= 3840
    && Number.isInteger(value.viewport.height) && value.viewport.height >= 600 && value.viewport.height <= 2160, CODE);
  const image = pngEvidence(reader, value.screenshot, CODE);
  requireThat(image.width === value.viewport.width && image.height === value.viewport.height, CODE);
  const styles = bridge.changes.filter(change => change.kind === 'CSS_PRESENTATION');
  requireThat(Array.isArray(value.css) && value.css.length === styles.length, CODE);
  for (const [index, change] of styles.entries()) {
    const applied = value.css[index]; exactKeys(applied, ['path', 'targetObjectId', 'applied'], CODE);
    requireThat(applied.path === change.path && applied.targetObjectId === change.targetObjectId && applied.applied === true, CODE);
  }
  return { receiptSha256: reference.sha256, observedAt: value.observedAt,
    releaseSignatureSha256: value.releaseSignatureSha256, version: value.version, screenshotSha256: value.screenshot.sha256 };
}
