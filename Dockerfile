# =============================================================================
# Dockerfile — AgentDex on Cloud Run (Next.js standalone)
# =============================================================================
# Serves the materialized 34k-agent snapshot + API + frontend. No GCP creds are
# required at runtime (the snapshot is baked in); outbound egress is used for
# live ENS resolution and tokenURI/IPFS metadata, both open on Cloud Run.
# =============================================================================

# ---- deps -------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner -----------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Standalone server + static assets.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Runtime data read by lib/data.ts, lib/ens.ts, lib/metadata.ts (not JS-traced).
COPY --from=build /app/data ./data
COPY --from=build /app/shared ./shared

EXPOSE 8080
CMD ["node", "server.js"]
