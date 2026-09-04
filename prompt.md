# ChatBot HEL — Project Prompt / Context

> Colle ce fichier dans ChatGPT (ou un autre LLM) pour expliquer **ce que fait le projet**, ses règles métier, et son architecture.
> Repo: https://github.com/phonedelta/ChatBot-HEL

**Dernière mise à jour :** 3 septembre 2026  
**Inclut :** confirmation multi-RDV, consultation des disponibilités WhatsApp, identité WhatsApp (LID/Android), moteur de créneaux partagé Agenda ↔ chatbot.

---

## 1. Qu’est-ce que ce projet ?

**ChatBot HEL / Smart CRM IA** est un **assistant WhatsApp autonome** + un **tableau de bord opérationnel (Smart CRM)** pour le **Centre Dentaire HEL** (cabinet dentaire à El Oulfa, Casablanca, Maroc).

### Ce que le système fait concrètement

1. Se connecte à WhatsApp via **WhatsApp Web** (session QR + Puppeteer).
2. Répond aux patients en **français** ou **darija marocaine** (réponses darija = **écriture arabe uniquement**).
3. Comprend le **texte** et les **messages vocaux** (Whisper + NLU Darija).
4. Gère la **prise de rendez-vous** (formulaire CRM → résumé → confirmation patient).
5. Affiche les **disponibilités réelles** du cabinet (mêmes créneaux que l’Agenda).
6. Demande la **confirmation 24h** avant le RDV, gère multi-patients / multi-RDV sur un même numéro.
7. Permet l’**annulation** par le patient (avec confirmation OUI/NON).
8. Propose des **créneaux** envoyés par le staff depuis le dashboard.
9. Expose un **dashboard React** : Aujourd’hui, Messages, Agenda, Patients, Relances, Assistant IA, Analyses, Historique, Intégrations, Paramètres (RBAC admin / secrétaire).

### Ce que le système ne fait PAS

- Pas de diagnostic médical, pas de prescription.
- **N’invente jamais** les horaires, les prix, ni les créneaux disponibles.
- Ne crée pas de RDV tant que le patient n’a pas confirmé le résumé (sauf flux dashboard manuel).
- Ne traite pas le numéro WhatsApp comme l’identité unique d’un patient (famille / téléphone partagé).

---

## 2. Parcours patient typiques (WhatsApp)

### A. Prise de rendez-vous classique

1. Patient : « Bghit nakhud rendez-vous » / « Je veux un rendez-vous ».
2. Bot envoie un **formulaire en un seul message** (tous les champs d’un coup).
3. Champs : **prénom + nom**, motif dentaire, téléphone, ville, jour + heure.
4. Résumé → patient répond **نعم / OUI**.
5. RDV créé en statut **`non_confirme`** (UI : **À confirmer**).
6. Plus tard : rappel WhatsApp de confirmation → OUI = **Confirmé**, NON = **Annulé**.

### B. Consultation des disponibilités (nouvelle fonctionnalité)

1. Patient : « Chno les rendez-vous disponibles ? » / « Quels créneaux sont disponibles ? »
2. Bot demande **jour + mois** (ex. `05/09`) s’ils ne sont pas déjà dans le message.
3. Bot récupère **tous les créneaux libres** de ce jour via le **même moteur que l’Agenda**.
4. Affiche une liste numérotée (matin / après-midi).
5. Patient choisit par **numéro** (`3`) ou par **heure** (`11:00`).
6. Le bot **mémorise date + heure** dans le brouillon de réservation, **sans créer le RDV**.
7. Il continue le formulaire pour les infos encore manquantes (nom, téléphone, etc.) — **sans effacer** ce qui était déjà collecté.

Intent : `CHECK_APPOINTMENT_AVAILABILITY`  
États : `awaiting_availability_date` → `awaiting_available_slot_selection`

**Ne pas confondre** avec « Chno les rendez-vous **dyali** ? » (= mes propres RDV, pas les créneaux du cabinet).

### C. Confirmation 24h — un seul RDV

Rappel automatique → patient OUI/NON → confirmé ou annulé.

