# AI Image Provider Sandbox Acceptance

This runbook validates a real AI image Provider with one bounded paid request. It is an acceptance probe for code that remains unavailable to production users. It is not a tenant rollout, a load test, an Ozon publishing test, or permission to repeat an uncertain request.

Two Provider lanes are supported:

- International generation and editing through an explicitly configured third-party OpenAI-compatible HTTPS endpoint.
- Image translation through the official Alibaba Cloud DashScope endpoint with the fixed `qwen-mt-image` model.
- Alibaba Cloud Wanx 2.1 image editing through its dedicated asynchronous JSON endpoint. This is a
  sandbox-only edit adapter until a positive Provider result is recorded.

The sandbox uses separate environment variables and `NODE_ENV=sandbox`. It must not read a production API key implicitly or change a production feature flag.

## Safety Boundary

Before and after every probe, keep all production entry points dark:

- `feature_ai_media_workflow_v2=false`
- `feature_ai_media_image_to_image=false`
- `feature_ai_media_suite=false`
- `feature_ai_media_full_edit=false`
- `feature_ai_media_inpaint=false`
- `feature_source_listing_web_media=false`
- `feature_source_listing_extension_workbench=false`
- `feature_source_ozon_publisher_v2=false`
- `ai_media_workflow_v2_rollout_policy` has an empty `tenantIds` array
- the `ai_image_generation_enabled` / `ai_image_provider` pair does not activate a paid production channel
- the `feature_image_translate` / `ai_image_translation_provider` pair does not activate a paid production channel
- all five `source_ozon_publisher_*_stage` values remain `off`

Run the deployed dark-state verifier before and after the probe:

```bash
bash scripts/verify-ai-media-dark.sh
```

The sandbox does not require a tenant ID, bucket name, shop credential, Ozon credential, or a production feature change. Do not put any of those values into its environment or evidence.

On an app-directory VPS deployment, both evidence roots are private persistent paths. The deployer links the CLI defaults to them before each release switch:

- `/opt/ss-erp/app/tmp/ai-image-sandbox` -> `/opt/ss-erp/shared/ai-image-sandbox`
- `/opt/ss-erp/app/tmp/ai-image-translation-sandbox` -> `/opt/ss-erp/shared/ai-image-translation-sandbox`

Verify that both links resolve under `/opt/ss-erp/shared` and that the shared directories have mode `0700`. Never relocate this evidence into `apps/server/public`.

## One-Use Request Identity

Create one unique Operation ID for one reviewed request. An Operation ID must be 8-80 characters and match `[A-Za-z0-9][A-Za-z0-9._-]*`. Treat it as permanently consumed once an intent or fingerprint claim exists.

Before dispatch, the CLI writes an immutable `SUBMITTING` intent and a fail-closed request-fingerprint claim. The replay fingerprint binds only actual Provider transport semantics: endpoint hash, model, image count, requested size, fixed Prompt hash, ordered source hashes, and mask hash. Audit-only labels, approval metadata, credential revision, adapter revision, and source dimensions remain in the intent but cannot create a new replay identity. The same paid request is therefore rejected even if an operator changes only the Operation ID, approval, profile label, credential, or deployment revision.

On Linux, claim and intent creation pins both the private `intents` and descriptor-relative
`.fingerprints` directories before either artifact is written. Both writes remain bound to those
handles through durability sync and final visible-path/handle identity checks. Replacing the parent
keeps subsequent writes in the held tree; replacing only `.fingerprints` cannot redirect the claim
into the replacement. Either detected change returns `SANDBOX_EVIDENCE_DIRECTORY_CHANGED` before
Provider dispatch. Other platforms use canonical paths plus final identity checks under the
documented local ACL trust boundary and do not claim the same descriptor-relative guarantee.

Run the descriptor and final-entry boundary tests on an actual Linux filesystem before relying on
that guarantee:

```bash
pnpm --filter server exec vitest run \
  src/__tests__/ai-image-sandbox-guard-filesystem.test.ts \
  src/__tests__/ai-image-sandbox-media.test.ts
```

A Windows run intentionally skips the `/proc/self/fd`, directory-replacement, and final-entry
symlink cases; passing only the Windows projection is not Linux execution evidence.

Never delete an intent or `.fingerprints` claim to make a request runnable again. Never switch to a new Operation ID after a timeout, connection loss, malformed acknowledgement, or other ambiguous outcome. Resolve the original request with read-only evidence.

## Revision And Cost Evidence

Set revisions from authoritative records:

- `credentialRevision` is a non-secret version label for the exact injected credential. Use a secret-manager version, controlled configuration revision, or key-rotation revision. Do not use the secret itself, its prefix, or a secret hash as the label.
- `pricingRevision` is a non-secret version label for the backend pricing policy that supplies the
  exact quote and single-request maximum. It must bind the model alias, operation, quality, size,
  image count and currency. A live Provider pricing API lookup is not required for this sandbox.
- `adapterRevision` is the exact commit deployed with the CLI being executed. Use the full 40- or 64-character value from `DEPLOYED_COMMIT` or `git rev-parse HEAD`; abbreviated SHAs are rejected. `HEAD` must match `DEPLOYED_COMMIT`, each paid CLI/security module must be tracked and byte-identical to that revision, the tracked worktree must be clean, and HEAD is verified again after inspection. The official direct CLI rejects a marker-only release archive because it cannot reconstruct Git blob membership. On a VPS, use a private clean checkout of the deployed revision and point its evidence root to the private shared sandbox directory. The direct submit process captures and removes its paid confirmation/API Key from `process.env` before Git inspection; Git receives only a minimal OS environment with hooks, fsmonitor, and recursive submodules disabled. Any Git verification error fails closed. If no trustworthy code identity is available, the probe fails closed. Do not use a planned or local-only commit.

Record the Provider account, backend policy revision, currency, model, quoted charge, balance or
usage counter, and observation time immediately before the call. Repeat the observation after the
Provider has settled the charge.

New international approvals use exact money through `AI_IMAGE_SANDBOX_CURRENCY`,
`AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT`, `AI_IMAGE_SANDBOX_MAX_COST_AMOUNT`, and
`AI_IMAGE_SANDBOX_COST_SCALE`. Amounts are canonical positive integers and the shared scale is an
integer from `0` through `8`; for example, `CNY amount=119 scale=4` means `CNY 0.0119`. Quote and
maximum must use one currency and minimal shared scale, and the maximum is bounded to `100,000`
major currency units. Do not use floats or mix these variables with legacy cents.

Historical international evidence may still use `AI_IMAGE_SANDBOX_QUOTED_COST_CENTS` and
`AI_IMAGE_SANDBOX_MAX_COST_CENTS`; the DashScope translation lane continues to use its own integer
cents variables. These fields are compatibility paths, not the format for a new sub-cent
international approval. The quote/maximum fields do **not** limit the Provider bill or prove the
actual charge; they bind the backend policy and this one-request approval. Exact submit reports
leave `actualCost` as `null`; legacy
reports leave `actualCostCents` as `null`. Settled cost is recorded later through the append-only
[billing finalizer](ai-image-provider-sandbox-billing.md). Configure a Provider-side spending cap
separately when one is available.

