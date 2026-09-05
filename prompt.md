# ChatBot HEL — Project Prompt / Context

> Colle ce fichier dans ChatGPT (ou un autre LLM) pour expliquer **ce que fait le projet**, ses règles métier, et son architecture.
> Repo: https://github.com/phonedelta/ChatBot-HEL

**Dernière mise à jour :** 4 septembre 2026  
**Inclut :** booking robuste (Darija / heures / alternatives de créneaux / corrections du récap), NLU Darija hybride, confirmation multi-RDV, disponibilités WhatsApp, identité WhatsApp (LID/Android), moteur de créneaux partagé Agenda ↔ chatbot, déploiement Hetzner.

---

## 1. Qu’est-ce que ce projet ?

**ChatBot HEL / Smart CRM IA** est un **assistant WhatsApp autonome** + un **tableau de bord opérationnel (Smart CRM)** pour le **Centre Dentaire HEL** (cabinet dentaire à El Oulfa, Casablanca, Maroc).

### Ce que le système fait concrètement

1. Se connecte à WhatsApp via **WhatsApp Web** (session QR + Puppeteer).
2. Répond aux patients en **français** ou **darija marocaine** (réponses darija = **écriture arabe uniquement**).
3. Comprend le **texte** et les **messages vocaux** (Whisper + NLU Darija / Arabizi).
4. Gère la **prise de rendez-vous** (collecte progressive ou formulaire → résumé → confirmation patient).
5. Affiche les **disponibilités réelles** du cabinet (mêmes créneaux que l’Agenda).
6. Propose des **alternatives** si un créneau est occupé, sans perdre la date ni le brouillon.
7. Demande la **confirmation 24h** avant le RDV, gère multi-patients / multi-RDV sur un même numéro.
8. Permet l’**annulation** par le patient (avec confirmation OUI/NON explicite).
9. Propose des **créneaux** envoyés par le staff depuis le dashboard.
10. Expose un **dashboard React** : Aujourd’hui, Messages, Agenda, Patients, Relances, Assistant IA, Analyses, Historique, Intégrations, Paramètres (RBAC admin / secrétaire).

### Ce que le système ne fait PAS

- Pas de diagnostic médical, pas de prescription.
- **N’invente jamais** les horaires, les prix, ni les créneaux disponibles.
- Ne crée pas de RDV tant que le patient n’a pas confirmé le résumé (sauf flux dashboard manuel).
- Ne traite pas le numéro WhatsApp comme l’identité unique d’un patient (famille / téléphone partagé).
- Ne transforme **jamais** une réponse floue au récapitulatif en annulation automatique.

---

## 2. Parcours patient typiques (WhatsApp)

### A. Prise de rendez-vous classique

1. Patient : « Bghit nakhud rendez-vous » / « Je veux un rendez-vous ».
2. Bot collecte les infos (formulaire bulk et/ou messages progressifs).
3. Champs : **prénom + nom**, motif dentaire, téléphone, ville, jour + heure.
4. Formats naturels acceptés pour date/heure, dont Darija latin :
   - `Ghda m3a 14h`, `gheda 14h`, `demain à 11h`
   - `12h30`, `12 h 30`, `12:30`, `14h`, `14:00`
5. Résumé → patient répond **نعم / OUI** (strict).
6. RDV créé en statut **`non_confirme`** (UI : **À confirmer**).
7. Plus tard : rappel WhatsApp de confirmation → OUI = **Confirmé**, NON = **Annulé**.

### B. Créneau indisponible → alternatives (corrigé)

1. Patient demande une date/heure (ex. demain 11:00) déjà prise.
2. Bot conserve **la date** et le brouillon, propose des alternatives (ex. 10:30 / 12:00 / 12:30).
3. État : `awaiting_field = slot_alternative` (+ candidats en `correction_json`).
4. Patient répond `12h30` / `12:30` / index `3` → sélection du créneau **pour la date mémorisée**.
5. **Revalidation** via `getBookableSlotsForDate` / `checkSlotAvailability` avant d’accepter.
6. **Ne pas** redemander « jour et heure » depuis zéro.

### C. Consultation des disponibilités

