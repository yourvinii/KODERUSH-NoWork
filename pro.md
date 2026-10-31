# PROJECT: AI-Powered Disaster Intelligence & Community Response Platform (Hackathon MVP)

You are building a hackathon prototype. We have ~3 hours total and 2 developers, so
prioritize a WORKING END-TO-END DEMO over completeness. Keep code simple, readable, and
runnable locally. DO NOT do any deployment/Docker/CI work, we will deploy at the end.

## THE IDEA
A platform that sits between existing data sources (weather, official alerts), the
government, and citizens. We do NOT replace government systems, we connect them.

Core loop:
Official data (weather + alerts) -> risk per zone -> alert draft -> government approves
& broadcasts (demo SMS) -> citizens get alert, see live map, submit ground reports and
rescue requests -> reports get confidence/priority -> government verifies -> updated map
-> chatbot answers citizens using live data.

In production, the government's SMS system would send alerts; for the demo we simulate
SMS with our own "phone inbox" page.

## TECH STACK (fixed, do not change)
- Backend: Node.js + Express + Mongoose, MongoDB (Atlas connection string via .env)
- Frontend: React (Vite) + react-leaflet + plain CSS (or Tailwind), React Router
- Live updates: polling every 5 seconds (NO websockets)
- Chatbot: goggle gemini 3 API called from one Express route (key in .env)
- Scheduling: node-cron
- Monorepo: /server and /client
- Use environment variables for all secrets (MONGO_URI, ANTHROPIC_API_KEY, ADMIN_PASSWORD)

## EXPLICITLY OUT OF SCOPE (do not build)
Real SMS, offline/PWA sync, ML models, citizen accounts/login, websockets, photo/video
upload, multi-district support, raw satellite analysis, Docker, deployment config.

## DATA MODEL (Mongoose)
- Zone: name, polygon (GeoJSON Polygon), centroid (GeoJSON Point), riskLevel
  (LOW|MEDIUM|HIGH|SEVERE), riskReason, estimatedPopulation (Number), updatedAt
- Place: name, kind (SHELTER|FOOD|MEDICAL), location (GeoJSON Point, 2dsphere index),
  capacity, status (OPEN|FULL|CLOSED)
- Report: type (FLOODED_ROAD|BLOCKED_ROUTE|SHELTER_FULL|RESCUE), description,
  location (GeoJSON Point, 2dsphere index), status (UNVERIFIED|LIKELY|VERIFIED|RESOLVED),
  priority (Number, rescue only), rescue: {peopleCount, hasChildrenOrElderly,
  medicalEmergency, trapped, floorInfo}, createdAt
- Alert: zone (ref), title, message, severity, status (DRAFT|SENT), source
  (OPEN_METEO|GDACS|SACHET|MANUAL), createdAt, sentAt
- FeedItem: source, zone (ref, optional), severity, summary, raw (Mixed), fetchedAt

## API CONTRACT (implement exactly; the frontend is built against this)
Public:
- GET  /api/map      -> { zones:[...], places:[...], reports:[...non-resolved...] }
- POST /api/report   -> body: report fields; returns created report (with status/priority)
- GET  /api/alerts   -> list of SENT alerts, newest first
- POST /api/chat     -> body: { message } returns { reply }
Admin (header `x-admin-password` must equal ADMIN_PASSWORD):
- GET   /api/admin/feeds    -> { zones with riskLevel/riskReason/estimatedPopulation,
                                 draftAlerts:[...], recentFeedItems:[...] }
- GET   /api/admin/reports  -> all reports, rescue sorted by priority desc
- PATCH /api/admin/reports/:id -> body: { status } (VERIFIED|RESOLVED)
- POST  /api/admin/alerts   -> body: { draftId? , zoneId, title?, message? }; builds the
                               final message if not provided and marks it SENT

## BUILD ORDER
Build ONE chunk at a time. When a chunk is finished, tell me how to run/test it and STOP.
I will tell you which chunk to build next.

### CHUNK 0: Foundation (build this first)
- Scaffold /server (Express, CORS, Mongoose connection, error handling, dotenv, route
  files per resource, admin auth middleware) and /client (Vite React, router, a
  src/api.js with one function per endpoint and a base URL from VITE_API_URL).
- All Mongoose models above, with 2dsphere indexes where needed.
- Write CONTRACT.md in the repo root containing example JSON for every endpoint.
- Write server/seed.js: one fictional-but-realistic district with 5 zones (polygons
  with centroids), 10 places (shelters/food/medical), and 4 sample reports (one of each
  type incl. one RESCUE). Add `npm run seed`.
- Make every endpoint in the contract exist and return correct-shaped (stub or real)
  data, so the frontend can be built immediately.

