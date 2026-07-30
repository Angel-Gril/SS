# QA-02 Relay Pricing Audit

Audit date: 2026-07-30 (Asia/Shanghai)

## Scope and verdict

The public portion of this audit used only unauthenticated first-party `GET`/`HEAD` requests to
the relay, its documentation site, and its published frontend assets. A later secret-safe
follow-up used the private credential only for bounded authenticated read-only endpoints. No Key,
raw account response, or private billing log is stored here. No paid image request or `POST`
endpoint was used.

**Verdict: the public and authenticated read-only evidence is not sufficient to approve a paid
QA-02 call for `gpt-image-2-count`.** The relay publishes reference prices for the different model
name `gpt-image-2`, and the account can see the `-count` alias, but no retained pricing artifact
establishes that the alias has the same price, billing rules, operation coverage, or pricing
revision.

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

The operator supplied `CNY 0.0119 per image` as planning input. No authenticated pricing artifact
has yet tied that number to the exact alias, account/group, requested operation, quality, size,
image count, or pricing revision. `/api/pricing` requires a logged-in session plus its user header;
the API Key alone did not expose the account-specific pricing record.

## Required pricing facts versus available evidence

| Required QA-02 fact | Public evidence | Status |
| --- | --- | --- |
| Exact model identity `gpt-image-2-count` | Authenticated model catalogue lists the exact alias | Present for catalogue visibility only |
| Exact model-to-upstream/alias mapping | Not published | Missing |
| Currency | Authenticated billing configuration and public status both use CNY display | Partial; exact alias price still unbound |
| Generation billing unit | Per image by quality for `gpt-image-2` | Wrong model identity |
| Reference-image/full-edit/inpaint price | Edits are documented, but no explicit edit price is published | Missing |
| Size-dependent pricing | Supported sizes are listed; price-size interaction is not specified | Missing |
| Account/group multiplier | General guide says group multipliers apply; exact applicable group is unavailable publicly | Missing |
| Pricing effective date/revision | Only HTTP/build timestamps are available | Missing |
| Binding maximum charge for one request | Cannot be calculated for the exact alias and operation | Missing |

## QA-02 decision

Do not use the `gpt-image-2` reference table as authorization to charge
`gpt-image-2-count`. Before any paid request, obtain an authenticated, timestamped pricing
artifact for the exact model and applicable account/group that states:

1. the exact model identifier and any alias mapping;
2. the price and currency for each intended operation;
3. the effects of `quality`, `size`, and `n`;
4. whether generation prices also apply to full edit and mask edit;
5. the pricing effective date or revision;
6. the resulting maximum charge for the exact proposed request.

Until those facts are available, QA-02 cost approval remains blocked even if the model is
present in an authenticated model catalogue.
