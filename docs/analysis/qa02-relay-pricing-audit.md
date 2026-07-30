# QA-02 Relay Pricing Audit

Audit date: 2026-07-30 (Asia/Shanghai)

## Scope and verdict

The public portion of this audit used only unauthenticated first-party `GET`/`HEAD` requests to
the relay, its documentation site, and its published frontend assets. A later secret-safe
follow-up used the private credential only for bounded authenticated read-only endpoints. No Key,
raw account response, or private billing log is stored here. No paid image request or `POST`
endpoint was used.

**Verdict: the public and authenticated read-only evidence does not establish the Provider's
account-specific price for `gpt-image-2-count`, but that missing Provider record does not by itself
block the selected QA-02 policy.** The relay publishes reference prices for the different model
name `gpt-image-2`, and the account can see the `-count` alias. QA-02 will instead use a private,
versioned backend pricing policy for one bounded request and will reconcile the actual Provider
meters afterward. The unknown Provider pricing facts must not be presented as advance proof of the
charge.

## First-party evidence

### Published GPT-Image-2 documentation

Source: <https://docs.big-model-api.top/api/gpt-image-2>

The page identifies the API base as `https://ai.big-model-api.top/v1` and says the
`model` parameter is **fixed to `gpt-image-2`** for both generations and edits. Its
Generations section states:

> 以下是当前单张图片参考价格

and publishes this table:

| Quality | Published reference price | Published unit |
| --- | ---: | --- |
| `low` | `¥0.007` | one image |
| `medium` | `¥0.06` | one image |
| `high` | `¥0.26` | one image |

The same page says `n` defaults to `1`. The table is under the Generations section.
The Edits section documents full-image editing and mask editing, but does not publish a
separate edit price or explicitly say that the generation table also governs edits.

The exact string `gpt-image-2-count` is absent from this page. It is also absent from all
54 documentation routes enumerated by the documentation site's own VitePress hash map at
<https://docs.big-model-api.top/>.

The page response reported `Last-Modified: Tue, 09 Jun 2026 07:33:34 GMT`. Its immutable
page-data asset is
<https://docs.big-model-api.top/assets/api_gpt-image-2.md.BWxm-dtQ.lean.js>. These are
transport/build identifiers, not a stated pricing effective date or pricing revision.
The page itself does not state when the prices took effect or when they were last revised.

### General pricing documentation

Source: <https://docs.big-model-api.top/guide/pricing>

The official guide says:

> 最新价格请查看：官网模型广场

and:

> 具体的价格信息请访问官网查看最新定价。

It also explains that charges can be affected by a billing-group multiplier. The guide
therefore does not establish that the static GPT-Image-2 reference table is the exact
price applicable to a particular authenticated account, group, or alias.

### Live public status

Source: <https://ai.big-model-api.top/api/status>

The live status response reports:

- pricing is enabled with `requireAuth: true`;
- `quota_display_type` is `CNY`;
- `display_in_currency` is `true`;
- the official documentation link is `https://docs.big-model-api.top`;
- the running gateway version is `v1.0.0-rc.20`.

Together with the documentation's use of `¥` and `元`, this supports interpreting the
published `gpt-image-2` reference prices as CNY/RMB. It does **not** establish a CNY price
for `gpt-image-2-count`. The status response also contains a generic system `price` field,
but it is not labelled as a model price and must not be repurposed as one.

### Live pricing endpoints and frontend source

Sources:

- <https://ai.big-model-api.top/api/pricing>
- <https://ai.big-model-api.top/api/ratio_config>
- <https://ai.big-model-api.top/static/js/index.8e79f50e09.js>

Observed unauthenticated behavior:

- `/api/pricing` returned HTTP `401` with `Unauthorized, not logged in and no access token provided`.
- `/api/ratio_config` returned HTTP `403` with `倍率配置接口未启用`.
- The relay's first-party frontend bundle identifies `/api/pricing` as its pricing data
  source. The exact alias `gpt-image-2-count` was absent from all five first-party JavaScript
  bundles referenced by the relay homepage.

This confirms that the live, account-relevant pricing source is gated and that the static
frontend does not supply an exact price for the candidate alias.

### Authenticated read-only follow-up

A single authenticated `GET /v1/models` returned HTTP `200`, listed one model, and included the
exact identifier `gpt-image-2-count`. The raw catalogue remains outside the repository under the
private QA-02 evidence root. Its retained SHA-256 is
`a9c6be5ec39d9764ce6d04fe89be106de8101fd733ce4e394ae08fef38033c4d`.
This proves only that the account can see the alias; it does not prove generation, edit, inpaint,
async, or pricing behavior.

Read-only account endpoints also established the relay's billing display configuration as CNY,
with `quota_per_unit = 500000` and `usd_exchange_rate = 1`. `/api/usage/token/` can provide an
integer quota observation, while `/v1/dashboard/billing/usage` provides a decimal
`total_usage` observation. Private before/after snapshots must bind both meters during finalization.
For a charge of `CNY 0.0119`, the expected paired evidence is a raw quota delta of `5950` and a
displayed total-usage delta of `1.19`; this is a reconciliation expectation, not advance proof of
the model's price.

The operator supplied `CNY 0.0119 per image` as planning input. `/api/pricing` requires a logged-in
session plus its user header; the API Key alone did not expose the account-specific pricing record.
That Provider endpoint is not a prerequisite under the selected policy. Before a paid request, the
backend/operator must retain a private policy revision that binds the exact alias/account reference,
operation, quality, size, image count, currency, quote and single-request maximum. The policy must
be explicitly reviewed and its revision copied into the approval; it does not become a Provider-side
hard cap, so the paired before/after meter reconciliation remains mandatory.

## Provider facts versus backend policy controls

| QA-02 control | Provider evidence / policy source | Status |
| --- | --- | --- |
| Exact model identity `gpt-image-2-count` | Authenticated model catalogue lists the exact alias | Present for catalogue visibility only |
| Exact model-to-upstream/alias mapping | Not published; exact alias is bound in the backend policy | Policy-controlled; Provider mapping remains unknown |
| Currency | Authenticated billing configuration and public status both use CNY display | Policy must bind CNY |
| Generation billing unit | Per image reference exists for `gpt-image-2`, not the alias | Policy supplies the bounded quote; actual meters settle it |
| Reference-image/full-edit/inpaint price | No explicit Provider price is published | Each operation must be explicitly priced or left unsupported in policy |
| Size-dependent pricing | Provider interaction is not specified | Policy binds one exact size/profile per request |
| Account/group multiplier | Exact applicable group is unavailable publicly | Policy binds the account reference and post-call reconciliation catches variance |
| Pricing effective date/revision | Provider revision unavailable | Backend policy revision is required |
| Binding maximum charge for one request | Provider cap unavailable | Backend policy and approval must bind the maximum |

## QA-02 decision

Do not use the `gpt-image-2` reference table as authorization to charge
`gpt-image-2-count`. No Provider pricing synchronization is required. Before any paid request,
retain a private, timestamped backend pricing-policy record for the exact proposed request that
states:

1. the exact model identifier and account reference;
2. the quote and currency for the selected operation;
3. the fixed `quality`, `size`, and `n`;
4. the backend policy revision/effective time;
5. the resulting single-request maximum charge.

Until that policy is reviewed and the operator explicitly approves the maximum, QA-02 remains
blocked. A successful settlement must still prove the actual paired meter deltas; if they exceed
the approved maximum, retain `COST_LIMIT_EXCEEDED` and do not promote the capability.
