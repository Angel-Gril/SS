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

Current checkpoint (2026-08-01): `QA-02` remains the first unresolved dependency at Phase 3 `4/5`
and is blocked on positive acceptance from an edit-capable Provider. Replacement Packy credential
revision `packy-sora-key-rotation-20260801-02` passed
the official fixed seven-GET preflight from clean commit
`e4503e9253b15eea5540dd436bf027c713cd3739`, then the operator explicitly approved one exact
`IMAGE_TO_IMAGE` request for `gpt-image-2`, `1024x1024`, `n=1`, source SHA-256
`5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`, quote USD `0.08`, and
maximum USD `1.00`. Operation `qa02-packy-i2i-20260801-e4503e9-01` made exactly one guarded
`/v1/images/edits` POST and received a definite HTTP 400 `REJECTED` result after `1118 ms`; it was
not retried. Raw quota, displayed usage and Token log remained byte-identical, and official receipt
SHA-256 `0107a287f45e6b74e185ea4669057b9b5264f8617d4cc59facaa1ad8950cb363` records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`. This endpoint/credential/
model combination is negative edit evidence and must not be used for `FULL_EDIT` or `INPAINT`.
Here `createRequests=1` proves that the guarded client sent one HTTP POST and received the 400
response; it does not mean that Packy created an edit task. The null Provider request ID, unchanged
meters and empty consumption log are consistent with rejection before an accepted or billed task.
The operator has now confirmed through MOSS that the active credential belongs to the Sora group.
That closes the token-group prerequisite as an operator assertion, but the edit route remains
unverified. Offline code now isolates Packy's documented edit multipart contract under
`PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1`; it has not been sent and has incurred no charge.
`QA-04`, `REL-03`, `REL-04`, and `REL-02` remain blocked; overall progress stays `32/37` and all
rollout flags remain off.

`DOC-01` is complete. `QA-02` preparation now uses a private canonical closed-schema one-request
approval (`v3` for exact money; historical `v2` remains cents-only) with `approvedAt`/`expiresAt`,
a positive validity window capped at 60 minutes,
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
authorization. Its public frontend contains a generic `/v1/images/edits` route constant, but that
constant is not bound to this account, model or upstream channel. Public snapshots and manifest SHA-256
`92d0bf08298d0c9254687ca1e0369200f99dc68c5451180ccf2182937dc3b6b4` remain outside Git. The Key
provided in conversation was treated as exposed and was never used. The operator rotated it and
stored the replacement in a private current-user DPAPI file under non-secret revision
`centos-key-rotation-20260730-01`.

The replacement credential passed a bounded authenticated GET-only check with redirects disabled,
no body and a 1 MiB response cap. Its catalogue and Token model limits contain only `gpt-image-2`
and `gpt-image-2-2k`; both still advertise only `image-generation` and `openai`. Token quota,
displayed usage and the empty Token log were byte-identical before and after the checks, proving no
charge. Private read-only summary v3 SHA-256 is
`6ae534108272abcc84fef7f75abf8114d73304ea7ccca2bdb0283c771c1b510a`; secret scans were clean.
This proves the credential and reconciliation endpoints, not edit capability. No Provider POST,
charge, production mutation, deployment, flag change, or `.context/` staging occurred. Counts
remain `32/37`.

The operator then authorized one separate `IMAGE_TO_IMAGE` probe for the alternate candidate:
`gpt-image-2`, `1024x1024`, `n=1`, the accepted mug source, quote `CNY 0.1`, and maximum
`CNY 1.0`. Operation `qa02-centos-i2i-20260730-094857-01` passed the private policy, pre-call
snapshot, deployed-checkout, dark-state and official no-key approval gates. Its Key was injected
from DPAPI through SSH standard input and never entered a command argument or retained artifact.

Exactly one `/v1/images/edits` POST returned a definite `REJECTED` report after `302 ms`, with
`createRequests=1`, no Provider request-ID hash and `PROVIDER_AUTH_FAILED`. It was not retried.
Raw quota and displayed usage were byte-identical before/after and the Token log remained empty.
Official exact receipt v3 SHA-256
`9d1e5db49dc5b76e7de70e36cad88a7429e426b3e93de4207ad62a46c040e2d2` records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; exact replay returned the
same bytes. Both VPS remained dark and private-artifact credential scans passed.

This is operation-specific negative evidence: the rotated Token can read the catalogue and billing
endpoints but the current `gpt-image-2` edit route is not accepted. It does not prove this candidate's
generation behavior. `FULL_EDIT` and `INPAINT` must not be sent through the same endpoint/Token/model.
QA-02 still needs another edit-capable endpoint/credential or an explicit Provider-side edit enablement
followed by a fresh bounded approval sequence. Counts remain Phase 3 `4/5` and overall `32/37`.

The offline follow-up closed the remaining runtime gaps without promoting any failed or unverified
model. An exact sandbox-verified `custom` OpenAI-compatible profile can now pass generation,
image-to-image, full-edit, inpaint and paid-suite boundaries only when the active API Base, model,
operation, multipart/none transport and sync mode all match its operation-specific evidence. Route
readiness is rechecked before workflow creation and reservation, and queued generation performs the
same request check before its immutable Provider-dispatch fence; evidence drift therefore cannot be
misclassified as an uncertain network submission. Reference limits are operation-specific.
`INPAINT` accepts a decoded PNG/JPEG/WebP source but requires one same-size decoded PNG mask before
dispatch. Current sandbox quality remains `PROVIDER_DEFAULT_OMITTED`; an explicit quality tier needs
a new profile and pricing policy.

Future HTTP 4xx/5xx sandbox rejections write one private, exclusive v1 diagnostic sidecar bound to
the authoritative submit-report SHA-256. It contains only Operation ID and integer HTTP status,
does not change historical v4/v5 reports or billing semantics, and a sidecar failure cannot replace
the original Provider result. Focused tests passed `371/371`; the static contract, workspace
typecheck, lint (`0` errors with `20` existing Server and one shared warning), full Server suite
(`4509` passed, `194` skipped), and full preflight (`445/0` with two expected local-package warnings)
passed. Independent reviews found no remaining P0/P1/P2. No real Provider call, charge, deployment,
flag change, ERP media mutation, Ozon write, or `.context/` staging occurred. Phase 3 remains `4/5`
and overall progress remains `32/37` because positive edit capability evidence is still absent.

An offline `QA-04` rehearsal starting from pushed commit `410981e`, with the fixture fixes below,
then rebuilt and verified extension version `1.0.264`: cloud passed `449/0/0` and local passed
`445/2/0` with only the expected local permission warnings. The Server production build passed. The
real local PostgreSQL gate initially found ten expired test fixtures whose fixed July 27/28
pairing/session expiry preceded the database insertion time. The two fixture families now preserve
their intended event chronology while binding valid record creation time. A clean rerun applied all
`142` migrations to a fresh isolated schema,
passed all 20 AI Media PostgreSQL integration files, and passed the populated migration-upgrade
sequence; every temporary schema was removed. Server typecheck and diff checks passed. This is only
rehearsal evidence: `QA-04` remains open until complete positive `QA-02` evidence exists and the
entire gate is rerun on the final revision. No Provider request, charge, VPS mutation, deployment,
flag change, ERP media mutation, Ozon write, or `.context/` staging occurred. Counts remain `32/37`.

Release preparation now has one coordinated, fail-closed cloud/local packaging path without
claiming `REL-03` completion. `pnpm package:extension` chooses one version, holds an exclusive lock,
writes artifacts durably without overwrite, verifies extracted ZIP paths/CRC/file counts and
retains a canonical checksum plus closed-schema evidence. Three independently approved public HTTPS
origins must exactly match deployment defaults and every concrete cloud permission surface. Evidence
binds a full 40-character commit, source mode and deterministic package-input digest; both the
coordinator and independent verifier recompute the inputs and repository Git state. The migration
floor is the last verified legacy package `1.0.264`, so the first canonical release is `1.0.265` and
cannot downgrade installed Chrome extensions. `signature.status=EXTERNAL_REQUIRED` remains an
explicit unsigned boundary. The focused package/deploy matrix passed in `213.6s`, and two independent
reviews found no remaining P0/P1/P2.

A fail-fast `pnpm qa:04:offline` command now records an eight-step, network-free rehearsal manifest
and rejects any Provider, VPS, remote-smoke or deployment command. Its final run passed in `583.5s`:
diff check, workspace lint (only the existing `20` Server and one shared warning), workspace
typecheck, full preflight with Server tests and Server/Web builds, all AI Media PostgreSQL integration
and populated upgrade gates, and fresh cloud/local builds passed. Package verification reported
cloud `450/0/0` and local `446/2/0`, with only the two expected local permission warnings; a Prisma
query found no current-run `20260730` test schema. This remains rehearsal evidence because positive
edit-capable `QA-02` evidence does not exist. `QA-04`, `REL-03`, `REL-04` and `REL-02` therefore stay
unchecked; Phase 3 remains `4/5`, Phase 5 `3/4`, Phase 6 `0/3`, and overall progress stays `32/37`.

An offline distribution review then found that `/api/extensions/latest` and the target download
routes could still trust mutable unpacked manifests or reconstruct a ZIP without canonical release
evidence. The server now serves only one repository-source cloud/local evidence set bound to the
current full `DEPLOYED_COMMIT`; canonical evidence, checksum, ZIP digest/structure, target manifest
and file count must agree. Version/SHA-bound URLs prevent `/latest` and download from crossing
versions, startup metadata is selected once, and only the requested target is verified and cached.
Missing, mixed, replaced or symlinked artifacts fail closed. Unverified reconstruction requires an
explicit non-production development option. Staging writes `DEPLOYED_COMMIT` only after API/Worker
quiescence, requires clean matching Git provenance including ignored source files, and strictly
verifies the current release set before migration even with `--skip-build`. Canonical evidence now
also records the independently approved local origin exactly as `http://127.0.0.1:3001`; formal and
runtime readers both reject symlink artifacts and enforce stored-ZIP CRC, bounded sizes, portable
paths/collisions and contiguous local records. Mutable discovery responses use `no-store`. This is
offline hardening, not signing or distribution:
`signatureStatus=EXTERNAL_REQUIRED` remains explicit, `REL-03` stays open, and counts remain
Phase 3 `4/5`, Phase 5 `3/4`, Phase 6 `0/3`, overall `32/37`. The operator has paused further paid
edit-capability testing until a genuinely edit-capable Provider endpoint/model/credential exists;
no Provider request, charge, VPS access, deployment, production mutation, flag change, ERP media
mutation, Ozon write or `.context/` staging occurred.

