---
title: Launch And Iteration Optimization Plan
type: feat
status: active
date: 2026-05-29
origin: user-provided external doc: 开发建议.md
---

# Launch And Iteration Optimization Plan

## Overview

This plan combines the Claude and Codex recommendations into one execution order for SS ERP. The goal is to avoid building long-term architecture before the product is safely testable online, while still preparing the versioning, OTA, database, and collaboration foundations needed for continuous development.

## Problem Frame

The project is transitioning from local development to online testing. Recent work already landed authentication hardening, Turnstile + SMS registration, Prisma baseline migrations, OSS direct upload, Sentry, backup scripts, Docker files, and Git workflow. Remaining work should prioritize safe staging deployment, operational correctness, regression protection, version release infrastructure, and then larger code-quality refactors.

## Requirements Trace

- R1. Prepare a staging environment before production testing.
- R2. Finish Cloudflare origin protection and real client IP handling.
- R3. Keep database changes maintainable through Prisma migration discipline and restore drills.
- R4. Add basic regression tests for high-risk auth, crypto, SMS, and storage paths.
- R5. Add version release infrastructure for Web, API, Chrome extension, print agent, and local package.
- R6. Recommend OTA/update strategy without violating Chrome Manifest V3 policy.
- R7. Sequence refactors so they do not block online validation or collide with active Claude work.

## Scope Boundaries

- This plan does not implement code directly.
- This plan assumes the current branch `hardening/prelaunch-auth-security` remains the integration branch until a clean merge to `main`.
- This plan does not choose a final cloud vendor; it keeps the deployment compatible with ECS/RDS/Redis/OSS-style providers.
- Chrome extension remote JavaScript hot-update is explicitly out of scope because Manifest V3 remote hosted code restrictions make it the wrong direction.

## Context & Research

### Relevant Code And Patterns

- `docker-compose.prod.yml` already defines `api`, `web`, and `redis` with health checks.
- `docker/nginx/ss-erp.conf` is still a basic reverse proxy and does not yet enforce Cloudflare-only traffic.
- `apps/server/prisma/schema.prisma` already has a baseline migration and models for operational data, but no `AppVersion` model yet.
- `apps/server/src/routes/auth.ts` now separates Turnstile-protected SMS code sending from SMS-code-protected registration.
- `scripts/backup-db.sh` and `scripts/restore-db.sh` exist, but a real restore drill still needs to be performed.
- `extensions/ss-erp/manifest.json` is Manifest V3 and currently has broad host permissions, so extension release work should be conservative.
- `print-agent/electron/package.json` uses `electron-builder`, but does not yet configure `electron-updater`.
- `docs/git-workflow.md` already defines short-lived feature branches and no blind `git add .`.

### External References

- Prisma recommends `migrate dev` for development and `migrate deploy` for production/testing environments.
- Cloudflare documents that proxied origins see Cloudflare IPs by default and should use `CF-Connecting-IP` to restore original visitor IPs.
- Cloudflare Turnstile server-side validation is mandatory; tokens are verified through Siteverify.
- Chrome MV3 extensions must bundle executable code inside the extension package; remote JSON/config is acceptable, remote executed JS/WASM is not.
- `electron-updater` supports auto-update metadata and release delivery through providers such as GitHub or generic HTTP/S3-style hosting.

## Key Technical Decisions

- Staging before production: online test traffic should not use the final production database, bucket, or SMS template.
- Cloudflare true-origin protection before public beta: Turnstile is not a replacement for origin firewalling.
- Regression tests before major refactors: tests around auth, crypto, SMS, and image storage give protection for the areas most likely to break during launch hardening.
- AppVersion before OTA clients: a central version table/API lets Web, extension, print agent, and local package share one release policy.
- Cold update over hot update: Web/API/worker/extension/Electron should use deploy/reload/package update patterns, not runtime code patching.
- Large route refactors after launch readiness: splitting `collect.ts` and `order.ts` improves maintainability, but it should follow staging validation and test coverage.

