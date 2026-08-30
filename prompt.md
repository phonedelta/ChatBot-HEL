# ChatBot HEL — Project Prompt / Context

> Use this file as the source of truth when asking an AI (or a new developer) to work on this project.
> Repo: https://github.com/phonedelta/ChatBot-HEL

**Last updated:** 30 August 2026 — History audit (Exécuté par = dashboard user | Assistant IA) + RBAC + cabinet settings

---

## 1. What this project is

**ChatBot HEL / Smart CRM IA** is an autonomous WhatsApp AI assistant + operational dashboard for **Centre Dentaire HEL** (dental clinic in El Oulfa, Casablanca, Morocco).

It:

1. Connects to WhatsApp via **WhatsApp Web** (QR scan session).
2. Answers patients in **French** or **Moroccan Darija** (Arabic script for Darija replies).
3. Understands **text** and **voice notes** (Whisper transcription + Darija NLU).
4. Books **dental appointments** through a CRM workflow (single-message form → summary → confirmation).
5. Runs a **Smart CRM dashboard** with RBAC (admin / secretary), messages, agenda, patients, relances, analyses, **historique (audit)**, assistant config, WhatsApp integration, and cabinet settings.

Clinic knowledge (hours, services, address, phone) lives in:

- `whatsapp/src/knowledge/centre-dentaire-hel.md` (LLM knowledge file)
- `knowledge_items` table (dashboard-editable base de connaissances)

---

## 2. Business rules (important)

### Languages

| Patient speaks | Bot replies |
|----------------|-------------|
| French | French only |
| Darija (Latin keyboard or Arabic script) | Arabic script only (never Latin Darija in replies) |

### Appointment booking

1. Patient asks for a rendez-vous (explicit intent: RDV, `bghit nreserve`, `بغيت موعد`, etc.).
2. Bot sends a **one-message form** (all fields at once — never field-by-field).
3. Required fields:
   - Full name (**prénom + nom** — single first name is rejected)
   - Dental problem / motif
   - Phone number
   - City
   - Preferred day and time
4. Bot shows a summary and asks for `*OUI*` / `نعم`.
5. Only after confirmation is the appointment saved in CRM with status **`non_confirme`** (UI: **À confirmer** / En attente).
6. Confirmation flow: WhatsApp 24h before → patient OUI/NON → status **Confirmé** or cancelled.

**Audit:** WhatsApp auto-booking, confirmation, cancel, and slot accept/decline are executed by **Assistant IA** (origin: WhatsApp patient). Manual dashboard create/edit/cancel is executed by the **authenticated dashboard user**.

### Working hours (hard rule)

| Day | Hours |
|-----|--------|
| Mon–Fri | 10:30 → 19:00 |
| Saturday | 09:30 → 13:00 (no booking from 13:00) |
| Sunday | Closed |

Out-of-hours slots are rejected with an explanation + form again.

### Voice notes

- Transcribed with Whisper (French / Darija).
- Used for **conversation** (understand the dental problem).
- **Never** collect CRM identity fields from voice.
- Booking form opens only on **explicit** appointment request in the transcript.
- If already in form mode and patient sends voice → short reminder to reply in **one text message**.

### CRM status labels

| Internal value | UI label |
|----------------|----------|
| `non_confirme` | À confirmer |
| `confirmed` | Confirmé |
| `cancelled` | Annulé |

### Multi-patient / shared WhatsApp contact

- **Phone = contact channel**, not unique patient identity.
- One WhatsApp number can be linked to **multiple patients** (family, shared phone).
- Always show the **correct patient name** on appointments, relances, and messages.
- Never invent a phone from a WhatsApp `@lid`.

### Human handoff

- Staff can take over a conversation (**Prendre la main** in Messages).
- When `HUMAN_CONTROLLED`: bot does **not** auto-reply (including cancel/confirmation flows).
- Handoff actor = authenticated dashboard user (never « Équipe »).
- Returning the conversation to AI is still a **dashboard user** action.

### WhatsApp patient self-cancel

- Intent `CANCEL_APPOINTMENT` → list active RDV → patient selects → **OUI/NON confirmation**.
- Never cancel immediately without confirmation.
- On cancel: status `cancelled`, reminders cleared, **bell notification + sound** (slot released).
- **No auto WhatsApp slot proposal** after cancellation.
- History: **Exécuté par = Assistant IA**, origin = WhatsApp patient.

