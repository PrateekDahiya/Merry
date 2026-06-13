FROM node:20-slim AS builder

WORKDIR /app

# Install build tools needed for native modules (better-sqlite3, pdf-parse)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDependencies so only prod deps are copied to runtime
RUN npm prune --omit=dev


FROM node:20-slim AS runtime

WORKDIR /app

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PERSISTENCE_TYPE=sqlite
ENV DB_PATH=/app/data/store.sqlite

# Copy compiled native modules + prod deps from builder (avoids recompiling)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# knowledge/ is provided by the merry_knowledge Docker volume at runtime.
EXPOSE 3000

CMD ["node", "dist/index.js"]
