# CDR Intelligence — backend (normalized MongoDB architecture)

The main app (`index.html`) is a single HTML file that runs entirely in
your browser. Browsers can't open a direct MongoDB connection though —
there's no MongoDB driver for client-side JS, and shipping DB credentials
inside an HTML file would expose them to anyone who opens it. This Express
server is the bridge: it holds the real (pooled) MongoDB connection via
Mongoose, and the app talks to it over plain HTTP.

## What changed (v2)

Previously every case stored its entire CDR/tower dataset embedded on the
case document itself (`savedData: { records, towers }`). That doesn't
scale — MongoDB caps a single document at 16MB, big imports were slow,
and the whole blob moved over the wire on every case load/save.

Storage is now split into one collection per concern, matching the same
field names/shapes the frontend already produced:

| Collection      | What it holds                                             |
|-----------------|------------------------------------------------------------|
| `cases`         | Metadata only — caseNo, title, officer, status, priority   |
| `cdr_records`   | One document per call/SMS record, linked by `caseId`       |
| `tower_records` | One document per tower/cell-site entry, linked by `caseId` |
| `notes`         | Case log entries (previously embedded on the case)         |
| `evidence`      | Evidence file pointers/metadata                            |
| `tasks`         | Case tasks/to-dos                                          |
| `timeline`      | Auto-generated audit log of case actions                   |
| `graph_cache`   | Cached link-analysis graph per case                        |
| `ai_analysis`   | Stored AI analysis results per case                        |

All of this is invisible from the UI — no screens were redesigned and no
existing workflow changed. What *did* change under the hood:

- **Case list load** now pulls metadata + counts only, not full datasets.
- **Saving/importing CDR or tower data** sends it to the backend in
  batches of 1000 records instead of one giant request, with a progress
  indicator (`Saving 1000 / 45000 record(s)…`) in the existing busy overlay.
- **"Load Data"** on a case now fetches records via cursor-based
  pagination behind the scenes, page by page, until everything's loaded —
  still lands in the same in-memory `records`/`towers` arrays the
  Map/Graph/Timeline/Analytics pages already use, so those pages are
  completely unaffected.
- **Notes** post straight to `/api/cases/:id/notes` instead of rewriting
  the whole case document.

Evidence, Tasks, and AI Analysis have full REST APIs (see below) but no UI
exists for them yet in `index.html` — they weren't part of the current
app, so no screens were added for them, per the "don't redesign the UI"
constraint. Timeline auto-logs case actions (case created, CDR imported,
note added, etc.) and is queryable via `GET /api/cases/:id/timeline`, but
is separate from the existing "Timeline" nav page, which is an in-browser
call-activity chart built from CDR data and is untouched.

## Setup

1. Make sure your MongoDB server is running (default: `mongodb://localhost:27017`).
2. Install dependencies:
   ```
   npm install
   ```
3. (Optional) copy `.env.example` to `.env` and adjust if your MongoDB
   isn't on the default host/port:
   ```
   cp .env.example .env
   ```
4. **If upgrading from the old embedded-document version**, migrate
   existing data first (safe to re-run; see `scripts/migrate.js`):
   ```
   npm run migrate:dry-run   # see what would change, writes nothing
   npm run migrate           # actually move the data
   ```
5. Start the backend:
   ```
   npm start
   ```
   You should see:
   ```
   Connected to MongoDB (mongodb://localhost:27017) → database "cdrIntelligence"
   CDR Intelligence backend listening on http://localhost:4000
   ```
6. Open `index.html` in your browser as usual — it's already pointed at
   `http://localhost:4000/api`.

If you run the backend on a different host/port, set this before the
page's own scripts run:
```html
<script>window.CDR_API_BASE = 'http://your-host:port/api';</script>
```

## API reference

```
Cases
  GET    /api/cases                     list all (metadata + notes + counts)
  GET    /api/cases/:id                 single case
  POST   /api/cases                     create (server can generate the id)
  PUT    /api/cases/:id                 upsert by app-generated id (what the UI uses)
  DELETE /api/cases/:id                 delete + cascade-delete all linked data

CDR
  POST   /api/cases/:id/import-cdr      body: { records:[...], mode:'replace'|'append' }
  GET    /api/cases/:id/cdr             ?cursor=&limit=  → { records, nextCursor, hasMore }
  GET    /api/cases/:id/cdr/count       → { count }
  DELETE /api/cdr/:recordId             delete one record
  DELETE /api/cases/:id/cdr             clear all CDR records for a case

Towers
  POST   /api/cases/:id/import-towers   body: { towers:[...], mode:'replace'|'append' }
  GET    /api/cases/:id/towers          ?cursor=&limit=
  DELETE /api/towers/:towerId
  DELETE /api/cases/:id/towers

Evidence
  POST   /api/cases/:id/evidence
  GET    /api/cases/:id/evidence
  DELETE /api/evidence/:id

Notes
  POST   /api/cases/:id/notes           body: { text }
  GET    /api/cases/:id/notes

Tasks
  POST   /api/cases/:id/tasks
  GET    /api/cases/:id/tasks
  PUT    /api/tasks/:id

Timeline (auto-generated audit log)
  GET    /api/cases/:id/timeline

Graph (cached link-analysis layout)
  GET    /api/cases/:id/graph           ?refresh=true forces recompute

AI Analysis
  GET    /api/cases/:id/analysis
  POST   /api/cases/:id/analysis
```

## Project layout

```
server.js              entry point — wires everything together
db.js                  Mongoose connection (pooled)
models/                one Mongoose schema per collection
routes/                one Express router per resource
utils/                 logger, timeline-logging helper, async error wrapper
scripts/migrate.js     one-time migration from the old embedded schema
dev-tools/             local-only test harness (fake in-memory API + a
                        jsdom smoke test that drives the real index.html
                        through create/import/load/note/delete) — not
                        needed to run the app, useful if you touch the
                        frontend's API-calling code again
```

## Troubleshooting

- **App shows "Cannot reach the CDR backend"** — the server isn't
  running, or `API_BASE` doesn't match where it's listening.
- **Server fails to start with a MongoDB connection error** — check that
  MongoDB is running and that `MONGODB_URI` is correct for your setup.
- **Upgrading and case cards show "None" for saved data that should be
  there** — run the migration script (see Setup step 4).


## Authentication and RBAC

Authentication uses bcrypt (12 rounds), 15-minute JWT access tokens, and a 7-day httpOnly refresh cookie. Access tokens are held in frontend memory only; no JWT is stored in localStorage.

Every route in `routes/cases.js`, `routes/cdr.js`, `routes/towers.js`, `routes/evidence.js`, `routes/notes.js`, `routes/tasks.js`, `routes/timeline.js`, `routes/graph.js`, and `routes/analysis.js` requires authentication. Investigators are server-side restricted to cases whose `officer` equals their username; admins can access all cases.

Admin endpoints are under `/api/admin/users` and require `requireRole('admin')`. Role/status changes and deletes are written to the existing `timeline` collection with the acting admin's username and user id in `meta.actor`.

### First administrator

1. Copy `.env.example` to `.env` and set strong, unique `JWT_SECRET` and `JWT_REFRESH_SECRET` values.
2. Set `FIRST_ADMIN_USERNAME`, `FIRST_ADMIN_EMAIL`, and `FIRST_ADMIN_PASSWORD` (minimum 8 characters).
3. Run:
   ```
   npm install
   npm run first-admin
   ```
4. Remove or unset the first-admin password variables after the bootstrap account has been created.

Public signup always creates an `investigator`. An authenticated administrator may also call `POST /api/auth/signup` with `role: "admin"` to create another administrator.
