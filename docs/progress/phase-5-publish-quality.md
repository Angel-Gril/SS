# Phase 5: Publishing Closure and Product Quality

Progress: 2/4 tasks.

## Tasks

- [x] `INT-03` Unify ordered media/Ozon publish semantics (`P0`, `L`). Acceptance: both
  modes use one current draft compiler, validation, publish grant, receipt, queue, and
  reconciliation; local-only/rejected/unknown/stale/unbound slots cannot publish; recovery
  never creates a second submission.
- [x] `QA-03` Complete accessibility/responsive Chrome QA (`P0`, `L`). Acceptance: target
  desktop/mobile viewports have no overlap/clipping; keyboard, focus, live status, 200% zoom,
  reduced motion, stable media dimensions, contrast, screenshot, and DOM checks pass.
- [ ] `QA-04` Run full security/billing/auth/package regression (`P0`, `XL`). Acceptance:
  sentinel, endpoint, permission, hostile image, stale/revoked, billing, idempotency,
  one-receipt, remote-code, cloud/local package, lint, typecheck, tests, preflight, builds, and
  verifier pass.
- [ ] `DOC-01` Document setup, charges, permissions, recovery, and privacy (`P1`, `M`).
  Acceptance: docs distinguish hosted/external charges, session keys, capability probes, data
  sent to Provider, retry risk, draft review, and ERP-owned publishing.

## Parallel Lanes

- Lane A: `INT-03`.
- Lane B: `QA-03`.
- Lane C: `QA-04`.
- Lane D: `DOC-01` after UI and publish contracts stabilize.
- Merge risk: medium around publish client and package verifier.

## Notes

- No rollout begins if any secret, billing, stale-draft, or one-receipt invariant fails.
- `INT-03` converges `ERP_HOSTED` and `BYOK` on one device-scoped publish contract. The server
  re-reads the current draft, validates the complete authoritative media order, records the existing
  publish intent, and returns the unchanged `OZON_PUBLISH` command envelope used by the established
  grant, receipt, executor, and reconciliation path. Mixed hosted/BYOK drafts link all matching BYOK
  provenance rows to the same receipt.
- Only exact `BOUND` workspace slots can request a preview. Local, rejected, unknown, expired,
  stale, reordered, or unbound selections fail closed before intent creation. Hosted assignment and
  BYOK atomic ingest now project receipt-bound asset IDs into the same publish workspace; restart
  recovery without asset mappings falls back to an authoritative draft reload.
- Confirmation requires a trusted checkbox action. Double-clicks coalesce, timeout/reload recovery
  reuses one draft-version-bound idempotency identity, a `PENDING` receipt is never redispatched, and
  only an authoritative `NOT_COMMITTED` result permits same-identity dispatch. Session storage never
  retains grants, Provider secrets, Ozon credentials, binary media, or raw Prompts.
- Verification passed: lint (existing warnings only), workspace typecheck, 4,268 server tests,
  preflight, focused Hosted/BYOK/controller/vertical tests, cloud package `449/0/0`, local/source
  package `445/2/0` (expected local permission warnings), and `git diff --check`.
- `QA-03` passed in a real unpacked Playwright Chromium extension at 1440x900, 1024x768,
  768x900, 390x844, and native 200% tab zoom. Root and coherent-element overflow, mobile touch
  targets, keyboard SKU/library navigation, focus visibility, live announcements, reduced motion,
  forced colors, stable 1:1 media dimensions, workbench/Provider contrast, secret-field state, and
  page/service-worker console checks all passed. The final QA health score is 100/100.
- Three medium accessibility findings were closed: the workbench muted token and Provider brand
  background now pass WCAG AA, and slot reordering now returns focus to the same slot's available
  opposite-direction control (or its selector) when Chrome rejects focus on a newly disabled
  button. The focus behavior has a dedicated red/green regression wired into preflight.
- Final `QA-03` gates passed: lint (existing warnings only), workspace typecheck, full preflight
  `445` checks with zero failures, source/local verifier `445/2/0` (expected local warnings), cloud
  verifier `449/0/0`, and `git diff --check`. No real Provider request, charge, ERP ingest, Ozon
  write, production mutation, VPS access, or deployment occurred.
