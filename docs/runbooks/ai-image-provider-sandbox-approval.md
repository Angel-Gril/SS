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
```

The Centos operation definitively rejected `/v1/images/edits` for its tested
`https://ai.centos.hk/v1` Token and `gpt-image-2` combination. The final Packy operation likewise
returned definite HTTP 400 for
`https://www.packyapi.ai/v1`, replacement credential revision `-02`, `gpt-image-2` and the reviewed
single-source multipart contract. Both settled with no charge. Do not prepare `FULL_EDIT`, `INPAINT`,
or another image-to-image approval for either same combination unless the Provider first supplies a
reviewed edit-contract/account correction; otherwise select a different edit-capable Provider and
use a new policy, Operation ID and approval after that external change.

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
`IMAGE_TO_IMAGE`, one source, `1024x1024`, `n=1`, and the default multipart fields only. It requires
exact money and cannot authorize `FULL_EDIT` or `INPAINT`.

One approval file authorizes only one of `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or
`INPAINT`; it cannot prove another operation.

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
multipart limit. It additionally requires:

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

Operation-specific fields:

- `TEXT_TO_IMAGE`: use `/v1/images/generations`, `sourceSha256: []`, and `maskSha256: null`.
- `IMAGE_TO_IMAGE` or `FULL_EDIT`: use `/v1/images/edits`, exactly one source digest, and
  `maskSha256: null`.
- `INPAINT`: use `/v1/images/edits`, exactly one PNG, JPEG, or WebP source digest, and the exact same-size PNG
  mask digest.
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