The resulting offline distribution patch passed the focused download matrix (`7` passed with one
Windows-only symlink case skipped), Server typecheck and targeted lint, deployment/documentation
contracts, the full Server suite (`4514` passed, `195` skipped), and the coordinated
package/deployment matrix in `212.7s`; diff check also passed. This verification does not provide an
external signature, store receipt, clean install/upgrade smoke or distribution, so formal counts and
release ordering remain unchanged.

Subsequent offline release hardening closed the remaining environment and Git provenance gaps: the
fixed local extension origin no longer requires a pre-existing operator env value, while templates
document it; direct Git checkouts now fail closed on inspection failure, invalid or dangling `.git`
metadata, and archive trees cannot inherit an unrelated ancestor checkout. The coordinated package
matrix passed on a stable HEAD and commit `4367384` was pushed.

Offline `REL-04` preparation also added a mandatory pre-migration database backup attestation gate.
Real gzip bytes, compressed SHA-256/size, an immutable canonical status sidecar, stable database ID,
full target commit, successful temporary restore, positive table count and bounded freshness are
verified again before each systemd or Compose migration. Evidence files are `0600`, no-follow and
identity checked; verification streams SHA-256/gunzip under an external timeout. Compose binds a
clean stable HEAD and mounts the evidence directory read-only. The release evidence directory uses
`DEPLOY_BACKUP_LOCAL_DIR`, separate from application-managed backup cleanup. Native focused gates and
an offline Debian run passed all `28` POSIX backup/restore/symlink/mode assertions. Workspace lint
had zero errors and the existing `20` Server plus one shared warning; workspace typecheck,
Dockerfile check, both Compose config parses and full preflight passed. Preflight completed in
`464.8s` at `445/0` with the two expected local-extension warnings. No real database backup,
restore, migration, VPS access, deployment, canary, Provider request, flag change or Ozon write
was performed. `REL-04` therefore remains preparation-only; Phase 6 stays `0/3` and overall
progress stays `32/37`.

