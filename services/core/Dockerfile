# Build context = repo root (see docker-compose.yml).
FROM node:20-slim AS build
WORKDIR /app
ENV NODE_ENV=development

# manifests first for layer caching
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/event-schemas/package.json packages/event-schemas/
COPY services/core/package.json services/core/
RUN npm install --workspaces --include-workspace-root

# sources
COPY packages/contracts packages/contracts
COPY packages/event-schemas packages/event-schemas
COPY services/core services/core

RUN npm run -w @praxis/event-schemas build \
 && npm run -w @praxis/contracts build \
 && npm run -w @praxis/core build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# docker CLI (static) — only used when SANDBOX_BACKEND=docker (local/demo, ADR-0005);
# needs /var/run/docker.sock mounted. Prod uses the firecracker/gvisor backend instead.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz \
    | tar xz -C /usr/local/bin --strip-components=1 docker/docker \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN groupadd -r praxis && useradd -r -g praxis praxis

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/event-schemas/dist ./packages/event-schemas/dist
COPY --from=build /app/packages/event-schemas/package.json ./packages/event-schemas/package.json
COPY --from=build /app/services/core/dist ./services/core/dist
COPY --from=build /app/services/core/package.json ./services/core/package.json

USER praxis
WORKDIR /app/services/core
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
