# Autonomous WhatsApp AI Service

Node.js WhatsApp Web service that can answer incoming messages directly with OpenAI. A Laravel backend is optional.

## Features
- `GET /health`
- `POST /incoming` (Twilio/Meta/custom payload normalization)
- `POST /instance/init` (start WhatsApp web instance)
- `GET /instance/status` (instance connection state)
- `POST /instance/qr` (fetch QR to scan)
- `POST /instance/send` (send outbound WhatsApp text)
- `POST /instance/send-media` (send outbound WhatsApp document from URL or local file)
- `GET /instance/chats` (list chats and groups with their `chat_id`)
- Standalone OpenAI chatbot with local per-chat conversation memory
- Optional Laravel API mode for storing inbound/outbound messages
- Supports group-level chatbot suppression (`WA_CHATBOT_BLOCKED_CHAT_IDS`)
- Supports WhatsApp media -> Odoo automation bridge (`WA_ODOO_AUTOMATION_*`)

## Standalone AI Setup

1. Copy `.env.example` to `.env`.
2. Keep `CHATBOT_MODE=standalone`.
3. Set `OPENAI_API_KEY` in `.env`. Never expose this key in frontend code or commit it.
4. Run `npm install`.
5. Run `npm start`.
6. Open `POST /instance/qr` or use the generated QR image and scan it with WhatsApp.

Once the instance state is `ready`, private incoming text messages receive automatic AI replies. Voice notes (French / Darija) are transcribed with Whisper and answered as text when `AI_REPLY_TO_AUDIO=true` (default).

Darija voice understanding uses a modular NLU pipeline in `src/voice-nlu/`:
- language detection
- ASR cleanup + Darija normalization dictionary
- intent / entity extraction
- low-confidence clarification
- JSON logs in `storage/voice-nlu-logs/`

Run Darija NLU tests with `npm run test:darija-nlu`.

Group replies and non-audio media-only replies are disabled by default. Set `AI_REPLY_IN_GROUPS=true` or `AI_REPLY_TO_MEDIA=true` only when that behavior is intentional. Replies stay in French or Moroccan Darija.

Conversation memory is stored in `storage/ai-conversations.json`. A contact can send `/reset` to clear the memory for that discussion.

To restore the original Laravel-driven behavior, set `CHATBOT_MODE=backend` and configure `API_BASE_URL` plus `WHATSAPP_SERVICE_TOKEN`.

## Smoke Test
`npm run smoke`

## Real WhatsApp Document Test
Prerequisites:
- The WhatsApp instance must be initialized with `instance_id=main` or with the instance id you already scanned.
- `WHATSAPP_SERVICE_TOKEN` must be set if you want internal endpoints protected.
- `WA_SESSION_PATH` must point to the folder that contains your persisted LocalAuth session.
- If `PUPPETEER_EXECUTABLE_PATH` is invalid on Windows, the service now falls back to common local Chrome/Edge paths automatically.
- You need the target group `chat_id` in the form `120363xxxxxxxx@g.us`.

Suggested flow:
1. Start the service.
2. Call `POST /instance/init`.
3. Call `POST /instance/status` until the state becomes `ready`.
4. If needed, call `POST /instance/qr` and scan the QR code from WhatsApp.
5. Call `POST /instance/send-media` with the compiled file URL.

Example payload:

```json
{
  "instance_id": "main",
  "chat_id": "120363xxxxxxxx@g.us",
  "media_url": "https://dev.ozirpaie.ma/webhook/download-test",
  "caption": "Nouvelle build OzirPaie",
  "filename": "ozir-paiesetup-1.0.0.exe"
}
```

The endpoint also supports `file_path` for a local file when you want to bypass the remote download during debugging.