### Notifications (bell)

- Bell notifications **only on appointment cancellation** (`sourceEvent === 'appointment_cancelled'`).
- Do **not** notify on slot proposals or routine events.
- Sound: `NotificationContext` polls (~4s), plays `Notification_HEL.mp3` on **new notification IDs** (not unread count). Initial load = no sound. Toggle in Paramètres → Notifications.
- Clicking a notification is **not** the actor; the subsequent dashboard action is.

### Assistant guardrails (backend — not exposed in UI)

Even though the Assistant IA page no longer shows guardrails, these rules remain active:

- No diagnosis / no unauthorized clinical recommendation / no treatment change without staff.
- Transfer to human when needed.
- Never invent hours, prices, or availability.

---

## 3. Architecture (high level)

```
Patient (WhatsApp)
        │
        ▼
┌───────────────────────────────────────────┐
│  Node.js Express service                    │
│  whatsapp/src/index.js                    │
│  Port :8081                               │
│                                           │
│  • whatsapp-web.js + Puppeteer            │
│  • OpenAI chat + Whisper                  │
│  • Intent Router                          │
│  • CRM workflow + Smart CRM layer         │
│  • Dashboard API + RBAC + React SPA      │
└───────────┬───────────────────────────────┘
            │
    ┌───────┴────────────────────┐
    ▼                            ▼
SQLite CRM                  Admin Dashboard
storage/crm.sqlite          http://localhost:8081/dashboard
(conversations, messages,
 appointments, tasks,
 activity_history,
 dashboard_users,
 ai_actions, knowledge…)
```

### Main pipeline (each inbound message)

1. Receive WhatsApp message (text or audio).
2. If audio → enhance (ffmpeg) → Whisper transcription → Voice NLU.
3. Detect language (FR / Darija).
4. **Intent Router** → language, intent, service, flags (`bookAppointment`, `cancelAppointment`, …).
5. **Smart handlers** (cancel, confirmation reply, slot proposal) before generic LLM.
6. **CRM workflow** if booking-related → templates (form / summary / confirmation).
7. Else **LLM** with clinic knowledge + router block + conversation history.
8. Reply as WhatsApp text; persist to `messages` + `conversations`.
9. Persist **business audit** via `activity_history` (actor = Assistant IA for automations).

Templates for booking form / summary / confirmation are **exact** (`shouldSkipLlm: true`) — AI must not rewrite them.

---

## 4. Technologies

### Backend

| Layer | Tech |
|-------|------|
| Runtime | **Node.js** |
| Language | **JavaScript** (CommonJS) |
| HTTP server | **Express** |
| WhatsApp | **whatsapp-web.js** + **Puppeteer** |
| AI chat | **OpenAI** API |
| Speech-to-text | **Whisper** |
| Database | **SQLite** (`node:sqlite`) |
| Config | **dotenv** |

### Frontend (Smart CRM dashboard)

| Layer | Tech |
|-------|------|
| Language | **TypeScript** |
| UI | **React 19** |
| Build | **Vite 8** |
| Styling | **Tailwind CSS 4** |
| Routing | **react-router-dom** |
| Charts | **recharts** (Analyses) |
| Icons | **lucide-react** |
| Motion | **framer-motion** |

### Design tokens HEL

```
Primary Navy    #12324A
Medical Cyan    #13AEC1
Cyan Tint       #E4F6F8
Background      #F5FAFC
Surface         #FFFFFF
Border          #DCEAF0
Secondary       #708299
Success         #20B26B
Warning         #F59E0B
Error           #E34C4C
Font            Manrope
```

### Data & storage (local)

| Path | Purpose |
|------|---------|
| `whatsapp/storage/crm.sqlite` | Full CRM + Smart CRM + `dashboard_users` + `activity_history` |
| `whatsapp/storage/sessions/` | WhatsApp LocalAuth session |
| `whatsapp/storage/ai-conversations.json` | LLM chat memory per conversation (UTF-8, no BOM) |
| `whatsapp/storage/dashboard-auth.json` | Legacy admin login (bootstraps SQLite users) |
| `whatsapp/storage/dashboard-sessions.json` | Dashboard sessions |
| `whatsapp/storage/media/` | Inbound/outbound media copies |
| `whatsapp/storage/voice-nlu-logs/` | Voice NLU debug logs |
| `whatsapp/storage/backups/` | Manual CRM reset backups |