1. Patient : « Chno les rendez-vous disponibles ? » / « Quels créneaux sont disponibles ? »
2. Bot demande **jour + mois** (ex. `05/09`) s’ils ne sont pas déjà dans le message.
3. Bot récupère **tous les créneaux libres** via le **même moteur que l’Agenda**.
4. Affiche une liste numérotée ; choix par **numéro** (`3`) ou **heure** (`11:00` / `11h`).
5. Mémorise date + heure dans le brouillon **sans créer le RDV**, puis complète les champs manquants.

Intent : `CHECK_APPOINTMENT_AVAILABILITY`  
États : `awaiting_availability_date` → `awaiting_available_slot_selection`

**Ne pas confondre** avec « Chno les rendez-vous **dyali** ? » (= mes propres RDV).

### D. Récapitulatif — confirmation / correction / annulation (corrigé)

Ordre de traitement pendant `awaiting_field = confirmation` :

1. **OUI** explicite → créer le RDV `non_confirme`.
2. **NON** explicite → menu **modifier** (pas annulation définitive).
3. **Correction de champ** détectée (nom, tél, ville, motif, date, heure) → patch partiel du draft → nouveau récap.
4. **Nom incomplet** (`Smyti Issam`) → demander prénom + nom, **conserver** le reste du draft.
5. **Annulation explicite** seulement (`annuler`, `bghit nlghi`, إلخ) → confirmation d’annulation du *draft*.
6. Entrée inconnue → **clarification** (rester en confirmation). **Jamais** `unclear_cancel_confirm` implicite.

Exemples de correction nom : `Smyti Issam Alaoui`, `Mon nom c'est Issam Alaoui`, `سميتي عصام العلوي`.

### E. Confirmation 24h — un seul RDV

Rappel automatique → patient OUI/NON → confirmé ou annulé.

### F. Confirmation 24h — plusieurs RDV / plusieurs patients

Exemple : même WhatsApp pour **Salim** (11:00) et **Hasnae** (11:30).

1. Patient dit OUI → bot affiche une **liste numérotée stable**.
2. Patient répond `1`, `2`, ou le **nom** → sélection du bon RDV.
3. `1 2` / « بجوج » = les deux → confirmation groupée.
4. OUI final confirme **uniquement** le(s) RDV sélectionné(s).
5. L’index affiché n’est **jamais** l’ID base de données.

États : `awaiting_selection` → `awaiting_confirmation` / `awaiting_multi_confirmation`  
Parser déterministe (pas le LLM) pour `1`, `2`, noms.

### G. Annulation patient

Intent annulation → liste des RDV à venir → choix → **OUI pour confirmer l’annulation**.  
Libère le créneau + notification cloche dashboard. Pas de proposition auto WhatsApp.

### H. Proposition de créneau (staff → patient)

Depuis l’Agenda, un utilisateur dashboard propose un nouveau créneau.  
Patient OUI/NON. Actor Historique = **utilisateur dashboard** (pas le patient).

### I. RDV manuel dashboard

Création Agenda / Patients → peut envoyer une confirmation WhatsApp. Entre dans le même pipeline rappels / Relances.

---

## 3. Règles métier importantes

### Langues

| Patient parle | Bot répond |
|---------------|------------|
| Français | Français uniquement |
| Darija (clavier latin / Arabizi ou arabe) | **Arabe script** uniquement (jamais de darija latin dans les réponses) |

Un message uniquement numérique (`12h30`) hérite de la **langue de conversation** déjà établie.

### Parsing temporel / dates (unifié)

Fonction partagée : **`normalizeTimeExpression()`** dans `appointment-slots.js`.

| Entrée | Normalisé |
|--------|-----------|
| `11h` / `14h` | `11:00` / `14:00` |
| `12h30` / `12 h 30` / `12H30` | `12:30` |
| `12:30` | `12:30` |

Dates relatives Darija (extraites via `extract.js` / helpers) :

| Variante | Sens |
|----------|------|
| `lyoum` / `اليوم` | aujourd’hui |
| `ghda` / `gheda` / `ghdda` / `غدا` | demain |
| `mn b3d ghda` / `بعد غدا` | après-demain |

