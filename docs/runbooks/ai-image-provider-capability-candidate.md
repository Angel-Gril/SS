# AI Image Provider Capability Candidate Review

Use this network-free review only after `IMAGE_TO_IMAGE`, `FULL_EDIT`, and `INPAINT` each have:

- one successful exact-money `schemaVersion: 5` submit report;
- one matching exact-money `schemaVersion: 3` or `4` billing receipt with `billingGate: PASS`;
- a human review of the returned image against the operation Prompt and source media.

This command does not call a Provider, inspect an API key, change the capability registry, enable a
flag, or write an output file. It prints a sanitized `CANDIDATE_ONLY` manifest to stdout for a
separate code review. The sanitized report/receipt bundle is self-described evidence, not a trust
anchor, so the output deliberately uses `evidenceLevel: candidate-only` and cannot be pasted into
the production Registry as an `AiImageProviderCapability`.

The reviewer accepts two closed transport families. The existing `custom` family requires an exact
model/API Base with synchronous `multipart` reports from `custom-openai-compatible`. The Wanx family
requires provider `dashscope-wanx21-image-edit`, exact model `wanx2.1-imageedit`, the reviewed
`https://dashscope.aliyuncs.com/api/v1` digest, `base64` input transport, and `async` result mode.
It does not accept a generic DashScope provider label, another Wanx model, another region/base,
multipart relabeling, or a synchronous result claim.

## Prepare The Review Bundle

Create one private directory containing sanitized copies of the three submit reports, three billing
receipts, and `quality-review.json`. Artifact paths in the review manifest must be relative paths
inside that directory. Symlinks, duplicate files, non-canonical JSON, files larger than 256 KiB,
and paths outside the bundle are rejected.

Do not put an API key, Authorization header, cookie, raw Provider response, Provider URL, billing
snapshot, image bytes, or free-form reviewer notes in this bundle. The submit reports and receipts
remain the immutable machine evidence; the quality review only binds their SHA-256 digests and the
returned image digest.

The review file is a closed canonical JSON object in this shape:

```json
{
  "schemaVersion": 1,
  "event": "AI_IMAGE_PROVIDER_EDIT_CAPABILITY_QUALITY_REVIEW",
  "decision": "APPROVED",
  "provider": "custom",
  "model": "exact-model-alias",
  "apiBaseSha256": "<normalized API Base SHA-256>",
  "inputTransport": "multipart",
  "resultMode": "sync",
  "maxReferences": 1,
  "supportsMask": true,
  "reviewerRefSha256": "<non-secret reviewer reference SHA-256>",
  "reviewedAt": "2026-07-31T12:00:00.000Z",
  "operations": [
    {
      "operation": "IMAGE_TO_IMAGE",
      "operationId": "<unique operation ID>",
      "reportPath": "IMAGE_TO_IMAGE.report.json",
      "reportSha256": "<report SHA-256>",
      "receiptPath": "IMAGE_TO_IMAGE.receipt.json",
      "receiptSha256": "<receipt SHA-256>",
      "outputImageSha256": "<returned image SHA-256 from the report>",
      "decision": "APPROVED",
      "qualityChecks": {
        "operationIntentSatisfied": true,
        "primaryProductIdentityPreserved": true,
        "noUnexpectedTextLogoWatermark": true,
        "acceptableVisualQuality": true,
        "unmaskedRegionPreserved": null
      }
    },
    {
      "operation": "FULL_EDIT",
      "operationId": "<unique operation ID>",
      "reportPath": "FULL_EDIT.report.json",
      "reportSha256": "<report SHA-256>",
      "receiptPath": "FULL_EDIT.receipt.json",
      "receiptSha256": "<receipt SHA-256>",
      "outputImageSha256": "<returned image SHA-256 from the report>",
      "decision": "APPROVED",
      "qualityChecks": {
        "operationIntentSatisfied": true,
        "primaryProductIdentityPreserved": true,
        "noUnexpectedTextLogoWatermark": true,
        "acceptableVisualQuality": true,
        "unmaskedRegionPreserved": null
      }
    },
    {
      "operation": "INPAINT",
      "operationId": "<unique operation ID>",
      "reportPath": "INPAINT.report.json",
      "reportSha256": "<report SHA-256>",
      "receiptPath": "INPAINT.receipt.json",
      "receiptSha256": "<receipt SHA-256>",
      "outputImageSha256": "<returned image SHA-256 from the report>",
      "decision": "APPROVED",
      "qualityChecks": {
        "operationIntentSatisfied": true,
        "primaryProductIdentityPreserved": true,
        "noUnexpectedTextLogoWatermark": true,
        "acceptableVisualQuality": true,
        "unmaskedRegionPreserved": true
      }
    }
  ]
}
```

For a Wanx review, keep the same closed shape but set:

```json
{
  "provider": "dashscope-wanx21-image-edit",
  "model": "wanx2.1-imageedit",
  "apiBaseSha256": "3d3074c32a59b1d48fc41b46cdc5f389411691480738fa914cde3537cb61fbff",
  "inputTransport": "base64",
  "resultMode": "async"
}
```

The three Wanx reports must respectively use
`DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`,
`DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1`, and
`DASHSCOPE_WANX21_INPAINT_ASYNC_V1`. Every report must bind the fixed image-synthesis submit
endpoint digest, one accepted task-ID hash, and CNY exact money. Each matching receipt must be v3
with `correlationMethod: PROVIDER_REQUEST_ID`, where that Provider request identity is the accepted
Wanx task ID. A task count, image count, public list price, unrelated console snapshot, or
capability-only unresolved-billing sidecar is not a receipt.

Format the file as `JSON.stringify(value, null, 2)` followed by one newline. The three operations
must use one credential revision, one Provider account, and one operation endpoint. They require
independent Operation IDs, approval files/digests, pricing revisions, pre-call/reconciliation
references, reports, and receipts; one approval or price/limit record cannot authorize another
operation. Each receipt must bind back to those approval references. `INPAINT` requires a source
digest and a mask digest; the other two operations require one source digest and no mask. Exact
quote and maximum objects must be positive and use one currency, one scale, and their minimum shared
scale. Settled actual cost must use that same currency and scale.

## Produce The Candidate

```text
node scripts/sandbox/ai-image-capability-candidate.mjs --review-manifest <bundle>/quality-review.json
```

The candidate contains the exact reviewed provider, model, API Base digest, operation, input
transport, and result mode. Its `proposedSandboxEvidence.endpointSha256` is copied only from the
report and receipt field named `apiBaseSha256`; the operation-endpoint digest is retained as review
evidence and is never substituted for the Registry digest. Wanx therefore emits `base64`/`async`;
the custom OpenAI-compatible family continues to emit `multipart`/`sync` byte-for-byte.

`CANDIDATE_ONLY` is not authorization to edit
`apps/server/src/services/ai-image-provider-capabilities.ts`. Review the candidate, the three human
quality decisions, original output images, private intent/approval/attestation/fingerprint and
Provider-entry claims, rollout scope, and default-off flags in a separate change before Registry
promotion. The reviewer must rerun the official finalizer replay against that private evidence root
and confirm byte-identical receipts; this helper does not perform that trusted replay.

## Verify The Helper

```text
node --test scripts/ai-image-capability-candidate.test.mjs
```
