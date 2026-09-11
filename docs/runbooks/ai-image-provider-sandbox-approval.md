# QA-02 AI Image Sandbox One-Request Approval

Use this private approval record immediately before one paid international AI image sandbox
request. It binds the operator's approval to one exact endpoint, model, operation, request profile,
credential revision, deployed adapter revision, source/mask digest, maximum cost, and short validity
window.

This record is not a Provider API Key, a production rollout approval, or permission to retry an
ambiguous request. Never include an API Key, Authorization value, raw Provider response, Ozon
credential, tenant identifier, or customer data in it.

## Current Blocker

Do not prepare a new edit approval for the previously rejected international relay/model pair. The
following consumed `IMAGE_TO_IMAGE` Operation IDs must never be reused or repeated:

```text
gpt-image-2-i2i-20260724-200300-01
gpt-image-2-i2i-20260725064150-03
qa02-i2i-20260730-083710-01
qa02-centos-i2i-20260730-094857-01
qa02-packy-i2i-20260801-e4503e9-01
qa02-packy-i2i-documented-20260801-9b6cc05-01
qa02-xiaoyi-i2i-20260801-f189dfa-01
qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01
qa02-picpi-i2i-20260801-de951b7-01
```

The Centos operation definitively rejected `/v1/images/edits` for its tested
`https://ai.centos.hk/v1` Token and `gpt-image-2` combination. The final Packy operation likewise
returned definite HTTP 400 for
`https://www.packyapi.ai/v1`, replacement credential revision `-02`, `gpt-image-2` and the reviewed
single-source multipart contract. Both settled with no charge. Do not prepare `FULL_EDIT`, `INPAINT`,
or another image-to-image approval for either same combination unless the Provider first supplies a
reviewed edit-contract/account correction; otherwise select a different edit-capable Provider and
use a new policy, Operation ID and approval after that external change.

The two Xiaoyi operations sent the V1 five-field and documented V2 three-field synchronous
multipart contracts once each. Both received definite HTTP 400, produced no image, and settled with
no charge. Do not retry either Operation ID or prepare `FULL_EDIT`/`INPAINT` for the same Xiaoyi
route/account/model/profile without a Provider-confirmed material permission or contract change.

The PicPi operation sent the generic multipart contract once, received definite HTTP 400, produced
no image, and settled from authenticated API-key lifetime zero usage. Do not retry it or prepare
`FULL_EDIT`/`INPAINT` for the same PicPi route/account/model/profile. Another paid PicPi approval
requires a Provider-confirmed material route/account/contract change; renaming the Operation ID is
not such a change.

Those two Xiaoyi results remain negative evidence for their exact account, endpoint, model, and
wire contracts. They are not erased or converted into Wanx evidence by selecting a new Provider.
The Wanx implementation described below is offline and mocked only: the credential pasted into
chat was exposed and was not used, no live DashScope request was made, and no Wanx charge was
incurred. Revoke that value and use only a separately rotated private credential revision for any
future authenticated preflight or paid approval.

The dedicated DashScope catalog-only preflight may verify that a rotated credential can read an
exact `wanx2.1-imageedit` model entry from the reviewed legacy API Base. Its v3 manifest explicitly
requires separate billing evidence and records `editCapabilityVerified=false`; it is not a pricing
record, maximum-cost approval, billing snapshot, or positive edit result. Do not create a paid
approval merely because this GET succeeds.

The candidate `https://ai.big-model-api.top/v1` / `gpt-image-2-count` is present in an
authenticated model catalogue, but the catalogue does not need to be a live pricing source for
this sandbox. Before a paid approval, retain a private, versioned backend pricing policy that binds
the exact alias/account reference, operation, quality, size, image count, currency, quote, and
single-request maximum. `AI_IMAGE_SANDBOX_PRICING_REVISION` names that policy revision; no Provider
pricing API synchronization is required. The policy is an internal approval/budget control, not a
Provider-side hard spending cap, and the finalizer must still reconcile the actual before/after
meters. A price stated in chat remains planning input until it is entered into and reviewed against
that policy. `OPENAI_SQUARE_SINGLE_V1` and `OZON_PORTRAIT_SINGLE_V1` bind quality as
`PROVIDER_DEFAULT_OMITTED`: their guarded requests contain no `quality` field. The isolated
`PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` profile instead binds `quality=high`, `output_format=png`, and
`response_format=url` while omitting optional `input_fidelity`. A policy for another quality or
multipart dialect requires a new profile and cannot authorize any existing transport contract.
`XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1` binds the exact Xiaoyi image host, `gpt-image-2`, synchronous
`IMAGE_TO_IMAGE`, one source, `1024x1024`, `n=1`, and the V1 five-field multipart body. The distinct
`XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2` keeps the same logical dimensions/count but sends only
`model`, `prompt`, and `image`; it cannot inherit the consumed V1 approval or fingerprint. Both
require exact money and neither can authorize `FULL_EDIT`, `INPAINT`, or async editing.

