# Phase 4: Release and Cutover

- [x] D4.1 Add donor-based package/security verifier regressions.
- [ ] D4.2 Run allowlist browser canary for donor workbench.
- [ ] D4.3 Cut source-page entrypoint with rollback evidence.

## Current Slice

- The formal package verifier requires every donor contract/bridge/page asset, the background prompt-handoff owner, content and page dependency order, the exact five marketplace WAR matches and the `enabled !== true` default-off guard.
- The verifier rejects donor page `fetch`, direct Ozon endpoint text, `chrome.debugger`, broad `https://*/*`, missing styles/modules and dependency inversions. Existing package secret, remote-code, CSP and host-permission scans still apply.
- `extension-donor-workbench-package-verifier.test.mjs` mutates an isolated package to remove the prompt adapter, add `<all_urls>`, defeat the default-off check, invert page scripts and inject an Ozon fetch; all five failures are required. The test is registered in preflight.
- Source package verification is now `490 pass / 0 failure / 0 warning`. This proves package/security wiring only; no signed candidate, deployment, allowlist canary or production cutover was executed.

## Remaining

- `D4.2`: create a commit/package-bound allowlist canary with production entrypoint unchanged and zero unapproved Provider/Ozon writes.
- `D4.3`: switch the source entrypoint only after independent browser evidence and a tested rollback to the current workbench.
