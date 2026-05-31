# VPS Release Deployment

This project can keep the current single-server systemd model while gaining fast rollback by deploying each build into a release directory and switching a `current` symlink.

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

Use this for the VPS production/early SaaS phase:

- one VPS runs Nginx, Web, API, Worker, PostgreSQL, and Redis
- services are still managed by systemd
- deploys need a quick rollback path without introducing Kubernetes or a deploy panel
- the simplest GitHub-based flow is still a normal git checkout plus `deploy-staging.sh`

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
DEPLOY_BASE=/opt/ss-erp DEPLOY_USER=deploy ENV_FILE_NAME=.env.staging bash scripts/init-server.sh
```

Then copy the current environment file into:

```text
/opt/ss-erp/shared/.env.staging
```

## Systemd Working Directories

Release deployment expects services to start from the symlink:

```ini
WorkingDirectory=/opt/ss-erp/current/apps/server
ExecStart=/usr/bin/node dist/index.js
```

```ini
WorkingDirectory=/opt/ss-erp/current/apps/server
ExecStart=/usr/bin/node dist/worker.js
```

```ini
WorkingDirectory=/opt/ss-erp/current/apps/web
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
```

The service names used by the scripts default to the existing names:

- `ss-erp-api`
- `ss-erp-worker`
- `ss-erp-web`

Override them with `API_SERVICE`, `WORKER_SERVICE`, and `WEB_SERVICE` if needed.

## Deploy

From the local repository:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root ./scripts/deploy.sh
```

Deploy a specific commit:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root ./scripts/deploy.sh 9538dc9
```

The script:

1. packages the commit with `git archive`
2. uploads it to `/tmp`
3. extracts it into `/opt/ss-erp/releases/<commit>`
4. links shared `.env.staging`, uploads, and backups
5. runs `pnpm install --frozen-lockfile`
6. runs Prisma generate and migrations
7. builds server and web
8. switches `/opt/ss-erp/current`
9. restarts worker, API, and web services
10. checks `/ready`
11. rolls back automatically if the health check fails

## Roll Back

Roll back to the previous release:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root ./scripts/rollback.sh
```

Roll back to a specific release:

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root ./scripts/rollback.sh 9538dc9
```

Rollback switches the symlink, restarts services, and checks `/ready`.

If the VPS is itself a git checkout and you want the lowest-friction update path, use:

```bash
cd /opt/ss-erp
./scripts/deploy-staging.sh
```

That path is good for small teams and fast iteration. The release/symlink path is better when you want immutable releases and one-command rollback.

## Important Notes

- Database migrations are not automatically reversed. Rollback restores application code, not database schema.
- Keep migrations backwards-compatible whenever possible.
- The current smoke and verification scripts still apply after deploying:

```bash
./scripts/verify-vps-deploy.sh
cd apps/server && SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
```

Recommended deploy order:

1. backup database
2. publish commit / pull branch
3. migrate database
4. build
5. restart services
6. run `/ready`
7. run `smoke:live`
8. run `verify-vps-deploy.sh`

## Existing Non-Release Deploy

The older `/opt/ss-erp/app` tar deployment can continue to run until you intentionally switch systemd services to `/opt/ss-erp/current`. Do not mix both modes in one deploy.