One approval file authorizes only one of `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or
`INPAINT`; it cannot prove another operation.

## Wanx 2.1 Async Edit Approval Boundary

The first reviewed Wanx sandbox identity is exactly:

```text
API Base: https://dashscope.aliyuncs.com/api/v1
Submit:   https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis
Model:    wanx2.1-imageedit
```

The approval and runner derive the asynchronous submit endpoint from that API Base. A workspace
endpoint, another region, another model, or an OpenAI-compatible `/images/edits` route is a
different Provider identity and cannot inherit this approval. Each operation has its own closed
profile and function mapping:

| Operation        | Request profile                                      | Wanx function                 |
| ---------------- | ---------------------------------------------------- | ----------------------------- |
| `IMAGE_TO_IMAGE` | `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`           | `description_edit`            |
| `FULL_EDIT`      | `DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1`                | `description_edit`            |
| `INPAINT`        | `DASHSCOPE_WANX21_INPAINT_ASYNC_V1`                  | `description_edit_with_mask`  |

Although `IMAGE_TO_IMAGE` and `FULL_EDIT` share the Provider function, they are different product
operations with different Prompts and expected outcomes. Generate and review three separate
policies, Operation IDs, approval files, pre-call billing snapshots, and settlements. A successful
or consumed approval for one profile never authorizes either of the other two. `INPAINT` also binds
the exact source digest, original alpha-mask digest, and same-size media. The immutable fingerprint
binds that original mask plus the transport/function and adapter revision; the guarded JSON request
separately binds the deterministic transport-mask digest after alpha is converted to white=edit and
black=preserve.

Alibaba's [public Wanx reference](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference)
reviewed on 2026-08-01 lists `CNY 0.14` per image. That value is only input for planning a private
policy; it is not an account-specific quote, an approved maximum, a Provider-side cap, or proof of
a settled charge. No Provider pricing synchronization is required. Before every paid operation,
the operator must explicitly approve an exact CNY quote and a separately chosen single-request
maximum in the private schema v3 record. The quote and maximum may be reviewed from internal policy
without calling a Provider pricing endpoint.

## Generate A Non-Approval Draft Offline

After selecting the exact endpoint/model and preparing the non-secret request metadata, an operator
may generate a near-final private JSON draft instead of assembling the schema by hand:

```bash
pnpm --filter server sandbox:ai-image:approval:draft
```

The command requires a private, existing parent directory (mode `0700` on Linux), a clean
verifiable Git checkout of `AI_IMAGE_SANDBOX_ADAPTER_REVISION`, and the same endpoint, model,
operation/profile, credential revision, source/mask digest, and quoted/maximum cost variables used
by the submit command. New approvals use exact money: one uppercase currency, canonical positive
integer `amount` values, and one shared `scale` from `0` through `8`. The quote must not exceed the
maximum, and the maximum must not exceed `100,000` major currency units. Decimal strings and
floating-point values are never used. Exact-money variables must not be mixed with the legacy
integer-cents variables. Edit media must use supported bounded PNG/JPEG/WebP bytes. `INPAINT`
accepts one such source and requires a same-size PNG mask; source plus mask must not exceed the shared `50 MiB`
multipart limit. A Wanx profile applies the narrower Provider contract: source and mask must each
be no larger than 10 MiB and 512 through 4096 pixels on each axis. It additionally requires:

| Variable                                                  | Requirement                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH`                    | New private output path; an existing path is never overwritten      |
| `AI_IMAGE_SANDBOX_APPROVAL_ID`                            | Proposed unique approval ID                                         |
| `AI_IMAGE_SANDBOX_OPERATION_ID`                           | New one-use ID for this exact proposed request                       |
| `AI_IMAGE_SANDBOX_BASE_URL`                               | HTTPS API base without an `/images/generations` or `/images/edits` path |
| `AI_IMAGE_SANDBOX_APPROVER_REF`                           | Non-secret reference for the future recorded review                 |
| `AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF`                   | Non-secret Provider account reference                               |
| `AI_IMAGE_SANDBOX_PRICING_REVISION`                       | Version of the backend pricing policy; no live Provider sync required |
| `AI_IMAGE_SANDBOX_CURRENCY`                               | Three-letter uppercase currency code                                |
| `AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT`                     | Canonical positive integer quote in the shared scale                 |
| `AI_IMAGE_SANDBOX_MAX_COST_AMOUNT`                        | Canonical positive integer approved maximum in the shared scale      |
| `AI_IMAGE_SANDBOX_COST_SCALE`                             | Shared decimal scale from `0` through `8`                            |
| `AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF`          | Non-secret reference for the reviewed before-call bill snapshot     |
| `AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF`             | Non-secret reference for the future settled-bill reconciliation     |

