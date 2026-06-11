FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:20-slim AS runtime

WORKDIR /app

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PERSISTENCE_TYPE=file
ENV DB_PATH=/app/data/store.json

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Default knowledge base — override by mounting a volume at /app/knowledge
COPY knowledge ./knowledge

EXPOSE 3000

CMD ["node", "dist/index.js"]
