# NoWork

Talk to the AI by voice only, in your language, about what you want to build. It asks questions out loud and, when you confirm, sends 6 detailed prompts (design, architecture, UI/UX, frontend, backend, database) to the **Prompt** page as a roadmap: download each step as a Word document and watch the traveler drive to the next stop. Finished roadmaps are kept in History. If you also asked for code, the **Code** page has a ready HTML/CSS/JavaScript project with an editor, live preview and ZIP download.

Three pages: **Agents** (voice), **Prompt** (roadmap and history), **Code** (starter project). Built on Google's Gemini Live API (`gemini-live-api-examples`, ephemeral-token example).

## Structure

```
prompt-maker/
├── backend/                 Python (aiohttp)
│   ├── server.py            token endpoint, /api/rag, /api/doc (all rate limited), serves ../frontend
│   ├── api.py               history (/api/prompt-sets, /api/code-projects), /api/code, /api/zip, /api/health, live sites (/api/preview, /p/<token>/)
│   ├── db.py                tiny Supabase REST client (service role key, server side only)
│   ├── codegen.py           writes the HTML/CSS/JS project with a Gemini text model
│   ├── supabase/schema.sql  tables: run once in the Supabase SQL Editor
│   ├── docgen.py            builds the .docx from the six prompts (python-docx)
│   ├── rag.py               knowledge retrieval
│   ├── knowledge/*.md       trusted facts the AI must answer from
│   ├── tests/               pytest
│   ├── .env                 GEMINI_API_KEY (never commit)
│   └── requirements*.txt
├── frontend/                static site (vanilla JS)
│   ├── index.html, script.js (system prompt + wiring), tools.js
│   └── geminilive.js, mediaUtils.js, audio-processors/   (unmodified from the example)
└── tests/frontend/          node tests for tools.js
```

## Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt   # Windows
copy .env.example .env      # then put your key in GEMINI_API_KEY=
.venv\Scripts\python server.py
```

Open http://localhost:8000 in Chrome/Edge and tap the orb (mic needs localhost or https).

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest tests -q
cd .. && node tests/frontend/tools.test.js
```

## Accuracy (RAG)

The model must call `lookup_knowledge` before stating facts. It searches `backend/knowledge/*.md` and answers only from the results, or says it is unsure. To make it smarter, add `## Section` blocks to those files.

## Database setup (Supabase)

1. Put these in `backend/.env` (never in the frontend; the service role key bypasses row level security):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
2. Open the Supabase dashboard, SQL Editor, paste `backend/supabase/schema.sql` and run it once.
3. `GET /api/health` returns `{"db": true}` when it works. Until then the Prompt page keeps history in this browser only.

Row level security is on with no policies, so the public (anon) key can read nothing; only the backend reads and writes. History belongs to a random id stored in the browser, not to a login (add Supabase Auth for real accounts).

`CODE_MODEL` (env, default `gemini-3.5-flash`) picks the model that writes the Code page project. Model availability changes: if code generation fails with 404, set a model your key can use.

## Live site for generated code

The Code page publishes the project as a real site at `http://127.0.0.1:<port>/p/<token>/` (kept in server memory, newest 50, lost on restart; press Run on the Code page to recreate it). Open it in a new tab, or copy the link. It is served from the *other* loopback name (`localhost` <-> `127.0.0.1`), so it is a different origin from the app and cannot read the app's storage. On any other host the page is served with a CSP sandbox instead.

## Code history

Every project the agent writes is a row in `code_projects` and shows up under **Your code history** on the Code page. Open any entry to switch to it; edits are saved to the database about a second after you stop typing, and after a refresh the project you had open comes back. If the database is down, projects and edits are kept in this browser instead (marked "this device only"). Endpoints: `GET /api/code-projects` (list), `GET /api/code-projects/<id>` (open), `PUT /api/code-projects/<id>` (save edits). No schema change is needed beyond `schema.sql`.

## Deploy on Vercel

Vercel's Python runtime runs ASGI/WSGI apps, and looks for a top-level `app` in `app.py` at the repository root. The backend is aiohttp, so `backend/aio_asgi.py` serves the same handlers over ASGI and the root `app.py` exposes it. Files involved (repo root):

- `app.py` the entrypoint (`app = aio_asgi.wrap(server.make_app())`)
- `requirements.txt` what Vercel installs (keep in sync with `backend/requirements.txt`)
- `.python-version` Python 3.12 (Vercel supports 3.12, 3.13, 3.14; not 3.11)
- `vercel.json` 90 s function timeout (code generation takes 35 to 60 s) and files left out of the bundle

**Project settings:** Root Directory = repository root. Then add these **Environment Variables** (Settings, Environment Variables) and redeploy; nothing is read from `.env` on Vercel:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini key (used for voice tokens and code generation) |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service role key (server only) |
| `CODE_MODEL` | optional, default `gemini-3.5-flash` |

Things that behave differently on serverless: the frontend is served by the same function (static files are bundled with it); the live site `/p/<project id>/` is read from the database, so it works from any instance (a project that only exists in one browser has no live link); rate limits are per instance; responses are capped at 4.5 MB. The voice itself never touches the server: the browser talks to Gemini Live directly.
