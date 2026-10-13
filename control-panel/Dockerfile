# ─── Control panel — Docker image (multi-stage) ──────────────────────────────
# Build from the REPO ROOT (the panel reuses src/design-system):
#   docker build -f control-panel/Dockerfile -t del-groups-control-panel \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
# control-panel/Dockerfile.dockerignore limits the context to what the build needs.

FROM node:22-alpine AS deps
WORKDIR /repo/control-panel
COPY control-panel/package.json control-panel/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /repo
COPY src/design-system ./src/design-system
COPY control-panel ./control-panel
COPY --from=deps /repo/control-panel/node_modules ./control-panel/node_modules

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NODE_ENV=production

WORKDIR /repo/control-panel
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Tracing starts at the repo root (next.config.ts), so the server sits in control-panel/.
COPY --from=builder /repo/control-panel/.next/standalone ./
COPY --from=builder /repo/control-panel/.next/static ./control-panel/.next/static
# Invoice PDF fonts (Noto Sans, SIL OFL), read at run time by lib/billing/pdf.ts.
COPY control-panel/assets/fonts ./control-panel/assets/fonts
ENV BILLING_FONT_DIR=/app/control-panel/assets/fonts
# The ERP schema provisioning applies to a new tenant (baseline, module install scripts, migrations).
COPY supabase/baseline ./supabase/baseline
COPY supabase/modules ./supabase/modules
COPY supabase/migrations ./supabase/migrations
ENV ERP_SQL_DIR=/app/supabase

USER nextjs
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/login || exit 1

CMD ["node", "control-panel/server.js"]