### D. Confirmation 24h — plusieurs RDV / plusieurs patients (corrigé)

Exemple : même WhatsApp pour **Salim** (11:00) et **Hasnae** (11:30).

1. Patient dit OUI → bot affiche une **liste numérotée stable**.
2. Patient répond `1`, `2`, ou le **nom** → sélection du bon RDV.
3. `1 2` / « بجوج » = les deux → confirmation groupée.
4. OUI final confirme **uniquement** le(s) RDV sélectionné(s).
5. **Jamais** mélanger Salim et Hasnae ; l’index affiché n’est **jamais** l’ID base de données.

États : `awaiting_selection` → `awaiting_confirmation` / `awaiting_multi_confirmation`  
Parser déterministe (pas le LLM) pour `1`, `2`, noms.

### E. Annulation patient

Intent annulation → liste des RDV à venir → choix → **OUI pour confirmer l’annulation**.  
Libère le créneau + notification cloche dashboard. Pas de proposition auto WhatsApp.

### F. Proposition de créneau (staff → patient)

Depuis l’Agenda, un utilisateur dashboard propose un nouveau créneau.  
Patient OUI/NON. Actor Historique = **utilisateur dashboard** (pas le patient).

### G. RDV manuel dashboard

Création Agenda / Patients → peut envoyer une confirmation WhatsApp en darija si session connectée. Entre dans le même pipeline rappels / Relances.

---

## 3. Règles métier importantes

### Langues

| Patient parle | Bot répond |
|---------------|------------|
| Français | Français uniquement |
| Darija (clavier latin ou arabe) | **Arabe script** uniquement (jamais de darija latin dans les réponses) |

### Horaires cabinet (règle dure)

| Jour | Horaires |
|------|----------|
| Lun–Ven | 10:30 → 19:00 |
| Samedi | 09:30 → 13:00 |
| Dimanche | Fermé |

### Paramètres rendez-vous (dashboard → Paramètres)

Le chatbot **respecte automatiquement** :

- Durée standard d’un créneau (15–90 min)
- Délai minimum avant RDV (lead time)
- Réservation max à l’avance (horizon)
- Autoriser ou non le **jour même**
- Délais d’annulation / report
- Rappels de confirmation (24h, 4h, etc.)

### Multi-patient (fondamental)

```
Contact WhatsApp (+212…)
    ├── Patient Salim Zouhairi
    ├── Patient Hasnae Zouhairi
    └── Patient Yassine …
```

- Le **téléphone = canal de contact**, pas l’identité patient.
- `contactId ≠ patientId`.
- Après sélection d’un RDV : la vérité = `appointment.patientId` / `customer_id`.
- Ne jamais convertir un JID technique `@lid` en « numéro de téléphone ».

### Identité WhatsApp (Android / iOS)

- Session multi-appareils Android peut exposer un **LID** (`…@lid`) au lieu d’un MSISDN.
- Module `whatsapp-identity.js` : résolution du vrai numéro, routage, envoi.
- Intégrations : « connecté » seulement quand session **ready** ; ne jamais afficher un ID technique comme téléphone.
- Bibliothèque : **whatsapp-web.js** (pas Baileys).

### Handoff humain

- Staff : **Prendre la main** dans Messages.
- En `HUMAN_CONTROLLED` : le bot ne répond plus automatiquement.
- Actor = utilisateur dashboard authentifié.

### Garde-fous assistant

- Pas de diagnostic / pas de conseil clinique non autorisé.
- Transfert humain si besoin.
- Jamais inventer disponibilités, prix, horaires.

---

## 4. Architecture (vue d’ensemble)

```
Patient (WhatsApp)
        │
        ▼
┌────────────────────────────────────────────────┐
│  Service Node.js (Express)                     │
│  whatsapp/src/index.js  — port :8081           │
│                                                │
│  • whatsapp-web.js + Puppeteer                 │
│  • OpenAI (chat) + Whisper (voix)              │
│  • Intent Router + Voice NLU                   │
│  • Handlers déterministes (cancel, confirm,    │
│    disponibilités, propositions de créneau)    │
│  • CRM workflow (booking)                      │
│  • Smart CRM + API dashboard + RBAC            │
└──────────────┬─────────────────────────────────┘
               │
     ┌─────────┴──────────┐
     ▼                    ▼
 SQLite CRM          Dashboard React
 storage/crm.sqlite  http://127.0.0.1:8081/dashboard
```