A final offline `REL-04` hardening pass now gives root orchestration, runtime execution and builds
three explicit trust levels. The distinct non-root `ss-erp-build` UID/GID receives no supplementary
groups or runtime secrets; stable root env snapshots, pre/post closed source manifests and new-inode
sealing bind every systemd build before migration. Unexpected ignored root `.env*` inputs fail
closed, and runtime cache creation no longer recursively changes ownership of build-produced paths.
Compose uses root-provisioned global project locks and a private target-commit archive whose digest
is verified before either Dockerfile executes repository code; commit and archive markers are
checked again by the migration container. Backup restore now binds maintenance and restore routes
with a random database marker, requires an actual drop of the created temporary database, and can
refresh an expired same-commit attestation only after root archives the old exact bytes under their
SHA-256. A no-network Debian run passed the full `52/52` POSIX deployment/backup matrix. Lint had no
errors and only the existing `20` Server plus one shared warning; workspace typecheck passed; the
Server suite passed `4515` with `195` skipped; final preflight passed `445/0` with two expected local
package warnings in `415.8s`. BuildKit checks had no Dockerfile warnings, both Compose configs
parsed, and cloud/local/source extension verification passed `450/0/0`, `446/2/0` and `445/2/0` at
version `1.0.264`. No real backup, restore, migration, VPS access, deployment, canary, Provider
request, charge, flag change, ERP media mutation, Ozon write or `.context/` staging occurred.
`REL-04` remains preparation-only; Phase 6 stays `0/3` and overall progress stays `32/37`.

