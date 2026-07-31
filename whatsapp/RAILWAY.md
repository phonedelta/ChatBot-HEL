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

## Limits
WhatsApp Web (Puppeteer) on free/shared PaaS can be unstable. If the session dies often, prefer a small VPS (Contabo / OVH) with Chrome and `systemd`.
