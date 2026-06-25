---
title: AI Translation Cache and Product Content Generation Plan
type: feat
status: active
date: 2026-06-25
---

# AI Translation Cache and Product Content Generation Plan

## Overview

Add a controlled AI translation/generation layer for SS ERP. The goal is to reduce repeated API calls, improve Ozon category display/search quality, and prepare a separate configurable pipeline for product title, description, and image-text optimization.

The key design choice is to separate deterministic short-text translation from generative product content. They can share provider credentials, rate limits, and usage logging, but they should not share prompts, cache keys, or acceptance rules.

## Problem Frame

Recent Ozon category candidates show two failures at once:

- Category display terms such as adult-product Russian category names are missing from the local dictionary, so the UI shows placeholder Chinese labels such as "待翻译类目".
- Low-text-similarity category candidates can still appear because category scoring mixes tree fallback, source terms, attribute coverage, and history.

The user also wants high-frequency category translations and product translations to reuse cached results from the server/database, avoiding excessive API calls. Product title/description/image optimization needs richer prompt configuration and must not conflict with simple category translation.

## Requirements Trace

- R1. Cache high-frequency translation results in the server/database so repeated category terms do not repeatedly call an external API.
- R2. Keep category translation simple and deterministic: input term/path, output translated display text, status, provider metadata, and fallback behavior.
- R3. Add separate settings for product title/description/image prompt behavior because product generation is not the same problem as category label translation.
- R4. Improve category candidate quality so unrelated adult-product categories do not surface for normal underwear/source products just because the Ozon catalog has weak fallback matches.
- R5. Preserve existing manual confirmation history for source category to Ozon category mappings.
- R6. Make API credentials, provider selection, rate limits, and prompt templates configurable from the admin settings surface without exposing secrets.
- R7. Keep publish flows safe when the AI provider is unavailable: cached results and existing non-AI behavior must continue.
- R8. Support custom/OpenAI-compatible providers first so DeepSeek, MiniMax, Immersive Translate-style gateways, and similar endpoints can be configured without code changes.
- R9. Let all users use product content generation while enforcing administrator-configured daily user limits.

## Scope Boundaries

- This plan does not implement image OCR or actual image editing. It only prepares the translation/generation service boundary and settings shape.
- This plan does not let AI auto-publish or silently select a risky Ozon category.
- This plan does not replace the existing Ozon category catalog cache or attribute dictionary cache; it extends them.
- This plan does not require Redis for correctness. Redis can be a short-lived acceleration layer, but Postgres remains the durable cache.

## Context & Research

### Relevant Code and Patterns

- `apps/server/src/services/ozon-category-catalog.ts` currently builds the Ozon category catalog, applies a local Russian-to-Chinese dictionary, records `translationStatus`, and builds searchable keywords.
- `apps/server/src/routes/collect.ts` builds source-to-Ozon category candidates through `buildSourceOzonCategoryCandidates`, using source term expansions, text score, attribute coverage, and confirmed history.
- `apps/server/src/services/ozon-attribute-dictionary-cache.ts` is the closest existing cache pattern: normalize params, read Postgres, refresh through API, store TTL, and return stale cache on downstream failure.
- `apps/server/prisma/schema.prisma` already has `SystemConfig`, `OzonAttributeDictionaryCache`, and `OzonCategoryCatalog`.
- `apps/server/src/config/system-config-schema.ts` defines typed config keys, defaults, labels, sensitivity, encryption, and admin UI metadata.
- `apps/server/src/routes/system-config.ts` already encrypts/masks sensitive config values and seeds defaults.
- `apps/web/src/app/(dashboard)/admin/settings/page-client.tsx` renders grouped system settings and has specialized panels for auth/upload/backup.
- `apps/web/src/app/(dashboard)/collect/source/page.tsx` already displays candidate `translationStatus`, untranslated terms, candidate score, reasons, and manual confirmation controls.