**Ne pas** appliquer la conversion Arabizi `3 → ع` sur les chiffres seuls (sélection `3`, dates, téléphones).

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
- Une correction de nom au récap **ne rattache pas** arbitrairement à un autre patient.

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
- Le LLM **ne décide jamais** qu’un créneau existe, ne confirme pas un RDV, ne choisit pas un patient.

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
│  • Intent Router + Voice NLU (Darija hybride) │
│  • Handlers déterministes (cancel, confirm,    │
│    disponibilités, propositions, alternatives) │
│  • CRM workflow (booking state machine)        │
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
3. Détection langue + **Intent Router** (lexique Darija + fallback sémantique).
4. **State machine en priorité** sur l’intent global :
   - `slot_alternative` + `12h30` → choix d’alternative
   - confirmation récap + `Smyti …` → correction nom
   - etc.
5. Handlers **déterministes** (avant le LLM) :
   - Annulation patient
   - Réponse à une proposition de créneau staff
   - Confirmation 24h (y compris sélection multi-RDV)
   - Consultation disponibilités
6. Workflow CRM booking (formulaire / résumé / OUI) si pertinent.
7. Sinon LLM + base de connaissances cabinet.
8. Réponse WhatsApp + persistance messages / conversations / Historique.

Les templates booking / confirmation / listes de créneaux sont **exacts** (`shouldSkipLlm: true`) — le LLM ne doit pas les réécrire.

### Source de vérité des créneaux

Fonction partagée : **`getBookableSlotsForDate()`** dans `appointment-slots.js`.

Aussi : `normalizeTimeExpression()`, `checkSlotAvailability()`, `listAvailableSlotTimes()`.

Utilisée par :

- Agenda (dashboard)
- Chatbot disponibilités
- Alternatives après créneau indisponible
- Booking / corrections d’heure

Statuts qui **bloquent** un créneau : `non_confirme`, `pending_confirmation`, `confirmed`.  
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
├── Dockerfile                  # image Node 22 + Chromium
├── docker-compose.yml          # VPS / Hetzner
├── scripts/
│   ├── deploy-direct.ps1       # upload tar → deploy-chatbot@VPS
│   └── deploy.config.example.ps1
└── whatsapp/
    ├── package.json
    ├── .env                    # secrets — NE PAS commit
    ├── .env.example
    ├── scripts/                # tests d’intégration
    ├── storage/                # données runtime (gitignore)
    ├── dashboard-app/          # source React
    └── src/
        ├── index.js            # boucle WhatsApp + API
        ├── whatsapp-identity.js
        ├── knowledge/
        ├── dashboard/          # auth, RBAC, smart-routes, SPA dist/
        ├── crm/
        │   ├── workflow.js                 # state machine booking
        │   ├── booking-confirmation-flow.js
        │   ├── booking-corrections.js
        │   ├── repository.js
        │   ├── appointment-slots.js        # créneaux + normalizeTimeExpression
        │   ├── extract.js                  # dates/heures Darija+FR
        │   ├── working-hours.js
        │   ├── contact-patients.js
        │   ├── binary-confirmation.js
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
        └── voice-nlu/
            ├── intent-classifier.js / intent-router.js / intent-table.js
            ├── darija-lexicon.js
            ├── darija-normalizer.js
            └── semantic-intent-fallback.js
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
- Les propositions de créneau staff **ne** créent **pas** de notif cloche.

### RBAC

- `admin` : tout.
- `secretary` : permissions explicites.
- Users dans SQLite (`dashboard_users`).
- API protégée par permission — pas seulement masquer un bouton UI.

---

## 8. Intents WhatsApp (principaux)

| Intent | Signification |
|--------|----------------|
| `BOOK_APPOINTMENT` | Veut réserver (verbe explicite) |
| `CHECK_APPOINTMENT_AVAILABILITY` | Veut voir les créneaux libres du cabinet |
| `LIST_MY_APPOINTMENTS` | Veut ses propres RDV |
| `CANCEL_APPOINTMENT` | Veut annuler |
| `RESCHEDULE_APPOINTMENT` | Veut déplacer / changer (pas cancel) |
| `ASK_SERVICES` | Liste des soins / services |
| `ASK_OPENING_HOURS` / `ASK_LOCATION` / `ASK_PRICE` | FAQ cabinet |
| `DENTAL_PAIN` / `DENTAL_EMERGENCY` | Douleur / urgence |
| `GREETING` / `THANKS` / `OTHER` | Conversation |