The offline release handoff now preserves one `REL-03` candidate across `REL-04`: a bounded
no-follow staging CLI selects and byte-preserves exactly one target-commit/origin/source-bound
cloud/local ZIP, checksum and evidence set, then independently re-verifies the staged copy. The
three systemd deployment entrypoints require a root-owned `EXTENSION_RELEASE_ROOT` under
`/var/lib/ss-erp-extension-releases` and no longer package or increment extensions during deploy;
after staging, root removes build-UID writes and the sealed tree must byte-match that input again.
The QA-04 rehearsal also gained a real isolated PostgreSQL scope/JTI/session revocation lane and
adversarial remote-code/eval/Worker/Wasm/CSP package tests. This is offline preparation only:
external signature/store receipts, actual distribution, signed-package upgrade smoke, final QA-02
evidence and all real rollout actions remain open. Counts stay `32/37`.

The enlarged nine-step QA-04 offline rehearsal subsequently passed in `817.7s`, including both
isolated PostgreSQL lanes, full preflight/builds, and cloud/local/source verification at `451/0/0`,
`447/2/0`, and `446/2/0`; no `20260731` test schema remained. Final release-handoff regressions also
cover Git environment poisoning, root-owned checkout reads, `umask 077`, non-root artifact access,
and post-stage ZIP replacement. The sealed deploy tree must now byte-match the immutable root
candidate after build-UID writes are revoked. This is still offline preparation: no formal task,
flag, Provider request, VPS, migration, signature, distribution, pilot, or Ozon action completed,
so the five open tasks and `32/37` count remain unchanged.

The final release-handoff review then closed the remaining provenance and in-place lifecycle
blockers without changing a formal task. Repository-source extension packages and all three
deployment archive paths now read pinned raw Git blobs with inherited `GIT_*` redirects and
replacement objects disabled; local attributes, clean/smudge filters, checkout EOLs,
`assume-unchanged`, and `skip-worktree` cannot alter the claimed build bytes. The production reader
accepts a clean-checkout `GIT_HEAD` candidate only when its commit equals `DEPLOYED_COMMIT`;
external-source and wrong-commit evidence still fail closed. Staging executes its verifier from the
preinstalled root gate, leaves the successful checkout root-frozen, and installs only root-owned
links to external media, backup, sandbox-evidence, and commit-scoped Web-cache directories. Before
any thaw, a root helper installs exact-path systemd write boundaries, writes a persistent marker
bound to sibling deploy/runtime roots, and stops all three services; a process kill or reboot cannot
start them from a writable checkout. Focused package/download/deployment tests, no-network Debian
root lifecycle `5/5`, and the final nine-step offline rehearsal passed in `991.8s`;
cloud/local/source verification was `451/0/0`, `447/2/0`, and `446/2/0`, and no `20260731` temporary
schema remained. No Provider, VPS, deployment, signature, distribution, feature flag, pilot or Ozon
action ran. `QA-02`, `QA-04`, `REL-03`, `REL-04`, `REL-02` and the overall `32/37` count remain
unchanged.