### Existing Constraints

- Ozon category tree and attribute dictionary are shop/language scoped. Translation cache should not need shop scope for plain text, but category mapping decisions do need shop/source context.
- Existing UI already distinguishes "推荐/可选/谨慎" candidates; the backend should become stricter about when a candidate is considered recommended.
- `SystemConfig` supports encrypted sensitive values, so AI API keys should use the same schema instead of only `.env`.

## Key Technical Decisions

- Durable cache in Postgres, optional Redis front cache: Postgres provides auditability, portability, and deploy stability. Redis can be added later for hot reads but must not be required.
- Separate cache namespaces: `category_term`, `category_path`, `product_title`, `product_description`, `image_text`, and future namespaces should have different cache keys and TTL policies.
- Provider abstraction before product features: introduce one AI text client/service with provider config, timeout, retry, rate-limit, and usage logging. Category and product features call that service through separate domain wrappers.
- Category translation should be batch-first: category tree refresh can collect missing Russian terms and translate them in batches, then rebuild display/search text.
- Category missing translations should run automatically during catalog refresh, but only after checking system glossary/cache first.
- AI should not directly select Ozon categories in phase 1: it can enrich translations and search terms, but category selection remains scoring/history/manual confirmation.
- Category candidate filtering must become stricter: low score with no text match and no confirmed history should be hidden or marked non-selectable by default.
- Product content generation should store generated drafts, not overwrite source fields silently. User review stays in the collect/source workflow.
- Product generation is available to normal users, with per-user daily limits controlled from administrator settings.

## High-Level Technical Design

Directional flow:

```text
Admin settings
  -> AI provider config and prompt profiles
  -> ai text service

Ozon category catalog refresh
  -> local dictionary
  -> translation cache lookup
  -> batch AI translation for misses
  -> update displayPathZh, searchText, translationStatus

Source category candidates
  -> confirmed mapping history
  -> stricter text score and deny/penalty terms
  -> translated catalog search text
  -> UI candidate labels and warnings

Product optimization
  -> source title/description/images metadata
  -> prompt profile
  -> AI generation cache/draft record
  -> user review/apply
```

## Implementation Units

- [x] **Unit 1: AI System Config and Admin Settings**

**Goal:** Add admin-configurable AI provider settings and prompt profile controls.

**Requirements:** R3, R6

**Files:**
- Modify: `apps/server/src/config/system-config-schema.ts`
- Modify: `apps/server/src/routes/system-config.ts`
- Modify: `apps/web/src/app/(dashboard)/admin/settings/page-client.tsx`
- Test: `apps/server/src/__tests__/system-config.test.ts` or add focused coverage near existing config tests

**Approach:**
- Add config keys under a new `ai` group:
  - `ai_provider`: `disabled | custom`
  - `ai_base_url`
  - `ai_api_key` encrypted/sensitive
  - `ai_model`
  - `ai_provider_label`
  - `ai_timeout_ms`
  - `ai_daily_budget_cents` or global request cap
  - `ai_user_daily_category_translation_limit`
  - `ai_user_daily_product_generation_limit`
  - `ai_category_translation_enabled`
  - `ai_product_generation_enabled`
  - `ai_category_translation_prompt`
  - `ai_product_title_prompt`
  - `ai_product_description_prompt`
- Keep category and product prompts separate.
- Add an AI settings panel rather than dumping all keys into the generic settings list.
- Treat DeepSeek, MiniMax, OpenRouter, Immersive Translate gateways, and other compatible services as custom endpoint presets rather than separate hardcoded provider branches.

**Test Scenarios:**
- Saving `ai_api_key` stores encrypted data and returns a masked value.
- Invalid provider/model/budget values are rejected by schema validation.
- Seeding default config creates all AI keys with safe disabled defaults.

**Verification:**
- Super admin can configure AI provider without exposing the API key.
- With defaults, no AI call is possible.