---

## 5. Repository structure

```
ChatBot-HEL/
├── prompt.md                 ← this file
└── whatsapp/
    ├── package.json
    ├── .env                  # secrets (DO NOT commit)
    ├── .env.example
    ├── scripts/              # integration tests
    ├── storage/              # runtime data (gitignored)
    ├── dashboard-app/        # React + TS source
    │   └── src/
    │       ├── pages/
    │       ├── components/   # layout, auth, history, settings, UI
    │       ├── context/      # AuthContext, NotificationContext
    │       ├── hooks/        # usePermissions, useIdleSession
    │       └── lib/          # api, permissions, history-ui, labels
    └── src/
        ├── index.js          # Express + WhatsApp + AI loop + CRM appointment mutations
        ├── knowledge/
        ├── dashboard/
        │   ├── auth.js
        │   ├── auth-middleware.js
        │   ├── permissions.js
        │   ├── users.js          # dashboard_users CRUD
        │   ├── user-routes.js    # /users, /permissions (MANAGE_USERS only)
        │   ├── smart-routes.js   # /dashboard/api/*
        │   └── dist/             # built SPA
        ├── crm/
        │   ├── workflow.js
        │   ├── repository.js
        │   ├── schema.sql
        │   └── smart/
        │       ├── index.js
        │       ├── activity-history.js   # append-only audit
        │       ├── activity-actors.js     # dashboard_user | assistant_ai
        │       ├── cabinet-settings.js
        │       ├── analytics-board.js
        │       ├── patients-board.js
        │       ├── followups-board.js
        │       ├── agenda-board.js
        │       ├── appointment-confirmation.js
        │       ├── whatsapp-cancel.js
        │       ├── slot-proposals.js
        │       ├── slot-release-notifications.js
        │       ├── conversation-context.js
        │       ├── conversation-routing.js
        │       ├── contact-resolver.js
        │       └── defaults.js
        └── voice-nlu/
```

---

## 6. Auth, RBAC, users

### Roles

| Role | UI label | Access |
|------|----------|--------|
| `admin` | Administrateur | All permissions (bypass) |
| `secretary` | Secrétaire | Explicit permission list |

Users live in SQLite (`dashboard_users` + `dashboard_user_permissions`), not only in the JSON auth file. Login UI: **AccountSelector** (pick account then password). Session: `req.dashboardUser` via `auth-middleware.js`.

**Never trust** `req.body.actorUserId` / `actor_display_name` for audit. Actor for dashboard mutations comes from the **authenticated session**.

### Permissions (high level)

Messages, agenda (create/edit/cancel/confirm/propose slot), patients, relances, assistant, analyses, historique, integrations, settings, **MANAGE_USERS**.

`user-routes.js` applies `requireManageUsers` **per route** only — never as a global `router.use` on `/dashboard/api` (that 403’d every CRM call for secretaries).

### Paramètres (SettingsPage)

Sidebar sections (permission-gated):

| Section | Content |
|--------|---------|
| Utilisateurs et accès | CRUD accounts, permissions, disable/delete |
| Rendez-vous | Slot duration, lead times, waitlist, proposals |
| Confirmations & rappels | 24h confirm, 4h/24h reminders, send window |
| Automatisations | Toggle backend automations |
| Sécurité & sessions | Session TTL, idle timeout (`useIdleSession`) |
| Notifications internes | Bell + **Sons de notification** |

Idle logout: actor remains the logged-in user; origin = session expiry (if logged).

---

## 7. Smart CRM dashboard (current)

**URL:** `http://localhost:8081/dashboard`

### Navigation (sidebar)

