# WhatsApp Service Runbook

## Start
- `npm install`
- `cp .env.example .env`
- `npm start`

## Endpoints
- `GET /health`
- `POST /incoming`
- `POST /instance/init`
- `GET /instance/status`
- `POST /instance/qr`
- `POST /instance/send`
- `POST /instance/send-media`
- `GET /instance/chats`

## Required Env
- `PORT`
- `WHATSAPP_PROVIDER`
- `WEBHOOK_SECRET`
- `API_BASE_URL`
- `WHATSAPP_SERVICE_TOKEN`
- `WA_CHATBOT_BLOCKED_CHAT_IDS` (comma-separated chat ids/numbers where bot replies are disabled)
- `WA_ODOO_AUTOMATION_ENABLED`
- `WA_ODOO_AUTOMATION_GROUPS` (comma-separated group chat ids allowed for media->Odoo)
- `WA_ODOO_INGEST_SCRIPT` (path to `ingest_whatsapp_media.php`)
- `WA_PHP_BINARY`
- `WA_ODOO_INGEST_TIMEOUT_MS`
- `WA_SESSION_PATH` (must match the LocalAuth storage folder you want to reuse)
- `PUPPETEER_EXECUTABLE_PATH` (optional; on Windows the service falls back to common local Chrome/Edge paths)
- `WA_MEDIA_TMP_DIR`
- `WA_MEDIA_MAX_BYTES`
- `WA_OUTBOUND_MEDIA_MAX_BYTES`
- `WA_OUTBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS`

## Real Test Flow
1. Start the service with `npm start`.
2. Initialize the WhatsApp instance:
   - `POST /instance/init`
3. Check the state:
   - `GET /instance/status?instance_id=main`
4. If the state is not `ready`, fetch and scan the QR:
   - `POST /instance/qr`
5. Send the compiled file to the target WhatsApp group:
   - `POST /instance/send-media`

Recommended `send-media` payload:

```json
{
  "instance_id": "main",
  "chat_id": "120363xxxxxxxx@g.us",
  "media_url": "https://dev.ozirpaie.ma/webhook/download-test",
  "caption": "Nouvelle build OzirPaie",
  "filename": "ozir-paiesetup-1.0.0.exe"
}
```

PowerShell example:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "x-service-token" = "change_this_service_token"
}

$body = @{
  instance_id = "main"
  chat_id = "120363xxxxxxxx@g.us"
  media_url = "https://dev.ozirpaie.ma/webhook/download-test"
  caption = "Nouvelle build OzirPaie"
  filename = "ozir-paiesetup-1.0.0.exe"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8081/instance/send-media" `
  -Headers $headers `
  -Body $body
```

The endpoint also supports `file_path` instead of `media_url` for local debugging.

List groups and retrieve their `chat_id`:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:8081/instance/chats?instance_id=main&groups_only=true&limit=50" `
  -Headers @{ "x-service-token" = "change_this_service_token" }
```