Le routing **contextuel** (state machine) a priorité sur le LLM pour : sélection de créneau, alternatives, OUI/NON confirmation, corrections du récap, sélection multi-RDV, annulation.

---

## 9. Modules backend clés

| Module | Rôle |
|--------|------|
| `appointment-slots.js` | Disponibilité + `normalizeTimeExpression` |
| `workflow.js` | Collecte booking + `slot_alternative` + récap |
| `booking-confirmation-flow.js` | OUI/NON, NON→modifier, cancel explicite, templates |
| `booking-corrections.js` | Corrections inline (smyti, téléphone, ville…) |
| `extract.js` | Dates relatives Darija + heure embarquée |
| `availability-flow.js` | Flow WhatsApp « créneaux disponibles » |
| `availability-slot-select.js` | Parser sélection créneau (index / heure) |
| `appointment-confirmation.js` | Rappels 24h + confirmation / multi-sélection |
| `appointment-selection.js` | Parser `1` / `2` / noms / multi |
| `whatsapp-cancel.js` | Annulation patient |
| `slot-proposals.js` | Propositions staff |
| `manual-appointment-flow.js` | RDV dashboard + WhatsApp |
| `cabinet-settings.js` | Paramètres métier persistés |
| `contact-patients.js` | Contact ↔ plusieurs patients |
| `whatsapp-identity.js` | LID / téléphone / routage envoi |
| `darija-lexicon.js` / `darija-normalizer.js` | Lexique + normalisation Arabizi |
| `semantic-intent-fallback.js` | Intent de secours Darija |
| `knowledge-prompt.js` | Knowledge live pour l’Assistant |
| `activity-history.js` | Journal d’audit |

---

## 10. Données & stockage local

| Chemin | Contenu |
|--------|---------|
| `whatsapp/storage/crm.sqlite` | CRM + Smart CRM + users + history |
| `whatsapp/storage/sessions/` ou `wa-auth/` | Session WhatsApp LocalAuth |
| `whatsapp/storage/ai-conversations.json` | Mémoire LLM |
| `whatsapp/storage/dashboard-sessions.json` | Sessions dashboard |
| `whatsapp/.env` | Secrets (jamais commit) |

**Ne jamais supprimer** ces chemins runtime (sessions, SQLite, `.env`).

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

### Tests utiles (lire `package.json` — ne pas inventer de scripts)

```powershell
npm run test:booking-input-normalization
npm run test:booking-confirmation-corrections
npm run test:booking-corrections
npm run test:darija-understanding
npm run test:chatbot-availability-flow
npm run test:multi-appointment-selection
npm run test:appointment-confirmation
npm run test:whatsapp-cancel
npm run test:whatsapp-identity
npm run test:agenda
npm run test:multi-patient-contact
npm run test:history
npm run test:dashboard-rbac
npm run test:cabinet-settings
npm run test:crm
npm run smoke
```

Debug optionnel : `CRM_DEBUG_BOOKING=1`, `CRM_DEBUG_DARIJA=1`.

Un seul process bot sur le port **8081**.

### Déploiement Hetzner

```powershell
cd "C:\Users\Pc\Desktop\Chatbot HEL"
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-direct.ps1
```

