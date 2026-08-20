# VPS Release Deployment

This project can keep the current single-server systemd model. There are three supported update paths:

1. existing app-dir tar deployment at `/opt/ss-erp/app`
2. direct Git checkout deployment at `/opt/ss-erp`
3. release directory deployment with `/opt/ss-erp/current`

## Current Production Release (2026-08-20)

- Both COM and CN production VPS deployments are bound to immutable commit
  `d27b3ad855bb7bc373cb168b2861100c4aeea61e`. Application services are active and `/ready`
  reports database and Redis readiness. Extension `1.0.311` is deployed dark; the website
  publication pointer is CAS-activated to `1.0.311` (COM approval
  `a65fa010239033550694437c97844f943648cdc6f53f0c82d622684b7ca5d4d5`, CN approval
  `0e481fb68068409a57997c087f98711cb072c86a06c7f0e82fe4b9d9ab86f4f0`).
- The approved deployment run is `rel04-d27b3ad8-311-20260819`, using deployment helper
  `83fe9f907ee9189cbce82d7dd6e4780f2539607c64260b2d749e5a987cd6c868`. The dual-region summary
  SHA-256 is `4da008349ff0de62c85bea2a35df6157500eab6f5a29950dfa2f36f7f554fd06`.
  The externally signed candidates use Ed25519 key ID `ss-erp-extension-release-2026-08-02-01`;
  COM/CN signature SHA-256 values are
  `f566956d399a8e577844bd7a7cec2a399e5a0813bf25b60ca09e741f243c289b` and
  `e89f25a983db42c533b776598f04c6570dab6e60d928947d03d48a8881043b07`.
  Target-bound backup/restore authentication, 146 migration checks, service restart, health
  checks, and the `7/32` REL-04 dark canary passed. COM's eight AI/BYOK settings were temporarily
  darkened with revision+value-hash CAS and restored.
- CN backup/restore evidence is currently local-only because remote backup storage is not
  configured. This did not block the approved dark deployment, but it remains an operational
  hardening item before long-term production operation.
- The 1.0.311 publication receipt and local final verifier were generated, but the DNS-quorum
  closure's read-only remote verifiers did not close: COM still reports BYOK settings as non-dark,
  and CN reports backup/restore evidence older than 36 hours. No pointer rollback was attempted.
  The 1.0.311 BINI same-path upgrade and active-worker/Unicode closure have not been executed;
  they require a separate approval and must remain independent from website publication.
- No Provider request, ERP ingest/publish, Ozon write, or pilot operation was executed. Before a
  real pilot, narrow the COM BYOK policy to the exact owner/shop/device/origin/operation and obtain
  separate approval for the draft revision, offer prefix, rollback command, and responsible operator.

Any later documentation-only commit records this state; it does not change the production release
binding, feature flags, or publication pointer.

Do not mix the three in one deploy. First identify which path systemd is currently using:

```bash
systemctl cat ss-erp-api ss-erp-web ss-erp-worker | grep -E 'WorkingDirectory|EnvironmentFile'
```

The current VPS can run from `/opt/ss-erp/app`; use the app-dir deploy script for that shape.

## Existing App-Dir Deployment

Use this when systemd points to:

```ini
WorkingDirectory=/opt/ss-erp/app/apps/server
EnvironmentFile=/opt/ss-erp/app/.env.staging
```

## Commit-Bound Deploy Rule

Production fixes must be commit-bound:

1. fix and verify locally
2. commit and push the branch
3. deploy that exact commit to the VPS
4. verify `/ready`, the relevant smoke test, and the deployed commit marker

Do not patch application source directly under `/opt/ss-erp/app`, `/opt/ss-erp`, or `/opt/ss-erp/current`. Temporary diagnostic files are fine, but the durable fix must live in Git first. This keeps local code, GitHub, and the VPS rebuildable from the same commit.

