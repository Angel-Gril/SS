---
title: Domestic VPS Deployment Separation Plan
type: feat
status: active
date: 2026-07-10
---

# Domestic VPS Deployment Separation Plan

## Overview

Add a third deployment environment for domestic commercial testing while keeping local development and the current overseas VPS staging flow intact. Use one source repository and one deployment toolchain, but separate runtime configuration, database, storage, domains, release promotion, and verification.

## Implementation Status (2026-07-22)

- Domestic host `8.163.122.40` intentionally remains on promoted application commit `bb3d8cd`; the database is empty and `/setup` is ready for first-administrator initialization.
- `ss-erp.cn`, `www.ss-erp.cn`, `app.ss-erp.cn`, and `admin.ss-erp.cn` resolve directly to the domestic origin. Nginx serves HTTPS on `443`, redirects allowlisted HTTP hosts to HTTPS, and UFW allows only the public Web ports while application and data ports remain private.
- A ZeroSSL ECC SAN certificate is installed at `/etc/ssl/certs/ss-erp.cn.fullchain.pem` with its key at `/etc/ssl/private/ss-erp.cn.key`. `acme.sh` owns renewal and reloads Nginx after installation; the initial certificate expires on 2026-10-19.
- Domestic runtime URLs, CORS and secure cookie settings use the `.cn` domains. API, Web, Worker, PostgreSQL and Redis are healthy, and public `https://ss-erp.cn/ready` reports DB/Redis ready.
- The next promoted domestic build must freeze `NEXT_PUBLIC_USER_HOSTNAME=app.ss-erp.cn`, `NEXT_PUBLIC_ADMIN_HOSTNAME=admin.ss-erp.cn`, `NEXT_PUBLIC_MARKETING_HOSTNAME=ss-erp.cn`, and `EXTENSION_CLOUD_BASE_URL=https://app.ss-erp.cn`; these are build inputs, not runtime-only switches.
- The domestic origin is intentionally not Cloudflare-proxied. Repository deployment verification uses `VERIFY_ORIGIN_MODE=direct` plus the explicit four-host `VERIFY_DIRECT_HOSTNAMES` list, validates unknown-host rejection, the ACME exception, `acme.sh` renewal and each hostname's certificate; the international VPS retains the default `cloudflare` mode.
- First administrator creation does not use SMS. Aliyun SMS remains a separate provider/configuration step after administrator initialization and a whitelist-only test.

## Problem Frame

The project currently supports local ERP testing and an overseas VPS staging deployment. A new domestic VPS should be more stable and less exposed to active development churn, but it should not drift into a separate hand-maintained project that becomes hard to debug or deploy.

## Requirements Trace

- R1. Keep local development, overseas VPS staging, and domestic VPS commercial testing separated.
- R2. Avoid maintaining duplicate code folders or divergent project copies.
- R3. Make domestic VPS deployments stable and intentional, not automatically affected by every development commit.
- R4. Reuse the existing deployment scripts and verification checks where possible.
- R5. Keep rollback/debugging practical by deploying immutable commits or tags.

## Scope Boundaries

- Do not fork the codebase into a separate long-lived copy.
- Do not share the domestic VPS database, Redis, runtime uploads, or production-like credentials with local or overseas staging.
- Do not deploy uncommitted local working-tree changes to the domestic VPS.

## Context & Research

### Relevant Code and Patterns

- `scripts/deploy-app-dir.sh` packages a specific commit, uploads it to a target VPS, builds in an app-next directory, runs Prisma migrations, builds server/web, packages the cloud extension, then atomically switches `/opt/ss-erp/app`.
- `scripts/verify-cloud-runtime.sh` validates the deployed VPS, service state, runtime mode, upload backend, migrations, local `/ready`, public `/ready`, and recent logs.
- `scripts/package-extension-package.mjs` preserves and bumps extension package versions for cloud/local builds.
- `docs/RUNBOOK.md` and `docs/vps-deployment.md` document the existing app-dir deployment and verification flow.

## Key Technical Decisions

- Use one Git repository as the source of truth.
  Rationale: avoids code drift and keeps bug fixes portable across local, overseas staging, and domestic commercial test.
- Use commit or tag based promotion for domestic VPS.
  Rationale: domestic deployments should happen only after a commit has passed overseas staging and smoke verification.
- Treat the overseas VPS as staging, not as the same tier as domestic commercial test.
  Rationale: staging remains fast-moving; domestic remains stable.
- Keep domestic runtime infrastructure fully separate.
  Rationale: database, Redis, uploads, cookies, and secrets must not be shared across environments.

## Recommended Environment Model

| Environment | Purpose | Deploy Source | Runtime Data | Expected Stability |
|---|---|---|---|---|
| Local ERP | Daily development and debugging | Working tree / local build | Local Postgres/Redis/storage | Can break |
| Overseas VPS | Staging / pre-release validation | Current branch commits | Overseas staging DB/storage | Can change often |
| Domestic VPS | Commercial test / stable pilot | Promoted release commit or tag | Domestic DB/Redis/storage | Stable |

## Implementation Units

- [x] **Unit 1: Provision domestic VPS runtime**

**Goal:** Prepare the new VPS so it can run the same app-dir deployment shape.