API keys, `AI_IMAGE_SANDBOX_CONFIRM`, `Authorization`, an existing approval path/digest, and common
Provider secret variables must all be absent. Draft generation reads only pinned local media and
Git metadata. It performs no DNS lookup or Provider request and creates no request intent or replay
fingerprint. The output file is created once as mode `0600` on Linux; stdout contains only a
sanitized event and hashes. Linux creation, persisted-byte verification, leaf checks, and directory
sync remain bound to one held parent descriptor, so replacing the visible parent path cannot redirect
the write. A detected parent change fails closed. Other platforms retain canonical path and
before/after identity checks under the documented local ACL trust boundary.

Draft generation and the later exact-request preflight share one local-only media verifier. It opens
the final source/mask entry with no-follow semantics where supported, bounds each descriptor read,
checks the pinned digest, PNG/JPEG/WebP decode, dimensions, pixels, single-page state, and meaningful
PNG mask alpha, and enforces the aggregate edit limit before reading excess mask bytes. A manually
assembled approval record cannot bypass these checks.

The generated file deliberately contains these rejection sentinels:

```text
statement: DRAFT_REVIEW_REQUIRED_NOT_APPROVED
approvedAt: REPLACE_DURING_REVIEW
expiresAt: REPLACE_DURING_REVIEW
```

It is not an approval and the submit/preflight loader must reject it. A human approver must review
every request field against the backend pricing policy, Provider account, source/mask bytes,
deployed revision, dark-state result, and pre-call billing evidence. Only during that review may the
approver replace
`statement` with `I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST`, set distinct canonical UTC
`approvedAt`/`expiresAt` values with a positive window of at most 60 minutes, and save the canonical
two-space JSON. Compute a new SHA-256 only after those three manual replacements and the final
review. These are the only three fields that may be edited in place. If any other bound field is
wrong, preserve the old draft as rejected evidence, correct the environment, and generate a new
file at a new `AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH`. The final file must still use two-space JSON
and one trailing newline. Set `AI_IMAGE_SANDBOX_APPROVAL_PATH` and its newly computed
`AI_IMAGE_SANDBOX_APPROVAL_SHA256` only after that review. Never treat the draft event or its
pre-review digest as paid-request authority.

## Published Template Source And Offline Input Compilation

The source endpoint is available in API versions containing this change. An authorized
superadmin can read `GET /api/admin/ai-prompt-templates/full-image-edit.base/source` and
`GET /api/admin/ai-prompt-templates/inpaint.base/source`. Unlike the template list endpoint,
these reads do not initialize missing templates. A missing release returns 404; an incomplete
publication/PASS chain or a release changed during the read is rejected. A rollback is linked
to its earlier publication of the same revision. The response omits internal actor identities.

Retain each authorized HTTP capture privately, including the origin, time, response bytes and
their SHA-256. The HTTP response uses the standard `{code,msg,data}` envelope. Use the offline
source importer below to validate the captures and produce the compiler references. Its data
conversion uses two-space JSON with a final newline and no BOM:

```js
const envelope = JSON.parse(responseBody);
if (statusCode !== 200 || envelope.code !== 1) throw new Error('Source export failed');
const sourceBytes = Buffer.from(`${JSON.stringify(envelope.data, null, 2)}\n`, 'utf8');
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
```

Store the resulting bare source object as a separate private file. Preserve both digests and
their transformation relationship in the private capture record. The compiler pins the source
file digest, not the HTTP envelope digest. It accepts LF, CRLF or mixed line endings supported by
the private JSON reader and preserves the exact source bytes in its output bundle. Pretty-printing
does not authenticate a source; approved capture evidence remains necessary.

