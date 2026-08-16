FROM node:22.14.0-bookworm-slim AS build
WORKDIR /app
COPY contabo/app-api/package.json ./package.json
RUN npm install --ignore-scripts --no-audit --no-fund
COPY contabo/app-api/tsconfig.json ./tsconfig.json
COPY contabo/app-api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8788
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER appuser
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
