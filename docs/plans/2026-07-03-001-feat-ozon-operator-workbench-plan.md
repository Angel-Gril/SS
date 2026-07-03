---
title: Ozon Operator Workbench And Managed Content Plan
type: feat
status: active
date: 2026-07-03
---

# Ozon Operator Workbench And Managed Content Plan

## Overview

SS ERP already has many Ozon capabilities that overlap with Maozi ERP: product sync, Ozon listing, image/watermark handling, promotions, analytics, cookie/companyId capture, pickup point sync, listing diagnostics, and post-publish picture repair. The next improvement should not be a visual copy of Maozi ERP. It should reorganize existing capabilities into an operator-first workflow and make homepage/tutorial/announcement content maintainable from the admin side.

The work should deliver a durable Ozon operations surface:

- A managed dashboard home page for onboarding, quick tools, updates, tutorials, and operational next steps.
- A single announcement/content pipeline instead of static seed notices.
- Clear sync state and auto-sync controls exposed in ERP, not only in the extension popup.
- Product-list workflow improvements: compact toolbar, status tabs, batch actions, repair/diagnostics, promotions.
- Future automation and analytics features planned without blocking the P0 delivery.

## Problem Frame

The current SS ERP feature set is strong, but the UI reads like a collection of backend modules. Maozi ERP feels more comfortable because its product pages and home page are organized around operator tasks:

- The home page tells new users what to do next.
- Product pages expose status tabs, search, sync, and batch actions in one compact toolbar.
- Cookie, analytics, promotions, tutorial, update, and support entry points are visible.
- Feature education and update notices are productized instead of hidden in docs.

SS ERP has underlying systems for many of these behaviors, but important surfaces are fragmented:

- Dashboard system announcements still use `/api/notices`, while the richer managed announcement system is `/api/announcements`.
- The homepage has KPI cards and quick actions, but not an Ozon operator workflow.
- Auto sync exists in the extension background service, but the ERP UI does not expose status or controls clearly.
- Promotions exist under shop analytics but are not productized as a product-list batch workflow.
- Image/country repair exists in the publish/refresh pipeline, but users need a clear "diagnose/repair" surface.

## Requirements Trace

- R1. Preserve existing stronger SS ERP backend capabilities; do not duplicate them with weaker frontend-only flows.
- R2. Make dashboard content maintainable by admins: announcements, update cards, quick links, tutorials, and onboarding steps must not be hard-coded.
- R3. Replace or bridge the legacy dashboard notice feed with the richer announcement system.
- R4. Provide a complete roadmap beyond P0/P1, including P2/P3 strategic features.
- R5. Start development from the highest-value, lowest-risk foundation: managed homepage and announcement/content plumbing.
- R6. Keep user-role boundaries: users can consume content and operate their shops; admins can configure shared content and maintain system-level data.
- R7. Keep operator pages dense but readable; avoid decorative marketing layouts inside the ERP app.
- R8. Surface existing repair/sync capabilities through UI diagnostics before adding new backend mechanics.

## Scope Boundaries

- This plan does not redesign every ERP page at once.
- This plan does not copy Maozi ERP styling, assets, or exact layouts.
- This plan does not make third-party Ozon Cookie/API scraping more aggressive than current extension behavior.
- This plan does not replace the existing listing, watermark, analytics, promotions, and pickup-point implementations.

### Deferred to Separate Tasks

- Full product-page redesign beyond compact toolbar/status tabs: later P1 batch after homepage/content foundation.
- Deep AI image/rich-content generation workbench: P2.
- Fully automated promotion/review/passport/pickup bots: P3 and requires dry-run, audit logs, rate limiting, and explicit opt-in.

## Context & Research

### Relevant Code And Patterns