- [x] **Unit 2: AI Text Client and Usage Guard**

**Goal:** Provide one backend service for text completions/translations with consistent config, timeout, error handling, and usage metadata.

**Requirements:** R1, R3, R6, R7

**Files:**
- Create: `apps/server/src/services/ai-text.ts`
- Create: `apps/server/src/__tests__/ai-text.test.ts`
- Modify: `apps/server/src/config/system-config-schema.ts`

**Approach:**
- Read `SystemConfig` first, then fallback to env only if provider is `env` or `custom` behavior is explicitly desired.
- Use OpenAI-compatible chat/completions semantics as the first integration contract. Provider-specific quirks should be handled by configurable base URL, model, headers if needed, and a small adapter layer rather than separate feature code.
- Return structured results: `ok`, `text`, `provider`, `model`, `usage`, `finishReason`, `error`.
- Add conservative defaults: disabled provider, short timeout, no retries for validation errors, one retry for network/429 when safe.
- Never throw provider failures into publish-critical paths unless the caller explicitly requests strict mode.

**Test Scenarios:**
- Disabled provider returns a typed unavailable result without network calls.
- Timeout/provider error returns a recoverable error result.
- Sensitive config is not logged in error messages.
- Usage metadata is preserved when the mocked provider returns it.

**Verification:**
- Category and product services can call one client without duplicating provider logic.

- [x] **Unit 3: Translation Cache Store**

**Goal:** Add a durable translation/generation cache with normalized keys, content hashes, status, and provider metadata.

