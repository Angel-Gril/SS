FROM node:22-bookworm-slim AS build

ARG DEPLOY_SOURCE_ARCHIVE_SHA256
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY .ss-erp-source.tar /tmp/ss-erp-source.tar
RUN case "$DEPLOY_SOURCE_ARCHIVE_SHA256" in *[!0-9a-f]*|'') exit 1;; esac \
  && [ "${#DEPLOY_SOURCE_ARCHIVE_SHA256}" -eq 64 ] \
  && printf '%s  %s\n' "$DEPLOY_SOURCE_ARCHIVE_SHA256" /tmp/ss-erp-source.tar | sha256sum -c - \
  && tar -xf /tmp/ss-erp-source.tar -C /app \
  && rm -f /tmp/ss-erp-source.tar
RUN pnpm install --frozen-lockfile
RUN pnpm --filter server db:generate
RUN pnpm --filter server build
RUN pnpm deploy --legacy --filter server --prod /prod/server

FROM node:22-bookworm-slim AS runtime

ARG DEPLOY_TARGET_GIT_COMMIT
ARG DEPLOY_SOURCE_ARCHIVE_SHA256
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
RUN case "$DEPLOY_TARGET_GIT_COMMIT" in *[!0-9a-f]*|'') exit 1;; esac \
  && [ "${#DEPLOY_TARGET_GIT_COMMIT}" -eq 40 ] \
  && case "$DEPLOY_SOURCE_ARCHIVE_SHA256" in *[!0-9a-f]*|'') exit 1;; esac \
  && [ "${#DEPLOY_SOURCE_ARCHIVE_SHA256}" -eq 64 ] \
  && printf '%s\n' "$DEPLOY_TARGET_GIT_COMMIT" > DEPLOYED_COMMIT \
  && printf '%s\n' "$DEPLOY_SOURCE_ARCHIVE_SHA256" > DEPLOYED_SOURCE_ARCHIVE_SHA256

COPY --from=build /prod/server ./
COPY --from=build /app/docker/migrate-and-verify-ai-media-dark.sh ./scripts/migrate-and-verify-ai-media-dark.sh
COPY --from=build /app/docker/verify-ai-media-dark.mjs ./scripts/verify-ai-media-dark.mjs
COPY --from=build /app/scripts/deploy-backup-attestation.mjs ./scripts/deploy-backup-attestation.mjs
COPY --from=build /app/scripts/deploy-backup-gate.mjs ./scripts/deploy-backup-gate.mjs
COPY --from=build /app/scripts/deploy-database-identity.mjs ./scripts/deploy-database-identity.mjs
COPY --from=build /app/scripts/deploy-environment.mjs ./scripts/deploy-environment.mjs
COPY --from=build /app/scripts/deploy-source-manifest.mjs ./scripts/deploy-source-manifest.mjs
COPY --from=build /app/scripts/freeze-deploy-source.sh ./scripts/freeze-deploy-source.sh
COPY --from=build /app/scripts/verify-deploy-backup.sh ./scripts/verify-deploy-backup.sh
COPY --from=build /app/apps/server/scripts/ai-media-suite-post-migration-contract.mjs ./scripts/ai-media-suite-post-migration-contract.mjs
COPY --from=build /app/apps/server/scripts/verify-ai-media-suite-post-migration.mjs ./scripts/verify-ai-media-suite-post-migration.mjs
COPY --from=build /app/scripts/verify-ai-media-dark-policy.mjs ./scripts/verify-ai-media-dark-policy.mjs
COPY --from=build /app/scripts/verify-extension-byok-rollout-policy.mjs ./scripts/verify-extension-byok-rollout-policy.mjs

EXPOSE 3001
CMD ["node", "dist/index.js"]
