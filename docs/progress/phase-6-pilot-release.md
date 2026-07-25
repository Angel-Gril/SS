# Phase 6: Pilot and Release

Progress: 0/3 tasks.

## Tasks

- [ ] `REL-02` Run owner/shop/device pilots (`P0`, `M`). Acceptance: sandbox, then one-shop
  publish pilot succeeds; generation/ingest/publish kill switches are independent; audit and
  receipts are visible; rollback preserves consistent stored assets and receipts.
- [ ] `REL-03` Build/sign/distribute cloud and local extension packages (`P0`, `M`).
  Acceptance: same feature set with environment-correct endpoints, one version increment,
  non-secret profile upgrade, no session-key persistence, verified hashes, and smoke results.
- [ ] `REL-04` Deploy server/web and run canaries (`P0`, `M`). Acceptance: backup/migration,
  services, readiness, dark flags, both VPS environments, pairing, hosted regression, BYOK
  fixture ingest, and publish reconciliation pass before pilot enablement.

## Parallel Lanes

- Lane A: rollout controls and observability preparation.
- Lane B: final exact Provider sandbox evidence.
- Packaging and deployment execute sequentially after all quality gates pass.

## Notes

- Text-to-image pilot success does not automatically enable edits or inpaint.
- Each production operation remains limited to explicitly verified endpoint/model evidence.