The PackyAPI candidate is prepared for bounded authenticated edit verification, but it is not
capability evidence yet. Credential revision `packy-sora-key-rotation-20260801-01` previously
passed a bounded same-origin GET-only observation at `https://www.packyapi.ai/v1`: models, raw
quota, displayed usage, and Token log returned HTTP 200 with byte-identical before/after snapshots.
That remains historical transport evidence from the time of observation only; it is not an active
credential gate. Its sanitized read-only manifest SHA-256 is
`5f5829e7ec0d8703956112878929894bb161bf51e53ce51d3f8bda4e2a8ff3fc`. A later attempt to run the
new official preflight delivered the credential as UTF-16 and exposed its Authorization value in
local stderr while Undici rejected the header, before network dispatch. The credential is now
invalid and its DPAPI artifact is quarantined. Replacement revision
`packy-sora-key-rotation-20260801-02` is present only in the active current-user DPAPI path and has
not yet run the official authenticated preflight. The
`https://slb-v1.api.fan/v1` edge has incomplete same-origin metering and remains excluded from paid
verification; the selected candidate API Base is `https://www.packyapi.ai/v1`.

Public documentation identifies model `gpt-image-2`, Sora-group access, synchronous multipart
`/v1/images/edits`, and the three operation mappings. Public price remains only an input to private
policy: each operation has a USD `0.08` quote and USD `1.00` single-request maximum; Provider price
synchronization is not required. Private bounded source/mask media remain reusable. All policy and
approval drafts bound to `slb-v1.api.fan` are obsolete, and the main-base policies and schema-v3
drafts bound to invalid credential revision `packy-sora-key-rotation-20260801-01` must not be
finalized or used.

The invalidated private main-base policy revisions have SHA-256 values `4f962b72ce5005c437e0df5887c6cd76b7c56abadfa0061b4dc90f0b8464cefa`
(`IMAGE_TO_IMAGE`), `cbdf62711fe3986366fe51c1ff61d7342ece8d79e9f509ff63127d5b8e1e3b76`
(`FULL_EDIT`), and `074b9ccb59d2561b27af19c834068b6d0c5bd926b64fd8aaa0de870b074344d1`
(`INPAINT`). Clean checkout `cd8455e5818576300bc07dae80e7b46b0f49cc65` generated matching
schema-v3 draft SHA-256 values `e1674527ac78d2fd81f4b4fab3221834666ea2b5f4072b53d78a3ef5a839928b`,
`255263c896789ceed1b2c7bbe587f54d9f72c1550f968d7e0ea0c3371b9b315f`, and
`8cbe900f84f3b99ff6fb23db7e9a7ce6d4e0bd38b4a4dff3d228a9196d5aee0f`. They retain the mandatory
review sentinels and are historical preparation evidence only. After Provider-side rotation, every
credential-revision-bound policy and approval artifact must be regenerated and independently
reviewed.

The official `sandbox:ai-image:readonly:preflight` helper accepts a credential only through bounded
UTF-8 stdin, performs the fixed seven-GET observation, and writes a descriptor-bound private
evidence bundle. After the safe `ac41efa` schema rejection and three diagnostic GETs, the focused
Windows matrix passed `55` with four POSIX skips, the Linux `--network none` matrix passed `59/59`,
and static contract, sandbox typecheck, targeted script ESLint and diff checks passed. Clean commit
`e4503e9253b15eea5540dd436bf027c713cd3739` then completed the official sequence under replacement
credential revision `-02`. Manifest SHA-256
`9f3dbc30bf2b78b99ede50bdfd285d3f932580cab1ddc5a52812ae7cbacb7b0f` binds seven fixed GETs;
all eight file names, hashes, byte lengths, routes, methods, HTTP 200 statuses, normalized content
types and private ACL identities were independently verified. The exact model is visible, raw quota,
displayed usage and Token log are byte-identical before/after, and exact plus generic credential
scans are clean. The manifest records `providerPostSent=false` and `chargeObserved=false`.