- Dashboard home: `apps/web/src/app/(dashboard)/page.tsx`
- Current dashboard notice widget: `apps/web/src/components/dashboard/notice-list.tsx`
- Rich announcement popup: `apps/web/src/components/announcement-popup.tsx`
- User announcement page: `apps/web/src/app/(dashboard)/announcements/page.tsx`
- Admin announcement page: `apps/web/src/app/(dashboard)/admin/announcements/page.tsx`
- Announcement routes: `apps/server/src/routes/announcements.ts`
- Legacy notice routes: `apps/server/src/routes/notice.ts`
- Dashboard metrics routes: `apps/server/src/routes/dashboard.ts`
- Product management page: `apps/web/src/app/(dashboard)/products/page.tsx`
- Promotions UI/routes: `apps/web/src/app/(dashboard)/shops/ozon/analytics/page.tsx`, `apps/server/src/routes/shop.ts`
- Extension auto-sync logic: `extensions/ss-erp/background/service-worker.js`
- Listing image repair diagnostics: `apps/server/src/routes/listing.ts`, `apps/web/src/components/listing-job-detail-dialog.tsx`
- Ozon publish image/country repair helpers: `apps/server/src/routes/collect.ts`

### Existing Strengths

- Announcement system already supports rich text, attachments, target roles, read tracking, and forced popup.
- Layout already mounts `AnnouncementPopup`, so urgent updates can be displayed now.
- Product page already has sync, commission sync, stock push, price/weight/stock filters, and batch price/stock/archive actions.
- Extension already performs Ozon auto-sync maintenance every 30 minutes and reacts to `sc_company_id` changes.
- Picture repair and origin-country repair already exist in listing/publish flows.
- Promotions endpoints and a promotions tab already exist.

### Main Gap

The product needs an operator-first information architecture, not more isolated features. The first deliverable should make content and operational guidance dynamic and visible, then move to product-list workflow consolidation.

## Key Technical Decisions

- Use the existing `Announcement` model for update notices and homepage update cards where possible.
  Rationale: it already has rich content, role targeting, force-popup, expiry, read tracking, attachments, and admin CRUD.

- Add a separate managed dashboard-content model for reusable homepage blocks.
  Rationale: quick links, tutorial cards, onboarding steps, and banner modules have different structure from announcements and should not be stuffed into HTML blobs.

- Keep legacy `/api/notices` readable during transition but stop using it on the dashboard.
  Rationale: avoids breaking seeded/sample data while moving real UI to `/api/announcements`.

- Build homepage as an operations workbench, not a marketing dashboard.
  Rationale: ERP users need fast navigation, status, and next actions more than static hero content.

- Expose extension auto-sync state through a small ERP-facing endpoint/message bridge before changing scheduling behavior.
  Rationale: the automation already exists; the missing piece is visibility and control.

- Start with P0 content foundation before product toolbar redesign.
  Rationale: homepage updates/tutorials/announcements need backend maintainability first, and this is a low-risk foundation for later UI changes.

## Roadmap

### P0: Managed Operator Home Foundation

Goal: Make the ERP homepage useful and maintainable without hard-coded content.

- Replace homepage `NoticeList` with announcement-backed update/notice cards.
- Add managed dashboard content blocks:
  - hero/banner
  - onboarding step groups
  - quick links
  - tutorials/videos
  - operational checklists
  - support/help links
- Add admin UI for dashboard content management.
- Redesign dashboard home into an Ozon operator workbench:
  - compact KPI strip
  - onboarding / operation steps
  - quick tools grid
  - latest updates card
  - tutorial/help card
  - pending operational tasks
- Keep forced announcement popup as-is, but add non-blocking update cards on homepage.
- Add tests for dashboard content routes and announcement-backed home cards.

### P1: Product Operations Workbench

Goal: Make product management feel like an operator console.

- Rework product page top area into a compact toolbar:
  - shop selector
  - keyword search
  - status tabs with counts
  - sync actions
  - auto-sync state summary
  - batch actions menu
- Add status tabs:
  - all
  - selling
  - ready to ship
  - errors
  - pending edit
  - archived
  - missing from sync
- Consolidate batch actions:
  - price
  - stock
  - archive/unarchive
  - promotion
  - watermark/replace image
  - repair/diagnose
  - refresh Ozon status
