# syntax=docker/dockerfile:1
# Hosted demo image for Google Cloud Run. Synthetic data, ephemeral storage, not an operational system.

# ---- deps: install with the toolchain native modules may need (better-sqlite3 normally ships a prebuilt binary)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the React UI
FROM deps AS build
# The dashboard map needs the Google Maps BROWSER key at build time (it ends up in the public JS by design; restrict it by HTTP referrer to the
# service URL, and by API to Maps JavaScript). Empty = the offline outline map. Set only in this stage: nothing reaches the runtime image's environment.
ARG VITE_GOOGLE_MAPS_API_KEY=""
ARG VITE_GOOGLE_MAPS_MAP_ID=""
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY VITE_GOOGLE_MAPS_MAP_ID=$VITE_GOOGLE_MAPS_MAP_ID
COPY . .
RUN npm run build:ui

# ---- runtime: no compilers, non-root, safe defaults (stub providers, models off)
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    AEGIS_ENV=cloud \
    AEGIS_STORAGE_MODE=sqlite-ephemeral-demo \
    AEGIS_DB_PATH=/tmp/aegis.db \
    AEGIS_PROVIDER_MODE=stub \
    AEGIS_MODELS_ENABLED=false \
    PORT=8080
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node fixtures ./fixtures
# Public Assist: the validated card files and the release record that holds or approves them (AEG-PLN-003). Without them the page shows nothing.
COPY --chown=node:node content ./content
COPY --chown=node:node records/releases ./records/releases
COPY --from=build --chown=node:node /app/ui/dist ./ui/dist
USER node
EXPOSE 8080
# The server runs TypeScript through tsx (a dependency); the database is created in /tmp and seeded on first start.
CMD ["node", "--import", "tsx", "src/api/main.ts"]