Do not promote a capability until the settled Provider bill can be reconciled to the request. When the Provider omits a request ID, correlate the narrow time window, account, endpoint, model, operation, and image count, and record the remaining uncertainty.

## Offline Verification

Run these from the repository root with paid confirmations and API keys unset. These tests use local fixtures or mocked transports and do not make a paid Provider request:

```bash
node --test scripts/ai-image-single-submit-contract.test.mjs scripts/ai-image-translation-single-submit-contract.test.mjs
pnpm --filter server exec vitest run scripts/ai-image-provider-approval-draft.test.ts scripts/ai-image-provider-single-submit.test.ts scripts/ai-image-translation-single-submit.test.ts src/__tests__/ai-image-sandbox-guard.test.ts src/__tests__/ai-image-translation-sandbox-guard.test.ts
pnpm preflight
```

Also confirm the worktree and executable revision:

```bash
git status --short
git rev-parse HEAD
```

Do not run a paid probe from an unreviewed or partially deployed worktree.

The private [approval runbook](ai-image-provider-sandbox-approval.md) includes an optional
`sandbox:ai-image:approval:draft` command that binds the non-secret request into a private canonical
file without DNS, intent creation, or Provider access. Its rejection sentinels require a separate
human review and cannot authorize a request.

After the private international approval file is final, run the no-key/no-confirmation exact-request
preflight before any paid submit:

```bash
pnpm --filter server sandbox:ai-image:approval:verify
```

This command performs no DNS lookup, intent/fingerprint claim, or Provider request. An exact-money
approval emits a v3 verification event; a legacy cents approval retains the v2 event. Both report
separate `apiBaseSha256` and `operationEndpointSha256` values, the approved cost exposure, and the
sanitized approval validity window without exposing either URL. It rejects a non-HTTPS endpoint.
Approval freshness is checked again throughout the submit path and immediately before the single
Provider POST.

### Packy GET-only transport and meter preflight

Before reviewing a paid Packy approval, run the dedicated read-only command from the exact clean Git
revision that would execute the request:

```bash
pnpm --filter server sandbox:ai-image:readonly:preflight
```

The command is intentionally restricted to API Base `https://www.packyapi.ai/v1`, host
`www.packyapi.ai`, and model `gpt-image-2`. It requires `NODE_ENV=sandbox`, the exact non-secret
adapter and credential revisions, `AI_IMAGE_SANDBOX_OPERATION_ID`, and one new
`AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID`. It rejects `AI_IMAGE_SANDBOX_API_KEY`, paid confirmation,
Authorization, and common Provider secret variables in the environment.

Supply the credential only as bounded UTF-8 stdin. One final LF or CRLF is accepted; UTF-16, NUL,
control characters, multiple lines, and values outside the printable ASCII/byte limits fail before
an Authorization header is constructed. On PowerShell, do not pipe a .NET string through the
default native pipeline encoding. Use a process with redirected stdin and set
`StandardInputEncoding` to `new UTF8Encoding(false)`, keeping the decrypted value only in memory.
The script accepts no argv values and rejects them before DNS or stdin. Never rely on that rejection
to hide a command-line credential: shells and package managers such as pnpm may echo argv before the
script starts. The direct Node/tsx entry emits only `AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_FAILED`
and a stable failure code; it never prints a Provider body or credential. Secret-shaped operation
IDs, evidence IDs, credential revisions, and evidence-root paths are also rejected.
If a credential ever reaches argv, stdout, or stderr, revoke it at the Provider, quarantine the
local artifact, and regenerate every credential-revision-bound policy and approval. A historical
read-only observation does not make an exposed credential reusable.

### Xiaoyi dual-origin GET-only preflight

Xiaoyi separates paid image traffic from account and billing evidence. Use only the reviewed exact
identity: API Base `https://image.xiaoyiapi.xyz/v1`, expected host `image.xiaoyiapi.xyz`, billing
origin `https://xiaoyiapi.xyz`, and model `gpt-image-2`. Set
`AI_IMAGE_SANDBOX_BILLING_ORIGIN=https://xiaoyiapi.xyz`; the command rejects a missing, derived,
slash-suffixed, queried, or otherwise different value before DNS or credential input.

The helper resolves and validates the image and billing hosts independently, pins each host to its
own public addresses, and sends the Bearer credential only to seven fixed GET requests: three
before meters on the billing origin, `/v1/models` on the image host, then the same three billing
meters again. A private or mixed answer for either host fails before stdin is read. The v2 private
manifest binds both origins; stdout includes only their SHA-256 digests. It never sends an image
POST, follows a redirect, accepts cookies, or writes the credential.

Charged settlement uses the same closed identity. An intent bound to the Xiaoyi image API accepts
Token-log evidence only from the exact Xiaoyi billing origin, and that billing origin cannot settle
an intent for any other API Base. All other Providers retain the same-origin `/v1` API and Token-log
rule. Both the preflight and finalizer Git revision checks include the shared Xiaoyi identity module.

### DashScope Wanx catalog-only preflight

Before preparing the first Wanx approval, run the same read-only command with the exact reviewed
legacy identity: API Base `https://dashscope.aliyuncs.com/api/v1`, expected host
`dashscope.aliyuncs.com`, and model `wanx2.1-imageedit`. Do not set
`AI_IMAGE_SANDBOX_BILLING_ORIGIN` for this branch. A workspace-specific host is a different
Provider identity and remains rejected until its exact Workspace ID and complete approval,
execution, and billing chain are reviewed.

The command sends exactly one authenticated GET with no request body:

```text
GET /api/v1/models?model=wanx2.1-imageedit&page_no=1&page_size=1
```

The credential is accepted only through bounded UTF-8 stdin. Before reading it, each DoH response must
bind its Question to `dashscope.aliyuncs.com` and the queried A/AAAA type, set `TC=false`, and use IN
class when present. A/AAAA responses must provide a complete, bounded CNAME chain to the terminal
address owner; compare the complete chains across address families. Reject loops, unrelated records,
missing terminals, mismatched targets, and chains longer than eight hops. DNS remains pinned, redirects
and ambient credentials remain disabled, and no task, image-synthesis, or guessed billing endpoint is
called. The private v3 manifest records `authenticationVerified=true`,
`exactModelListed=true`, `billingMeterStatus=SEPARATE_EVIDENCE_REQUIRED`,
`providerPostSent=false`, `chargeObserved=false`, and `editCapabilityVerified=false`.
The catalogue response must also set `success=true`, keep `code` and `message` null, report page and
page size `1`, make `total` equal the returned zero-or-one row count, and identify a row through the
exact `model` field. Top-level and output fields are closed to the observed shape; do not accept
mixed `data`/`error` fields, `model_id`, `id`, multiple rows, or inconsistent pagination. The
endpoint/query are corroborated by the official SDK, but this exact success envelope is a versioned
live response-shape contract bound to retained evidence. Provider drift must fail closed and trigger
review, not silent compatibility expansion.