- Expose existing picture/country repair state in listing/product diagnostics.
- Add "sync center lite" status on product and analytics pages.

### P2: Ozon Sync Center And Promotions Productization

Goal: Make Ozon data freshness and promotion workflows auditable.

- Create Ozon Sync Center:
  - products
  - commissions
  - inventory push
  - cookie/companyId
  - analytics
  - graphs
  - promotions
  - pickup/dropoff pool
- Store sync run records with counts, duration, trigger, shop, companyId, result, and error details.
- Promote current promotions tab into a dedicated Ozon promotions module:
  - promotion list
  - promotion products
  - batch add/remove
  - discount/price setting
  - refresh action list
  - item-level errors
- Add sync history and retry actions.

### P3: Advanced Automation And Operator Intelligence

Goal: Move from manual workflows to controlled automation.

- Extension/device management:
  - extension version
  - last seen
  - ERP connection
  - Ozon login
  - current companyId
  - selected shop match
- Automated operations with audit and dry-run:
  - auto promotion cleanup
  - pickup/passport/review reminders
  - stale listing checks
  - stock anomaly alerts
- AI-assisted listing quality:
  - publish readiness score
  - title/description risk checks
  - category/attribute completeness
  - image/watermark compliance
- Selection rules:
  - margin estimate
  - rating/review/price thresholds
  - logistics feasibility
  - Ozon product-page labels via extension.

## Implementation Units

- [x] **Unit 1: Dashboard Content Data Model And Routes**

**Goal:** Create dynamic content blocks for homepage modules that are not announcements.

**Requirements:** R2, R5, R6

**Dependencies:** None

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_dashboard_content_blocks/migration.sql`
- Create: `apps/server/src/routes/dashboard-content.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/src/__tests__/dashboard-content-route.test.ts`

**Approach:**
- Add a `DashboardContentBlock` table with fields for key, title, subtitle, type, content JSON, target role, enabled, sort order, published/expires dates, createdBy, timestamps.
- Route public/user reads through auth and role filtering.
- Route admin CRUD through `requireRole('ADMIN')`.
- Keep the content schema flexible but validate known block types with Zod.

**Patterns to follow:**
- `apps/server/src/routes/announcements.ts`
- `apps/server/src/routes/dashboard.ts`
- `apps/server/prisma/migrations/20260531000000_add_announcements/migration.sql`

**Test scenarios:**
- Happy path: admin creates a quick-link block; user reads it from dashboard content endpoint.
- Happy path: admin creates tutorial and onboarding blocks; read endpoint returns enabled blocks sorted by sort order.
- Edge case: expired content is not returned to users.
- Edge case: role-targeted admin-only content is not returned to normal users.
- Error path: non-admin user cannot create/update/delete content blocks.
- Error path: invalid block type or malformed content JSON returns 400.

**Verification:**
- Dashboard content endpoints return only active, role-appropriate blocks.
- Admin can manage blocks without touching frontend code.

- [x] **Unit 2: Announcement Feed Consolidation**

**Goal:** Stop using legacy `/api/notices` on the dashboard and use managed announcements for updates/notices.

**Requirements:** R2, R3, R5

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/components/dashboard/notice-list.tsx`
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
- Test: `apps/server/src/__tests__/announcements-route.test.ts` or extend existing announcement route coverage.

**Approach:**
- Replace `/api/notices?limit=5` with `/api/announcements/list`.
- Rename the UI concept from generic `NoticeList` to an announcement/update card if implementation scope allows.
- Show unread state, type, priority, date, and link to `/announcements`.
- Leave `/api/notices` registered for backward compatibility for now.

**Patterns to follow:**
- `apps/web/src/app/(dashboard)/announcements/page.tsx`
- `apps/web/src/components/layout/topbar.tsx`

**Test scenarios:**
- Happy path: dashboard announcement widget renders announcements from the managed announcement list.
- Edge case: empty announcement list displays a quiet empty state.
- Integration: marking an announcement read on the announcement page reduces unread count and no longer appears as unread in dashboard widget.