| Route | Page | Permission |
|-------|------|------|
| `/` | **Aujourd’hui** | `VIEW_TODAY` |
| `/messages` | **Messages** | `VIEW_MESSAGES` |
| `/agenda` | **Agenda** | `VIEW_AGENDA` |
| `/patients` | **Patients** | `VIEW_PATIENTS` |
| `/relances` | **Relances** | `VIEW_FOLLOWUPS` |
| `/assistant` | **Assistant IA** | `VIEW_ASSISTANT` |
| `/analyses` | **Analyses** | `VIEW_ANALYTICS` |
| `/historique` | **Historique** | `VIEW_HISTORY` |
| `/integrations` | **Intégrations** | `VIEW_INTEGRATIONS` |
| `/parametres` | **Paramètres** | `VIEW_SETTINGS` |

**Removed from UI:**

- `/automatisations` — page removed; automations still run in backend (`automations` table + Paramètres).
- Legacy `/commandes`, `/config` — compat only.

### Historique (`HistoryPage.tsx`) — audit journal

Append-only business audit (`activity_history`). Not a copy of every WhatsApp message.

**Column « Exécuté par » — non-negotiable:**

| Allowed | Never |
|---------|--------|
| Real dashboard account (Admin, Sawsane, Sarah A. + role) | Patient |
| **Assistant IA** / subtitle Automatisation | Système, Équipe, WhatsApp, Bot, CRM, Scheduler |

**Concepts (do not mix):**

- **Actor** — who executed in the CRM (`dashboard_user` \| `assistant_ai`)
- **Target** — patient / appointment / user concerned
- **Origin** — dashboard, WhatsApp patient, automation, scheduler

Examples:

- Patient books via chatbot → actor **Assistant IA**, origin WhatsApp patient.
- Patient replies OUI to a slot → actor **Assistant IA**.
- Sawsane clicks « Proposer un créneau » → actor **Sawsane** (even if WhatsApp sends the message).
- Admin creates RDV in Agenda → actor **Admin**.

**KPI « Équipe »** on the History page = count of `dashboard_user` actions (aggregation). Individual rows still show the real name.

CSV/PDF: Exécuté par = Admin / Sawsane / Assistant IA. Never Patient / Système / Équipe.

Filter « Tous les exécutants » lists dashboard users + Assistant IA. No Patient/Système/Équipe.

### Assistant IA (`AssistantPage.tsx`)

- **Shown:** status toggle (pause modal), personality (name/tone), languages (FR + Darija), knowledge base drawer.
- **Hidden from UI (backend unchanged):** capabilities, guardrails, AI action journal.
- Pause/enable and knowledge edits are audited as the **dashboard user**.

### Intégrations (`IntegrationsPage.tsx`)

- **Only WhatsApp** (SQLite / Google / Outlook / Webhooks hidden).
- Real state from `GET /dashboard/api/instances` + QR.
- Connect / reconnect / disconnect with confirmation.

### Relances / Patients / Analyses

Unchanged product rules from previous versions: relance categories + manual WhatsApp; multi-patient drawer; period analytics with real KPIs only.

---

## 8. History / audit model (backend)

### Actor types (new events)

```
dashboard_user  → actor_user_id, actor_display_name snapshot, actor_role snapshot
assistant_ai    → displayName always "Assistant IA", userId null
```

Helpers (`activity-actors.js` / `activity-history.js`):

- `recordUserAuditEvent(user, …)` — session required
- `recordAssistantAuditEvent(…)` — Assistant IA
- Reject / do not persist visible `patient` / `system` / `team` as actor

Snapshots keep showing « Sawsane · Secrétaire » after rename or account deletion.

### Origin values

`dashboard` · `whatsapp_patient` · `assistant_ai` · `automation` · `scheduler` · `integration` · `system_internal`

Origin ≠ Exécuté par.

### Legacy backfill (on boot)

- Rows with `actor_user_id` → keep that dashboard user.
- WhatsApp / automation / patient / system → **Assistant IA**.
- « Équipe » with recoverable name/metadata → recover user; **never invent Admin**.

### Instrumented mutations (minimum)

- Appointments: create, update (date/time/both → moved), confirm, cancel, delete, slot released
- Slot proposals: sent (manual = user, auto = Assistant IA), accepted, declined
- Patients, notes, handoff, relances, users/permissions, settings, assistant, WhatsApp connect/disconnect
- Log **after** successful mutation only. Do not log page views / polling / hover.

---

## 9. Key backend modules

### CRM core (`src/crm/`)

