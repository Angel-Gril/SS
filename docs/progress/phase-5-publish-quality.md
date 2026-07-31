# Phase 5: Publishing Closure and Product Quality

Progress: 3/4 tasks.

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
- [x] `DOC-01` Document setup, charges, permissions, recovery, and privacy (`P1`, `M`).
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
  only an authoritative `NOT_COMMITTED` result permits same-identity dispatch. Publish recovery
  session records never retain grants, Provider secrets, Ozon credentials, binary media, or raw
  Prompts; BYOK API Keys remain separately scoped to `chrome.storage.session`.
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
- `DOC-01` adds one indexed user/admin guide for both execution modes. It documents default-off
  hosted/BYOK generation, ingest, and publish controls; the strict pilot JSON policy; session Key
  and persistent non-secret profile behavior; per-operation capability validation; exact-origin
  Chrome permissions; external versus ERP charges; data sent to Provider; candidate review, ERP
  normalization/binding, one-receipt Ozon publishing; and `UNKNOWN_OUTCOME` recovery without blind
  retry. It also corrects stale extension/deployment descriptions and distinguishes the historical
  AI Media dark verifier from the separate extension flags.
- The documentation contract is wired into preflight so links, flags, policy version, operations,
  privacy, billing, recovery, and default-off language cannot silently disappear. Focused docs,
  BYOK admin settings, Provider settings UI, and workspace UI tests passed; full preflight passed
  `445` checks with zero failures and expected source verifier warnings only. No real Provider
  request, charge, ERP ingest, Ozon write, production mutation, VPS access, or deployment occurred.
- A post-`410981e` offline `QA-04` rehearsal rebuilt extension version `1.0.264`; cloud strict
  verification passed `449/0/0` and local verification passed `445/2/0` with the two expected local
  permission warnings. The Server production build also passed. The local PostgreSQL gate exposed
  ten date-sensitive fixture failures: fixed July 27/28 pairing/session expiries had become earlier
  than PostgreSQL's insertion timestamp and violated the real expiry constraints. Both affected
  fixture families now retain the intended chronology with a valid creation/expiry relationship.
- The clean PostgreSQL rerun applied all `142` migrations to a new isolated schema, passed all 20 AI
  Media integration files, and passed the populated migration-upgrade sequence; temporary schemas
  were removed. Server typecheck and diff checks passed. `QA-04` remains unchecked because this is
  rehearsal evidence before its required complete `QA-02` operation matrix. No Provider request,
  charge, production mutation, VPS access, deployment, flag change, ERP ingest, Ozon write, or
  `.context/` staging occurred; Phase 5 remains `3/4` and overall progress remains `32/37`.
- A fail-fast `pnpm qa:04:offline` aggregate now publishes a machine-readable rehearsal manifest and
  runs exactly nine local gates: its own contract, `git diff --check`, workspace lint/typecheck,
  `preflight --build`, isolated scope-revocation and AI Media PostgreSQL integration lanes, and fresh
  cloud/local extension builds with verification. It explicitly reports that complete positive
  `QA-02` evidence is still required and contains no Provider, VPS, remote-smoke or deployment step.
- The final aggregate run passed in `583.5s`. Lint retained only the existing `20` Server and one
  shared warning; workspace typecheck, full preflight including Server tests and Server/Web builds,
  all PostgreSQL integration/upgrade gates, and both extension builds passed. Cloud verification was
  `450/0/0`; local verification was `446/2/0` with only the expected `<all_urls>` and `file:///*`
  warnings. A Prisma query confirmed no `20260730` test schema remained. This is durable rehearsal
  evidence, not formal `QA-04` completion: Phase 5 remains `3/4` and overall remains `32/37` until
  positive edit-capable `QA-02` evidence exists and the gate is rerun on that final revision.
- The offline aggregate now adds a separate ephemeral `logistics_test_*` PostgreSQL lane for the
  real command-grant/session/current-JTI/scope revocation matrix. All `142` migrations and `7/7`
  grant tests passed, including proof that scope loss consumes neither grant nor receipt, and the
  schema was removed afterward. Package verification now has adversarial rejection coverage for
  eval/Function, remote or computed imports/importScripts, runtime Worker construction,
  WebAssembly, remote script assignment and executable-code CSP relaxation. The source package
  verifier passed `446/2/0`; `QA-04` remains unchecked until complete positive `QA-02` evidence is
  accepted and the enlarged aggregate is rerun on that final clean revision.
- The enlarged nine-step `pnpm qa:04:offline` rehearsal passed end to end in `817.7s`. It reran
  lint with zero errors and the existing `20` Server plus one shared warning, workspace typecheck,
  full preflight with Server/Web production builds, the isolated scope/JTI/session revocation and
  AI Media PostgreSQL/upgrade lanes, and fresh extension builds. Cloud/local/source verification
  finished at `451/0/0`, `447/2/0`, and `446/2/0`; the two local/source warnings remain the expected
  broad local permissions. A post-run query found no schema containing `20260731`. The dangerous
  code matrix now separately rejects escaped remote `.mjs`, executable `.cjs`, remote-script SVG,
  CSP host sources and computed imports. This remains rehearsal evidence only: `QA-04`, Phase 5
  `3/4`, and overall `32/37` are unchanged pending complete positive `QA-02` evidence.
- A release-provenance follow-up closed cross-platform and local-Git substitution gaps before the
  formal gate. Repository-source package-input digests and deployment archives now read pinned raw
  Git blobs instead of checkout bytes, ignore `refs/replace`, and remove inherited Git redirects.
  Regressions cover CRLF/mixed worktrees, local attributes and clean/smudge filters,
  `assume-unchanged`, `skip-worktree`, untracked or missing files, and non-blob entries. The
  production download reader also accepts clean-checkout `GIT_HEAD` evidence when its commit exactly
  matches `DEPLOYED_COMMIT`, while still rejecting external source and the wrong commit. The final
  nine-step offline rehearsal passed in `991.8s`; cloud/local/source verification was `451/0/0`,
  `447/2/0` and `446/2/0`, the no-network root lifecycle passed `5/5`, and no `20260731` test schema
  remained. This is still rehearsal evidence: `QA-04`, Phase 5 `3/4`, and overall `32/37` remain
  unchanged until complete positive `QA-02`.
- The Packy capability-candidate helper and its preflight contract are QA-02 promotion hardening,
  not formal QA-04 evidence. It is deliberately `CANDIDATE_ONLY`, does not mutate the Provider
  Registry, and requires a separate trusted replay of the private intent, attestation, fingerprint,
  Token-log entry, and receipt chain before any Registry change. The offline matrix is green, but
  `QA-04` remains `3/4` until all three positive edit operations are accepted and this aggregate is
  rerun on the final clean revision.