**Verification:**
- Dashboard no longer depends on legacy seed notices for real update content.

- [x] **Unit 3: Operator Dashboard UI**

**Goal:** Redesign the dashboard page into a compact Ozon operator workbench.

**Requirements:** R1, R2, R5, R7

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
- Deferred component extraction: `apps/web/src/components/dashboard/operator-steps.tsx`
- Deferred component extraction: `apps/web/src/components/dashboard/quick-link-grid.tsx`
- Deferred component extraction: `apps/web/src/components/dashboard/tutorial-card-list.tsx`
- Deferred component extraction: `apps/web/src/components/dashboard/update-card.tsx`

**Approach:**
- Keep KPI cards but make them compact and secondary.
- Add role-aware sections:
  - Ozon setup / daily operations / after-sale optimization steps.
  - Quick link grid from managed content blocks.
  - Tutorials/videos from managed content blocks.
  - Latest update announcement card.
  - Pending operations from existing dashboard stats.
- Avoid large decorative marketing hero. Use dense, utilitarian bands/cards for operator tasks.

**Patterns to follow:**
- `apps/web/src/components/dashboard/order-chart.tsx`
- `apps/web/src/components/dashboard/notice-list.tsx`
- Existing UI components under `apps/web/src/components/ui`

**Test scenarios:**
- Test expectation: frontend component tests are not currently established for dashboard components. Verify through route smoke and browser QA after implementation.

**Verification:**
- Dashboard first screen answers: "what should I do next?", "what changed?", and "where is the tool I need?"

- [x] **Unit 4: Admin Dashboard Content Management**

**Goal:** Let admins edit homepage content without code changes.

**Requirements:** R2, R6

**Dependencies:** Unit 1