A new private proposed `IMAGE_TO_IMAGE` policy now binds `gpt-image-2`, the square one-image profile,
default-omitted quality, quote USD `0.08`, maximum USD `1.00`, and the successful read-only manifest.
Policy SHA-256 is `9b91a0fa1f3e98177ea5d085e3201e9146b617af7368c351f9e1080324f980cb`;
schema-v3 draft SHA-256 is
`1f2d3bb6389856ed63c0ea443a6196a250bd8e1606a3aa2d327129aca71976e4`. The draft binds that policy
digest, replacement credential revision `-02`, adapter revision `e4503e9`, and local
prepared source SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`,
not the earlier Centos request's `481527...f0b` source; those bytes are not present locally and its
authorization cannot be reused. The new draft retains all review sentinels, and the offline verifier
rejects it with `SANDBOX_APPROVAL_SCHEMA_INVALID`. At that preparation checkpoint no Packy POST or
charge had occurred.

The operator then explicitly approved the exact source-bound request. Fresh pre-call manifest
SHA-256 `e9cef9fb0a2efeefae62646f6bd32345e1782e28982e02d3db1608402ae172df` and canonical snapshot
SHA-256 `f653a02f3e9e0d80be45ca5550b5820b4620b5c1dee307eb407d43e38f32f99e` preceded final approval
SHA-256 `de530a1d7f4258b713e909d91c444ffa0faf3832f42ad7639b9153a4d8438da4`; the final file differs
from the draft only in statement and approval/expiry timestamps, and official no-key verification
passed. Operation `qa02-packy-i2i-20260801-e4503e9-01` sent one multipart POST without retry. Its
v5 report is definite `REJECTED`, `createRequests=1`, HTTP 400, `PROVIDER_REQUEST_FAILED`, no
Provider request-ID hash and no image. Report SHA-256 is
`02ab909a2dc4d8cda2858f7291f41ebacb2e3e686f5583419bbdd1d8907a4c3e`; intent SHA-256 is
`bedb0b0a17e45190de71ba0578b04b950c37eeb7106ff012d70ffc62a04ea8e8`.

Settled GET-only manifest SHA-256
`b64bb39aa4d55cfb38a4c1ba44a1601cc9de605e0823a1e8b226c9e2c2eaf5b4` proved zero raw-quota
delta, zero displayed-usage delta and an unchanged empty Token log over a `329871 ms` exclusive
window. Exact attestation SHA-256
`3ce448fe0dfc21d25d4862c03aa0d7c2198da9d3676e4fdee8d27f05fae83e70` produced the receipt
above; exact replay returned identical bytes. A six-record private execution archive has manifest
SHA-256 `43a2a316ba75055442553d4f8d9983f0b9c0d51878c56bb08e7d014bf2e31eaf`.
Private run-summary SHA-256 is
`e1e2c54583fd25f817b6d5021b024503303b15db74fbe259738a07ec9dc1c896`. Credential scans across
38 retained files and private ACL checks passed. The offline dark-deployment guard passed, and no
Registry, feature flag, VPS, deployment, ingest or Ozon mutation occurred. The sandbox static
contract, candidate review contract `27/27`, dark-deployment guard, diff check and full preflight
`446/0` passed with the two expected local-extension permission warnings.
`QA-02` remains `4/5` and overall progress remains `32/37`.

An offline follow-up now prevents a future HTTP 200 from becoming false-positive QA-02 evidence.
The single-submit runner fully decodes each returned image, rejects truncated or animated output,
enforces shared byte/pixel/MIME limits, and requires the decoded dimensions to equal the approved
request profile before writing a `SUCCEEDED` report. A post-acceptance validation failure remains
`RECONCILIATION_REQUIRED` and retains the known Provider request-ID hash. The capability-candidate
reviewer independently requires `requestedSize` to equal the reported width and height. Focused
runner tests passed `61/61`, candidate review passed `29/29`, and Server/sandbox typechecks,
targeted lint, the static single-submit contract and diff checks passed. Full preflight passed
`446/0` with the two expected local-extension permission warnings. This hardening made no Provider
request or charge and does not change the `32/37` count.

The documented Packy follow-up is now a separate immutable request profile rather than a relabeled
retry. It requires exact Packy API Base/host/endpoint/model identity, edit-only operation,
`1024x1024`, `n=1`, `quality=high`, `output_format=png`, `response_format=url`, and PNG output;
optional `input_fidelity` stays omitted. Profile and Provider identity are bidirectionally bound,
legacy cents evidence is rejected, and the request fingerprint includes the exact multipart
dialect and fields while historical non-Packy fingerprints remain byte-compatible. Provider,
approval, guard, runner and billing focused tests passed `275` with two skips; Server/sandbox
typechecks and the static single-submit contract passed. Full preflight passed `446/0` with the two
expected local-extension permission warnings. No Provider request, charge, Registry, deployment,
flag, ingest or Ozon mutation occurred, so counts remain `4/5` and `32/37`.

Clean adapter commit `9b6cc058091837aa17641871c94138e9c164c0a6` was pushed, then a detached
private checkout generated the next non-approval artifacts without reading the DPAPI credential.
Proposed operation `qa02-packy-i2i-documented-20260801-9b6cc05-01` reuses only the retained source
bytes with SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`.
Pricing policy `qa02-packy-gpt-image-2-i2i-documented-usd-v1-9b6cc05` has SHA-256
`8744574db12812666ba16b4a7725d8dd617fcddb03b7f98bd722ae4dd002977c`; schema-v3 draft SHA-256 is
`1bad6cdb203914f54dfb1935b6c50b977cd2b0f9e8c6f4427e9bc253bd061da1`. The draft retains all
review sentinels, the official no-key verifier rejects it with `SANDBOX_APPROVAL_SCHEMA_INVALID`,
and private ACL plus digest checks pass. USD `0.08` and USD `1.00` are proposed quote/maximum values,
not a new authorization. No Provider GET/POST, credential read or charge occurred.