Extension release operations use five independent approvals: production package, external release
signature, production deploy/dark canary, website publication plus same-path upgrade, and the pilot.
These approvals are operationally independent and non-transitive. The current release signature,
website approval, and distribution receipt use domain-separated payloads under the same active
Ed25519 key and keyring; they are not separate cryptographic trust domains.
The exact order is `package -> external release sign -> deploy/dark canary -> sign website approval
-> activate pointer -> distribution probe -> final verify -> same-path upgrade -> independently
approved pilot`. Deployment never activates
`/var/lib/ss-erp-extension-publications/current.website-publication-approval.json`. During the dark
gate, `/api/extensions/latest` may be 404 or may continue to serve a previously approved commit; it
must not expose the new `DEPLOYED_COMMIT` until the separate website-publication approval is signed.

Deploy the latest local commit from your workstation:

```bash
DEPLOY_HOST=45.76.49.64 \
DEPLOY_USER=root \
SSH_KEY=~/.ssh/ss_erp_vultr_sg \
DEPLOY_ENV_PROFILE=cloud-r2 \
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
./scripts/deploy-app-dir.sh
```

The script packages the requested commit, uploads it to the server, builds it in a temporary directory, copies the current `.env.staging`, verifies a fresh commit/database/restore-bound backup attestation, runs migrations, swaps `/opt/ss-erp/app`, restarts services, and checks `/ready`.

Deploy a specific commit:

```bash
DEPLOY_HOST=45.76.49.64 SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 \
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
./scripts/deploy-app-dir.sh <full-target-commit>
```

Every migration requires a separate pre-deploy backup and restore drill. Set the same stable
`DEPLOY_DATABASE_ID` in the application env and `/etc/ss-erp-backup.env`, then run these commands
on the VPS from a checkout containing the target revision's scripts:

```bash
TARGET_COMMIT=<lowercase-full-40-character-commit>
set -a
. /opt/ss-erp/app/.env.staging
. /etc/ss-erp-backup.env
set +a
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/backup-db.sh
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/verify-backup-restore.sh
bash scripts/verify-deploy-backup.sh "$TARGET_COMMIT"
```

This creates a real gzip, an immutable canonical `.status.json` sidecar, and a `0600`
`deploy-backup-<commit>.attestation.json` only after a temporary database restore reports a positive
table count and is successfully removed. The backup and application URLs must query the same actual
database name, database OID and database-stored deployment UUID; their network routes may differ.
The maintenance route also writes a random marker into the temporary database, and the restore URL
must read the exact marker before import and again before deletion. This rejects same-named databases
reached through different hosts. When evidence for the same commit expires, rerun the drill as root:
the old attestation is archived byte-for-byte under a SHA-256-qualified name before a new current
pointer is created. Do not manually delete or overwrite the current attestation.
Credentials and Prisma-only query parameters are
not retained in evidence. The deployment re-hashes and gunzips those exact bytes before Prisma can run. For the
first rollout of this gate, copy or check out `backup-db.sh`, `verify-backup-restore.sh`,
`verify-deploy-backup.sh`, `deploy-backup-attestation.mjs`, `deploy-database-identity.mjs`,
`postgres-connection-environment.mjs`, and `run-postgres-command.mjs` from the target revision into
a private operator directory; do not use an older deployed backup script.
Archive deploys install the eleven runtime gate files plus the commit marker automatically. A Git
checkout deployment must first follow the root-owned gate archive/install procedure in
`docs/deployment.md`; `deploy-staging.sh` fails before dependencies or service quiescence when that
exact target gate is absent. It always rebuilds the target and no longer supports `--skip-build`.

`DEPLOY_ENV_PROFILE=cloud-r2` now validates two layers:

1. bootstrap env in `.env.staging`: service startup, database, Redis, auth, cloud mode, and public API base URL
2. upload runtime config after Prisma migration: super-admin `SystemConfig` (`upload_storage_backend=oss` + `upload_oss_*`) or env fallback (`IMAGE_STORAGE_BACKEND=oss` + `OSS_*`)

This means R2 does not have to be duplicated into `.env.staging` when the super-admin settings already contain the upload OSS/R2 config. If you choose env fallback instead of super-admin configuration, write the R2 values on the VPS:

```bash
cd /opt/ss-erp/app
export OSS_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
export OSS_BUCKET='ss-erp-assets'
export OSS_ACCESS_KEY_ID='...'
export OSS_ACCESS_KEY_SECRET='...'
export OSS_REGION='auto'
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/configure-cloud-r2-env.sh
```

If the current server version does not have this script yet, copy it first:

```bash
scp -i ~/.ssh/ss_erp_vultr_sg scripts/configure-cloud-r2-env.sh root@45.76.49.64:/opt/ss-erp/app/scripts/
```

After deploying:

```bash
ssh -i ~/.ssh/ss_erp_vultr_sg root@45.76.49.64
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging EXPECTED_PROFILE=cloud-r2 bash scripts/verify-deploy-readiness.sh
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false \
VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false \
DEPLOY_DIR=/opt/ss-erp/app ./scripts/verify-vps-deploy.sh
```

`verify-cloud-runtime.sh` checks bootstrap env first, then runs `diagnose-runtime-env.sh`, which accepts either complete super-admin upload config or complete env OSS fallback.

Then from the local repository:

```bash
pnpm preflight --remote-oss
```

For R2 this only passes when `/api/extension/runtime` reports `mode:"cloud"` and `capabilities.imageUpload:"oss"`, and the upload response returns `backend:"oss"`.

## Human Challenge Rollout Gate

Configure the effective human-challenge provider before deploying an auth change. Explicit environment variables override the super-admin `SystemConfig`; do not maintain conflicting values in both places.

International deployment:

```env
HUMAN_CHALLENGE_PROVIDER=cloudflare-turnstile
TURNSTILE_SECRET_KEY=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_ALLOWED_HOSTNAMES=ss-erp.com,www.ss-erp.com,app.ss-erp.com,admin.ss-erp.com
```

Domestic deployment:

```env
HUMAN_CHALLENGE_PROVIDER=builtin-pow
HUMAN_CHALLENGE_SIGNING_SECRET=<at-least-32-random-characters>
HUMAN_CHALLENGE_POW_DIFFICULTY=4
HUMAN_CHALLENGE_TTL_SECONDS=120
```

Turnstile is fail-closed when the exact hostname allowlist is empty or invalid. Before switching an international release, open the super-admin integrations page and confirm the effective provider, Site Key, Secret Key, and hostname count. For the domestic deployment, confirm a challenge can be issued and consumed once for each auth action. Never silently fall back to `disabled` when an external verifier is unavailable.

## Domestic Direct-Origin HTTPS

The domestic `.cn` deployment is DNS-direct and must not use the Cloudflare origin guard from `docker/nginx/ss-erp.conf`. Use the tracked direct-origin template instead:

```text
docker/nginx/ss-erp-cn-direct.conf
```

It has separate default virtual hosts that reject unknown Host values, allowlists the four `.cn` application domains, redirects allowlisted HTTP requests to HTTPS, serves the ACME HTTP-01 webroot, and proxies only to loopback API/Web upstreams. The installed certificate paths are:

```text
/etc/ssl/certs/ss-erp.cn.fullchain.pem
/etc/ssl/private/ss-erp.cn.key
```

Set the domestic build-time hosts in `/opt/ss-erp/app/.env.staging` before deploying a commit. The Web middleware and cloud extension package are compiled from these values:

```env
NEXT_PUBLIC_USER_HOSTNAME=app.ss-erp.cn
NEXT_PUBLIC_ADMIN_HOSTNAME=admin.ss-erp.cn
NEXT_PUBLIC_MARKETING_HOSTNAME=ss-erp.cn
EXTENSION_CLOUD_BASE_URL=https://app.ss-erp.cn
```

After installing or renewing a certificate, validate and reload Nginx:

```bash
nginx -t
systemctl reload nginx
```