**Files:**
- Create: `apps/web/src/app/(dashboard)/admin/dashboard-content/page.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Test: `apps/server/src/__tests__/dashboard-content-route.test.ts`

**Approach:**
- Add list/create/edit/delete UI for dashboard content blocks.
- Use structured editors per type where simple:
  - quick link: label, URL, icon key, description
  - tutorial: title, URL, cover URL, duration
  - step group: title and JSON rows initially, later richer editor
  - banner/update: title, subtitle, link
- Include enabled, sort order, target role, expiry.

**Patterns to follow:**
- `apps/web/src/app/(dashboard)/admin/announcements/page.tsx`
- `apps/web/src/app/(dashboard)/admin/warehouse-templates/page.tsx`

**Test scenarios:**
- Covered by route tests in Unit 1.
- Manual QA: create quick link, disable it, expire it, and verify dashboard visibility changes.

**Verification:**
- Admin can update homepage content and user dashboard reflects it without redeploy.

- [ ] **Unit 5: Extension Auto-Sync Visibility**

**Goal:** Expose existing extension auto-sync state in ERP UI before changing sync mechanics.

**Requirements:** R1, R8

**Dependencies:** Unit 3

**Files:**
- Modify: `extensions/ss-erp/background/service-worker.js`
- Modify: `extensions/ss-erp/pages/popup.js`
- Create or modify: `apps/web/src/components/ozon/extension-sync-status.tsx`
- Modify: `apps/web/src/app/(dashboard)/products/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/shops/ozon/analytics/page.tsx`

**Approach:**
- Reuse `SS_ERP_OZON_AUTO_SYNC_STATE_KEY` and existing `ozon-calc:auto-sync-maintenance` message.
- Add a page-level status card/button that can ask the extension for auto-sync state when available.
- Display last cookie/analytics/graphs sync, selected shop/companyId, and last errors.
- If extension is unavailable, show a clear local-only state instead of implying server failure.

**Patterns to follow:**
- Existing extension ping and bridge patterns in `apps/web/src/app/(dashboard)/admin/ozon-pickup-points/page.tsx`
- Existing popup sync display in `extensions/ss-erp/pages/popup.js`

**Test scenarios:**
- Happy path: extension returns auto-sync state and ERP displays last sync times.
- Edge case: extension unavailable shows "扩展未连接" and does not block normal page use.
- Error path: auto-sync last result has cookie error; UI shows the error text and retry option.

**Verification:**
- Users can see whether automatic Ozon maintenance is working without opening the extension popup.

- [ ] **Unit 6: Product Page Compact Toolbar And Status Tabs**

**Goal:** Improve product page workflow density and operator clarity.

**Requirements:** R1, R7, R8

**Dependencies:** Unit 5 preferred but not required

**Files:**
- Modify: `apps/web/src/app/(dashboard)/products/page.tsx`
- Test: Extend relevant product route tests only if backend status counts require new endpoint changes.

**Approach:**
- Keep existing filters and backend calls.
- Convert status selector into tab row with counts where available.
- Move advanced filters into a collapsible panel.
- Keep primary sync actions visible.
- Consolidate selected-item actions into a batch action menu.

**Patterns to follow:**
- Current `products/page.tsx`
- Status tabs pattern in `apps/web/src/app/(dashboard)/shops/ozon/analytics/page.tsx`

**Test scenarios:**
- Happy path: selecting status tab updates existing status filter and resets pagination/selection.
- Edge case: advanced filters remain available and do not crowd first-row toolbar.
- Manual QA: product table remains readable on 1366px and 2048px widths.

**Verification:**
- Product page feels like a workflow table rather than a large filter card.

- [ ] **Unit 7: Repair And Diagnostics Surface**

**Goal:** Make existing repair capabilities visible and actionable.

**Requirements:** R1, R8

**Dependencies:** Unit 6

**Files:**
- Modify: `apps/web/src/components/listing-job-detail-dialog.tsx`
- Modify: `apps/web/src/components/listing-job-list.tsx`
- Modify: `apps/web/src/app/(dashboard)/products/page.tsx`
- Potentially modify: `apps/server/src/routes/listing.ts`
- Test: `apps/server/src/__tests__/listing-picture-stage.test.ts`

**Approach:**
- Surface current picture upload state, pending count, and blocked reason in product/listing views.
- Add "诊断/修复" entry points that reuse existing refresh/listing task endpoints.
- Do not invent a new repair mechanism until existing diagnostics show a real gap.

**Patterns to follow:**
- Existing picture-upload fields in `listing-job-detail-dialog.tsx`
- Existing refresh behavior in `apps/server/src/routes/listing.ts`

**Test scenarios:**
- Happy path: pending picture repair status is shown as "waiting for Ozon product_id".
- Happy path: successful picture repair status is shown as submitted, not immediately visible.
- Edge case: partial failure shows failed/skipped/pending counts.

**Verification:**
- Users can understand image/country repair state without reading raw job payloads.

- [ ] **Unit 8: Ozon Promotions Workflow**

**Goal:** Move promotions from a hidden analytics sub-tab into an operator workflow.

**Requirements:** R1, R8

**Dependencies:** Unit 6

**Files:**
- Modify: `apps/web/src/app/(dashboard)/shops/ozon/analytics/page.tsx`
- Create: `apps/web/src/app/(dashboard)/shops/ozon/promotions/page.tsx` or keep route if implementation chooses tabs first.
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify as needed: `apps/server/src/routes/shop.ts`
- Test: `apps/server/src/__tests__/product-promotions.test.ts`

**Approach:**
- Keep existing endpoints for action list, product list, deactivate products.
- Add a clearer promotions page or section:
  - activity list
  - product list
  - add/remove actions
  - batch discount inputs
  - sync activity button
- Later add product-page batch promotion entry.

**Patterns to follow:**
- Current `PromotionsTab` implementation in analytics page.
- `apps/server/src/services/product-promotions.ts`

**Test scenarios:**
- Happy path: promotion action list loads and product list loads for selected action.
- Error path: missing cookie/companyId shows actionable error.
- Integration: removing products queues product sync when appropriate.

**Verification:**
- Promotions are reachable as a first-class Ozon operations feature.

- [ ] **Unit 9: Sync Center Records**

**Goal:** Persist and display cross-module Ozon sync history.

**Requirements:** R1, R8

**Dependencies:** Units 5, 6, 8

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_ozon_sync_runs/migration.sql`
- Create: `apps/server/src/routes/ozon-sync-runs.ts`
- Modify sync callers incrementally across product, shop analytics, pickup point routes.
- Create: `apps/web/src/app/(dashboard)/shops/ozon/sync-center/page.tsx`
- Test: `apps/server/src/__tests__/ozon-sync-runs-route.test.ts`