### Pipeline d’un message entrant (ordre de priorité)

1. Réception WhatsApp (texte / audio).
2. Audio → ffmpeg → Whisper → NLU.
3. Détection langue + **Intent Router**.
4. Handlers **déterministes** (avant le LLM) :
   - Annulation patient
   - Réponse à une proposition de créneau staff
   - Confirmation 24h (y compris sélection multi-RDV)
   - **Consultation disponibilités** (date → liste → choix créneau)
5. Workflow CRM booking (formulaire / résumé / OUI) si pertinent.
6. Sinon LLM + base de connaissances cabinet.
7. Réponse WhatsApp + persistance messages / conversations / Historique.

Les templates booking / confirmation / listes de créneaux sont **exacts** (`shouldSkipLlm: true`) — le LLM ne doit pas les réécrire.

### Source de vérité des créneaux

Fonction partagée : **`getBookableSlotsForDate()`** dans `appointment-slots.js`.

Utilisée par :

- Agenda (dashboard)
- Chatbot disponibilités
- Alternatives de créneaux booking
- (même règles : horaires, durée, RDV bloquants, lead time, same-day, horizon)

Statuts qui **bloquent** un créneau : `non_confirme`, `pending_confirmation`, `confirmed` (via `isAppointmentSlotBlocking`).  
`cancelled` ne bloque plus le créneau.

---

## 5. Technologies

| Couche | Tech |
|--------|------|
| Runtime | Node.js, JavaScript CommonJS |
| HTTP | Express |
| WhatsApp | whatsapp-web.js + Puppeteer |
| IA | OpenAI Chat + Whisper |
| DB | SQLite (`node:sqlite`) |
| Dashboard | React 19, TypeScript, Vite, Tailwind 4 |
| Charts | recharts |
| Icons | lucide-react |

### Design HEL

```
Primary Navy    #12324A
Medical Cyan    #13AEC1
Background      #F5FAFC
Font            Manrope
```

---

## 6. Structure du dépôt (principale)

```
ChatBot-HEL/
├── prompt.md
├── docker-compose.yml          # déploiement (ex. Hetzner)
├── scripts/deploy-*.ps1
└── whatsapp/
    ├── package.json
    ├── .env                    # secrets — NE PAS commit
    ├── scripts/                # tests d’intégration
    ├── storage/                # données runtime (gitignore)
    ├── dashboard-app/          # source React
    └── src/
        ├── index.js            # boucle WhatsApp + API
        ├── whatsapp-identity.js
        ├── knowledge/
        ├── dashboard/          # auth, RBAC, smart-routes, SPA dist/
        ├── crm/
        │   ├── workflow.js
        │   ├── repository.js
        │   ├── appointment-slots.js      # moteur créneaux partagé
        │   ├── working-hours.js
        │   ├── contact-patients.js       # multi-patient
        │   ├── binary-confirmation.js    # OUI/NON
        │   └── smart/
        │       ├── agenda-board.js
        │       ├── appointment-confirmation.js
        │       ├── appointment-selection.js
        │       ├── availability-flow.js
        │       ├── availability-date.js
        │       ├── availability-slot-select.js
        │       ├── whatsapp-cancel.js
        │       ├── slot-proposals.js
        │       ├── manual-appointment-flow.js
        │       ├── cabinet-settings.js
        │       ├── activity-history.js
        │       ├── followups-board.js
        │       ├── patients-board.js
        │       ├── analytics-board.js
        │       ├── conversation-routing.js
        │       └── knowledge-prompt.js
        └── voice-nlu/          # intent router, classifiers, Darija
```

---

## 7. Dashboard Smart CRM

**URL locale :** `http://127.0.0.1:8081/dashboard`