Run the VPS verifier in direct mode with the complete public hostname allowlist. This requires active Nginx routing to reject unknown HTTP and HTTPS Host values, preserve the unredirected ACME HTTP-01 location, redirect each allowlisted HTTP host to HTTPS, and return a certificate-valid `/ready` response for every hostname. It also requires listeners on `80/443`, an active UFW installation and rules, loopback-only application/data ports, and an `acme.sh --cron` crontab entry or equivalent systemd timer. The domestic deployment uses external Aliyun RDS, so `VERIFY_EXPECT_LOCAL_POSTGRES=false` requires local port `5432` to remain closed while Prisma and `/ready` validate the configured RDS. Direct mode does not require Cloudflare real-IP configuration or its IP-update cron:

```bash
cd /opt/ss-erp/app
VERIFY_ORIGIN_MODE=direct \
VERIFY_DIRECT_HOSTNAMES=ss-erp.cn,www.ss-erp.cn,app.ss-erp.cn,admin.ss-erp.cn \
VERIFY_EXPECT_LOCAL_POSTGRES=false \
VERIFY_DOMAIN=ss-erp.cn \
VERIFY_READY_URL=https://ss-erp.cn/ready \
DEPLOY_DIR=/opt/ss-erp/app \
ENV_FILE=.env.staging \
bash scripts/verify-cloud-runtime.sh
```

The default verifier mode remains `cloudflare`, so the international VPS keeps its existing checks without additional arguments. Missing UFW is a deployment failure in both modes. Do not use `curl -k`, omit a SAN hostname from `VERIFY_DIRECT_HOSTNAMES`, or downgrade the public readiness URL to HTTP to make verification pass.

## Release/Symlink Deployment

Use this after you intentionally switch systemd to `/opt/ss-erp/current`.

```text
/opt/ss-erp/
├── releases/
│   ├── 9538dc9/
│   └── nextcommit/
├── current -> /opt/ss-erp/releases/nextcommit
└── shared/
    ├── .env.staging
    ├── uploads/
    └── backups/
```

## When To Use This

Use release/symlink deployment for the VPS production/early SaaS phase when rollback speed matters:

- one VPS runs Nginx, Web, API, Worker, PostgreSQL, and Redis
- services are still managed by systemd
- deploys need a quick rollback path without introducing Kubernetes or a deploy panel
- the existing app-dir path can stay in use until you intentionally migrate

## VPS sizing and tuning

For the current user scale, a single VPS is still the default recommendation:

- `2C4G` is enough for small-stage testing or light production if builds are done off-box
- `4C8G` is safer when API, Web, Worker, PostgreSQL, and Redis share one machine
- add swap before reaching for bigger architecture changes
- keep API/Web loopback-only and expose only `80/443`
- split worker first when queue backlog or sync jobs start interfering with request latency

## Initialize Server

Run once on the server:

```bash
DEPLOY_BASE=/opt/ss-erp DEPLOY_USER=deploy DEPLOY_BUILD_USER=ss-erp-build \
  ENV_FILE_NAME=.env.staging bash scripts/init-server.sh
```

The initializer keeps `/opt/ss-erp`, `/opt/ss-erp/releases`, and `/opt/ss-erp/shared` root-owned
`0755`. Only the managed `shared/uploads` and `shared/backups` children are writable by `deploy`;
the environment file is root-owned, group-readable by the deploy user's primary group, and `0640`.
It creates or validates a distinct non-root `ss-erp-build` UID/GID with no runtime-group identity,
provisions root-owned per-project Compose lock files in `/var/lib/ss-erp-deploy-locks`, and creates
the shared systemd-build lock plus protected disk-backed build root at
`/var/lib/ss-erp-deploy-build`. The build root is `root:root 0711`; each deployment creates one
random build-user-owned `0700` child while secret environment snapshots remain under `/run`.
Systemd deployment entrypoints hold the shared lock for their full lifetime and safely remove only
validated non-mounted stale children left by an interrupted prior build.
Older installations that recursively assigned the whole base to `deploy` must rerun the hardened
initializer once before the next archive deployment. It rejects pre-existing symlinks and hard-linked
env files before root changes ownership, then repairs only verified real paths:

```bash
DEPLOY_BASE=/opt/ss-erp DEPLOY_USER=deploy DEPLOY_BUILD_USER=ss-erp-build ENV_FILE_NAME=.env.staging \
  bash scripts/init-server.sh
```

Then copy the current environment file into:

```text
/opt/ss-erp/shared/.env.staging
```

## Systemd Working Directories

Release deployment expects services to start from the symlink:

```ini
WorkingDirectory=/opt/ss-erp/current/apps/server
EnvironmentFile=/opt/ss-erp/shared/.env.staging
ExecStart=/usr/bin/node dist/index.js
```

```ini
WorkingDirectory=/opt/ss-erp/current/apps/server
EnvironmentFile=/opt/ss-erp/shared/.env.staging
ExecStart=/usr/bin/node dist/worker.js
```

```ini
WorkingDirectory=/opt/ss-erp/current/apps/web
EnvironmentFile=/opt/ss-erp/shared/.env.staging
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
```

`deploy.sh` performs the first unit transition itself. After it switches `current`, but before any
service restart, it validates the release templates with `systemd-analyze`, snapshots the existing
unit files under `/var/lib/ss-erp-deploy-systemd-snapshots/<target-commit>`, installs them atomically,
reloads systemd, and checks the effective `FragmentPath`, `WorkingDirectory`, `EnvironmentFiles`,
and `ExecStart`. After restart it also verifies every main process cwd resolves into the target
release before accepting `/ready`. Health acceptance is bounded to 30 attempts with a fixed
one-second delay and two-second request timeout. API readiness accepts only HTTP `200`; the
in-place Web check accepts only HTTP `200` or `302`. The retry count cannot be expanded through an
environment variable. A failed install, restart, process check, or health check restores the
previous unit snapshot; the first release does not depend on a nonexistent previous symlink.

The release and app-dir deployers keep the same bounded status check inline as a compatibility
fallback when an explicitly selected historical target predates `scripts/deploy-health-check.sh`.
The in-place staging deployer instead runs the helper from the just-verified target checkout. If a
post-restart health check fails after staging leaves maintenance, its EXIT path re-enters and
verifies only the last root-owned, content-verified maintenance gate, stops all three services, and
requires operator recovery. It never executes a newly fetched but rejected target gate as root.

Use the installer directly only for an audited manual recovery, with a new root-only snapshot path:

```bash
DEPLOY_BASE=/opt/ss-erp ENV_FILE_NAME=.env.staging \
UNIT_SNAPSHOT_DIR=/var/lib/ss-erp-deploy-systemd-snapshots/manual-<unique-id> \
  bash scripts/install-release-systemd.sh --restart
```

Do not install release units before `current` points to a sealed full-commit release. To restore a
retained snapshot without restarting services, run the same command with `--restore` instead of
`--restart`, inspect the effective units, and then restart explicitly.

The older `deploy/systemd/*.service` templates are for a direct git checkout at `/opt/ss-erp` and read `/opt/ss-erp/.env.staging`. Do not use those templates with `/opt/ss-erp/current`, otherwise the running process can keep reading the wrong env file and stay in local mode even after R2 values are added.

The service names used by the scripts default to the existing names:

- `ss-erp-api`
- `ss-erp-worker`
- `ss-erp-web`

Override them with `API_SERVICE`, `WORKER_SERVICE`, and `WEB_SERVICE` if needed.

## Deploy

From the local repository:

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 \
./scripts/deploy.sh
```

When a region is reachable only through an audited jump host, keep the host blocks and their
separate identity files in one protected OpenSSH config outside the repository. Set
`SSH_CONFIG_FILE` to its absolute path and set `DEPLOY_HOST` to the target alias. The deployer passes
that file to both `ssh` and `scp` with `-F`; do not embed a `ProxyCommand`, private-key value, or
credential in a command argument. Keep strict host-key checking enabled for both hops.

Deploy a specific commit:

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 \
./scripts/deploy.sh <full-target-commit>
```

The script:

1. packages the commit with `git archive`
2. uploads it to `/tmp`
3. extracts it into `/opt/ss-erp/releases/<commit>` and installs the immutable root-owned target gate
4. links shared `.env.staging`, uploads, and application-managed backups
5. snapshots env once as root, gives builds only a public allowlist and a non-connectable database URL
6. installs dependencies, builds Server/Web, and stages the exact prebuilt `REL-03` extension candidate as the isolated `ss-erp-build` UID/GID
7. records pre/post source manifests, seals the tree onto new root-owned inodes, and re-verifies both
8. stops Worker/API and has the target gate verify backup evidence, migrate, and run the database guard
9. verifies runtime configuration and the dark rollout
10. switches `/opt/ss-erp/current`
11. restarts worker, API, and web services
12. checks `/ready` and rolls back the application symlink if the health check fails

## Roll Back

Roll back to the previous release:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg ./scripts/rollback.sh
```

Roll back to a specific release:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg ./scripts/rollback.sh 9538dc9
```

Rollback switches the symlink, restarts services, and checks `/ready`.

If the VPS is itself a git checkout and you want the lowest-friction update path, use:

```bash
cd /opt/ss-erp
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
```

That path is available only after the exact target gate is installed from a root-owned revision
archive as described above. The release/symlink path is preferred when you want immutable releases
and one-command application rollback.

All three systemd deployment modes require the exact four-file extension candidate to be installed
under the supplied root-owned `EXTENSION_RELEASE_ROOT` first, plus the externally signed JSON and its
operator-approved SHA-256 sidecar at the paths shown above. Replace every angle-bracket placeholder
with the approved release values before execution; deployment re-verifies and copies that candidate and
signature, and never rebuilds or increments the extension version. A command without both signature
variables is intentionally rejected.

After switching to release mode, the root backup cron must invoke
`/opt/ss-erp/current/scripts/backup-db.sh` and explicitly set
`BACKUP_DEPLOYED_COMMIT_FILE=/opt/ss-erp/current/DEPLOYED_COMMIT`. The VPS verifier rejects an
active `/opt/ss-erp/app/scripts/backup-db.sh` cron because that old script can overwrite current
target/database-bound backup evidence with a legacy schema.

## Important Notes

- Database migrations are not automatically reversed. Rollback restores application code, not database schema.
- Keep migrations backwards-compatible whenever possible.
- The current smoke and verification scripts still apply after deploying:

```bash
VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false \
VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false \
DEPLOY_DIR=/opt/ss-erp/current ./scripts/verify-vps-deploy.sh
cd /opt/ss-erp/current/apps/server && SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
```

For release-mode deployments, run diagnostics against the active symlink and shared env file:

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

Recommended deploy and publication order:

1. With the production-build approval, freeze the full target commit, create each regional package,
   and create its database/restore-bound backup attestation.
2. With a separate signing approval, externally sign the immutable regional release candidate and
   verify the approved signature digest.
3. With the deploy/dark-canary approval, use one standard deployment entrypoint. Let it build,
   quiesce services, verify evidence, migrate, and enforce the dark gate; then run `/ready`,
   `smoke:live`, and `VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false
   VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false verify-vps-deploy.sh`.
4. Run the target-bound `canary:rel04:dark` contract from `docs/deployment.md`; retain its private
   mode-0600 summary and verify cleanup. The dark verifier must show that the new deployed commit is
   not the live website publication; an older approved pointer may remain active.
5. With the independent website-publication approval, sign the exact release-signature and dark-canary
   evidence outside the VPS. Never upload the private key. Install only the approval and dark-canary
   as root-owned staging inputs, then atomically activate the pointer with its expected old approval
   SHA-256 CAS value using the active deployment's sealed candidate, signature, and SHA sidecar.
6. Run the exact regional website distribution probe with both `--approval` and `--dark-canary`, then
   run the publication verifier with the same two inputs. Re-run the VPS verifier with the immutable
   cloud-package expectation unchanged and `VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=true`.
7. Only after final publication verification, replace the managed extension directory in place,
   reload it, and retain the active-worker, Unicode smoke, and full same-path upgrade evidence.
8. Execute any Provider or Ozon write only under the fifth, independently approved pilot binding.

## Existing Non-Release Deploy

The older `/opt/ss-erp/app` tar deployment can continue to run until you intentionally switch systemd services to `/opt/ss-erp/current`. Do not mix both modes in one deploy.