Use `pnpm --filter server sandbox:ai-image:wanx-trial:input:compile` with the same sandbox,
private-root, clean-revision, account and credential-reference settings as preparation below.
`AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH` and `AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256` select the raw
draft input. Keep `AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256`, credentials, paid confirmation
and legacy request overrides absent. The command does not load `.env` or access the network.

The draft retains the trial v1 root fields, amounts, operation IDs and media bindings described
below, with `kind:WANX_EDIT_TRIAL_INPUT_DRAFT_V1`. In each of its two operations, replace
`frozenPrompt` with `prompt`, nullable `negativePrompt`, and `templateSource:{path,sha256}`.
The source path is relative to the private evidence root. Use the full-edit source for
`FULL_EDIT` and the inpaint source for `INPAINT`. Do not supply resolved text, snapshots or
approval fields; the compiler derives the frozen prompt using the existing Wanx rendering owner.

Compilation validates both source chains, media, the 800-code-point limit and the CNY 1 combined
maximum before creating `wanx-input-<roundId>`. The immutable bundle contains
`full-edit-template.json`, `inpaint-template.json`, `input.json` and `manifest.json`.
Stdout includes `inputSha256` and `compilationManifestSha256` with sanitized source bindings.
Retain those digests separately. For preparation, point the two input settings at that bundle's
`input.json` and `inputSha256`; then use the preparation manifest digest for verification.

Compilation remains `COMPILED_NOT_APPROVED`, `canSubmit:false`, `actualCost:null`,
`sourceVerification:OFFLINE_CONSISTENCY_ONLY` and `sourceAuthentication:REQUIRES_CAPTURE_REVIEW`.
It creates no ERP task, execution claim or billing evidence, and preserves all later submission
requirements. Existing output directories are rejected, including incomplete prior bundles.

### Import Captured Source Responses Offline

Run `pnpm --filter server sandbox:ai-image:wanx-trial:sources:import` with the same sandbox,
clean code revision, private root and trial identity settings as preparation. Additionally set
`AI_IMAGE_SANDBOX_ERP_ORIGIN` to the independently selected canonical HTTPS origin, such as
`https://ss-erp.com`, without a trailing slash, credentials, path, query or fragment. This is
an offline origin comparison; the command does not resolve DNS, fetch a URL or authenticate a
session. Never place cookies, Authorization headers or Provider keys in its input or environment.

Select the private capture record with `AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH` and its exact
`AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256`. The record uses the private reader's canonical JSON format:

- `schemaVersion:1`, `kind:WANX_EDIT_TEMPLATE_SOURCE_CAPTURES_V1`, and the same `roundId` and
  `adapterRevision` as the selected trial.
- Exactly two `captures`, one each for `full-image-edit.base` and `inpaint.base`.
- Each capture has `templateKey`, canonical UTC `capturedAt`, an ASCII non-secret `collectorRef`
  of 1–128 identifier characters, and the following closed request/response records.
- `request:{method:"GET",url:"<origin>/api/admin/ai-prompt-templates/<templateKey>/source"}`.
  The exact selected origin and template key must agree with that capture's response data.
- `response:{httpStatus:200,contentType:"application/json; charset=utf-8",bodySha256,bodyBase64}`.
  `bodyBase64` must encode the original HTTP response bytes and `bodySha256` must hash those bytes,
  before any JSON parsing or formatting. Keep request/response headers out of this record.

The importer requires the actual success envelope `{code:1,msg:"ok",data}` and validates `data`
through the existing published-source owner. Each raw body is limited to 256 KiB. JSON whitespace,
CRLF and escaped Unicode are accepted; duplicate decoded keys, excessive depth, invalid UTF-8/BOM
and noncanonical base64 are rejected. Numeric codes, versions and sequences must be non-negative
safe integers written as plain decimal integer tokens; fractional or exponent tokens are rejected
before they can round into accepted identities. Capture times must not
precede the active publication and cannot be more than five minutes in the future. These checks
do not prove the capture's authenticity or that its publication is still active at import time.

After both captures pass, the importer creates `wanx-sources-<roundId>` using the existing private
bundle writer. It retains the original wrapper as `captures.json`, exact HTTP bodies as
`full-edit-response.json` and `inpaint-response.json`, and normalized data as
`full-edit-template.json` and `inpaint-template.json`. It writes `manifest.json` last, binding the
capture digest, selected origin digest, capture times, collector/request digests and each response
to its exported source. Existing or incomplete output directories are rejected without overwriting.

Stdout returns `manifestSha256` and `sources[]`, including each operation's ready-to-use
`templateSource:{path,sha256}`. Those paths are relative to the private evidence root, never absolute
private paths. Copy the complete reference into the corresponding raw-prompt draft operation:

