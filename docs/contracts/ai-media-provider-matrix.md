# AI Media Provider Capability Matrix

Status: **adapter capability foundation implemented; the Unit 0B media acceptance gate remains open**

The server registry is a fail-closed operation/input guard. Text-to-image job creation checks it before quota reservation and the worker checks every job again before provider submission. It describes current adapter behavior only; it is not paid-provider sandbox acceptance.

| Provider         | Model scope                                                                  | Current operations                | Inputs                                                                    | Result                        | Evidence level                              |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `fake`           | local non-production lifecycle wildcard                                      | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `IMAGE_TRANSLATE` | zero references for text-to-image; owned reference(s) for derived operations | sync                          | local test only                             |
| `dashscope-wanx` | preset `wanx2.1-t2i-turbo`; legacy model wildcard retained for compatibility | `TEXT_TO_IMAGE`                   | no source asset                                                           | async task + URL download     | adapter characterized, not sandbox verified |
| `openai-images`  | preset `gpt-image-1`; legacy model wildcard retained for compatibility       | `TEXT_TO_IMAGE`                   | no source asset                                                           | sync JSON (`b64_json` or URL) | adapter characterized, not sandbox verified |
| `dashscope-qwen-mt-image` | exact `qwen-mt-image` model                                         | `IMAGE_TRANSLATE`                 | one owned HTTPS/public source URL; `imageSegment=false`                   | async task + immediate URL download | adapter characterized, **not sandbox verified** |

Wildcard model entries exist only to avoid breaking historical text-to-image jobs. A wildcard entry can never count as `sandbox-verified`. Paid image-to-image, full edit, masked inpaint, multi-reference inputs and provider cancellation remain disabled. The qwen-mt-image adapter is implemented as a resumable submit/poll contract with frozen positive/constraint Prompt provenance, bounded recovery, and cost reservation; paid dispatch remains blocked until Unit 0B sandbox evidence and a positive verified price upgrade its capability level.

## Required Evidence Before Enabling A Capability

- Exact provider and model request shape, including input transport and size limits.
- Result form and maximum fetch/poll window; temporary URLs must be internalized immediately.
- Cancellation and retry behavior, including accepted-but-unrecorded reconciliation.
- Measured cost or a bounded reservation estimate.
- Executable fixtures and recorded results for identity consistency, Russian readability, and Chinese-text residue. The current JSON files are threshold-policy scaffolds only.
- A route/worker preflight that rejects unsupported combinations before quota or cost reservation and revalidates before submission.

No localhost/private URL may be sent to a cloud provider. A signed URL is valid only when its TTL exceeds the documented provider fetch and polling window. Transport, timing, dimension and cost fields are intentionally absent from runtime acceptance until sandbox evidence exists.

## Listing-Copy Prompt Foundation

`listing-copy.title` and `listing-copy.description` use versioned Prompt revisions with template-specific variable schemas. Their non-editable safety prefix requires supplied source facts and confirmed attributes, prohibits invented claims, and labels the output as `listing_copy_candidate`.

Fact JSON is parsed as an object, recursively checked for sensitive transport/account fields, bounded by UTF-8 bytes, depth and node count, then serialized deterministically before template rendering. Text variables and the combined variable set have separate byte limits. Admin preview, PASS testing and runtime resolution all enforce the final compiled Prompt limits. The frozen resolution snapshot records the candidate-only output mode and variable-schema version.

The admin API exposes explicit response DTOs. Internal variable `token` names are returned only as `placeholder`; unknown service fields, actor IDs and provider details are not copied into responses.

This registry slice does not call a text Provider and does not apply a candidate to listing or Ozon publish fields. Provider execution, candidate persistence, review and explicit application remain separate Unit 7B work.
