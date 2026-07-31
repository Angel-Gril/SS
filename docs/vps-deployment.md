# VPS Release Deployment

This project can keep the current single-server systemd model. There are three supported update paths:

1. existing app-dir tar deployment at `/opt/ss-erp/app`
2. direct Git checkout deployment at `/opt/ss-erp`
3. release directory deployment with `/opt/ss-erp/current`

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

Deploy the latest local commit from your workstation:

```bash
DEPLOY_HOST=45.76.49.64 \
DEPLOY_USER=root \
SSH_KEY=~/.ssh/ss_erp_vultr_sg \
DEPLOY_ENV_PROFILE=cloud-r2 \
./scripts/deploy-app-dir.sh
```

The script packages the requested commit, uploads it to the server, builds it in a temporary directory, copies the current `.env.staging`, verifies a fresh commit/database/restore-bound backup attestation, runs migrations, swaps `/opt/ss-erp/app`, restarts services, and checks `/ready`.

Deploy a specific commit:

```bash
DEPLOY_HOST=45.76.49.64 SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-app-dir.sh 4b47043
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
`verify-deploy-backup.sh`, `deploy-backup-attestation.mjs`, and `deploy-database-identity.mjs` from
the target revision into a private operator directory; do not use an older deployed backup script.
Archive deploys install the seven runtime gate files plus the commit marker automatically. A Git
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
and provisions root-owned per-project Compose lock files in `/var/lib/ss-erp-deploy-locks`.
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

Install the release-mode unit templates when switching to the symlink deployment:

```bash
DEPLOY_BASE=/opt/ss-erp ENV_FILE_NAME=.env.staging bash scripts/install-release-systemd.sh --restart
```

The older `deploy/systemd/*.service` templates are for a direct git checkout at `/opt/ss-erp` and read `/opt/ss-erp/.env.staging`. Do not use those templates with `/opt/ss-erp/current`, otherwise the running process can keep reading the wrong env file and stay in local mode even after R2 values are added.

The service names used by the scripts default to the existing names:

- `ss-erp-api`
- `ss-erp-worker`
- `ss-erp-web`

Override them with `API_SERVICE`, `WORKER_SERVICE`, and `WEB_SERVICE` if needed.

## Deploy

From the local repository:

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh
```

Deploy a specific commit:

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh <full-target-commit>
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
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
```

That path is available only after the exact target gate is installed from a root-owned revision
archive as described above. The release/symlink path is preferred when you want immutable releases
and one-command application rollback.

All three systemd deployment modes require the exact four-file extension candidate to be installed
under the supplied root-owned `EXTENSION_RELEASE_ROOT` first. Deployment re-verifies and copies that
candidate; it never rebuilds or increments the extension version.

## Important Notes

- Database migrations are not automatically reversed. Rollback restores application code, not database schema.
- Keep migrations backwards-compatible whenever possible.
- The current smoke and verification scripts still apply after deploying:

```bash
DEPLOY_DIR=/opt/ss-erp/current ./scripts/verify-vps-deploy.sh
cd /opt/ss-erp/current/apps/server && SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
```

For release-mode deployments, run diagnostics against the active symlink and shared env file:

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

Recommended deploy order:

1. freeze the full target commit and create its database/restore-bound backup attestation
2. publish the commit and use one standard deployment entrypoint
3. let that entrypoint build, quiesce services, verify evidence, migrate, and enforce the dark gate
4. run `/ready`
5. run `smoke:live`
6. run `verify-vps-deploy.sh`

## Existing Non-Release Deploy

The older `/opt/ss-erp/app` tar deployment can continue to run until you intentionally switch systemd services to `/opt/ss-erp/current`. Do not mix both modes in one deploy.