```js
operation.templateSource = imported.sources.find((source) => source.operation === operation.operation).templateSource;
```

Remove `AI_IMAGE_SANDBOX_ERP_ORIGIN` before running `input:compile`, `prepare`, `verify` or
`approval:draft`; these four offline modes reject import-only settings. Point the input path/digest at the raw-prompt draft for compilation,
then continue the existing prepare/verify flow. The importer creates no prompts, media, ERP jobs,
claims, approvals or billing evidence. Its state is `IMPORTED_NOT_AUTHENTICATED`, with
`sourceVerification:OFFLINE_CONSISTENCY_ONLY`, `sourceAuthentication:REQUIRES_CAPTURE_REVIEW`,
`canSubmit:false` and `actualCost:null`. Authenticated capture review remains separate.

## Frozen Wanx Two-Operation Trial Preparation

Use the following **offline preparation and verification** commands for the scoped CNY 1 trial:

```bash
pnpm --filter server sandbox:ai-image:wanx-trial:prepare
pnpm --filter server sandbox:ai-image:wanx-trial:verify
```

These commands do not submit images, initialize or publish templates, create ERP jobs, reserve
execution funds, query bills, or approve payment. Every result remains `canSubmit:false`,
`actualCost:null`, and `sourceVerification:OFFLINE_CONSISTENCY_ONLY`. In particular, a valid local
template snapshot is not evidence that its release or workflow exists in the selected ERP account.
Trusted source export, task-to-settled-bill association, a reviewed execution checkpoint, exact
per-operation approvals, and durable round/operation execution claims remain required before a
future paid path can consume a preparation. The existing fixed-prompt single-submit command cannot
consume this manifest as an approval. Do not change its fields to turn it into one.

Both commands require `NODE_ENV=sandbox`, a verifiable clean Git checkout, and an existing private
evidence root. Keep Provider/cloud credentials, cookies, Authorization, paid confirmation, and
legacy approval/submission/billing input variables absent. The commands do not load `.env`.

| Setting | Meaning |
| --- | --- |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION` | Full Git OID of the exact preparation and verification code |
| `AI_IMAGE_SANDBOX_EVIDENCE_ROOT` | Existing operator-controlled private directory; `0700` on POSIX |
| `AI_IMAGE_SANDBOX_TRIAL_ROUND_ID` | One bounded, non-secret round reference, 8–64 ASCII identifier characters |
| `AI_IMAGE_SANDBOX_CREDENTIAL_REVISION` | Non-secret credential version reference, never a key or key hash |
| `AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256` | Independently selected account digest; matching it does not prove live account ownership |
| `AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH` | Prepare only: pinned canonical JSON inside the private evidence root |
| `AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256` | Prepare only: digest of those exact input bytes |
| `AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256` | Verify only: independently retained digest from preparation |

The input uses two-space canonical JSON with a final newline and this closed contract:

- `schemaVersion:1`, `kind:WANX_EDIT_TRIAL_INPUT_V1`, and the selected `roundId`,
  `adapterRevision`, `credentialRevision`, and `providerAccountUidSha256`.
- `provider:dashscope-wanx`, `model:wanx2.1-imageedit`, and
  `apiBase:https://dashscope.aliyuncs.com/api/v1`. Workspace or alternate region endpoints cannot
  inherit this trial identity.
- `maximumCost:{"currency":"CNY","amount":1,"scale":0}`.
- Exactly two `operations`: one `FULL_EDIT` and one `INPAINT`, with distinct `operationId` values.
  Each carries a `source:{path,sha256}`, a `mask` (`null` for full edit, `{path,sha256}` for inpaint),
  a `frozenPrompt`, and exact `quotedCost`/`maximumCost` objects.
- `frozenPrompt` carries the existing owner's `prompt`, `negativePrompt`, `resolvedPrompt`,
  `resolvedNegativePrompt`, `templateKey`, `templateReleaseId`, `templateChecksum`, and full
  `templateSnapshot`. Preserve the registry snapshot, including `renderingContract`, `consumer`,
  and `variableKeys`. The existing `assertWanxHostedEditPrompt` owner re-renders the complete
  Wanx profile and rejects any inconsistent release/checksum/text/contract or text over 800
  Unicode code points. A default-template preview must not be relabeled as a verified ERP release.