- Booking workflow, extraction, working hours, repository.
- Tables: `customers`, `appointments`, `dental_cases`, `conversation_logs`.
- Manual create/update/delete appointments in `index.js` must pass `getAuthenticatedActor(req.dashboardUser)` into `recordActivity`.

### Smart CRM (`src/crm/smart/`)

| Module | Purpose |
|--------|---------|
| `index.js` | Orchestrator: conversations, messages, tasks, settings, today KPIs |
| `activity-history.js` | Append-only audit journal + CSV + actor filters |
| `activity-actors.js` | Actor helpers — `dashboard_user` \| `assistant_ai` only |
| `cabinet-settings.js` | Appointments / reminders / automations / security / notifications |
| `analytics-board.js` | Period-scoped KPIs, daily series, intents (FR labels) |
| `patients-board.js` | Patient list, search, context drawer |
| `followups-board.js` | Relances categories, manual remind, validation |
| `agenda-board.js` | Agenda view, practitioners, types |
| `appointment-confirmation.js` | 24h confirmation, followups, WhatsApp confirm/cancel |
| `whatsapp-cancel.js` | Patient self-cancel with OUI/NON |
| `slot-proposals.js` | Manual/auto slot proposal; accept/decline |
| `slot-release-notifications.js` | Bell on cancellation only |
| `contact-resolver.js` | WhatsApp identity ↔ phone ↔ patient |
| `conversation-context.js` | Intent/summary for Messages panel |
| `conversation-language.js` | Active language per chat |
| `conversation-routing.js` | Context routing vs booking |
| `labels.js` | French UI labels |

### Dashboard API (`src/dashboard/smart-routes.js`)

Mounted under `/dashboard/api/` (dashboard session + permission).

Key routes:

- `GET /today`, `GET /search`
- `GET|POST /conversations`, handoff, messages, media
- `GET|POST /patients`, notes, tags, context
- `GET /agenda`, slot proposals, moves
- `GET /followups`, `POST /followups/remind`, validate-all
- `GET /analytics?days=`
- `GET|PATCH /assistant`, `PUT /knowledge`
- `GET /integrations` (WhatsApp metadata only)
- `GET|PUT /settings/*` (appointments, reminders, automations, security, notifications)
- `GET /notifications`, read/mark-all
- `GET /history`, `GET /history/actors`, `GET /history/export.csv`, `GET /history/:id`

Users (`user-routes.js`, `MANAGE_USERS`):

- `GET /permissions`, `GET|POST /users`, `PATCH /users/:id`, permissions, reset-password, disable/enable, delete

WhatsApp instance (`index.js`):

- `GET|POST /dashboard/api/instances`
- `GET|POST /dashboard/api/instances/:id/qr`
- `DELETE /dashboard/api/instances/:id`

CRM appointments (`index.js`):

- `POST /dashboard/api/crm/appointments` — create + audit
- `PATCH /dashboard/api/crm/appointments/:id` — update/confirm/cancel + audit
- `DELETE /dashboard/api/crm/appointments/:id` — delete + audit

### Voice NLU (`src/voice-nlu/`)

- Language detection, intent classification, intent router, dental-problem classifier, NLU fallback.

---

## 10. Analytics KPI definitions (reference)

| KPI | Formula |
|------|---------|
| Messages patients | inbound `messages` in period |
| Traitement auto % | AI outbound replies ÷ inbound messages × 100 |
| RDV créés | `appointments.created_at` in period |
| Taux confirmation | cohort: created in period & now `confirmed` ÷ created × 100 |
| Confirmations auto | `confirmation_source = whatsapp_patient` |
| Créneaux récupérés | cancelled slot later filled by another active appointment |
| Handoff rate | `handoff_to_human` ÷ conversations touched (backend; not shown on Analyses UI) |
| Graph | daily created + confirmed, zero-fill missing days, timezone local |

---

## 11. How to run locally

```powershell
cd "whatsapp"
npm install
# copy .env.example → .env and set OPENAI_API_KEY
npm start
```

Dashboard build (after UI changes):

```powershell
npm run build:dashboard
# restart npm start to serve new static files
```

Useful tests:

```powershell
npm run test:crm
npm run test:intent-router
npm run test:darija-nlu
npm run test:history
npm run test:dashboard-auth
npm run test:analytics
npm run test:followups
npm run test:patients
npm run test:whatsapp-cancel
npm run test:agenda
npm run test:appointment-confirmation
npm run test:manual-slot-proposal
```