**Approach:**
- Record sync type, shopId, companyId, trigger, status, counts, error, startedAt, finishedAt.
- Backfill only new syncs; no historical data migration required.
- Keep endpoint generic but avoid logging raw cookies or sensitive headers.

**Patterns to follow:**
- Existing `SyncJob` model and listing jobs.
- Existing sync result summaries in pickup point admin page.

**Test scenarios:**
- Happy path: product sync records success counts and duration.
- Error path: failed sync records sanitized error and no raw cookie.
- Edge case: sync run with no shop is rejected unless explicitly system-level.

**Verification:**
- Support/debugging can answer "what synced, when, and why did it fail?"

## System-Wide Impact

- **Interaction graph:** Dashboard reads dashboard-content and announcements; admin pages write dashboard-content and announcements; extension status remains local/browser-mediated; product and analytics pages can display extension status but must not depend on it for server rendering.
- **Error propagation:** Content-management errors are normal API errors. Extension errors should be local and actionable. Sync errors should be persisted in sync-run records only after P2.
- **State lifecycle risks:** Dashboard content requires expiry/enable filtering. Announcements require read-state consistency. Sync center must avoid storing sensitive cookie values.
- **API surface parity:** User dashboard, admin content page, and announcements page must all use consistent role filtering.
- **Integration coverage:** Backend route tests should cover role filtering, expiry filtering, and CRUD authorization.
- **Unchanged invariants:** Existing `/api/announcements`, `AnnouncementPopup`, product sync, listing repair, promotions, and extension auto-sync behavior remain operational during P0.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Homepage becomes a static clone of Maozi ERP | Add managed content blocks and admin UI before hard-coding rich homepage content. |
| Two announcement systems confuse future maintenance | Stop dashboard usage of `/api/notices`; document `/api/announcements` as the supported path. |
| Dashboard content model becomes too generic and hard to validate | Use typed block kinds and Zod validation for known content shapes. |
| Extension state is mistaken for server state | Label extension status as local browser status and handle missing extension gracefully. |
| Product page redesign regresses existing workflows | Preserve existing handlers and move UI structure first; avoid backend changes unless needed for counts. |
| Sync center stores secrets | Explicitly sanitize errors and never persist raw cookies, tokens, headers, or API keys. |

## Documentation / Operational Notes

- Update admin/user documentation after P0 to explain how to publish homepage content and announcements.
- Keep a small seed set of default dashboard content for new installs.
- When P2 sync center lands, update troubleshooting docs to use sync-run history before raw log inspection.

## Success Metrics

- Admin can update homepage quick links/tutorials/update cards without code deployment.
- Dashboard no longer uses legacy `/api/notices`.
- New users can find the main Ozon workflow from the first screen.
- Operators can see Ozon sync/extension state without opening the extension popup.
- Product page common operations require fewer clicks: search, status filter, sync, batch actions, diagnose.

## Sources & References

- Maozi ERP screenshots and Feishu tutorial analysis from this thread.
- Dashboard home: `apps/web/src/app/(dashboard)/page.tsx`
- Announcements: `apps/server/src/routes/announcements.ts`
- Legacy notices: `apps/server/src/routes/notice.ts`
- Product management: `apps/web/src/app/(dashboard)/products/page.tsx`
- Extension auto-sync: `extensions/ss-erp/background/service-worker.js`
- Listing picture repair: `apps/server/src/routes/listing.ts`
