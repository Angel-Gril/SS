# Dual-Mode Extension AI Image Workflow: Master Progress

## Task

Build one SS ERP browser-extension image workbench with two explicit execution modes:

- `ERP_HOSTED`: ERP owns Provider execution, pricing, quota, queue, storage, candidate
  review, draft application, and Ozon publishing.
- `BYOK`: the extension background calls the user's approved AI Provider with a session-only
  API key, the user reviews results locally, ERP normalizes and binds accepted media, and the
  existing ERP publisher performs the final Ozon submission.

The workbench recreates the useful reference workflow in original SS ERP code and visual
language. It does not copy reference source, assets, branding, strings, identifiers, unsafe
credential storage, or direct Ozon calls.

## Analysis

- [Project overview](../analysis/project-overview.md)
- [Module inventory](../analysis/module-inventory.md)
- [Risk assessment](../analysis/risk-assessment.md)

## Plan

- [Task breakdown](../plan/task-breakdown.md)
- [Dependency graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Project Skill

- [Develop dual-mode AI workbench](../../.codex/skills/develop-dual-mode-ai-workbench/SKILL.md)

## Implementation Phases

- [x] Phase 0: Contract and regression baseline (3/3 tasks) [details](./phase-0-contract-baseline.md)
- [x] Phase 1: Default-off security foundation (7/7 tasks) [details](./phase-1-security-foundation.md)
- [x] Phase 2: Secure single-image BYOK vertical slice (10/10 tasks) [details](./phase-2-byok-vertical-slice.md)
- [ ] Phase 3: Edit operations and batch engine (4/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [x] Phase 4: Complete dual-mode workbench (5/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (3/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 32/37 tasks complete (86%).

## Current Status

`DOC-01` is complete. `QA-02` preparation now uses a private canonical closed-schema `v2`
one-request approval with `approvedAt`/`expiresAt`, a positive validity window capped at 60 minutes,
strict UTF-8/duplicate-key/bounded-file checks, and freshness rechecks after DNS, at the immutable
claim, before Provider execution, and at both generation/edit POST boundaries. The offline
`sandbox:ai-image:approval:verify` command rejects submit secrets, non-HTTPS/localhost endpoints,
and any exact request mismatch while performing no DNS, intent/fingerprint, or Provider operation.
Before human approval, the separate `sandbox:ai-image:approval:draft` command can bind the same
non-secret request into one exclusive private canonical file. Independent statement/timestamp
sentinels keep that file impossible for the approval loader to accept until a human reviews every
field and manually replaces only those three values; the command refuses secrets, paid
confirmation, existing approval configuration, unsafe media/endpoints/parents, revision drift, and
overwrites while performing no DNS, Provider, intent, or fingerprint operation.
The request claim is closed to known fields and replay identity binds only actual Provider transport
semantics, so approval, profile/dimension metadata, credential revision, adapter revision, or a new
Operation ID cannot authorize the same paid POST again. Git marker/HEAD drift, dirty tracked files,
and Git inspection errors fail closed; in Git checkouts paid executables must also be tracked and
byte-identical to the bound revision, Git HEAD is re-read after status inspection, and Git receives
a minimal secret-free environment with hooks and fsmonitor disabled. Official sandbox CLIs reject
marker-only release archives; VPS execution requires a private checkout of the deployed revision.
A separate network-free
`sandbox:ai-image:billing:finalize` command now verifies private before/settled billing snapshot
bytes, the v2 intent, v3 submit report, recomputed transport fingerprint, approval-time chronology,
Provider correlation, and all artifact digests before writing one append-only sanitized settlement.
The original intent/report remain byte-identical with `actualCostCents: null`; exact replay remains
idempotent across compatible finalizer revisions, over-budget charges are recorded as
`COST_LIMIT_EXCEEDED`, and settled billing cannot upgrade a `RECONCILIATION_REQUIRED` Provider
outcome. Snapshot identity uses canonical paths plus bigint device/inode evidence, output creation is
bound to one private directory identity, and a different finalizer revision can only return an exact
existing receipt. Focused draft/approval/runner/guard/billing tests passed `114` with one
Windows-only POSIX boundary test skipped; repository lint (existing warnings only), workspace
typecheck, the static
contract, sandbox TypeScript compilation, and full preflight passed. Preflight reported `445` passes
and `0` failures. No implementation task is dependency-ready until an edit-capable endpoint/model
and the exact paid `QA-02` request are explicitly approved; `QA-04` and release remain downstream.
All flags remain default-off; no real Provider request, charge, ERP ingest, Ozon write, production
mutation, VPS access, deployment, or `.context/` staging occurred.

The latest offline hardening binds Linux approval-draft writes, paid-request claim/intent artifacts,
and final billing durability syncs to held private directory descriptors with final visible-path and
handle identity checks. Parent or child replacement cannot silently redirect an artifact into a
replacement path before Provider dispatch. Approval drafting and exact-request preflight now share
one no-follow, descriptor-bounded media verifier that pins SHA-256, enforces the shared `50 MiB` edit
limit before reading excess mask bytes, and verifies MIME, dimensions, pixels, single-page state and
meaningful PNG mask alpha. Hostile-media tests cover non-images, animated WebP, read-time growth and
invalid masks; Linux-only tests cover final-entry symlinks and independent parent/child replacement.
Focused tests passed `197` with six platform/environment-specific skips; full server tests passed
`4371` with `194` skipped. The static contract, sandbox compilation, repository lint (existing
warnings only), workspace typecheck, diff check and full preflight passed; preflight reported `445`
passes, `0` failures and two expected local-package permission warnings. Independent reviews found
no P0/P1 issue. An isolated Docker Linux run corrected an over-broad test fault seam and then passed
the two filesystem/media boundary files `8/8` with runtime networking disabled, including all cases
skipped on Windows; production code did not require a change. Phase 3 remains `4/5` and overall
progress remains `32/37`: no exact paid `QA-02` capability evidence exists yet, all rollout flags
remain default-off, and no Provider call, charge, production mutation, VPS access, deployment, flag
change, or `.context/` staging occurred.

A subsequent sanitized read-only audit found both VPS deployments at `c98a2e4`: international kept
the third-party relay under a legacy `openai-images` label with model `gpt-image-2`, zero price and
all AI media/extension flags off, while domestic remained disabled. One bounded authenticated
`GET /models` returned only that already edit-rejected model and made no generations/edits request.
The paid runtime contract now independently restricts `openai-images` to the canonical official API
and requires relays to use `custom`; manually constructed matching legacy v1 generation/edit
contracts fail before Provider resolution, and suite readiness fails closed even with injected
sandbox evidence. Focused tests passed `138/138`. Phase 3 remains `4/5` and overall progress remains
`32/37`: a different edit-capable endpoint/model and explicit one-request approval are still required.
The final regression run exposed one stable-error mapping issue when an existing paid workflow was
replayed after its endpoint changed; quote reconstruction failures now remain
`MEDIA_PROVIDER_CONFIG_CHANGED` and no job is enqueued. Its focused test passed `83/83`. Repository
lint passed with `20` existing warnings and no errors, workspace typecheck passed, full server tests
passed `4376` with `194` skipped, and preflight passed `445` checks with no failures and the two
expected local-extension permission warnings. Bare official origins now bind the effective `/v1`
transport; a pre-existing v1 contract using the older bare-origin hash fails closed and must be
recreated rather than retried. No Provider call, charge, production mutation, deployment, flag
change, or `.context/` staging occurred during these gates.

The remaining `QA-02` promotion path is now structurally bound to exact sandbox evidence rather than
a provider/model-wide label. Each verified record must match the canonical endpoint SHA-256,
operation, input transport, and sync/async result mode. Generation, edit, translation, and paid-suite
dispatch all fail closed on a missing or mismatched binding; accepted asynchronous translation tasks
still retain their existing poll-only recovery path after registry tightening. A static contract
prevents future registry entries from being marked `sandbox-verified` without complete per-operation
bindings. Focused capability/worker/suite tests passed `87/87`, the Server typecheck passed, and the
Provider foundation contract passed. Repository lint passed with `20` existing warnings and no
errors, workspace typecheck passed, full Server tests passed `4383` with `194` skipped, and preflight
passed `445` checks with no failures and the two expected local-extension permission warnings.
Phase 3 remains `4/5` and overall progress remains `32/37`:
there is still no different edit-capable endpoint/model or explicitly approved paid request. All
production flags remain off, and this offline work made no Provider request, charge, production
mutation, VPS access, deployment, or `.context/` staging.

The supplied custom relay candidate then exposed and closed the remaining preflight identity gaps
without a paid call. Server and extension now canonicalize a bare origin or custom prefix to its
effective `/v1` API Base under one strict HTTPS multi-label-DNS/path contract. Existing extension
profiles migrate serially by invalidating generated results and physically deleting the session Key,
capability evidence, uncertain probes and Provider dispatches before canonical metadata is exposed;
legacy custom frozen hashes fail before Provider resolution. New sandbox verification/output uses
explicit API-base and operation-endpoint hashes (verification v2, submit report v4), while billing
retains exact historical v3 compatibility and emits a dual-hash v2 receipt for current reports.
Combined focused tests passed `246` Server checks with one Windows skip and `95` extension checks;
full Server tests passed `4422` with `194` skipped, lint passed with `20` existing warnings and no
errors, workspace typecheck passed, preflight passed `445/0`, and cloud/local package verification
passed `449/0/0` and `445/2/0` at build version `1.0.264`. Independent review found no P0/P1 issue.
The candidate then passed a bounded authenticated read-only model-catalog check: HTTP 200 with the
exact `gpt-image-2-count` alias as the only listed model. Its Key remains in a private DPAPI file
outside the repository, and raw catalogue/account/billing snapshots remain private. Read-only
billing checks established the paired quota and displayed-usage meters without a Provider POST.

The international sandbox evidence chain now represents sub-cent prices with closed exact-money
objects rather than floats: approval v3, intent v3, submit report v5, billing attestation v2 and
receipt v3 preserve `CNY amount=119 scale=4` exactly. Legacy cents generations remain readable but
cannot authorize or finalize an exact request. Exact intent/report artifacts bind both API Base and
operation-endpoint digests, and finalization requires independent raw-quota and displayed-usage
deltas to prove one actual cost. Focused tests passed `166` with two platform-specific skips; the
static contract, sandbox compilation, diff check, repository lint (`20` existing warnings, no
errors), workspace typecheck, full Server tests (`4468` passed, `194` skipped), and a clean full
preflight rerun passed. Cloud/local/source package verification passed `449/0/0`, `445/2/0`, and
`445/2/0` at build version `1.0.264`.

Phase 3 remains `4/5` and overall progress remains `32/37`: the Provider does not expose a retained
account-specific price record for the alias, but QA-02 does not require live Provider pricing sync.
The selected policy is a private, versioned backend price/limit record bound to the exact alias,
operation, profile, quality, size, image count and currency. It still needs explicit review and a
single-request maximum before any POST. The exact-money implementation and verification made no
Provider POST, image charge, feature-flag change, ERP AI generation, media ingest, Ozon write or
`.context/` staging.

Commit `9e7c8140a17592b76be4b219332f65b58d18cb3f` was then pushed and dark-deployed to both
app-dir VPS targets with every AI Media, extension workbench, legacy generation, translation and
Ozon publisher flag still off. The international backup is
`/var/backups/ss-erp/ss_erp_20260730_053537.sql.gz` (about 36 MB), and the domestic backup is
`/var/backups/ss-erp/ss_erp_20260730_134042.sql.gz` (8.2 MB). Both deployments applied the same
eight pending migrations, passed the post-migration database guard, runtime upload diagnostics,
service/local/public readiness, clean-log and dark-rollout checks, and now report the exact deployed
commit. The domestic verifier additionally passed direct-origin HTTPS, certificate, ACME and unknown
Host rejection checks for all four `.cn` hostnames. Each full verifier reported zero failures and one
warning because backup replication is not configured beyond the readable local artifact. These
authorized deployment and schema changes made no Provider POST, image charge, feature-flag change,
ERP AI generation, media ingest or Ozon write. `QA-02` therefore remains open at `4/5`, and overall
progress remains `32/37`.

The international sandbox CLI now has a private checkout at
`/opt/ss-erp/private/ai-image-sandbox/checkouts/9e7c8140a17592b76be4b219332f65b58d18cb3f`.
It is owned by `deploy:deploy` with mode `0700`; its exact HEAD, required paid-CLI Git blobs and clean
tracked worktree were verified, frozen dependencies were installed, and the sandbox TypeScript
configuration passed. Its ignored `tmp/ai-image-sandbox` link resolves to the deploy-managed private
`/opt/ss-erp/shared/ai-image-sandbox` evidence directory. No Key or private account artifact was
transferred, and no Provider command was run.

The operator subsequently approved exactly one `TEXT_TO_IMAGE` request for
`gpt-image-2-count`, `1024x1024`, `n=1`, with quote and single-request maximum both exact
`CNY amount=119 scale=4`. Operation `qa02-t2i-20260730-063129-01` made one Provider POST without a
retry and returned one visually accepted 1024x1024 PNG. Private before/after meters independently
proved raw quota delta `5950` and displayed usage delta `1.19`, both equal to `CNY 0.0119`.
Commit `5f6d3dd8ccac5e060189bec427400cc06c3a97ec` now binds exact settlement to one authenticated
Relay Token-log entry and globally claims that immutable billing identity. Security review closed
an isolated-claim recovery gap by also binding the claim to the attestation digest and found no
remaining P0/P1 issue. Focused tests passed `51` with one Windows skip; lint, static/sandbox
contracts, workspace typechecks, full preflight (`445/0` with two expected warnings), and the full
Server suite (`4488` passed, `194` skipped) passed.

The official network-free finalizer ran from a clean deploy-owned private checkout of `5f6d3dd`.
Its sanitized v4 receipt has SHA-256
`83ec0e913baefe0cfb5145d983ce48bf237865d0479725354d792c1e8b9b0423` and records `SUCCEEDED`,
`CHARGED`, `billingGate=PASS`, actual/quoted/maximum `CNY 0.0119`, one billed unit and
`sameRequestRetryAllowed=false`. Exact replay returned the same receipt bytes. Original
intent/report hashes remained unchanged, append-only outputs are private, and both VPS dark
verifiers passed. This was one real Provider charge; it did not switch either production app,
enable a flag, generate or ingest ERP media, write Ozon, or stage `.context/`.

Phase 3 remains `4/5` and overall progress remains `32/37`. The Relay has no documented or
configured explicit async task protocol for this alias/profile, so async is recorded unsupported
without another paid POST. The completed text-to-image evidence does not prove reference edit, full
edit or inpaint. Each edit operation requires a separate exact backend price/limit record, explicit
single-request approval and reconciled evidence. `QA-04`, `REL-02`, `REL-03` and `REL-04` remain
blocked behind full `QA-02` acceptance.

The operator then approved one separate `IMAGE_TO_IMAGE` request for `gpt-image-2-count`, the same
square profile and the accepted mug source, with quote `CNY 0.0119` and maximum `CNY 1.0000`.
Policy/source/pre-call snapshot, revision, dark state and official offline approval verification all
passed. Operation `qa02-i2i-20260730-083710-01` made exactly one `/v1/images/edits` POST and returned
a definite `REJECTED` v5 report after `155 ms`, with `createRequests=1`, no Provider request-ID hash
and `PROVIDER_REQUEST_FAILED`. It was not retried.

Both Provider meters had zero delta and the authenticated Token log had no matching consume entry.
The official finalizer wrote sanitized exact receipt v3 SHA-256
`c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855`, recording `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; exact replay returned the
same bytes. Both VPS remained dark. The alias is therefore directly evidenced as generation-capable
but incompatible with the Relay's shared edit transport. `FULL_EDIT` and `INPAINT` were not sent and
must not be attempted against this same endpoint/model.

Task counts remain Phase 3 `4/5` and overall `32/37`. Full `QA-02` now requires a different
edit-capable endpoint/model; `QA-04`, `REL-02`, `REL-03` and `REL-04` remain dependency-blocked.

The alternate candidate `https://ai.centos.hk` then passed a no-key public network preflight. Its
effective API Base is `https://ai.centos.hk/v1`; public resolvers and the international VPS returned
three Cloudflare public IPv4 addresses, TLS 1.3/SNI/hostname verification passed, and the project
URL/SSRF validator accepted it from clean checkout `5f6d3dd`. Bounded unauthenticated GET checks
confirmed `/v1/models` is credential-gated and made no redirect or Provider operation.

The candidate's public pricing revision lists `gpt-image-2` with `model_price=0.1` under the site's
CNY display configuration, but advertises only `/v1/images/generations` for image traffic and does
not advertise `/v1/images/edits`. This is not edit-capability evidence and is not a maximum-cost
authorization. Public snapshots and manifest SHA-256
`92d0bf08298d0c9254687ca1e0369200f99dc68c5451180ccf2182937dc3b6b4` remain outside Git. The Key
provided in conversation is treated as exposed; it was not used and must be rotated before a
private DPAPI-injected, authenticated read-only catalogue/account check. No authenticated request,
Provider POST, charge, production mutation, deployment, flag change, or `.context/` staging
occurred. Counts remain `32/37`.

## Next Steps

1. Do not repeat `qa02-t2i-20260730-063129-01` or `qa02-i2i-20260730-083710-01`; both requests and
   billing are closed and their receipts explicitly forbid same-request retry.
2. Do not send `FULL_EDIT` or `INPAINT` to the current relay/alias. For the alternate
   `ai.centos.hk` candidate, first revoke/rotate the exposed Key and load the replacement only
   through private local DPAPI storage. Then perform one bounded authenticated read-only catalogue
   and account/billing check. Do not infer edit support from its public generation-only metadata.
3. After selecting an actually edit-capable endpoint/model, prepare separate bounded source/mask
   bytes and a private versioned backend policy for each operation. Bind the exact profile, quote
   and one-request maximum; Provider pricing API sync is not required. Obtain a new explicit
   approval for each paid POST and settle it before the next operation.
4. Keep async marked unsupported unless the Relay supplies an explicit task protocol; absence does
   not justify a paid POST. Do not promote any edit capability from text-to-image evidence.
5. Run `QA-04` only after all `QA-02` operation-specific evidence is accepted; then proceed in order
   through `REL-02`, `REL-03` and `REL-04`.
6. Do not downgrade to an old extension while a BYOK batch is pending. Drain the batch first or use
   a rollback package carrying the new launch-session and Registry recovery layer.

## Cross-Conversation Protocol

At the start of every development session:

1. Read this file first.
2. Read the active phase file and its referenced plan section.
3. Check the current Git worktree without reverting unrelated user changes.
4. Mark exactly one active task in the native task tracker.
5. After completing a task, update its checkbox, the phase count, the overall count, Current
   Status, and Next Steps before moving to another task.

## Non-Negotiable Invariants

- API keys stay background-only in `chrome.storage.session` for the first release.
- BYOK creates no ERP AI generation reservation or settlement.
- Hosted paid execution always uses ERP cost controls and candidate review.
- Every publish-selected BYOK image is normalized, persisted, hashed, and draft-bound first.
- Both modes publish only through the existing ERP command-grant, receipt, and reconciliation
  path. The extension never stores Ozon credentials or calls Ozon directly.
- Provider capability evidence is exact to endpoint, model, operation, and request mode.
- No reference extension source, assets, branding, strings, identifiers, or unsafe defaults
  are copied.
