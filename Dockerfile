# syntax=docker/dockerfile:1

# --- Build: frontend (Vite) and backend (single esbuild bundle) ---------------
FROM node:25-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY . .
# Version from the git tag, set by the CI ("dev" for local builds).
ARG APP_VERSION=dev
RUN APP_VERSION="$APP_VERSION" npm run build

# --- Runtime dependencies: only the native SQLite driver stays outside the bundle
FROM node:25-alpine AS runtime-deps
WORKDIR /deps
COPY package-lock.json ./
RUN version=$(node -p "require('./package-lock.json').packages['node_modules/@libsql/client'].version") \
 && npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "@libsql/client@${version}"

# --- Runtime ------------------------------------------------------------------
FROM node:25-alpine
WORKDIR /app
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version=$APP_VERSION
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/yasad.db \
    MIGRATIONS_DIR=/app/drizzle \
    STATIC_DIR=/app/public
COPY --from=runtime-deps /deps/node_modules ./node_modules
COPY --from=build /app/backend/dist/server.js ./server.js
COPY --from=build /app/backend/drizzle ./drizzle
COPY --from=build /app/frontend/dist ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
