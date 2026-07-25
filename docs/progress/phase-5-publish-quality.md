# Phase 5: Publishing Closure and Product Quality

Progress: 0/4 tasks.

## Tasks

- [ ] `INT-03` Unify ordered media/Ozon publish semantics (`P0`, `L`). Acceptance: both
  modes use one current draft compiler, validation, publish grant, receipt, queue, and
  reconciliation; local-only/rejected/unknown/stale/unbound slots cannot publish; recovery
  never creates a second submission.
- [ ] `QA-03` Complete accessibility/responsive Chrome QA (`P0`, `L`). Acceptance: target
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