- Compte SSH forcé : `deploy-chatbot@46.224.49.33` (clé `~/.ssh/chatbot_hel_deploy`).
- Le script **stage** un arbre propre : garde `.env.example`, exclut `.env` / `.env.hostinger` / secrets, build le dashboard localement, envoie un tar `ustar`.
- Docker : `Dockerfile` + `docker-compose.yml` (volume `./data/storage`).
- Si échec à « Building in an isolated account… » : problème **serveur** (builder isolé). Il faut un accès **root / console Hetzner** pour les logs — la clé deploy ne donne pas de shell.
- Ne pas committer `scripts/deploy.config.ps1` (gitignore).

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
4. Nom complet = **prénom + nom** (au moins 2 mots) ; nom incomplet → redemander, **pas** annuler.
5. Ne pas ouvrir le formulaire booking sur une simple mention de soin.
6. State machine **avant** intent global (ex. `12h30` en `slot_alternative`).
7. Tokens HEL (Navy / Cyan / Manrope).
8. Pas d’enums bruts dans l’UI.
9. Analytics = données réelles uniquement.
10. Notifications cloche : surtout annulations.
11. Multi-patient + anti-mélange RDV : règles non négociables.
12. Historique « Exécuté par » : dashboard user **ou** Assistant IA.
13. Actor dashboard depuis la **session**, jamais le body client.
14. **Aucun créneau inventé** — toujours `getBookableSlotsForDate` / Agenda ; revalider avant acceptation.
15. Correction = **patch partiel** du draft (ne jamais vider téléphone/date/heure sans raison).
16. Commit / push / deploy uniquement si l’utilisateur le demande.
17. Ne jamais supprimer `.env`, SQLite, sessions WhatsApp, ni fichiers runtime « non importés ».

---

## 14. Journal des évolutions récentes (août–septembre 2026)

| Domaine | Évolution |
|---------|-----------|
| **Booking parsers** | `normalizeTimeExpression` ; `12h30` / `14h` / `Ghda m3a 14h` ; dates relatives Darija |
| **Alternatives créneau** | État `slot_alternative` ; date conservée ; revalidation Agenda |
| **Récapitulatif** | Corrections nom/tél/ville… ; nom incomplet → ask full name ; plus d’annulation implicite ; NON = modifier |
| **Darija NLU** | Lexique + normalizer + fallback sémantique ; protection chiffres/dates/tél |
| **Disponibilités WhatsApp** | Intent + liste créneaux + choix n°/heure + reprise booking |
| **Moteur créneaux** | `getBookableSlotsForDate` partagé Agenda ↔ chatbot + settings |
| **Confirmation multi-RDV** | Snapshot candidats, parser index/nom/multi |
| **Identité WA** | LID Android, téléphone réel, Intégrations « ready » |
| **RDV manuel** | Confirmation WhatsApp depuis dashboard |
| **Knowledge** | Assistant branché sur knowledge DB live |
| **Historique / RBAC** | Audit dashboard_user \| assistant_ai ; users & permissions |
| **Annulation patient** | Flow OUI/NON + cloche créneau libéré |
| **Déploiement** | `deploy-direct.ps1` staging sécurisé + build dashboard local |
| **Tests** | `booking-input-normalization`, `darija-understanding`, RBAC, cabinet-settings, etc. |

---

## 15. Résumé en une phrase

**ChatBot HEL est un assistant WhatsApp dentaire (Node.js + OpenAI + WhatsApp Web) qui réserve et confirme des rendez-vous en français/darija (y compris Arabizi), comprend les formats d’heure et dates naturelles, affiche les vraies disponibilités du cabinet, gère les familles multi-patients, et s’accompagne d’un Smart CRM React (agenda, relances, historique audité, RBAC) pour le Centre Dentaire HEL.**

---

## 16. Phrase de validation produit

> Quand un patient demande les rendez-vous disponibles, le chatbot lui demande le jour et le mois s’ils ne sont pas déjà précisés, récupère tous les vrais créneaux de cette journée depuis le même moteur que l’Agenda, les affiche clairement, permet de choisir par numéro ou par heure, puis continue la réservation sans perdre les informations déjà collectées.  
> Quand un créneau demandé est pris, les alternatives restent liées à la date mémorisée : `12h30` sélectionne 12:30 sans redemander le jour.  
> `Ghda m3a 14h` est compris comme demain à 14:00.  
> Au récapitulatif, `Smyti Issam Alaoui` corrige le nom ; `Smyti Issam` demande le nom complet sans lancer d’annulation ; une phrase floue clarifie au lieu d’annuler.  
> Quand plusieurs RDV sont à confirmer sur le même WhatsApp, `1`, `2`, un nom ou une sélection multiple sont compris immédiatement, sans répéter la liste et sans mélanger les patients.