**Files:**
- Reference: `scripts/init-server.sh`
- Reference: `scripts/deploy-app-dir.sh`
- Reference: `docs/vps-deployment.md`

**Approach:**
- Create the same `/opt/ss-erp` layout.
- Create or verify the `deploy` runtime user.
- Configure `ss-erp-api`, `ss-erp-worker`, and `ss-erp-web` systemd services.
- Configure nginx, firewall, Node/pnpm, PostgreSQL, Redis, backup cron, and domain TLS.

**Test scenarios:**
- Fresh VPS has required commands and services.
- `/opt/ss-erp/app/.env.staging` exists before deploy.
- Local-only ports remain loopback-only.

**Verification:**
- Domestic VPS passes `scripts/verify-cloud-runtime.sh` after first deployment.

- [x] **Unit 2: Create domestic environment config**

**Goal:** Give domestic VPS independent runtime configuration.

**Files:**
- Reference: `.env.production.example`
- Reference: `scripts/validate-env.mjs`
- Reference: `scripts/diagnose-runtime-env.sh`

**Approach:**
- Use a domestic-specific `.env.staging` or introduce a clearly named env file if the service templates are adjusted later.
- Set domestic domain/API/web/admin URLs.
- Set the user/admin/marketing build hostnames and extension cloud base explicitly before Web and extension packaging.
- Use domestic DB, Redis, upload backend, SMS/payment, and cookie/session secrets.
- Do not reuse overseas R2/OSS credentials unless that is an explicit business decision.

**Test scenarios:**
- Env validation passes for cloud bootstrap.
- Runtime diagnostics report cloud mode and complete upload configuration.
- Public `/ready` is reachable through the domestic domain.

**Verification:**
- Direct-origin deployment verification reports 0 failures after checking UFW, active Host routing, ACME renewal and all four certificate-valid HTTPS `/ready` endpoints. The remaining local-only backup warning is tracked until a domestic remote backup destination is selected.

- [x] **Unit 3: Define release promotion workflow**

**Goal:** Make domestic deployment stable and intentional.

**Files:**
- Reference: `docs/RUNBOOK.md`
- Reference: `scripts/deploy-app-dir.sh`

**Approach:**
- Continue development in normal branches.
- Deploy active work to overseas VPS first.
- After tests and smoke pass, create a release tag or move a stable branch such as `release/cn`.
- Deploy domestic VPS only from that tag/branch commit.

**Test scenarios:**
- Domestic deploy script receives an explicit commit hash.
- The deployed commit equals the promoted commit.
- Rollback can target the previous deployed commit.

**Verification:**
- `DEPLOYED_COMMIT` on domestic VPS matches the selected tag/commit.

- [x] **Unit 4: Add domestic deployment documentation**

**Goal:** Make the workflow repeatable without relying on memory.

**Files:**
- Modify: `docs/RUNBOOK.md`
- Modify or create: `docs/domestic-vps-deployment.md`

**Approach:**
- Document domestic host, domain, env-file policy, deploy command shape, verification steps, smoke steps, rollback steps, and data separation rules.
- Keep secrets out of docs.

**Test scenarios:**
- A deployer can identify which environment a command targets before running it.
- The doc makes it clear that domestic deploys must use a committed release, not dirty local files.

**Verification:**
- Dry-read the runbook and confirm it distinguishes local, overseas VPS, and domestic VPS.

## Recommended Operator Workflow

1. Develop and test locally.
2. Commit and push.
3. Deploy the commit to overseas VPS staging.
4. Run server/web typechecks, targeted tests, VPS runtime verification, and public smoke.
5. Promote that exact commit to a domestic release tag or branch.
6. Deploy the domestic VPS from the promoted commit.
7. Verify domestic VPS independently.

## Codex Workspace Guidance

- Do not open a second Codex window in the same working folder for parallel changes.
- If a separate Codex session is useful for domestic deployment work, create a separate Git worktree or clean clone.
- Use the same repository history, not a manually copied project directory.
- Prefer one Codex session for planning and one clean worktree session for operational deployment if long-running server setup is needed.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Domestic VPS accidentally receives unstable development commits | Deploy only explicit release tags or a protected `release/cn` branch |
| Domestic and overseas environments drift | Reuse the same deployment scripts and verify scripts |
| Debugging becomes harder due to separate code copies | Keep one repository and immutable commit-based deployment |
| Data or credentials cross environments | Use separate DB/Redis/upload storage/secrets per environment |
| Domain/runtime config mistakes | Require `verify-cloud-runtime.sh` and public smoke after deploy |

## Open Questions

- Complete or confirm the applicable ICP/public-security filing and retain the resulting operational record outside the repository.
- Domestic upload backend choice: existing OSS/R2 style backend or a domestic object storage provider.
- Configure and test the approved Aliyun SMS sign/template after the first administrator exists.
- Replace the temporary certificate notification address with a monitored operator email.
- Whether we should add a dedicated `deploy-domestic-app-dir.sh` wrapper to reduce command mistakes.

## Sources & References

- `scripts/deploy-app-dir.sh`
- `scripts/verify-cloud-runtime.sh`
- `scripts/diagnose-runtime-env.sh`
- `scripts/init-server.sh`
- `docs/RUNBOOK.md`
- `docs/vps-deployment.md`
