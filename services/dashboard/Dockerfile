# Build context = repo root (needs the @praxis/event-schemas workspace package).
FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/event-schemas/package.json packages/event-schemas/
COPY services/dashboard/package.json services/dashboard/
RUN npm install --workspaces --include-workspace-root

COPY packages/event-schemas packages/event-schemas
RUN npm run -w @praxis/event-schemas build

COPY services/dashboard services/dashboard
ARG NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run -w @praxis/dashboard build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd -r praxis && useradd -r -g praxis praxis

COPY --from=build /app/services/dashboard/.next/standalone ./
COPY --from=build /app/services/dashboard/.next/static ./services/dashboard/.next/static
COPY --from=build /app/services/dashboard/public ./services/dashboard/public

USER praxis
WORKDIR /app/services/dashboard
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
