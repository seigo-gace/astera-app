# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 10001 appuser \
  && useradd --system --uid 10001 --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser \
  && mkdir -p /app \
  && chown -R appuser:appuser /app

COPY --chown=appuser:appuser package.json package-lock.json* ./
COPY --from=build-deps /app/node_modules ./node_modules
COPY --chown=appuser:appuser --from=build /app/dist ./dist
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser migrations ./migrations
COPY --chown=appuser:appuser --from=build /app/tests ./tests
COPY --chown=appuser:appuser --from=build /app/vitest.config.ts ./vitest.config.ts
COPY --chown=appuser:appuser --from=build /app/tsconfig.json ./tsconfig.json

USER appuser
EXPOSE 8788
HEALTHCHECK --interval=10s --timeout=3s --retries=10 --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8788/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/system/server.js"]
