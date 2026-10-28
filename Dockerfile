# AtlasPad indexer image (Railway, Render and Fly pick up a root Dockerfile automatically). Build from the repository root:
#   docker build -t atlaspad-indexer .
# Runs on PORT (injected by the host) or INDEXER_PORT (default 4100). See ENVIRONMENT.md for the variables.
FROM node:22-slim
WORKDIR /app
RUN corepack enable

# Only what the indexer needs: the workspace manifests first (cached install layer), then the sources.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/indexer/package.json apps/indexer/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@atlaspad/indexer..."

COPY packages packages
COPY apps/indexer apps/indexer
RUN pnpm --filter @atlaspad/indexer build

WORKDIR /app/apps/indexer
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