Source and mask paths are relative to the evidence root. Absolute paths, traversal, URLs, links,
public POSIX file permissions, changed digests, malformed images, or non-1024×1024 canvases are
rejected before output. Each image is limited to 10 MiB and fully decoded. The inpaint input is the
existing PNG alpha-mask format, with transparent edit pixels and opaque preserved pixels; the
paid adapter's existing conversion to white-edit/black-preserve remains a separate execution step.

Quotes and maxima must share a currency and scale within each operation. Both use CNY and
positive safe integer amounts; scales may differ between the two operations. The owner sums
**both maxima**, using exact integer arithmetic, and rejects any total above CNY 1. Neither the
official CNY 0.14 reference nor a low quote reduces an operation's allocated maximum. This verifies
a proposed allocation; it is not a Provider-side spending cap or an execution reservation.

Preparation creates exactly one `wanx-trial-<roundId>` directory under the evidence root. It copies
the pinned sources and alpha mask, then writes `manifest.json` last. Concurrent or repeated
preparation of that round is rejected, including a directory left by an interrupted write. Do not
delete or overwrite such evidence to retry; retain it for review. This immutability is scoped to
the selected evidence root and does not substitute for a future central execution claim.

Stdout contains the manifest digest, allocation and sanitized request bindings, never raw prompts,
image bytes, credential references or file paths. Retain the digest separately. For verification,
remove the two prepare-only input variables and supply `AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256`.
Verification reads only the saved bundle, checks every pinned image, re-renders the frozen prompt,
recalculates the allocation and existing paid-wire fingerprint, and compares the complete manifest.
It writes nothing and cannot release budget or infer zero charges from a failed task or empty bill.
Original input images may subsequently move; the immutable copies are the verification inputs.

### Per-Operation V4 Approval And Isolated Execution

The existing single-submit pipeline now has an explicit isolated Wanx trial mode. It consumes the
prepared manifest separately from a **schema v4 one-operation approval**. The manifest remains
`PREPARED_NOT_APPROVED` and is never rewritten to grant execution.

```bash
pnpm --filter server sandbox:ai-image:wanx-trial:approval:draft
pnpm --filter server sandbox:ai-image:wanx-trial:approval:verify
pnpm --filter server sandbox:ai-image:wanx-trial:single
```

