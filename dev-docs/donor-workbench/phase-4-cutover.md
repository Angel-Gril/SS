# Phase 4: Release and Cutover

- [x] D4.1 Add donor-based package/security verifier regressions.
- [x] D4.2 Run allowlist browser canary for donor workbench.
- [ ] D4.3 Cut source-page entrypoint with rollback evidence.

## Current Slice

- The formal package verifier requires every donor contract/bridge/page asset, the background prompt-handoff owner, content and page dependency order, the exact five marketplace WAR matches and the `enabled !== true` default-off guard.
- The verifier rejects donor page `fetch`, direct Ozon endpoint text, `chrome.debugger`, broad `https://*/*`, missing styles/modules and dependency inversions. Existing package secret, remote-code, CSP and host-permission scans still apply.
- `extension-donor-workbench-package-verifier.test.mjs` mutates an isolated package to remove the prompt adapter, add `<all_urls>`, defeat the default-off check, invert page scripts and inject an Ozon fetch; all five failures are required. The test is registered in preflight.
- Source package verification is now `490 pass / 0 failure / 0 warning`. D4.1 proves package/security wiring only; at that checkpoint no signed candidate, deployment, allowlist canary or production cutover had been executed. The later isolated D4.2 canary is recorded below.
- The donor entrypoint now additionally requires an exact normalized `platform:sourceProductId` member in `ss-erp:donor-workbench-preview-allowlist:v1` (maximum 20). `enabled=true` alone cannot mount it; malformed, duplicate, oversized or nonmatching lists fail closed. Storage changes re-evaluate and unmount immediately.
- Clean-commit unpacked MV3 canary v2 passed on `8106c1688bc44ebce1b18269971a516910664c5a`, extension-tree SHA-256 `999c7f8199d9f7f62c12a3e5a0f92fbd4cbb8e837195b88f8f42298e249f7ee7`. `1688:990499606077` mounted only after allowlisting; adjacent `1688:990499606078` did not. Receipt: `C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-9XVUf7\summary.json`.
- Canary browser was Chrome `147.0.7727.15`, with zero page errors, blocked unexpected requests, Provider requests, Ozon requests and production mutations. It used a synthetic intercepted source page on the exact 1688 URL and is not a signed/deployed/live-product acceptance.
- D4.3 authorization was granted. `5265107d` preserves the five-origin donor WAR boundary in cloud/local packages; the release-bound live canary added from `ad086d3b` verifies the active Ed25519 signature, canonical evidence, cloud ZIP byte equality, candidate tree, monitored Worker startup, real product fingerprints, flag-only rejection, exact allowlist, distinct-product rejection, extension mutations and storage-key rollback.
- Local versions `1.0.366-1.0.370` were rejected during fail-closed runner validation and were never uploaded or deployed. The latest rejected candidate is `397d3ac4 / 1.0.370`, with evidence SHA-256 `0225cbbb68f312f68a10b6f2d6d04537102c4974ce3b69f23df656f347491674` and signature SHA-256 `7dbf07a31fa67dca853b377a08ea8dac8686b7e87b10c26566f1c5e2a4090ab5`.
- System Chrome `153.0.8010.48` can load the candidate through monitored CDP and reaches the exact real 1688 frame/loader, but the isolated headless document remains `readyState=loading`. Three loader/readiness strategies failed closed, so no D4.3 PASS receipt exists and the repeated-failure stop condition is active.

## Remaining

- `D4.3`: first choose an authorized browser context with a valid 1688 session and obtain a release-bound real-product canary plus rollback receipt. Then obtain separate Provider-cost authorization for fresh final-commit QA04 evidence before deployment, regional canaries, website approval and CAS.
