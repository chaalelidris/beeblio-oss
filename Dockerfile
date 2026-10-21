# syntax=docker/dockerfile:1

# -------------------------------------------------------------------
# Base stage: Node.js 24 + pnpm + system/research runtime dependencies
# -------------------------------------------------------------------
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Corepack to activate exact pnpm version
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

# Optional: Install headless LibreOffice for Office-to-PDF conversion (DOCX/PPTX/XLSX)
ARG INSTALL_LIBREOFFICE=true

# Install runtime utilities and agent research tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    python3-pandas \
    python3-docx \
    poppler-utils \
    pandoc \
    && if [ "$INSTALL_LIBREOFFICE" = "true" ]; then \
        apt-get install -y --no-install-recommends libreoffice-writer-nogui libreoffice-calc-nogui; \
    fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -------------------------------------------------------------------
# Dependencies stage: install node dependencies with build tools
# -------------------------------------------------------------------
FROM base AS dependencies

# Build tools for compiling native addons (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./

RUN pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# -------------------------------------------------------------------
# Builder stage: compile Eve Agent (.output) and Next.js (.next)
# -------------------------------------------------------------------
FROM dependencies AS builder

COPY . .

# Run production builds for both Eve and Next.js
RUN pnpm build:eve && pnpm build

# -------------------------------------------------------------------
# Runner stage: lightweight production image
# -------------------------------------------------------------------
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV BEEBLIO_UI_HOST=0.0.0.0
ENV PORT=3000
ENV BEEBLIO_DATA_DIR=/app/.beeblio

# Copy node_modules
COPY --from=dependencies /app/node_modules ./node_modules


# Copy compiled builds and required server sources
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/db ./db
COPY --from=builder /app/types ./types
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Ensure persistent data directory exists
RUN mkdir -p /app/.beeblio

EXPOSE 3000

VOLUME ["/app/.beeblio"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "scripts/local-start.mjs"]