This mode proves sandbox transport and budget mechanics. It does not verify the ERP provenance or
native task-to-bill association listed in `requiredBeforeSubmit`. Real pilot dispatch remains an
operator stop until those facts and the exact per-operation approval are available. Approval
reference strings do not replace those facts; see the [native billing boundary](ai-image-provider-sandbox-billing.md#native-wanx-task-association-and-settlement-boundary).

For all three commands, retain the same private evidence root, round ID, manifest digest, account
UID digest, credential revision and clean code revision used during preparation. Select exactly
`FULL_EDIT` or `INPAINT` with `AI_IMAGE_SANDBOX_OPERATION`. Do not provide independent endpoint,
model, operation ID, profile, source/mask paths, currency or cost overrides: these values come from
the frozen manifest. The submit API's `outputDirectory` override is also forbidden in trial mode.

The offline draft command additionally requires the same non-secret review metadata as ordinary
drafting: `AI_IMAGE_SANDBOX_APPROVAL_ID`, `AI_IMAGE_SANDBOX_APPROVER_REF`,
`AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF`, `AI_IMAGE_SANDBOX_PRICING_REVISION`,
`AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF`, and
`AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF`. It writes one new
`wanx-trial-<roundId>/approval-drafts/<approvalId>.json` and refuses to overwrite it. It retains the
three rejection sentinels described above; a generated draft cannot authorize a request.

V4 retains the v3 exact-money fields and adds one closed `trialBinding`:

| Binding | Purpose |
| --- | --- |
| `roundId` | Select the same immutable two-operation allocation |
| `manifestSha256` | Bind the exact frozen inputs, prompts and maxima |
| `evidenceRootSha256` | Bind the canonical private path and its filesystem identity, including replacement at the same path |
| `providerAccountUidSha256` | Bind the independently reviewed account digest |
| `requestFingerprint` | Retain the existing paid-wire replay identity |
| `frozenPromptSha256` | Bind the full frozen prompt and template snapshot |

After review, change only the statement and two timestamps using the existing one-request approval
procedure, then set `AI_IMAGE_SANDBOX_APPROVAL_PATH` and `AI_IMAGE_SANDBOX_APPROVAL_SHA256`.
Approval verification rejects keys and paid confirmation, performs no DNS or Provider calls, and
creates no claims. Ordinary modes reject v4 approvals; trial modes reject v2/v3 approvals and mixed
or missing trial selection. Mixed, repeated or unknown CLI flags are rejected before credentials
are read.

Only the submit command receives the exact injected `AI_IMAGE_SANDBOX_API_KEY` and the existing
`AI_IMAGE_SANDBOX_CONFIRM=I_ACCEPT_ONE_PAID_IMAGE_REQUEST`. Neither value belongs in the approval,
manifest, shell history, report or Git. The caller must already have separate live authorization;
having a runnable command is not that authorization.

Before the Provider POST, the runner creates the original global fingerprint/intent under
`<evidenceRoot>/intents`, then binds `wanx-trial-<roundId>/execution/round.json` and exclusively
claims `FULL_EDIT.claim.json` or `INPAINT.claim.json`. The round record freezes both maxima and
the manifest; the slot name is the operation, not a replaceable approval ID. The last send check
revalidates the code, manifest, directory identity, claims and approval validity. The in-memory
POST guard also claims synchronously before body, DNS or approval awaits.

Keep every claim after partial failure, rejection, timeout or unknown outcome. A new approval,
operation label, checkout, copied directory or changed manifest cannot reset an already claimed
slot. No automatic refund or retry exists in this trial. The two fixed allocations cannot exceed
CNY 1, but this is an execution authorization ceiling, not a Provider-side hard spending cap or
proof of the eventual bill amount.

Retain the normal intent, report, Wanx async evidence and
`<operationId>.wanx.trial-evidence.json` together. The latter binds the immutable report digest,
trial binding and both claim digests for successful and failed dispatches. It explicitly records
`ISOLATED_WANX_TRIAL`, `OFFLINE_CONSISTENCY_ONLY` and `billingReconciliation:REQUIRED`.
The original report format and `actualCost:null` are preserved. This evidence cannot be described
as normal ERP end-to-end acceptance, settled billing, complete QA-02 or formal QA-04.

## Private JSON Record

Create the file outside the repository or under the private persistent sandbox evidence root. On
Linux it must be a regular file with no group/other permissions, normally mode `0600`. Replace every
example value with reviewed evidence; do not leave placeholder brackets.

```json
{
  "schemaVersion": 3,
  "approvalId": "qa02-full-edit-20260729-01",
  "statement": "I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST",
  "approvedAt": "2026-07-29T01:00:00.000Z",
  "expiresAt": "2026-07-29T01:30:00.000Z",
  "approverRef": "owner-review-20260729-01",
  "providerAccountRef": "relay-account-main",
  "pricingRevision": "qa02-price-policy-20260730-v1",
  "preCallBillingSnapshotRef": "private-ledger/qa02-full-edit-before",
  "billingReconciliationRef": "private-ledger/qa02-full-edit-after",
  "requestCount": 1,
  "operationId": "qa02-full-edit-20260729-01",
  "endpoint": "https://provider.example/v1/images/edits",
  "expectedHost": "provider.example",
  "model": "edit-capable-model",
  "operation": "FULL_EDIT",
  "requestProfile": "OPENAI_SQUARE_SINGLE_V1",
  "credentialRevision": "secret-manager-revision-2",
  "adapterRevision": "0123456789abcdef0123456789abcdef01234567",
  "sourceSha256": [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ],
  "maskSha256": null,
  "quotedCost": {
    "currency": "CNY",
    "amount": 119,
    "scale": 4
  },
  "maximumCost": {
    "currency": "CNY",
    "amount": 1000,
    "scale": 4
  }
}
```

Operation-specific fields for the OpenAI-compatible profiles:

- `TEXT_TO_IMAGE`: use `/v1/images/generations`, `sourceSha256: []`, and `maskSha256: null`.
- `IMAGE_TO_IMAGE` or `FULL_EDIT`: use `/v1/images/edits`, exactly one source digest, and
  `maskSha256: null`.
- `INPAINT`: use `/v1/images/edits`, exactly one PNG, JPEG, or WebP source digest, and the exact same-size PNG
  mask digest.

For a Wanx profile, use the exact async submit endpoint above instead of `/v1/images/edits`. Use
one source digest for all three operations and no mask for `IMAGE_TO_IMAGE` or `FULL_EDIT`.
`INPAINT` requires the exact same-size PNG mask digest. The approval stores the original local mask
digest; the guard separately derives and binds the converted Wanx transport-mask digest in its exact
JSON request contract. The task poll URL and temporary result URL are Provider responses and do not
belong in the pre-call approval.

All profiles also require:

- `adapterRevision` must be the full deployed `DEPLOYED_COMMIT`, not a planned or abbreviated SHA.
- `approvedAt` and `expiresAt` must be canonical UTC ISO-8601 timestamps. The window must be
  positive and no longer than 60 minutes. A clock at most five minutes behind `approvedAt` is
  tolerated; the approval is invalid at the exact `expiresAt` instant.
- Billing references are non-secret identifiers for the private before-call snapshot and the place
  where the settled charge will be reconciled. The quoted/maximum fields are audit evidence, not a
  Provider-side spending limit.
- `amount: 119, scale: 4` means `0.0119` major currency units. Quote and maximum must use the same
  currency and scale, and that shared scale must be minimal for the pair.

Historical `schemaVersion: 2` approvals with `currency`, `quotedCostCents`, and
`maximumCostCents` remain readable only with the matching legacy cents environment. A v2 approval
cannot authorize an exact-money runner even when its numeric value happens to have two decimal
places. Do not edit a v2 record into v3; generate and review a new v3 draft for a new request.

The schema is closed: missing or extra properties fail before DNS resolution, intent creation, or a
Provider POST. Save it as pretty two-space JSON with one trailing newline; duplicate keys, invalid
UTF-8, non-canonical JSON, and files that change during reading are rejected. The endpoint,
hostname, model, operation, profile, revisions, hashes, and costs must match the command environment
exactly.

## Bind The Reviewed File

Compute the digest only after the final review. The file must not change afterward.

PowerShell:

```powershell
$approvalPath = 'C:\secure\qa02-full-edit-20260729-01.approval.json'
$env:AI_IMAGE_SANDBOX_APPROVAL_PATH = $approvalPath
$env:AI_IMAGE_SANDBOX_APPROVAL_SHA256 = `
  (Get-FileHash -Algorithm SHA256 -LiteralPath $approvalPath).Hash.ToLowerInvariant()
```

Linux:

```bash
chmod 600 /opt/ss-erp/shared/ai-image-sandbox/qa02-full-edit-20260729-01.approval.json
export AI_IMAGE_SANDBOX_APPROVAL_PATH=/opt/ss-erp/shared/ai-image-sandbox/qa02-full-edit-20260729-01.approval.json
export AI_IMAGE_SANDBOX_APPROVAL_SHA256="$(sha256sum "$AI_IMAGE_SANDBOX_APPROVAL_PATH" | awk '{print $1}')"
```

Set the paid confirmation and API Key only after the approval digest, dark-state result, deployed
commit, source/mask hashes, and pre-call billing snapshot have all been reviewed. Then run the
single-submit command exactly once as described in the main sandbox runbook.

## Offline Exact-Request Preflight

Before setting either the paid confirmation or API Key, keep the complete non-secret international
request environment and approval path/digest configured, then run:

```bash
pnpm --filter server sandbox:ai-image:approval:verify
```

The command rejects an environment containing `AI_IMAGE_SANDBOX_CONFIRM` or
`AI_IMAGE_SANDBOX_API_KEY`. It validates the deployed adapter revision, bounded source/mask bytes,
hashes, MIME, dimensions, pixels, single-page state, aggregate size and mask semantics, closed
approval schema, approval-file digest, HTTPS endpoint/model/operation/profile, credential revision,
costs, validity window, and billing references. It performs no DNS lookup, creates no intent or
fingerprint claim, and sends no Provider request. Successful output contains sanitized hashes, the
approval ID/window, and the approved quoted/maximum cost.

After this preflight passes, leave the approval file unchanged. Separately review the dark state and
pre-call bill, inject the API Key for the single submit process, and set the paid confirmation only
for the exact one approved run. The submit path rechecks freshness after DNS, while claiming the
immutable intent, immediately before Provider execution, and at the guarded POST boundary. If the
approval expires, stop and review a new exact request; never reuse the expired approval to retry an
ambiguous request.

## Retention And Review

Keep the private approval file and its digest with the immutable intent, fingerprint claim,
sanitized report, its report-bound failure diagnostic sidecar when present, source/mask hash
evidence, result, and before/settled billing evidence. For
approval metadata, the sanitized report and intent retain only the approval ID, approval-file
digest, approval/expiry timestamps, currency, and hashes of operator/account/pricing/billing
references; they do not copy the raw endpoint or private billing reference values from this file.

If the result is `RECONCILIATION_REQUIRED`, retain the same record and resolve the original request
read-only. Never edit the approval, change the Operation ID, or create a replacement approval to
resubmit the same paid request.