This observation proves only that the exact credential can read a catalogue containing the model.
It does not prove edit-route permission, successful editing, price, account balance, or billing.
Retain separate private Alibaba console or reviewed Billing OpenAPI evidence immediately before and
after every paid operation. Only a settled, quality-reviewed edit result can satisfy the matching
`QA-02` operation.

#### First real preflight checkpoint (2026-08-01)

The first real catalogue-preflight attempt failed with `SANDBOX_READONLY_DNS_FAILED` before stdin or
private credential decryption because the original resolver rejected DashScope's legitimate DoH CNAME
owner chain. Its evidence ID remains available for a corrected run. No authenticated GET, Provider
POST, or charge occurred. A separate no-credential resolver observation returned public DashScope A
and AAAA answers, but it does not establish authentication or model visibility and must not be
promoted to a successful preflight.

After the DNS hardening, focused tests pass `95` with four platform skips and the full Server suite
passes `4735` with `199` skips. Target lint, sandbox TypeScript compilation, the static contract, and
diff checks pass. Full repository preflight passes `446/0` with the two existing local-extension
permission warnings. Run the same catalog-only preflight again from the new clean pushed revision
through its pinned DoH resolver; do not bypass the DNS gate or prepare a paid approval from this
failed attempt.

The next clean revision reached the authenticated catalogue once and received HTTP 200, but the
first v3 response parser rejected it because the live row uses `model`, not `model_id`. The evidence
ID was not created. A separate pinned GET-only diagnostic retained the private response under
SHA-256 `a30c5462...e5cf2cb`, confirmed one exact `wanx2.1-imageedit` row, and found no credential
reflection. Neither GET contacted a task, synthesis, billing, or POST route. The parser correction
passes focused tests `109` with four platform skips, full Server `4749` with `199` skips, and full
preflight `446/0` with two existing warnings. Commit it before rerunning the official catalog
preflight with a new evidence ID; the diagnostic is not itself a successful v3 manifest or
edit-capability evidence.

Clean revision `6948460a41a2038e3a5c48b589b291ce179ab407` subsequently completed official v3
evidence ID `qa02-wanx-readonly-20260801-6948460-01` with one authenticated GET. Manifest SHA-256
is `d3099295...43c5f`, and its only 1022-byte response SHA-256 is `5d2dd214...1d578`. The manifest
proves authentication and exact model visibility only; it still records separate billing evidence
required, no Provider POST/charge observation, and no edit-capability verification. Private ACL,
reparse, hash, and credential scans passed.

Do not repeat the catalogue preflight merely to authorize a paid request. Preserve it, finalize the
exact Prompt, and retain an independent Alibaba console or reviewed Billing OpenAPI pre-call
snapshot. The private CNY `0.14` quote/CNY `1.00` maximum policy remains a proposal and the approval
draft remains explicitly unapproved. Only an operator's exact one-request authorization after those
gates may permit one async image-synthesis POST.

Operation `qa02-wanx-i2i-20260801-3ac48e4-01` later completed the first positive live Wanx
`IMAGE_TO_IMAGE` request. It sent one create POST, polled only the accepted task, reached
`SUCCEEDED`, and downloaded one validated 1024x1024 PNG. Do not retry or rename it. The API Key's
billing account did not match the authenticated Bailian console account, so that console snapshot
is excluded and no billing receipt exists. Treat the result as positive technical capability
evidence with billing unresolved; never convert the unrelated `CNY 0` console view into
`NO_CHARGE`, and never infer actual cost from `usage.imageCount`. `FULL_EDIT` and `INPAINT` still
require separate policies, media, approvals, Operation IDs, and single submissions.

The Xiaoyi API credential pasted into chat was exposed, revoked and replaced under non-secret
revision `xiaoyi-image-key-rotation-20260801-01`; only the replacement may remain in current-user
DPAPI outside the repository. Operation `qa02-xiaoyi-i2i-20260801-f189dfa-01` later sent the V1
five-field OpenAI-compatible synchronous multipart request once and received definite HTTP 400,
with no image or charge. It must not be retried or reused for `FULL_EDIT`/`INPAINT`.

