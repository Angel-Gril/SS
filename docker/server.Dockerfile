FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/server apps/server

RUN pnpm --filter server db:generate
RUN pnpm --filter server build
RUN pnpm deploy --legacy --filter server --prod /prod/server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /prod/server ./
COPY docker/migrate-and-verify-ai-media-dark.sh ./scripts/migrate-and-verify-ai-media-dark.sh
COPY docker/verify-ai-media-dark.mjs ./scripts/verify-ai-media-dark.mjs
COPY apps/server/scripts/ai-media-suite-post-migration-contract.mjs ./scripts/ai-media-suite-post-migration-contract.mjs
COPY apps/server/scripts/verify-ai-media-suite-post-migration.mjs ./scripts/verify-ai-media-suite-post-migration.mjs
COPY scripts/verify-ai-media-dark-policy.mjs ./scripts/verify-ai-media-dark-policy.mjs
COPY scripts/verify-extension-byok-rollout-policy.mjs ./scripts/verify-extension-byok-rollout-policy.mjs

EXPOSE 3001
CMD ["node", "dist/index.js"]