Also: `test:dashboard-rbac`, `test:cabinet-settings`, `test:notification-sound` (scripts in `whatsapp/scripts/`).

Service listens on **`:8081`**. Only **one** bot process at a time.

### Reset CRM data (dev)

Stop server → backup & delete `storage/crm.sqlite*` → reset `ai-conversations.json` (UTF-8 **without BOM**) and `dashboard-sessions.json` → keep `sessions/` (WhatsApp) and `dashboard-auth.json` → restart. Backups go to `storage/backups/crm-reset-*`. Admin is re-bootstrapped from legacy auth.

---

## 12. Environment (main variables)

See `whatsapp/.env.example`. Critical ones:

- `OPENAI_API_KEY` — required for chat + transcription
- `CHATBOT_MODE=standalone`
- `CRM_ENABLED=true`
- `CRM_DB_PATH=./storage/crm.sqlite`
- `AI_REPLY_TO_AUDIO=true`
- `AI_VOICE_NLU_ENABLED=true`
- `AI_KNOWLEDGE_PATH=./src/knowledge/centre-dentaire-hel.md`
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` (legacy bootstrap)
- `DASHBOARD_AUTH_PATH=./storage/dashboard-auth.json`
- `PORT=8081`

**Never commit `.env` or API keys.** Never store passwords in History (only « mot de passe mis à jour »).

---

## 13. Design / product constraints for AI agents

When modifying this project:

1. Prefer **minimal, targeted diffs** — do not refactor unrelated files.
2. Booking templates (form / summary / confirmation) must stay **exact** — no AI rewrite.
3. Darija replies = **Arabic script only**.
4. Full name requires **two words** (first + last).
5. Do not open the booking form for weak service mentions or random voice notes.
6. Use HEL design tokens (Navy `#12324A`, Cyan `#13AEC1`, Manrope).
7. **No raw backend enums in UI** (`BOOK_APPOINTMENT`, `connected`, `needs_configuration`, `dashboard_user` as raw chip, etc.).
8. Analytics KPIs must come from **real backend data** — no fake trends.
9. Integrations page: show **only actually usable** integrations (currently WhatsApp).
10. Bell notifications **only on cancellation**.
11. Multi-patient: never assume phone = single patient; never convert `@lid` to a phone.
12. **History « Exécuté par »:** only a real dashboard account **or** « Assistant IA ». Never Patient / Système / Équipe.
13. Dashboard mutations: actor from **session**, never from client body.
14. History is **append-only**; no edit/delete events in the dashboard.
15. Commit only when the user asks; do not force-push unless explicitly requested.

---

## 14. Recent changes log (Aug 2026)

| Area | Change |
|------|--------|
| **Historique** | Audit journal: actor = `dashboard_user` \| `assistant_ai`; origin separate; legacy Patient/Système/Équipe remapped |
| **RBAC** | Admin / secretary, `dashboard_users`, permission routes, Users section in Paramètres |
| **Auth** | AccountSelector login; idle session; session TTL from cabinet settings |
| **Paramètres** | 6 sections: users, appointments, reminders, automations, security, notifications |
| **Notifications** | Sound via NotificationContext (new IDs, not unread count); settings toggle |
| **Analyses** | 4 KPIs, period filter, real daily chart |
| **Assistant IA** | Simplified UI; Capacités / Garde-fous / Journal hidden |
| **Intégrations** | WhatsApp-only |
| **Automatisations** | Page removed; still in backend + Paramètres |
| **Relances / Patients** | Boards + drawers, multi-patient safe |
| **WhatsApp cancel** | Self-cancel with OUI/NON; audit as Assistant IA |
| **Notifications bell** | Cancellation only |
| **CRM reset** | Wipe `crm.sqlite` with backup; keep WA session + login |

---

## 15. One-sentence summary

**ChatBot HEL is a Node.js WhatsApp dental clinic assistant (JS + OpenAI + WhatsApp Web) with Darija/French NLU, SQLite Smart CRM, RBAC dashboard users, an append-only audit History (dashboard user or Assistant IA), and a React/TypeScript dashboard for messages, agenda, patients, relances, analytics, settings, and WhatsApp.**
