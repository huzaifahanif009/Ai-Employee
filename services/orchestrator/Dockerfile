# Build context = repo root.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/event-schemas/package.json packages/event-schemas/
COPY services/orchestrator/package.json services/orchestrator/
RUN npm install --workspaces --include-workspace-root
COPY packages/contracts packages/contracts
COPY packages/event-schemas packages/event-schemas
COPY services/orchestrator services/orchestrator
RUN npm run -w @praxis/event-schemas build \
 && npm run -w @praxis/contracts build \
 && npm run -w @praxis/orchestrator build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r praxis && useradd -r -g praxis praxis
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/orchestrator/dist ./services/orchestrator/dist
COPY --from=build /app/services/orchestrator/package.json ./services/orchestrator/package.json
USER praxis
WORKDIR /app/services/orchestrator
CMD ["node", "dist/worker.js"]