**Requirements:** R1, R2, R3, R7

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_ai_translation_cache/migration.sql`
- Create: `apps/server/src/services/ai-translation-cache.ts`
- Create: `apps/server/src/__tests__/ai-translation-cache.test.ts`

**Approach:**
- Add a table like `ai_translation_cache` with:
  - `namespace`
  - `source_lang`
  - `target_lang`
  - `input_hash`
  - `input_text`
  - `output_text`
  - `prompt_hash`
  - `provider`
  - `model`
  - `status`
  - `usage_json`
  - `expires_at`
  - `last_used_at`
  - `hit_count`
- Unique key should include namespace, source/target lang, input hash, prompt hash, provider/model where prompt sensitivity matters.
- For category labels, use long TTL or no expiry after manual approval.
- For product generation, include prompt hash and shorter TTL because prompt changes should produce new drafts.
- Add a glossary/source flag so system-owned category terms can be treated as approved vocabulary and read before provider calls.

**Test Scenarios:**
- Same category term returns a cache hit without calling the AI client.
- Different prompt hash for product generation creates a different cache entry.
- Stale entry can be returned when provider fails only if caller permits stale fallback.
- Empty or unsafe output is not cached as successful.

**Verification:**
- Repeated missing category labels do not trigger repeated external calls.

- [x] **Unit 4: Category Translation Enrichment**

**Goal:** Use the translation cache to enrich Ozon category catalog display/search fields while keeping safe fallback behavior.

**Requirements:** R1, R2, R4, R7

**Files:**
- Modify: `apps/server/src/services/ozon-category-catalog.ts`
- Modify: `apps/server/src/routes/collect.ts`
- Test: `apps/server/src/__tests__/ozon-category-catalog.test.ts`
- Test: `apps/server/src/__tests__/collect-publish-helpers.test.ts`

**Approach:**
- Keep the local dictionary as the first pass.
- Add a `translateMissingCategoryTerms` service that batches untranslated Russian terms, checks system glossary/cache, calls AI only for misses, and stores outputs.
- Store translated `categoryLevels`, `typeNameZh`, `displayPathZh`, `translationStatus`, and keywords back into `ozon_category_catalog`.
- Use deterministic validation: reject outputs that contain Cyrillic, are empty, are excessively long, or look like explanatory prose.
- Add domain search expansions for underwear terms: 文胸, 内衣, 胸罩, 吊带, 胸垫, 聚拢, 无痕, 薄杯, 厚杯, bra, lingerie.
- Trigger missing-term translation automatically when the Ozon category catalog refresh finds untranslated terms and `ai_category_translation_enabled` is true.

**Test Scenarios:**
- Known local dictionary terms do not call AI.
- Missing Russian terms are translated once, cached, and reused on a second catalog build.
- Invalid AI output leaves `translationStatus` as missing/partial and does not poison cache.
- Underwear source terms produce underwear-related candidates, not adult-product candidates.

**Verification:**
- The UI no longer shows placeholders for translated catalog terms once the cache has values.

- [x] **Unit 5: Safer Category Candidate Ranking**

**Goal:** Prevent unrelated low-confidence categories from surfacing as plausible choices.

**Requirements:** R4, R5

**Files:**
- Modify: `apps/server/src/routes/collect.ts`
- Modify: `apps/web/src/app/(dashboard)/collect/source/page.tsx`
- Test: `apps/server/src/__tests__/collect-publish-helpers.test.ts`

**Approach:**
- Require one of these to show a candidate as selectable: confirmed history, positive text score above threshold, direct catalog search match, or explicit user search.
- Add negative penalties for adult-product catalog terms unless source terms also indicate adult goods.
- Keep risky fallback candidates only in an expandable/debug section or return them with `selectable: false`.
- Strengthen reasons so the UI can show why a category appeared: history, text match, attribute coverage, translation cache, fallback.

**Test Scenarios:**
- A normal underwear product does not get adult-product candidates as recommended/optional.
- Confirmed history still overrides weak text match for the same source signature.
- Candidates with only attribute coverage but no text match are marked risky/non-selectable.
- The selected default candidate must be the first selectable recommended/optional candidate, not just the top raw score.

**Verification:**
- User sees fewer irrelevant category candidates and clearer warnings.

- [x] **Unit 6: Product Content Draft Generation**

**Goal:** Add a separate prompt-driven product optimization flow for titles/descriptions while keeping generated text reviewable.

**Requirements:** R3, R6, R7

**Files:**
- Create: `apps/server/src/services/product-content-ai.ts`
- Modify: `apps/server/src/routes/collect.ts`
- Modify: `apps/web/src/app/(dashboard)/collect/source/page.tsx`
- Test: `apps/server/src/__tests__/product-content-ai.test.ts`
- Test: `apps/server/src/__tests__/collect-publish-helpers.test.ts`

**Approach:**
- Add explicit endpoints such as generate title, generate description, and generate all draft fields for a collected source item.
- Use source metadata as input: raw title, source category, attributes, SKU values, dimensions, description, and existing rich content summary.
- Store drafts under item metadata or a dedicated draft table if review history is needed.
- Never overwrite `title`, `notes`, or publish fields without a user action.
- Include prompt version/hash so changing settings produces new drafts.
- Enforce administrator-configured per-user daily limits before provider calls; cache hits should not consume the same quota as fresh provider calls.

**Test Scenarios:**
- Product generation disabled returns a clear disabled response.
- Same input and prompt reuses cache/draft.
- Prompt change causes a new generation request.
- Generated title containing banned language, excessive length, or Chinese-only output is rejected for Ozon publish use.

**Verification:**
- The collect source page can generate and review product content drafts independently from category translation.

- [x] **Unit 7: Observability and Cost Controls**

**Goal:** Make AI usage visible and controllable before enabling high-volume workflows.

**Requirements:** R1, R6, R7

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create or modify: `apps/server/src/services/ai-usage.ts`
- Modify: `apps/web/src/app/(dashboard)/admin/settings/page-client.tsx`
- Test: `apps/server/src/__tests__/ai-usage.test.ts`

**Approach:**
- Record usage per namespace/provider/model/day.
- Add global daily cap, per-minute request cap, and per-user daily caps for product generation.
- Return cache hit/miss/provider stats from admin diagnostics.
- Provide a manual "refresh missing category translations" admin action later for repair/backfill, while normal catalog refresh can automatically translate missing terms once per cache miss.

**Test Scenarios:**
- Daily cap blocks new provider calls but still allows cache hits.
- Provider failure increments failure counters without breaking non-AI flows.
- Admin diagnostics masks secrets and exposes only usage totals.

**Verification:**
- Enabling AI cannot accidentally create unbounded API spend.

## System-Wide Impact

- **Interaction graph:** Admin settings feed AI client; AI client feeds category enrichment and product generation; collect UI consumes enriched metadata and candidate scores.
- **Error propagation:** AI failures should degrade to cache/local dictionary/manual review, not block normal collect/publish flows.
- **State lifecycle risks:** Cache poisoning is the main risk. Validation and status fields must distinguish successful, rejected, stale, and manually approved translations.
- **API surface parity:** Source collect, batch collect, and publish flows should use the same candidate scoring and metadata semantics.
- **Unchanged invariants:** Ozon category IDs/type IDs still come from Ozon API or manual confirmed mapping; AI does not invent IDs.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| AI mistranslates category labels | Keep Russian path visible, validate output, allow fallback placeholders, and avoid using AI label alone for category selection |
| Cache poisoning | Store status/provider/prompt hash, reject invalid output, and allow manual correction later |
| Excess API cost | Disabled default, Postgres cache, batching, daily cap, per-minute cap |
| Prompt settings conflict | Separate category translation prompt from product title/description prompts |
| UI becomes too complex | Add one AI settings panel and keep advanced prompts collapsed |
| Publish flow blocked by provider outage | Use cache/local fallback and never make AI mandatory for publish |

## Suggested Phasing

### Phase 1
- Add AI config, AI text client, translation cache, and category translation enrichment.
- Tighten category candidate ranking for the underwear/adult-category issue.
- Configure the first provider path as custom/OpenAI-compatible endpoint for DeepSeek, MiniMax, OpenRouter, Immersive Translate gateways, and similar APIs.

### Phase 2
- Add product title/description draft generation with prompt profiles and cache.
- Add UI actions to generate/review/apply drafts.

### Phase 3
- Add image text/OCR workflow if needed.
- Add admin diagnostics, usage charts, and manual translation correction UI.

## Open Questions

### Resolved During Planning

- Should Redis be the main cache? No. Use Postgres as durable cache; Redis is optional acceleration.
- Should category translation and product generation share prompts? No. They are different risk classes and should be isolated.
- Should AI directly pick categories? No. AI can improve labels/search terms, but IDs remain Ozon/API/manual-confirmed decisions.
- Which provider model should ship first? Custom/OpenAI-compatible endpoint, with presets or labels for services such as DeepSeek, MiniMax, OpenRouter, and Immersive Translate-style gateways.
- Should missing category translation be automatic? Yes, automatically during category catalog refresh, after system glossary/cache lookup and only for cache misses.
- Who can use product generation? All users, subject to administrator-configured daily per-user limits.

### Need User Decision Before Implementation

- Whether category glossary corrections need a manual admin editing UI in Phase 1, or can wait until Phase 3.
- Whether daily user limits should count only fresh provider calls or both fresh calls and cache hits. Recommended: fresh provider calls only.

## Sources & References

- `apps/server/src/services/ozon-category-catalog.ts`
- `apps/server/src/routes/collect.ts`
- `apps/server/src/services/ozon-attribute-dictionary-cache.ts`
- `apps/server/src/config/system-config-schema.ts`
- `apps/server/src/routes/system-config.ts`
- `apps/web/src/app/(dashboard)/admin/settings/page-client.tsx`
- `apps/web/src/app/(dashboard)/collect/source/page.tsx`
- `apps/server/prisma/schema.prisma`
