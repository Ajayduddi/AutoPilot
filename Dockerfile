FROM oven/bun:1.3.11-alpine AS build

WORKDIR /app

# Copy workspace manifests first for cache-friendly install
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile

# Copy sources and build
COPY . .
RUN bun run build


FROM oven/bun:1.3.11-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV HOME=/home/autopilot
ENV FRONTEND_STATIC_DIR=/app/public
ENV AUTOPILOT_HOME=/home/autopilot/.autopilot

# Minimal manifests needed to install backend production deps
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/src packages/shared/src

# Only backend production dependencies
RUN bun install --production --frozen-lockfile --filter=backend

# Runtime artifacts only (single-process runtime)
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build /app/apps/backend/src/db/migrations /app/apps/backend/src/db/migrations
COPY --from=build /app/apps/backend/src/db/migrations /app/apps/backend/dist/db/migrations
COPY --from=build /app/apps/frontend/.output/public /app/public

RUN find /app -name "*.map" -type f -delete \
  && rm -rf /root/.bun/install/cache /tmp/* \
  && mkdir -p /home/autopilot/.autopilot /tmp \
  && chmod 1777 /tmp \
  && chown -R autopilot:autopilot /app /home/autopilot

USER autopilot

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "const url = 'http://127.0.0.1:' + (process.env.PORT || '3000') + '/health'; const res = await fetch(url); if (!res.ok) throw new Error('unhealthy');"

CMD ["bun", "/app/apps/backend/dist/index.js"]