The first-party [image API guide](https://xiaoyiapi.xyz/docs/api/images/) separately shows a minimal
synchronous curl contract containing only `model`, `prompt`, and `image`; asynchronous editing is a
different `/v1/images/edits/async` route. `XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2` represents that
materially different synchronous wire request. Operation
`qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01` later sent that exact three-field request once and
received definite HTTP 400, with no image or charge. It must not be retried, renamed, or reused for
another operation. A later Xiaoyi paid attempt requires a Provider-confirmed material
permission/route/contract change, or a different edit-capable Provider, followed by a new profile,
pricing policy, Operation ID, source-bound approval, and billing capture. The profile alone never
authorizes a POST.

The command uses public DoH, rejects private DNS results, pins the accepted addresses, disables
redirects/cookies, and permits exactly four Provider routes in a fixed seven-GET sequence:
before/after raw quota, displayed usage, and Token log, plus one model-catalogue check. Every body
must be bounded UTF-8 JSON with its minimum successful schema. Raw quota requires `code: true` and
the reviewed numeric `total_available`, `total_granted`, and `total_used` fields rather than any
unrelated numeric property. Token log accepts either its successful response schema or Packy's exact
two-key empty-history envelope `{ "message": "record not found", "success": false }`; alternate
failure messages, a `data` field, or any extra field fail closed. The exact model must be visible,
and all three before/after meter bodies must be byte-identical. Content-Type is normalized before it
can enter the manifest, and parsed JSON is recursively checked for credential reflection. It writes a
new private directory under the canonical `AI_IMAGE_SANDBOX_EVIDENCE_ROOT` (default
`tmp/ai-image-sandbox`) containing the seven raw JSON files and one canonical sanitized manifest.
Directory handles, real paths and device/inode identity remain bound through each exclusive durable
write; the manifest is written last, and existing evidence is never overwritten. This proves only the
credential/catalogue/meter read path; it is not an edit-capability result, paid approval, price
source, Provider-side spending limit, or permission to retry a POST.

## International OpenAI-Compatible Probe

This lane accepts an operator-approved third-party endpoint. The configured base URL must use HTTPS, contain a DNS hostname, and contain no credentials, query, fragment, or `/images/generations` or `/images/edits` operation path. The CLI normalizes the base to `/v1`, requires `AI_IMAGE_SANDBOX_EXPECTED_HOST` to equal its hostname, validates public DNS, pins the resolved addresses, and permits one create POST.

Supported operations are:

| Operation        | Paid endpoint            | Input                                                                         |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `TEXT_TO_IMAGE`  | `/v1/images/generations` | No source or mask variables                                                   |
| `IMAGE_TO_IMAGE` | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `FULL_EDIT`      | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `INPAINT`        | `/v1/images/edits`       | One PNG, JPEG, or WebP source plus a same-size meaningful PNG mask             |

Prompts and requested count (`1`) are fixed in the CLI. The required request profile freezes the request dimensions and the single-reference multipart shape:

| Request profile                  | Requested size | Intended evidence scope                                      |
| -------------------------------- | -------------- | ------------------------------------------------------------ |
| `OPENAI_SQUARE_SINGLE_V1`        | `1024x1024`    | Square generation or one-source edit compatibility           |
| `PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` | `1024x1024`  | Packy `gpt-image-2` edit only, with its reviewed multipart dialect |
| `XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1` | `1024x1024` | Xiaoyi `gpt-image-2` synchronous `IMAGE_TO_IMAGE` only        |
| `XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2` | `1024x1024` | Xiaoyi documented minimal synchronous `IMAGE_TO_IMAGE` only |
| `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1` | `1024x1024` | Wanx 2.1 `description_edit`, asynchronous reference edit only |
| `DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1` | `1024x1024` | Wanx 2.1 `description_edit`, asynchronous full-image edit only |
| `DASHSCOPE_WANX21_INPAINT_ASYNC_V1` | `1024x1024` | Wanx 2.1 `description_edit_with_mask`, asynchronous masked edit only |
| `OZON_PORTRAIT_SINGLE_V1`        | `1024x1536`    | 2:3 Provider canvas composed crop-safe for final 3:4 normalization; does not prove native 3:4 transport |

No profile proves multi-reference compatibility. A Provider result whose decoded dimensions differ
from the approved profile is rejected and cannot become capability evidence. Any promoted capability
must be limited to the exact tested profile, operation, endpoint digest, model, adapter revision,
credential revision, and verified reference count.

`OPENAI_SQUARE_SINGLE_V1` and `OZON_PORTRAIT_SINGLE_V1` freeze Provider quality as
`PROVIDER_DEFAULT_OMITTED`: the guarded request must not contain a `quality` field. The Packy-only
profile instead freezes the documented multipart additions `quality=high`, `output_format=png`, and
`response_format=url`, and omits optional `input_fidelity`. Its exact API Base, host, endpoint,
model, edit operation, and fields are one immutable profile identity. The private pricing policy
must name the matching quality state. A different quality or response dialect requires another
versioned profile and separately reviewed policy and approval.

Both Xiaoyi-only profiles freeze API Base `https://image.xiaoyiapi.xyz/v1`, exact
`/v1/images/edits` endpoint, host `image.xiaoyiapi.xyz`, model `gpt-image-2`, one source, logical
`1024x1024`, `n=1`, and exact money. V1 sends `model`, `prompt`, `n`, `size`, and `image`; its closed
HTTP 400 is negative evidence for only that five-field transport. Minimal V2 sends exactly
`model`, `prompt`, and `image`: the logical size/count remain approval, fingerprint, output-validation,
and audit constraints but are omitted from the multipart body. The guard rejects `n`, `size`,
`quality`, `mask`, `image[]`, unknown fields, duplicates, or missing required fields before Provider
dispatch. Both profiles permit only `IMAGE_TO_IMAGE`; `FULL_EDIT`, `INPAINT`, and async require
separate future profiles and positive evidence. V1 and V2 produce different replay fingerprints,
and the approval, runner, dedicated adapter, request guard, and offline finalizer independently
derive and enforce the matching dialect.

### Alibaba Wanx 2.1 edit profiles

The Wanx adapter is a separate transport and is never treated as an OpenAI-compatible edit. The
first reviewed sandbox identity is pinned to the Beijing legacy API Base
`https://dashscope.aliyuncs.com/api/v1` and model `wanx2.1-imageedit`. A workspace-specific Beijing
endpoint can be supported by the adapter, but it is not a QA-02 identity until its exact host,
credential revision, approval and billing evidence are reviewed.

All three profiles use the official asynchronous JSON contract:

```text
POST /api/v1/services/aigc/image2image/image-synthesis
GET  /api/v1/tasks/<task_id>
```

The submit request contains only `model`, `input.function`, `input.prompt`,
`input.base_image_url`, an optional `input.mask_image_url`, and `parameters.n=1`. The submit header
must include `X-DashScope-Async: enable`. No `size`, `output_format`, `response_format`, or relay
multipart field is added. Local source bytes are sent as bounded `data:` URLs, so the first sandbox
probe does not expose a source image through a public staging URL. `IMAGE_TO_IMAGE` and `FULL_EDIT`
map to `description_edit`; `INPAINT` maps to `description_edit_with_mask`.

The existing editor mask uses alpha transparency. The Wanx adapter deterministically converts it to
an RGB PNG before dispatch: alpha below 128 becomes white (edit), and alpha 128 or above becomes
black (preserve). The derived mask digest is checked by the guarded JSON request. Source and mask
must be 512-4096 pixels and each no larger than 10 MiB; a Wanx mask must match the source dimensions.

A positive result requires one `output.results[].url`, `task_metrics.TOTAL=1`,
`task_metrics.SUCCEEDED=1`, `task_metrics.FAILED=0`, and `usage.image_count=1`. The result URL is
downloaded immediately without Provider Authorization. The accepted task ID and raw temporary URL
are private recovery evidence; the public report stores hashes only. A poll timeout, task mismatch,
download failure or malformed success is `RECONCILIATION_REQUIRED` and never causes a second submit.

The public Wanx price shown in Alibaba documentation is planning input only. The operator must set a
new exact quote and an independently reviewed single-request maximum in CNY for each profile; no live
Provider pricing synchronization is required. See the [official Wanx API reference](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference).

### Complete Environment Contract

Inject secrets without echoing them or retaining them in shell history. Use placeholders only in documentation and tickets.

Before setting the paid confirmation, create and review the private
[one-request approval record](ai-image-provider-sandbox-approval.md). The CLI hashes that file and
fails before DNS, intent creation, or Provider dispatch when any exact request field differs.

| Variable                               | Requirement                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                             | Must be `sandbox`                                                                       |
| `AI_IMAGE_SANDBOX_CONFIRM`             | Must be exactly `I_ACCEPT_ONE_PAID_IMAGE_REQUEST` immediately before this one run       |
| `AI_IMAGE_SANDBOX_BASE_URL`            | Exact third-party OpenAI-compatible HTTPS base URL                                      |
| `AI_IMAGE_SANDBOX_EXPECTED_HOST`       | Exact lowercase hostname from the base URL                                              |
| `AI_IMAGE_SANDBOX_API_KEY`             | Secret injected for this process only                                                   |
| `AI_IMAGE_SANDBOX_APPROVAL_PATH`       | Private closed-schema approval JSON for this exact one paid request                     |
| `AI_IMAGE_SANDBOX_APPROVAL_SHA256`     | Lowercase SHA-256 of the final reviewed approval file                                   |
| `AI_IMAGE_SANDBOX_MODEL`               | Exact third-party model identifier under test                                           |
| `AI_IMAGE_SANDBOX_OPERATION`           | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or `INPAINT`                            |
| `AI_IMAGE_SANDBOX_REQUEST_PROFILE`     | One of the four versioned profiles above                                                |
| `AI_IMAGE_SANDBOX_OPERATION_ID`        | New one-use Operation ID                                                                |
| `AI_IMAGE_SANDBOX_CREDENTIAL_REVISION` | Non-secret revision of the injected key                                                 |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`    | Exact deployed Git commit SHA                                                           |
| `AI_IMAGE_SANDBOX_CURRENCY`            | Uppercase three-letter currency for both exact amounts                                  |
| `AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT`  | Canonical positive integer quote in the shared exact-money scale                        |
| `AI_IMAGE_SANDBOX_MAX_COST_AMOUNT`     | Canonical positive integer operator-approved maximum; not a Provider limit              |
| `AI_IMAGE_SANDBOX_COST_SCALE`          | Shared decimal scale from `0` through `8`; must be minimal for the quote/maximum pair    |
| `AI_IMAGE_SANDBOX_SOURCE_PATH`         | Required only for the three edit operations; absolute or repository-root-relative path  |
| `AI_IMAGE_SANDBOX_SOURCE_SHA256`       | Required with source path; lowercase SHA-256 of the exact local bytes                   |
| `AI_IMAGE_SANDBOX_MASK_PATH`           | Required only for `INPAINT`                                                             |
| `AI_IMAGE_SANDBOX_MASK_SHA256`         | Required with mask path; lowercase SHA-256 of the exact PNG bytes                       |

For a new international request, set all four exact-money variables and leave both legacy cents
variables unset. Historical v2 approvals require the two legacy cents variables instead and cannot
be combined with any exact amount/scale variable. For `TEXT_TO_IMAGE`, leave all source and mask
variables unset. For `IMAGE_TO_IMAGE` and `FULL_EDIT`, leave both mask variables unset. The CLI
rejects extra conditional variables instead of ignoring them. One source, or the combined
`INPAINT` source and mask, must not exceed the shared `50 MiB` edit-request limit. The offline draft
and exact-request approval preflight use the same bounded media verifier and reject oversized or
unsupported media before DNS, intent creation, or Provider dispatch.

Relative source and mask paths are resolved from the repository/deployed app root, even though `pnpm --filter server` executes the package script with `apps/server` as its process working directory.

### Submit Once

1. Hash the reviewed source and mask, when applicable, and place their bytes under access-controlled temporary storage.
2. Take the pre-call billing snapshot, verify the dark state, and finalize the private approval
   record with its exact billing references.
3. Hash the unchanged approval file and inject the complete environment contract. Set the
   confirmation only after a second operator or recorded review has checked the approval digest,
   endpoint, model, operation, revisions, source/mask hashes, and cost evidence.
4. Run exactly once from the repository root:

   ```bash
   pnpm --filter server sandbox:ai-image:single
   ```

5. Unset the confirmation and API key immediately after the process exits.
6. Inspect `tmp/ai-image-sandbox/<operation-id>.report.json`, the immutable intent under
   `tmp/ai-image-sandbox/intents/`, and the returned image. Exact-money requests produce a
   `schemaVersion: 3` intent and `schemaVersion: 5` submit report; historical cents requests retain
   intent v2/report v4. Verify `apiBaseSha256`, `operationEndpointSha256`, request profile,
   source/mask dimensions and digests, image count, MIME type, output dimensions, byte length,
   SHA-256, requested semantics, exact quote/maximum values, and absence of unexpected text, logos,
   watermarks, or product changes. `apiBaseSha256` hashes the normalized Provider API Base;
   `operationEndpointSha256` hashes the exact `/images/generations` or `/images/edits` POST target.
   For a failed POST that receives an HTTP 4xx/5xx response, current runners also write private
   `<operation-id>.failure-diagnostic.json`. This versioned, non-authoritative sidecar contains only
   the Operation ID, the submit-report SHA-256, and the integer HTTP status. It never contains the
   response body, headers, URL, Provider code, or credential, and the billing finalizer does not
   consume it. A transport failure without an HTTP response produces no sidecar. Sidecar write
   failure emits only `SANDBOX_FAILURE_DIAGNOSTIC_WRITE_FAILED` and never replaces the original
   Provider failure or authoritative report.
7. Save the settled billing snapshot as a private bounded file, create the private closed-schema
   billing attestation that names and hashes both the before/settled snapshot files, and run
   `pnpm --filter server sandbox:ai-image:billing:finalize`. The finalizer performs no Provider call,
   verifies the snapshot bytes, preserves the original intent/report byte-for-byte, and writes one
   sanitized append-only billing settlement sibling.
8. Run the dark-state verifier again.

This lane has no automated reconciliation mode. If its report is `RECONCILIATION_REQUIRED`, use only the relay dashboard, billing ledger, request logs, or Provider support to resolve the original request. Do not call the submit command again.

### Recorded International Relay Observation (2026-07-25)

The configured international relay/model produced one earlier text-to-image result, but the evidence did not reconcile settled billing. Two independently claimed `IMAGE_TO_IMAGE` requests were definitely rejected with HTTP 400; the second used the current single-image multipart field and frozen square request profile. `FULL_EDIT` and `INPAINT` were not dispatched because they share the rejected edits transport.

Treat this exact relay/model as text-to-image-only and still unverified for production. Model-catalog access is not generation acceptance, and generation acceptance is not edit acceptance. Do not repeat the rejected requests or enable reference generation, full edit, inpaint, suites, or tenant rollout unless the operator selects an edit-capable endpoint/model and completes a new bounded acceptance.

### Recorded `gpt-image-2-count` edit rejection (2026-07-30)

The exact catalog-visible alias was separately tested once under explicit approval as
`IMAGE_TO_IMAGE`, `OPENAI_SQUARE_SINGLE_V1`, `1024x1024`, `n=1`, using the already accepted mug
source SHA-256 `481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`.
The private policy quoted exact `CNY 0.0119` and authorized a maximum of `CNY 1.0000`.

Operation `qa02-i2i-20260730-083710-01` made exactly one guarded `/v1/images/edits` POST. Its v5
report is a definite `REJECTED` result with `createRequests=1`, `providerRequestIdHash=null`,
`failureCode=PROVIDER_REQUEST_FAILED`, and elapsed time `155 ms`. It was not retried. Independent
raw-quota and displayed-usage snapshots both had zero delta, and the authenticated Token log had no
matching consume entry. The append-only exact receipt v3 therefore records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; receipt SHA-256 is
`c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855`.

This exact endpoint/model is now directly evidenced as generation-capable but edit-transport
incompatible. Do not dispatch `FULL_EDIT` or `INPAINT` against it: both share the rejected
`/images/edits` transport, neither has a separate authorization, and another paid attempt would not
repair the demonstrated capability gap. Select a different edit-capable endpoint/model and restart
the bounded approval sequence there.

### Recorded alternate Relay edit rejection (2026-07-30)

The rotated credential for `https://ai.centos.hk/v1` could read its model catalogue and billing
meters, but the catalogue advertised only generation/openai endpoint types. Under a separate
approval, operation `qa02-centos-i2i-20260730-094857-01` sent exactly one guarded
`IMAGE_TO_IMAGE` request using `gpt-image-2`, the accepted mug source, quote `CNY 0.1`, and maximum
`CNY 1.0`.

The `/v1/images/edits` POST was definitely rejected after `302 ms` with `createRequests=1`, no
Provider request-ID hash, and `failureCode=PROVIDER_AUTH_FAILED`. That stable code represents HTTP
401 or 403; the historical v5 report predates the sanitized HTTP-status sidecar, so it cannot
distinguish the two. Quota, displayed usage, and the Token log were unchanged. Exact receipt v3
SHA-256 `9d1e5db49dc5b76e7de70e36cad88a7429e426b3e93de4207ad62a46c040e2d2`
records `NO_CHARGE`, `billingGate=PASS`, and `sameRequestRetryAllowed=false`.

Do not retry that operation or send `FULL_EDIT`/`INPAINT` through the same endpoint, Token, and
model. Catalogue access proves only credential visibility; Provider-side edit-route entitlement or
a different edit-capable endpoint/credential is still required.

### Recorded Packy edit rejection (2026-08-01)

Replacement credential revision `packy-sora-key-rotation-20260801-02` passed the official GET-only
preflight and exposed exact model `gpt-image-2`. Under a separate USD `0.08` quote and USD `1.00`
maximum, operation `qa02-packy-i2i-20260801-e4503e9-01` sent one approved
`IMAGE_TO_IMAGE` request using source SHA-256
`5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`.

The `/v1/images/edits` POST returned definite HTTP 400 after `1118 ms`; report v5 records
`REJECTED`, `createRequests=1`, `PROVIDER_REQUEST_FAILED`, no Provider request-ID hash and no image.
Quota, displayed usage and Token log were unchanged. Receipt v3 SHA-256
`0107a287f45e6b74e185ea4669057b9b5264f8617d4cc59facaa1ad8950cb363` records `NO_CHARGE`,
`billingGate=PASS`, zero billed units and `sameRequestRetryAllowed=false`; replay was byte-identical.

`createRequests=1` records one HTTP dispatch, not a successfully created Provider edit task. HTTP
400 plus a null Provider request ID and zero billing/log deltas means this run produced no accepted
or billed edit operation. Packy's public instructions require a `sora`-group token, but the retained
model and quota GET responses do not expose the active token group. Before any newly approved Packy
request, confirm the group in the dashboard and require either Provider route confirmation or a
materially different reviewed multipart contract.

The operator subsequently confirmed through MOSS that the active credential is in the Sora group.
That satisfies the token-group prerequisite as an operator assertion, but it does not prove that
this account accepts the edit route. The route remains unverified until a newly approved request
returns an accepted Provider identity or a valid image result.

Never retry this Operation ID or the same request fingerprint. Do not infer edit support from Packy
documentation, catalogue visibility or GET-only metering, and do not reuse this approval for
`FULL_EDIT` or `INPAINT`. Require a materially different reviewed request contract, a Provider-side
account/route correction, or a new edit-capable endpoint, then begin a new operation-specific
price/approval/evidence sequence.

The documented Packy candidate used the isolated `PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` transport rather
than relabeling the first rejected request. It binds `https://www.packyapi.ai/v1`, `gpt-image-2`, edit-only
operations, `1024x1024`, `n=1`, one source for `IMAGE_TO_IMAGE`, and the exact documented multipart
additions above. The adapter, approval-draft generator, immutable Git revision set, request guard,
and single-submit runner reject endpoint/model/profile mixing before dispatch. Before that request
was sent, it required a new private policy, non-approval draft, fresh source-bound quote, and
single-request maximum approval from the clean implementation commit.

Operation `qa02-packy-i2i-documented-20260801-9b6cc05-01` was later explicitly approved for USD
`0.08` with a USD `1.00` maximum. From clean adapter commit
`9b6cc058091837aa17641871c94138e9c164c0a6`, it sent exactly one documented multipart POST and was
not retried. Packy returned definite HTTP 400 after `991 ms`; report SHA-256
`2ce500d9eb064e324216320d5f972bcdeb1748aeeb2242be68c3f2d1960460ae` records `REJECTED`, one
create request, no Provider request-ID hash, and no image. The pre-call and settled billing captures
remained byte-identical. Official receipt SHA-256
`c62bbc576368df51e72406023ff9e2a4be2551498d0fd3f7f5ef7d5a6e342d36` records `NO_CHARGE`,
`billingGate=PASS`, zero billed units, and `sameRequestRetryAllowed=false`; replay was byte-identical.

This closes both the generic and documented Packy requests as negative evidence for the tested
account/model/route. Never retry either Operation ID or relabel either request. Do not send
`FULL_EDIT` or `INPAINT` through the same route. Require a Provider-confirmed material
route/account/contract change or a different edit-capable Provider before beginning a new bounded
price, approval, and evidence sequence.

### Recorded PicPi edit rejection (2026-08-01)

Credential revision `picpi-sub2-20260801-r2` passed authenticated `GET /v1/models` and exposed
`gpt-image-2`. Operation `qa02-picpi-i2i-20260801-de951b7-01` then bound the exact
`https://api.picpi.top/v1/images/edits` route, `OPENAI_SQUARE_SINGLE_V1`, one reviewed
`1024x1024` source, USD `1.00` quote, and USD `1.00` maximum. The guarded runner sent one multipart
POST from clean revision `de951b7` and did not retry.

PicPi returned definite HTTP 400 after `2025 ms`. Report SHA-256 `87a574b0...f239f` records
`REJECTED`, `createRequests=1`, a response request-ID hash, `usage=null`, and no image. Authenticated
Sub2 `/v1/usage` raw SHA-256 `654b930e...3efcf` reported this API Key's today and lifetime
`requests=0` and `actual_cost=0`. Do not confuse the unrelated subscription-level historical usage
fields with this Key-level evidence.

Closed cumulative-zero attestation v4 SHA-256 `a82fded6...0764f` produced receipt v5 SHA-256
`e2ed71a3...65cd`. It records `NO_CHARGE`, `billingGate=PASS`, zero billed units, resolved rejection,
and `sameRequestRetryAllowed=false`; replay was byte-identical. The exact request is consumed and is
negative capability evidence. Never retry it, substitute a new ID for the same request, or reuse the
approval for `FULL_EDIT`/`INPAINT`. Require a Provider-confirmed material route/account/contract
change and a new bounded approval sequence, or select another edit-capable Provider.

Successful sandbox output must be fully decoded before it can become capability evidence. Reject
truncated or animated media, declared/decoded MIME mismatches, shared byte/pixel limit violations,
and any dimensions different from the approved request profile. If the Provider already returned
HTTP 200 or an acceptance identity, classify a later validation failure as
`RECONCILIATION_REQUIRED` and retain only the request-ID hash for settlement.

The international database may still contain a legacy `openai-images` selection with a third-party
Base URL. Current admin validation and paid runtime contracts reject that identity: official OpenAI
Images is restricted to `https://api.openai.com/v1`, while a relay must be labeled `custom`. Use the
admin one-click correction only to fix configuration identity; it does not authorize or re-test
`gpt-image-2`. A 2026-07-29 bounded `/models` check listed only that already rejected model, so a new
edit sandbox still requires a different endpoint/model rather than another request to the same one.

The runtime identity canonicalizes the bare official origin `https://api.openai.com` to
`https://api.openai.com/v1`. It applies the same effective transport rule to `custom` relays: a bare
origin receives `/v1`, and a custom prefix receives a trailing `/v1`. A paid v1 contract frozen by
older code from the pre-normalization raw text will not match the new hash. Treat it as a closed
historical operation: do not retry it, inspect and release or reconcile any reservation, then create
a fresh quote only after the Provider remains authorized. Contracts originally frozen with their
effective `/v1` API Base keep their existing hash.

Do not promote a Provider by changing only `evidenceLevel`. For every operation that will be marked
`sandbox-verified`, add a reviewed `sandboxEvidence` record with the report's `apiBaseSha256`, exact
operation, actual input transport, and actual sync/async result mode. `apiBaseSha256` is the only
direct-submit field eligible for Registry `sandboxEvidence.endpointSha256`; it hashes the same
normalized Provider API Base used by runtime contracts. `operationEndpointSha256` instead binds the
specific guarded POST and must not be copied into the Registry. Historical `schemaVersion: 3`
reports used the ambiguous name `endpointSha256` for that operation endpoint, so they are still
eligible for billing finalization but cannot by themselves supply Registry API-base evidence.
Evidence is not portable between API Bases, operations, multipart/base64/public-URL modes, or
sync/async adapters. The static Provider contract requires complete bindings for every operation
advertised by a verified entry, while final dispatch rechecks the single operation actually being
executed.

## DashScope `qwen-mt-image` Translation Probe

This lane accepts only the default-port official origin `https://dashscope.aliyuncs.com` (optionally with the exact `/api/v1` path) and the exact `qwen-mt-image` model. Custom ports, path prefixes, credentials, queries, and fragments are rejected. The CLI normalizes the base to `/api/v1`, pins public DNS, submits once to the official image-synthesis service, and polls a bounded task endpoint.

A synthetic source is preferred but not mandatory. A real product image may be used when the operator has explicit authorization to send it to Alibaba Cloud and has checked the image and metadata for personal data, credentials, private supplier data, or other prohibited content. Record that approval outside the public report.

### Pin Local And Public Source Bytes

DashScope must fetch a public HTTPS source URL asynchronously. Prepare one local PNG, JPEG, or WebP file of at most 20 MiB and 4096 pixels per edge, then publish those exact bytes at a dedicated temporary URL.

Before setting the paid confirmation:

1. Compute the local lowercase SHA-256.
2. GET the public URL independently and confirm its bytes have the same SHA-256 and MIME type.
3. Make the object immutable for the entire submit and reconciliation window. Prefer a content-addressed object name, overwrite protection, and `Cache-Control: immutable`.
4. Record the object version and ETag privately. The CLI stores only `etagSha256` and `cacheControlImmutable` in its intent/report.
5. Give a signed URL enough lifetime for the bounded poll and later manual reconciliation. Do not put the URL into a ticket, chat, or public report.

The CLI repeats the GET and byte-hash check before the paid POST. A matching ETag alone is not proof of matching content. ETag and `Cache-Control: immutable` are recorded evidence, not an automatic dispatch gate. If the resulting evidence reports `cacheControlImmutable=false` or lacks the expected ETag evidence, fail the acceptance review even if the Provider returned an image.

### Complete `SUBMIT` Environment Contract

| Variable                                           | Requirement                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                         | Must be `sandbox`                                                                              |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODE`                | Must be `SUBMIT`                                                                               |
| `AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM`             | Must be exactly `I_ACCEPT_ONE_PAID_IMAGE_TRANSLATION_REQUEST` immediately before this one run  |
| `AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL`            | Official DashScope HTTPS base, without an operation path                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST`       | Must identify the official DashScope hostname                                                  |
| `AI_IMAGE_TRANSLATION_SANDBOX_API_KEY`             | Alibaba Cloud secret injected for this process only                                            |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODEL`               | Must be `qwen-mt-image`                                                                        |
| `AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID`        | New one-use Operation ID                                                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION` | Non-secret revision of the injected Alibaba key                                                |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`                | Exact deployed Git commit SHA; this variable is intentionally shared with the generation probe |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_PATH`         | Absolute or repository-root-relative path to the reviewed source bytes                          |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256`       | Lowercase SHA-256 shared by the local file and public object                                   |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_URL`          | Temporary public HTTPS URL for those exact bytes                                               |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_LANGUAGE`     | Source language code                                                                           |
| `AI_IMAGE_TRANSLATION_SANDBOX_TARGET_LANGUAGE`     | Different target language code                                                                 |
| `AI_IMAGE_TRANSLATION_SANDBOX_DOMAIN_HINT`         | Reviewed translation context; maximum 16,000 UTF-8 bytes                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_TERMINOLOGIES_JSON`  | Optional JSON array of at most 50 unique `{\"src\",\"tgt\"}` entries; defaults to `[]`         |
| `AI_IMAGE_TRANSLATION_SANDBOX_QUOTED_COST_CENTS`   | Positive integer quote recorded before dispatch                                                |
| `AI_IMAGE_TRANSLATION_SANDBOX_MAX_COST_CENTS`      | Positive integer operator-approved exposure; not an Alibaba billing limit                      |

### Submit Once

After the source, revisions, dark state, and cost snapshot pass review, run exactly once:

```bash
pnpm --filter server sandbox:ai-image-translation:single
```

Unset the confirmation, API key, and source URL after exit. Inspect the submit report, result image, immutable intent, and private recovery journal under `tmp/ai-image-translation-sandbox/`. Do not resubmit when polling or download is incomplete.

### Recorded Quality Observation (2026-07-24)

A controlled synthetic `en` to `ru` A/B completed against the official `qwen-mt-image` lane. The reviewed semantic request inputs kept the source bytes, language pair, model, adapter and domain context fixed; only the terminology glossary changed.

- The no-glossary result mistranslated the product and capacity labels.
- The glossary-constrained result used the correct Russian product and capacity wording and retained the reviewed layout.
- The reports retained `actualCostCents: null`, so this run did not close the billing evidence gate.
- No production-equivalent `zh` to `ru` marketplace image and category glossary has passed the same review.

Treat this as a narrow quality observation, not capability promotion. `dashscope-qwen-mt-image` remains `adapter characterized`, Unit 0B remains open, and all production translation switches remain dark. Before promotion, run a separately approved `zh` to `ru` acceptance corpus with trusted category terminology, reconcile the settled charge, and review Russian readability, Chinese-text residue, layout preservation and product identity. Never reuse the earlier Operation IDs or repeat either paid request.

### `RECONCILE` With GET Only

Use reconciliation only for an existing translation Operation ID whose submit report is `RECONCILIATION_REQUIRED`. It loads the original immutable intent and private recovery journal. The network guard permits task polling and result download GETs but blocks a new submit POST.

Set exactly these variables for a reconciliation attempt:

| Variable                                           | Requirement                                              |
| -------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                         | Must be `sandbox`                                        |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODE`                | Must be `RECONCILE`                                      |
| `AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL`            | Same official base bound to the original intent          |
| `AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST`       | Same official hostname                                   |
| `AI_IMAGE_TRANSLATION_SANDBOX_API_KEY`             | Credential authorized to read the original task          |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODEL`               | Must remain `qwen-mt-image`                              |
| `AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID`        | The original Operation ID; never a replacement ID        |
| `AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID`   | New one-use ID for this read-only reconciliation attempt |
| `AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION` | Must match the original intent                           |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`                | Full Git SHA of the currently deployed reconciliation CLI; must equal `DEPLOYED_COMMIT` |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256`       | Must match the original source digest                    |

Do not set the paid `SUBMIT` confirmation. Quoted and maximum costs, language, terminology, and source URL evidence remain bound by the original intent. Source path, raw source URL, language, terminology, and cost variables are not read in `RECONCILE`; do not set replacements for them.

The immutable intent retains the SHA of the code that performed the original submit. A later deployment may safely reconcile that task: the runner validates the stored SHA as `submissionAdapterRevision`, independently requires the current `AI_IMAGE_SANDBOX_ADAPTER_REVISION` to equal `DEPLOYED_COMMIT`, and records the latter as `reconciliationAdapterRevision` (and the backward-compatible `adapterRevision`) in the reconciliation evidence. Do not copy the old submit SHA into the current environment after a deployment.

The raw result URL in the private journal is only a download hint. If it is expired or fails the current HTTPS/host/DNS policy, reconciliation preserves that raw evidence, sends no request to the rejected URL, and continues bounded GET-only polling through the durable Provider task ID. This fallback never authorizes another submit POST.

Run:

```bash
pnpm --filter server sandbox:ai-image-translation:single
```

One reconciliation attempt is bounded to 30 polls and 10 minutes. If it remains `RECONCILIATION_REQUIRED`, stop. Wait for external state to change, inspect the Alibaba task and billing records, and approve a later read-only reconciliation explicitly. Never change the Operation ID and return to `SUBMIT`.

## Outcome Handling

The report state, request counters, intent, recovery evidence, and Provider billing record are authoritative. The generic terminal error text is not.

| State                     | Meaning                                                                    | Required action                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRE_DISPATCH_FAILED`     | No guarded create/submit POST was sent                                     | Preserve the intent and fingerprint. Confirm the request counter is zero, fix the root cause, and review a genuinely new request. A new Operation ID alone is not a retry mechanism.                      |
| `REJECTED`                | The Provider returned a definite rejection after dispatch                  | Do not assume zero cost. Preserve evidence, inspect the Provider bill and rejection, then require a new reviewed request for any later attempt.                                                           |
| `RECONCILIATION_REQUIRED` | Dispatch, acknowledgement, polling, or download is ambiguous or incomplete | Never resubmit. For translation, use the same Operation ID with `RECONCILE`; for the third-party lane, use only external read-only evidence. Keep the source object available.                            |
| `FAILED`                  | DashScope reported a terminal failed or cancelled task                     | Stop polling, preserve evidence, and reconcile billing. Any later submission must be a separately approved request based on a diagnosed cause.                                                            |
| `SUCCEEDED`               | One output was downloaded and passed structural checks                     | Perform visual, semantic, dimension, source-preservation, and billing review. Success proves only this endpoint/model/operation/revision combination; it does not authorize tenant or production rollout. |

Provider HTTP `408`, `409`, `425`, `429`, 5xx responses, transport loss, malformed acknowledgements, and poll/download uncertainty are reconciliation cases, not definite rejections.

Configuration, local source, revision, and DNS failures can happen before an immutable claim/report exists. The direct CLI emits one sanitized `SANDBOX_COMMAND_FAILED` JSON event containing only `failureCode`, followed by a generic message. If the operation has no intent, fingerprint claim, or report, treat that as a pre-claim failure; correct the cause only after confirming all three are absent. Never infer dispatch state from the generic terminal message alone.

## Evidence, Recovery, And Cleanup

Sandbox directories and files are created with Unix modes `0700` and `0600` where the platform supports them. Claims, intents, recovery entries, result files, and renamed reports are synced together with their parent directory before the next state transition. Verify the mode and persistent shared path on the execution host. Windows permission emulation is best effort and requires an equivalent ACL.

Retain together:

- immutable intent and fingerprint claim;
- the private one-request approval file and its reviewed SHA-256 digest;
- sanitized submit or reconciliation report;
- its report-bound failure diagnostic sidecar, when present;
- source and mask SHA-256 evidence;
- generated result and its SHA-256 until visual review completes;
- pre-call and settled billing evidence;
- exact deployed commit and credential revision;
- the operator decision for the final acceptance result.

The translation recovery journal contains the **raw Provider task ID and raw result URL**. Keep it `0600`, restrict it to operators performing reconciliation, and never attach it to a ticket, commit, chat, or public report. Sanitized reports replace raw task IDs, request IDs, endpoints, source URLs, ETags, prompts, sources, masks, and results with hashes where applicable, while retaining bounded metadata needed for review. Remove local filesystem paths before sharing a report outside the operations team.

Do not delete or revoke the public translation source while a task is pending or reconciliation is required. After a terminal result, visual review, billing reconciliation, and evidence backup:

1. delete the temporary public source object or revoke its public/signed access;
2. verify the URL no longer serves the bytes;
3. retain or delete local source bytes according to the approved data-retention policy while preserving the recorded digest;
4. retain audit evidence for the approved security and financial retention period;
5. never upload sandbox output to a production listing or Ozon as part of this runbook.

Promotion is a separate change. It requires endpoint-bound capability evidence, operation-specific quality acceptance, verified pricing, budget controls, credential and adapter revisions, an approved tenant scope, review, deployment, and post-deploy monitoring.
