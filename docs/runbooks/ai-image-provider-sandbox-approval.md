# QA-02 AI Image Sandbox One-Request Approval

Use this private approval record immediately before one paid international AI image sandbox
request. It binds the operator's approval to one exact endpoint, model, operation, request profile,
credential revision, deployed adapter revision, source/mask digest, and maximum cost.

This record is not a Provider API Key, a production rollout approval, or permission to retry an
ambiguous request. Never include an API Key, Authorization value, raw Provider response, Ozon
credential, tenant identifier, or customer data in it.

## Current Blocker

Do not prepare a new edit approval for the previously rejected international relay/model pair. The
following consumed `IMAGE_TO_IMAGE` Operation IDs must never be reused or repeated:

```text
gpt-image-2-i2i-20260724-200300-01
gpt-image-2-i2i-20260725064150-03
```

Select a genuinely edit-capable endpoint/model first. One approval file authorizes only one of
`TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or `INPAINT`; it cannot prove another operation.

## Private JSON Record

Create the file outside the repository or under the private persistent sandbox evidence root. On
Linux it must be a regular file with no group/other permissions, normally mode `0600`. Replace every
example value with reviewed evidence; do not leave placeholder brackets.

```json
{
  "schemaVersion": 1,
  "approvalId": "qa02-full-edit-20260729-01",
  "statement": "I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST",
  "approvedAt": "2026-07-29T01:00:00.000Z",
  "approverRef": "owner-review-20260729-01",
  "providerAccountRef": "relay-account-main",
  "pricingRevision": "provider-pricing-20260729",
  "currency": "USD",
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
  "quotedCostCents": 10,
  "maximumCostCents": 20
}
```

Operation-specific fields:

- `TEXT_TO_IMAGE`: use `/v1/images/generations`, `sourceSha256: []`, and `maskSha256: null`.
- `IMAGE_TO_IMAGE` or `FULL_EDIT`: use `/v1/images/edits`, exactly one source digest, and
  `maskSha256: null`.
- `INPAINT`: use `/v1/images/edits`, exactly one source digest, and the exact PNG mask digest.
- `adapterRevision` must be the full deployed `DEPLOYED_COMMIT`, not a planned or abbreviated SHA.
- Billing references are non-secret identifiers for the private before-call snapshot and the place
  where the settled charge will be reconciled. The quoted/maximum fields are audit evidence, not a
  Provider-side spending limit.

The schema is closed: missing or extra properties fail before DNS resolution, intent creation, or a
Provider POST. The endpoint, hostname, model, operation, profile, revisions, hashes, and costs must
match the command environment exactly.

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
`AI_IMAGE_SANDBOX_API_KEY`. It validates the deployed adapter revision, source/mask bytes and hashes,
closed approval schema, approval-file digest, endpoint/model/operation/profile, credential revision,
costs, and billing references. It performs no DNS lookup, creates no intent or fingerprint claim,
and sends no Provider request. Successful output contains sanitized hashes and the approval ID only.

After this preflight passes, leave the approval file unchanged. Separately review the dark state and
pre-call bill, inject the API Key for the single submit process, and set the paid confirmation only
for the exact one approved run.

## Retention And Review

Keep the private approval file and its digest with the immutable intent, fingerprint claim,
sanitized report, source/mask hash evidence, result, and before/settled billing evidence. For
approval metadata, the sanitized report and intent retain only the approval ID, approval-file
digest, timestamp, currency, and hashes of operator/account/pricing/billing references; they do not
copy the raw endpoint or private billing reference values from this file.

If the result is `RECONCILIATION_REQUIRED`, retain the same record and resolve the original request
read-only. Never edit the approval, change the Operation ID, or create a replacement approval to
resubmit the same paid request.