## Implementation Units

- [ ] **Unit 1: Staging Deployment Baseline**

**Goal:** Create a realistic staging environment for end-to-end online testing.

**Requirements:** R1, R3

**Dependencies:** Current Docker and env documentation.

**Files:**
- Modify: `DEPLOYMENT.md`
- Modify: `PRE-LAUNCH-CHECKLIST.md`
- Modify: `docs/deployment.md`
- Optional create: `docs/staging-runbook.md`

**Approach:**
- Define staging domains such as `staging.example.com`.
- Use isolated staging PostgreSQL, Redis, OSS bucket, Turnstile keys, and SMS template.
- Run the full flow before production: register, login, shop connect, collect, publish, order sync, OSS upload, backup, restore.

**Test scenarios:**
- Integration: staging registration sends real SMS through test-approved provider and rejects wrong SMS code.
- Integration: staging OSS direct upload succeeds and uploaded URL is publicly readable.
- Integration: backup from staging can be restored into a disposable database.

**Verification:**
- Staging runbook exists and all checklist items have concrete evidence fields.

- [ ] **Unit 2: Cloudflare Origin Protection**

**Goal:** Ensure production origin is not directly exposed and rate limits use real visitor IPs.

**Requirements:** R2

**Dependencies:** Staging domain and Cloudflare DNS proxy enabled.

**Files:**
- Modify: `docker/nginx/ss-erp.conf`
- Modify: `DEPLOYMENT.md`
- Modify: `PRE-LAUNCH-CHECKLIST.md`
- Optional create: `scripts/update-cloudflare-ips.sh`

**Approach:**
- Add Cloudflare IP allowlist guidance for Nginx/firewall.
- Configure real IP headers for proxied traffic.
- Document a recurring process for refreshing Cloudflare IP ranges.
- Keep `/health` available through Cloudflare while direct origin access is blocked.

**Test scenarios:**
- Integration: request through Cloudflare reaches `/health`.
- Security: direct request to origin IP on 80/443 is rejected.
- Integration: auth rate-limit keys reflect client IP rather than a single proxy IP.

**Verification:**
- Nginx config validates, direct-origin access is blocked, and proxied access works.

- [ ] **Unit 3: Critical Regression Test Baseline**

**Goal:** Add low-cost tests before additional launch hardening and route refactors.

**Requirements:** R4

**Dependencies:** Current auth/SMS/crypto/image-storage code.

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/routes/auth.test.ts`
- Create: `apps/server/src/lib/crypto.test.ts`
- Create: `apps/server/src/lib/captcha.test.ts`
- Create: `apps/server/src/services/image-storage.test.ts`

**Approach:**
- Start with tests that mock Redis/SMS provider/Turnstile and do not require live third-party services.
- Cover schema validation, registration with SMS, failed SMS, login Turnstile threshold, crypto roundtrip, and OSS presign fallback behavior.

**Test scenarios:**
- Happy path: valid SMS code allows registration and sets auth cookie.
- Error path: wrong or expired SMS code blocks registration.
- Error path: production missing Turnstile secret rejects verification.
- Happy path: crypto encrypt/decrypt roundtrip preserves plaintext.
- Error path: OSS presign rejects unsupported MIME type.

**Verification:**
- Server test script exists and passes locally/CI.

- [ ] **Unit 4: Worker Graceful Shutdown**

**Goal:** Avoid losing in-flight BullMQ jobs during deploy/restart.

**Requirements:** R1, R4

**Dependencies:** Current worker startup pattern in `apps/server/src/index.ts`.

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/workers/*.ts`
- Optional create: `apps/server/src/workers/lifecycle.ts`

**Approach:**
- Centralize worker registration and shutdown.
- On `SIGTERM`/`SIGINT`, stop accepting new jobs and close workers/queues with a bounded timeout.
- Keep this scoped; do not split workers into a separate service in the same unit unless necessary.

