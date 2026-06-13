# Merry — Deployment Guide

## Required Secrets & API Keys

### 1. Telegram Bot Token (REQUIRED)
- **How to get:** Message @BotFather on Telegram → `/newbot`
- **Env var:** `TELEGRAM_BOT_TOKEN=7830437060:AAHxyz...`
- **Free:** Yes — unlimited bots, unlimited messages
- **Multi-bot:** Add more as `TELEGRAM_ADDITIONAL_TOKENS=token2,token3`

### 2. LLM Provider (one required, unless mock mode)

#### Option A: Groq (recommended — free tier available)
- **How to get:** https://console.groq.com → API Keys → Create Key
- **Env var:** `GROQ_API_KEY=gsk_...`
- **Free tier:** 30 req/min, 14,400 req/day — plenty for personal use
- **Best model:** `GROQ_MODEL=llama-3.3-70b-versatile`

#### Option B: Anthropic Claude
- **How to get:** https://console.anthropic.com → API Keys
- **Env var:** `ANTHROPIC_API_KEY=sk-ant-...`
- **Cost:** Pay-per-token, no free tier
- **Best model:** `ANTHROPIC_MODEL=claude-sonnet-4-6`

#### Option C: Ollama (local, completely free)
- **How to get:** Install from https://ollama.com
- **Env var:** `OLLAMA_BASE_URL=http://host.docker.internal:11434`
- **Pull model:** `ollama pull qwen2.5:1.5b`
- **Free:** Yes, runs on your machine

### 3. GitHub Token (optional — enables Zoro knowledge indexing)
- **How to get:** GitHub → Settings → Developer Settings → Personal Access Tokens → Classic
- **Required scopes:** `repo` (read access to all repos including private)
- **Env var:** `GITHUB_TOKEN=ghp_...`
- **Free:** Yes

### 4. GitHub Actions Secrets (for CI/CD deploy workflow)
Add in GitHub → Repository → Settings → Secrets and variables → Actions:
- `SERVER_HOST` — IP or hostname of your deployment server
- `SERVER_USER` — SSH username (e.g. `ubuntu`, `root`, `deploy`)
- `SSH_KEY` — private SSH key content (generate with `ssh-keygen -t ed25519`)

### 5. Admin Chat ID (for proactive messages before first user message)
- **How to get:** Message @userinfobot on Telegram — it replies with your chat ID
- **Env var:** `ADMIN_CHAT_IDS=7830437060`
- **Free:** Yes

---

## Optional Services (all free, self-hosted)

### Prometheus + Grafana (metrics dashboard)
Merry already exposes metrics on port 9090. To visualise:
```yaml
# Add to docker-compose.yml
prometheus:
  image: prom/prometheus
  ports: ["9091:9090"]
  volumes: ["./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml"]

grafana:
  image: grafana/grafana
  ports: ["3001:3000"]
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
```

`monitoring/prometheus.yml`:
```yaml
scrape_configs:
  - job_name: merry
    static_configs:
      - targets: ['merry:9090']
```

### Jaeger (distributed tracing)
```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one
```
Then add to `.env`:
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
```
View traces at http://localhost:16686

### Rclone (cloud backup)
```bash
# Install rclone, configure a remote
rclone config

# Add to scripts/backup.sh env:
RCLONE_REMOTE=s3:my-bucket  # or gdrive:backups, b2:my-bucket
```
Free options: Backblaze B2 (10GB free), Google Drive (15GB free)

---

## Deployment Steps

### Quick start (single server, Docker)
```bash
# 1. Clone the repo
git clone https://github.com/PrateekDahiya/Merry.git /opt/merry
cd /opt/merry

# 2. Create .env from template
cp .env.example .env
# Edit .env with your real keys

# 3. Set up backups
mkdir -p /opt/backups/merry
bash scripts/setup-cron.sh  # daily 3am backup

# 4. Start
docker-compose up -d --build

# 5. Verify
docker-compose logs -f | head -50
curl http://localhost:9090/health  # should return "ok"
```

### Auto-deploy on git push (CI/CD)
1. Push code to `main` → GitHub Actions runs tests
2. If tests pass → SSH deploy script runs on your server
3. Server: `git pull && docker-compose build --no-cache && docker-compose up -d`

### Required server software
- Docker Engine 24+
- Docker Compose v2+
- Python 3.11+ (for code execution sandbox)
- Git
- 2GB+ RAM recommended (1GB minimum)
- 10GB+ disk for knowledge base

### Environment variable reference
See `.env.example` for the full annotated list.
Key variables for production:
```env
TELEGRAM_BOT_TOKEN=...
GROQ_API_KEY=...
GITHUB_TOKEN=...
ADMIN_CHAT_IDS=...
ADMIN_USER_IDS=...
PERSISTENCE_TYPE=sqlite
ZORO_ENABLED=true
NODE_ENV=production
LOG_LEVEL=info
USE_MOCK_AGENTS=false
USE_MOCK_TELEGRAM=false
```

---

## What's Free vs What Costs Money

| Service | Free? | Notes |
|---|---|---|
| Telegram Bot API | ✅ Free | Unlimited |
| Groq LLM | ✅ Free tier | 30 req/min, 14.4k/day |
| Ollama (local) | ✅ Free | Runs on your hardware |
| GitHub API | ✅ Free | 5000 req/hr with token |
| Wikipedia API | ✅ Free | No key needed |
| DuckDuckGo API | ✅ Free | No key needed |
| Open-Meteo (weather) | ✅ Free | No key needed |
| Prometheus | ✅ Free | Self-hosted |
| Grafana | ✅ Free | Self-hosted |
| Jaeger | ✅ Free | Self-hosted |
| Docker | ✅ Free | For personal use |
| GitHub Actions | ✅ Free | 2000 min/month |
| Backblaze B2 | ✅ 10GB free | For backups |
| Anthropic Claude | 💰 Paid | Pay-per-token |
| Sentry | 🟡 Free tier | 5k errors/month free |
| Redis | 🟡 Free tier | Only needed for BullMQ future work |