## Next Steps

1. Do not repeat `qa02-t2i-20260730-063129-01` or `qa02-i2i-20260730-083710-01`; both requests and
   billing are closed and their receipts explicitly forbid same-request retry.
2. Do not retry `qa02-centos-i2i-20260730-094857-01` and do not send `FULL_EDIT` or `INPAINT` with
   the same `ai.centos.hk` Token/model. Its catalogue authentication works, but its edit POST was
   definitively rejected by the Provider authentication layer and settled with no charge.
3. Never restore or reuse quarantined credential revision
   `packy-sora-key-rotation-20260801-01`. Never retry consumed Packy operation
   `qa02-packy-i2i-20260801-e4503e9-01`, substitute a new ID for the same request, or reuse its
   approval for `FULL_EDIT`/`INPAINT`; the tested combination definitively rejected the shared edit
   transport and settled with no charge. The operator has confirmed through MOSS that the active
   credential is in the Sora group, but the retained evidence still does not prove that this account
   accepts the edit route. Any further Packy test must use the new documented profile from a clean
   implementation commit, a new Operation ID, a new private policy and non-approval draft, fresh
   pre-call meters, and a new explicit source-bound quote and maximum-cost approval. Do not use
   `slb-v1.api.fan` for a paid request because its same-origin settlement meters are incomplete.
   Provider price API synchronization is not required. Only after all three positive custom
   derived-image reports, billing receipts, and human quality review pass the candidate-only
   boundary may a separate reviewed change add the exact provider/model contract to
   `scripts/sandbox/ai-media-provider-contract.mjs`; never pre-authorize a failed candidate.
4. Keep async marked unsupported unless the Relay supplies an explicit task protocol; absence does
   not justify a paid POST. Do not promote any edit capability from text-to-image evidence.
5. Run `QA-04` only after all `QA-02` operation-specific evidence is accepted; then execute
   `REL-03` packaging, `REL-04` dark deployment/pre-enable canaries, and finally `REL-02`
   sandbox/one-shop pilots with post-enable canaries and reconciliation. No pilot flag may be enabled
   during `REL-03` or `REL-04`. Before the first migration, migrate both operator envs to the same
   stable `DEPLOY_DATABASE_ID`, set `DEPLOY_BACKUP_LOCAL_DIR`, and use the target revision's scripts
   to create and verify a fresh target-commit restore attestation; do not bypass the new gate with an
   old `backup-status.json` or the removed `RUN_DB_BACKUP` option.
   After the one-time `REL-03` package/sign/distribution step, install its exact canonical four-file
   candidate as root under `/var/lib/ss-erp-extension-releases/<target-commit>` on each VPS and pass
   that path as `EXTENSION_RELEASE_ROOT`; deployment must never rebuild or increment it.
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