### CHUNK 1: Feed ingestion + alert trigger
- node-cron job (every 10 min, plus a manual `POST /api/admin/feeds/refresh` for demos)
- For each Zone centroid, call Open-Meteo forecast API (free, no key:
  https://api.open-meteo.com/v1/forecast with hourly precipitation and wind speed).
  Compute riskLevel with simple, documented rules (e.g., 24h rainfall and max wind
  thresholds). Save riskLevel + riskReason on the Zone and a FeedItem.
- Also fetch an official alert feed. Try GDACS first (free RSS/GeoJSON). Make the source
  pluggable so SACHET (India's NDMA CAP RSS feed) can be added if accessible. Store
  results as FeedItems.
- When a zone reaches HIGH/SEVERE, or an official alert is found, create a DRAFT Alert
  for the government to approve (no duplicates for the same zone within 6 hours).
- IMPORTANT: if external feeds fail or nothing is active, fall back to seeded/cached
  sample data and never crash. Add a `npm run mock-alert` script that forces a
  SEVERE cyclone draft for demo purposes.

### CHUNK 2: Alert broadcast + demo SMS
- Implement POST /api/admin/alerts: build an SMS-style message (under ~300 chars)
  including the severity, zone name, roads/areas to avoid (from VERIFIED/LIKELY
  FLOODED_ROAD and BLOCKED_ROUTE reports near the zone), the nearest OPEN shelter and
  nearest food point (use MongoDB $near with approximate distance in km), the estimated
  population in the zone, and emergency number 112. Mark SENT with sentAt.
- GET /api/alerts returns SENT alerts.
- The message text should read like a real government emergency SMS.

### CHUNK 3: Reports, rescue, priority & confidence
- POST /api/report: validate input. For RESCUE compute priority as a documented
  weighted formula (medical +40, children/elderly +25, trapped +20, plus peopleCount).
- Confidence: for FLOODED_ROAD/BLOCKED_ROUTE/SHELTER_FULL, a $near query within ~300 m
  for other reports of the same type from the last 6 hours; if >=1 other exists, set
  status LIKELY on both. Admin PATCH sets VERIFIED/RESOLVED.
- GET /api/map returns zones, places and non-resolved reports.

### CHUNK 4: Citizen portal (React)
- Routes: / (map page), /sms (phone-mockup SMS inbox)
- Map page: full-screen react-leaflet map; zone polygons colored by riskLevel; place
  markers by kind; report markers colored by status (UNVERIFIED grey, LIKELY orange,
  VERIFIED red, rescue with a distinct icon); a toggle for a NASA GIBS satellite tile
  layer; latest-alert banner at the top; a floating "Report" button opening a form
  (type, description, tap-on-map or "use my location", plus rescue fields shown only for
  RESCUE); a floating chat button (widget calls POST /api/chat). Poll /api/map and
  /api/alerts every 5 s. Mobile-friendly.
- /sms: a phone-frame UI listing SENT alerts like SMS messages, newest first, polling
  every 5 s.
- Build against the contract and the seeded DB; do not wait for other chunks.

### CHUNK 5: Admin dashboard (React)
- Route /admin with a password gate (store password in memory/sessionStorage, send as
  x-admin-password).
- Panels: (1) Official Feeds: zones with risk badges, reason, estimated population,
  draft alerts each with a "Review & Broadcast" button (editable message preview, then
  send) and a "Refresh feeds" button; (2) Rescue Queue: sorted by priority with
  Verify/Resolve; (3) Reports awaiting verification with a mini map or coordinates,
  Verify/Resolve. Poll every 5 s. Clean, dashboard-style UI.

### CHUNK 6: Chatbot
- POST /api/chat: load zones (risk), OPEN places, VERIFIED+LIKELY reports, and the latest
  SENT alert from Mongo. Build a system prompt that gives Claude this context as JSON and
  instructs it to answer ONLY from this data, be short and calm, mention distances,
  say it doesn't know when the data doesn't cover it, and always include 112 for
  emergencies. Call the Anthropic API. Use a hardcoded fallback reply if the API fails.

### CHUNK 7: Population exposure (small script)
- server/scripts/fetchPopulation.js: for each Zone polygon call the WorldPop stats API
  (https://api.worldpop.org/v1/services/stats?dataset=wpgppop&year=2020&geojson=...).
  It is ASYNC: it returns a taskid; poll https://api.worldpop.org/v1/tasks/{taskid} until
  finished. Send a bare geometry, not a Feature (if that fails, try a FeatureCollection).
  Save the result as Zone.estimatedPopulation. If it fails or times out, keep a
  hardcoded fallback value and log a warning.

## GENERAL RULES
- Keep it simple: no over-engineering, no unnecessary abstractions or libraries.
- Add brief comments only where logic is non-obvious (priority formula, risk rules).
- Every external call (Open-Meteo, GDACS, WorldPop, Claude) needs try/catch and a
  fallback so the demo can never crash.
- Use clear, consistent naming matching the model and contract above.
- After each chunk, give me: how to run it, a quick way to test it (curl commands or
  what to click), and anything I need to put in .env.

Start with CHUNK 0 now.