| Route | Page | Rôle |
|-------|------|------|
| `/` | Aujourd’hui | KPIs du jour |
| `/messages` | Messages | Inbox WhatsApp + handoff |
| `/agenda` | Agenda | Créneaux réels, RDV, propositions |
| `/patients` | Patients | Fiches, multi-patient |
| `/relances` | Relances | Non confirmés, no-response, etc. |
| `/assistant` | Assistant IA | Pause, personnalité, knowledge |
| `/analyses` | Analyses | KPIs période |
| `/historique` | Historique | Audit append-only |
| `/integrations` | Intégrations | WhatsApp QR / session |
| `/parametres` | Paramètres | Users, RDV, rappels, sécu, notifs |

### Historique — « Exécuté par »

| Autorisé | Interdit |
|----------|----------|
| Compte dashboard réel (Admin, Sawsane…) | Patient |
| **Assistant IA** | Système, Équipe, Bot, WhatsApp (comme acteur) |

- Actor = qui a exécuté dans le CRM.
- Origin = dashboard / whatsapp_patient / automation / scheduler…
- Mutations WhatsApp auto → **Assistant IA**.
- Clics dashboard → **utilisateur session** (jamais `req.body.actor`).

### Notifications cloche

- Principalement sur **annulation** (créneau libéré).
- Son configurable dans Paramètres.

### RBAC

- `admin` : tout.
- `secretary` : permissions explicites.
- Users dans SQLite (`dashboard_users`).

---

## 8. Intents WhatsApp (principaux)

| Intent | Signification |
|--------|----------------|
| `BOOK_APPOINTMENT` | Veut réserver (verbe explicite) |
| `CHECK_APPOINTMENT_AVAILABILITY` | Veut voir les créneaux libres du cabinet |
| `LIST_MY_APPOINTMENTS` | Veut ses propres RDV |
| `CANCEL_APPOINTMENT` | Veut annuler |
| `RESCHEDULE_APPOINTMENT` | Veut déplacer |
| `ASK_SERVICES` | Liste des soins / services |
| `ASK_OPENING_HOURS` / `ASK_LOCATION` / `ASK_PRICE` | FAQ cabinet |
| `DENTAL_PAIN` / `DENTAL_EMERGENCY` | Douleur / urgence |
| `GREETING` / `THANKS` / `OTHER` | Conversation |

Le routing **contextuel** (state machine) a priorité sur le LLM pour : sélection de créneau, OUI/NON confirmation, sélection multi-RDV, annulation.

---

## 9. Modules backend clés

| Module | Rôle |
|--------|------|
| `appointment-slots.js` | Disponibilité partagée Agenda ↔ bot |
| `availability-flow.js` | Flow WhatsApp « créneaux disponibles » |
| `appointment-confirmation.js` | Rappels 24h + confirmation / multi-sélection |
| `appointment-selection.js` | Parser `1` / `2` / noms / multi |
| `whatsapp-cancel.js` | Annulation patient |
| `slot-proposals.js` | Propositions staff |
| `manual-appointment-flow.js` | RDV dashboard + WhatsApp |
| `cabinet-settings.js` | Paramètres métier persistés |
| `contact-patients.js` | Contact ↔ plusieurs patients |
| `whatsapp-identity.js` | LID / téléphone / routage envoi |
| `workflow.js` | Collecte booking CRM |
| `knowledge-prompt.js` | Knowledge live pour l’Assistant |
| `activity-history.js` | Journal d’audit |

---

## 10. Données & stockage local

| Chemin | Contenu |
|--------|---------|
| `whatsapp/storage/crm.sqlite` | CRM + Smart CRM + users + history |
| `whatsapp/storage/sessions/` | Session WhatsApp LocalAuth |
| `whatsapp/storage/ai-conversations.json` | Mémoire LLM |
| `whatsapp/storage/dashboard-sessions.json` | Sessions dashboard |
| `whatsapp/.env` | Secrets (jamais commit) |

---

## 11. Lancer en local

```powershell
cd whatsapp
npm install
# .env avec OPENAI_API_KEY
npm start
```

Dashboard : `http://127.0.0.1:8081/dashboard`  
Rebuild UI : `npm run build:dashboard` puis relancer `npm start`.

