# AI Media Provider Capability Matrix

Status: **adapter capability foundation implemented; the Unit 0B media acceptance gate remains open**

The server registry is a fail-closed operation/input guard. Text-to-image job creation checks it before quota reservation and the worker checks every job again before provider submission. It describes current adapter behavior only; it is not paid-provider sandbox acceptance.

| Provider         | Model scope                                                                  | Current operations                | Inputs                                                                    | Result                        | Evidence level                              |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `fake`           | local test wildcard                                                          | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE` | zero references for text-to-image; one owned reference for image-to-image | sync                          | local test only                             |
| `dashscope-wanx` | preset `wanx2.1-t2i-turbo`; legacy model wildcard retained for compatibility | `TEXT_TO_IMAGE`                   | no source asset                                                           | async task + URL download     | adapter characterized, not sandbox verified |
| `openai-images`  | preset `gpt-image-1`; legacy model wildcard retained for compatibility       | `TEXT_TO_IMAGE`                   | no source asset                                                           | sync JSON (`b64_json` or URL) | adapter characterized, not sandbox verified |

Wildcard model entries exist only to avoid breaking historical text-to-image jobs. A wildcard entry can never count as `sandbox-verified`. Image-to-image for paid providers, full edit, masked inpaint, `qwen-mt-image` translation, multi-reference inputs, provider cancellation, provider-specific dimensions and cost settlement remain disabled.

## Required Evidence Before Enabling A Capability

- Exact provider and model request shape, including input transport and size limits.
- Result form and maximum fetch/poll window; temporary URLs must be internalized immediately.
- Cancellation and retry behavior, including accepted-but-unrecorded reconciliation.
- Measured cost or a bounded reservation estimate.
- Executable fixtures and recorded results for identity consistency, Russian readability, and Chinese-text residue. The current JSON files are threshold-policy scaffolds only.
- A route/worker preflight that rejects unsupported combinations before quota or cost reservation and revalidates before submission.

No localhost/private URL may be sent to a cloud provider. A signed URL is valid only when its TTL exceeds the documented provider fetch and polling window. Transport, timing, dimension and cost fields are intentionally absent from runtime acceptance until sandbox evidence exists.