**Test scenarios:**
- Integration: simulated shutdown calls worker close handlers.
- Error path: one worker close failure is logged but does not hang process forever.

**Verification:**
- Deploy restart does not abandon a currently running job without logging the shutdown path.

- [ ] **Unit 5: Version Release Model And API**

**Goal:** Create the shared release metadata layer for Web/API/extension/print-agent/local package.

**Requirements:** R5, R6

**Dependencies:** Migration discipline from the baseline.

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_app_versions/migration.sql`
- Create: `apps/server/src/routes/version.ts`
- Modify: `apps/server/src/index.ts`
- Optional modify: `packages/shared/src/schemas/api.ts`

**Approach:**
- Add `AppVersion` with `platform`, `version`, `channel`, `minVersion`, `downloadUrl`, `sha256`, `releaseNotes`, `forceUpdate`, and `publishedAt`.
- Add read-only public endpoint for version checks.
- Keep admin CRUD optional for a later unit; seed manually at first if faster.

**Test scenarios:**
- Happy path: latest stable version is returned for `platform=extension`.
- Edge case: unknown platform returns clear 400/404 response.
- Error path: invalid semver or channel is rejected when writing seed/admin data.

**Verification:**
- Web/API/extension/print-agent can all query a single version endpoint contract.

- [ ] **Unit 6: Client Version Checks And OTA Policy**

**Goal:** Add user-facing update prompts without unsafe remote-code hot updates.

**Requirements:** R5, R6

**Dependencies:** Unit 5.

**Files:**
- Modify: `apps/web/src/components/layout/topbar.tsx`
- Modify: `extensions/ss-erp/pages/settings.js`
- Modify: `extensions/ss-erp/background/service-worker.js`
- Modify: `print-agent/electron/package.json`
- Modify: `print-agent/electron/src/main.js`
- Optional create: `docs/release-process.md`

**Approach:**
- Web checks `/api/version?platform=web` and prompts refresh when build version changes.
- Extension checks `/api/version?platform=extension` and shows an update badge/message; actual executable update goes through Chrome Web Store or enterprise install.
- Electron print agent uses `electron-updater` with GitHub Releases or OSS/generic provider.
- Local Windows package uses version check and download prompt, not runtime code replacement.

**Test scenarios:**
- Happy path: outdated Web client sees refresh prompt.
- Happy path: extension sees newer version and shows update notice without fetching executable JS.
- Happy path: print agent detects newer release metadata and prompts update.
- Security: extension never executes remote code returned from API.

**Verification:**
- All clients have a documented update behavior and no client relies on remote JS hot patching.

- [ ] **Unit 7: Database Maintenance And Restore Discipline**

**Goal:** Turn backup/migration scripts into an operated maintenance process.

**Requirements:** R3

**Dependencies:** Staging environment.

**Files:**
- Modify: `DEPLOYMENT.md`
- Modify: `PRE-LAUNCH-CHECKLIST.md`
- Optional create: `docs/db-maintenance.md`

**Approach:**
- Require staging `migrate deploy` before production.
- Require migration SQL review in PRs.
- Document when to use hand-written SQL, especially `CREATE INDEX CONCURRENTLY` for large PostgreSQL tables.
- Schedule monthly restore drills.
- Define future archive candidates: `orders`, `ozon_finance_transactions`, `notifications`, `sync_jobs`.

**Test scenarios:**
- Operational: latest backup restores into disposable database.
- Operational: a migration created on feature branch applies cleanly in staging.
- Operational: rollback plan is documented for destructive migrations.

**Verification:**
- Restore drill evidence exists before production launch.

- [ ] **Unit 8: Route And Service Refactor After Launch Readiness**

**Goal:** Reduce future change risk in large route files after the launch-critical path is stable.

**Requirements:** R7

**Dependencies:** Units 1-4, and no active Claude edits in the same files.

**Files:**
- Modify: `apps/server/src/routes/collect.ts`
- Modify: `apps/server/src/routes/order.ts`
- Create/modify: `apps/server/src/routes/collect/*`
- Create/modify: `apps/server/src/routes/order/*`
- Create/modify: `apps/server/src/services/*`

**Approach:**
- Do this after staging validation and tests, not before.
- Split by route responsibility and service responsibility, keeping behavior stable.
- Use characterization tests around publish/list/sync/label flows before moving large blocks.

**Test scenarios:**
- Integration: existing collect list/create/publish endpoints preserve response shape.
- Integration: existing order list/sync/ship/label endpoints preserve response shape.
- Error path: known OZON errors still surface full actionable messages.

**Verification:**
- Refactor diff is mostly movement plus imports; typecheck/build/tests remain clean.

## Recommended Sequence

### Phase 0: Freeze The Current Baseline

- Keep current feature branch clean.
- Merge to `main` only after validation gate passes.
- Do not let Claude and Codex edit the same route files at the same time.

### Phase 1: Before Public Online Testing

1. Unit 1: Staging Deployment Baseline.
2. Unit 2: Cloudflare Origin Protection.
3. Unit 3: Critical Regression Test Baseline.
4. Unit 4: Worker Graceful Shutdown.

### Phase 2: First Online Testing Window

1. Run staging full-flow tests.
2. Configure real SMS, Turnstile, OSS, Redis, Sentry, and backup cron.
3. Perform restore drill.
4. Deploy production beta only after staging passes.

### Phase 3: First Month After Launch

1. Unit 5: Version Release Model And API.
2. Unit 6: Client Version Checks And OTA Policy.
3. Unit 7: Database Maintenance And Restore Discipline.
4. Unit 8: Route And Service Refactor After Launch Readiness.

## System-Wide Impact

- **Authentication:** Turnstile and SMS are now launch-critical; test coverage should precede more auth changes.
- **Workers:** Deploy strategy must account for in-flight BullMQ jobs.
- **Database:** Migrations and backups become part of release discipline, not optional ops tasks.
- **Extension:** Update strategy must respect MV3 remote-code restrictions.
- **Print agent:** Auto-update can be introduced independently from the Web/API release cycle.
- **Git workflow:** Codex can continue reviewing/committing Claude work as long as file ownership remains scoped.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Direct origin bypasses Cloudflare controls | Firewall/Nginx allowlist for Cloudflare IPs and real IP restore |
| Migration breaks production data | Staging `migrate deploy`, SQL review, backup restore drill |
| Worker loses active jobs during deploy | Graceful shutdown before blue/green or restart automation |
| Extension rejected for remote code | Only remote config/version JSON; all executable code packaged |
| Large route refactor breaks publishing/orders | Delay until tests and staging pass; use characterization tests |
| Multiple AI agents overwrite work | Short-lived branches, scoped staging, no blind add/commit |

## Documentation / Operational Notes

- `docs/LAUNCH-OPTIMIZATION-PLAN.md` should remain the status dashboard.
- `DEPLOYMENT.md` should remain the operator runbook.
- `PRE-LAUNCH-CHECKLIST.md` should become evidence-based, with links/screenshots/log snippets for staging validation.
- `docs/release-process.md` should be added when Unit 5/6 begins.

## Sources & References

- Origin document: user-provided external doc `开发建议.md`
- Related plan/status: `docs/LAUNCH-OPTIMIZATION-PLAN.md`
- Git workflow: `docs/git-workflow.md`
- Deployment guide: `DEPLOYMENT.md`
- Prisma production migration guidance: https://www.prisma.io/docs/concepts/components/prisma-migrate/migrate-development-production
- Cloudflare original visitor IP guidance: https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Chrome MV3 remote hosted code guidance: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- electron-builder auto-update docs: https://www.electron.build/docs/features/auto-update