### Tests utiles

```powershell
npm run test:chatbot-availability-flow
npm run test:multi-appointment-selection
npm run test:appointment-confirmation
npm run test:whatsapp-cancel
npm run test:whatsapp-identity
npm run test:agenda
npm run test:multi-patient-contact
npm run test:history
npm run test:crm
```

Un seul process bot sur le port **8081**.

### Déploiement

- Historique : Railway (`chatbot-hel.up.railway.app`).
- Scripts Hetzner / Docker : `docker-compose.yml`, `scripts/deploy-direct.ps1`.

---

## 12. Variables d’environnement (principales)

Voir `whatsapp/.env.example` :

- `OPENAI_API_KEY` — chat + Whisper
- `CRM_ENABLED=true`
- `CRM_DB_PATH=./storage/crm.sqlite`
- `AI_REPLY_TO_AUDIO=true`
- `AI_VOICE_NLU_ENABLED=true`
- `AI_KNOWLEDGE_PATH=./src/knowledge/centre-dentaire-hel.md`
- `PORT=8081`
- Auth dashboard (bootstrap legacy) : `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`

---

## 13. Contraintes pour un agent / développeur IA

1. Diffs **minimales** et ciblées.
2. Templates booking / listes / confirmations = texte **exact**, pas de réécriture LLM.
3. Réponses darija = **arabe script**.
4. Nom complet = **prénom + nom** (au moins 2 mots).
5. Ne pas ouvrir le formulaire booking sur une simple mention de soin.
6. Tokens HEL (Navy / Cyan / Manrope).
7. Pas d’enums bruts dans l’UI.
8. Analytics = données réelles uniquement.
9. Notifications cloche : surtout annulations.
10. Multi-patient + anti-mélange RDV : règles non négociables.
11. Historique « Exécuté par » : dashboard user **ou** Assistant IA.
12. Actor dashboard depuis la **session**, jamais le body client.
13. **Aucun créneau inventé** — toujours `getBookableSlotsForDate` / Agenda.
14. Commit / push uniquement si l’utilisateur le demande.

---

## 14. Journal des évolutions récentes (août–septembre 2026)

| Domaine | Évolution |
|---------|-----------|
| **Disponibilités WhatsApp** | Intent + demande date + liste complète créneaux + choix n°/heure + reprise booking |
| **Moteur créneaux** | `getBookableSlotsForDate` partagé Agenda ↔ chatbot + settings |
| **Confirmation multi-RDV** | Snapshot candidats, parser index/nom/multi, plus de boucle « حدد شكون » |
| **Identité WA** | Gestion LID Android, téléphone réel, Intégrations « ready » |
| **RDV manuel** | Confirmation WhatsApp depuis dashboard |
| **Knowledge** | Assistant branché sur knowledge DB live |
| **Historique / RBAC** | Audit dashboard_user \| assistant_ai ; users & permissions |
| **Paramètres** | RDV, rappels, automations, sécurité, notifications |
| **Annulation patient** | Flow OUI/NON + cloche créneau libéré |
| **UI** | Assistant simplifié ; Intégrations WhatsApp-only |

---

## 15. Résumé en une phrase

**ChatBot HEL est un assistant WhatsApp dentaire (Node.js + OpenAI + WhatsApp Web) qui réserve et confirme des rendez-vous en français/darija, affiche les vraies disponibilités du cabinet, gère les familles multi-patients, et s’accompagne d’un Smart CRM React (agenda, relances, historique audité, RBAC) pour le Centre Dentaire HEL.**

---

## 16. Phrase de validation produit

> Quand un patient demande les rendez-vous disponibles, le chatbot lui demande le jour et le mois s’ils ne sont pas déjà précisés, récupère tous les vrais créneaux de cette journée depuis le même moteur que l’Agenda, les affiche clairement, permet de choisir par numéro ou par heure, puis continue la réservation sans perdre les informations déjà collectées.  
> Quand plusieurs RDV sont à confirmer sur le même WhatsApp, `1`, `2`, un nom ou une sélection multiple sont compris immédiatement, sans répéter la liste et sans mélanger les patients.
