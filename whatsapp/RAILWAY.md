# Deploy on Railway

## Why the first deploy failed
The GitHub repo has the Node app under `whatsapp/`, with **no** root `package.json` and **no** Dockerfile. Railway then fails at **Build image** in a few seconds.

This is fixed by the root `Dockerfile` + `railway.toml`.

## Steps in Railway
1. Open the service → **Settings**
2. **Builder** = Dockerfile (or leave railpack if `railway.toml` is detected)
3. **Root Directory** = `/` (repository root)
4. **Variables** — add at least:
   - `OPENAI_API_KEY`
   - `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
   - `WEBHOOK_SECRET` / `WHATSAPP_SERVICE_TOKEN`
   - `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
   - `WA_PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu`
   - `PORT=8081` (Railway may inject `PORT` automatically — the app already reads it)
5. **Volumes** → create a volume mounted at `/app/storage` (keeps WhatsApp session + CRM DB)
6. Redeploy

## After deploy
- Dashboard: `https://<your-railway-domain>/dashboard`
- Health: `https://<your-railway-domain>/health`
- Scan WhatsApp QR via `POST /instance/qr` (or your usual init flow)

## Runtime vars that fix “Prête but no replies”
Add these in Railway Variables (override Windows paths from local `.env`):

```env
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WA_PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--disable-extensions
WA_INSTANCE_PING_TIMEOUT_MS=90000
WA_INSTANCE_PING_INTERVAL_MS=120000
WA_AUTOMATION_HISTORY_SYNC_ENABLED=false
```

Also:
- Use **at least 2 GB RAM** for the service (WhatsApp Web + Chromium).
- Keep **1 replica** only (two replicas = two WhatsApp sessions fighting).
- Test from a **second phone** → message `+` the connected bot number (not from the bot phone itself).

## Limits
WhatsApp Web (Puppeteer) on free/shared PaaS can be unstable. If `instance.getState timed out` keeps appearing and replies never arrive, prefer a small VPS (Contabo / OVH) with Chrome and `systemd`.
