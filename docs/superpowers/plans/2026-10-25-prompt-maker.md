# Voice Prompt Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A voice-only website where users describe what they want to build in any language and get a finished prompt on screen.

**Architecture:** Copy the `gemini-live-ephemeral-tokens-websocket` example. `server.py` mints one-use tokens; the browser connects straight to Gemini Live. The model calls a `show_prompt` function to render the result.

**Tech Stack:** Python 3 + aiohttp + google-genai; vanilla JS; pytest + pytest-aiohttp.

**Spec:** `docs/superpowers/specs/2026-10-25-prompt-maker-design.md`

## Global Constraints

- Project dir: `C:\Users\AMAN YATAN\Nowork\prompt-maker`; example source cloned at `%TEMP%\gl-ex\gemini-live-ephemeral-tokens-websocket`.
- Voice only: no text input box.
- API key only in `.env` (`GEMINI_API_KEY`); never sent to the browser.
- `geminilive.js`, `mediaUtils.js`, `audio-processors/*` are copied unmodified.
- Model default stays `gemini-3.8-live` (example default); voice `Puck`.
- Prompt text is English by default; the AI replies by voice only in the user's language.

## Review Focus

- `/api/token` with no/invalid API key → JSON `{"error": ...}`, status 500, no crash.
- Same IP calling `/api/token` more than 10 times in 60 s → 429 (tested).
- Model calls `show_prompt` with empty/missing `prompt` → returns an error string, renders nothing (tested).
- Mic permission denied → visible message, no stuck "connecting" state.
- Prompt in an RTL/Indic language renders correctly (`dir="auto"` on result) and Copy works when `navigator.clipboard` is unavailable (fallback to selecting the text).
- Disconnect mid-conversation (tab idle, WebSocket close) → UI returns to idle with Start button enabled.

---

### Task 1: Scaffold and token server

**Files:**
- Create: `prompt-maker/` (copy of example: `server.py`, `requirements.txt`, `frontend/`), `prompt-maker/.env.example`, `prompt-maker/requirements-dev.txt`, `prompt-maker/tests/test_server.py`
- Modify: `prompt-maker/server.py`

**Interfaces:**
- Produces: `server.make_app(client=None) -> web.Application` (registers `POST /api/token` and static routes; `client` overrides the module's genai client for tests); `server.RATE_LIMIT = 10`, `server.RATE_WINDOW = 60` (seconds).

- [ ] **Step 1:** Copy the example's `server.py`, `requirements.txt`, `frontend/` into `prompt-maker/`. Add `.env.example` containing `GEMINI_API_KEY=` and `requirements-dev.txt` with `-r requirements.txt`, `pytest`, `pytest-aiohttp`. Create a venv and install dev requirements.
- [ ] **Step 2: Write failing tests** in `tests/test_server.py` (using `aiohttp_client`, a fake client whose `auth_tokens.create(config=...)` returns an object with `.name == "tok123"`):
  - `test_token_ok`: POST `/api/token` → 200, `json["token"] == "tok123"`.
  - `test_token_error`: fake client raises → 500, `"error"` in json.
  - `test_rate_limit`: 10 POSTs return 200, the 11th returns 429.
- [ ] **Step 3:** Run `pytest tests -v` → expect FAIL (`make_app` missing).
- [ ] **Step 4:** Refactor `server.py`: move app construction from `main()` into `make_app(client=None)`; `get_ephemeral_token` reads the client from `request.app["client"]`. Add a per-IP sliding-window limiter (dict of IP → list of timestamps; use `request.remote`) inside `get_ephemeral_token`, returning `web.json_response({"error": "rate limited"}, status=429)`. Keep the example's startup banner but change its title to "Voice Prompt Maker".
- [ ] **Step 5:** Run `pytest tests -v` → expect 3 passed.

### Task 2: `show_prompt` tool

**Files:**
- Modify: `prompt-maker/frontend/tools.js` (replace entire contents)
- Test: `prompt-maker/tests/tools.test.js` (run with `node`)

**Interfaces:**
- Consumes: `FunctionCallDefinition(name, description, parameters, required, behavior?)` from `geminilive.js`.
- Produces: `class ShowPromptTool extends FunctionCallDefinition`, constructed as `new ShowPromptTool(onPrompt)` where `onPrompt(prompt: string, language: string)` is called with a valid prompt. `functionToCall({prompt, language})` returns `"shown"` on success, or `"error: prompt is required"` for a missing/blank prompt without calling `onPrompt`. Tool name `"show_prompt"`; description tells the model to call it once the prompt is complete.

- [ ] **Step 1: Write failing test** `tools.test.js`: load `geminilive.js` + `tools.js` into a `vm` context with `assert`; tests: valid call → returns `"shown"` and callback receives both args; `{prompt: "  "}` and `{}` → returns `"error: prompt is required"`, callback not called. Run `node tests/tools.test.js` → FAIL.
- [ ] **Step 2:** Replace `tools.js` with `ShowPromptTool` only (remove all example tools).
- [ ] **Step 3:** Run `node tests/tools.test.js` → PASS.

### Task 3: Voice UI and wiring

**Files:**
- Modify (replace): `prompt-maker/frontend/index.html`, `prompt-maker/frontend/script.js`

**Interfaces:**
- Consumes: `GeminiLiveAPI`, `MultimodalLiveResponseType`, `AudioStreamer(client)`, `AudioPlayer` (`init()`, `play(b64)`, `interrupt()`, `destroy()`), `ShowPromptTool(onPrompt)`; `POST /api/token` → `{token}`. Script load order unchanged: `geminilive.js`, `mediaUtils.js`, `tools.js`, `script.js`.

- [ ] **Step 1:** `index.html`: single page with a big mic Start/Stop button (`#micBtn`), status line (`#status`), transcript box (`#transcript`), result card (`#result`, hidden until a prompt arrives, `dir="auto"`, with `#copyBtn`). Minimal inline CSS, mobile-friendly, dark-on-light. Page text in English.
- [ ] **Step 2:** `script.js`: `start()` fetches token → builds `GeminiLiveAPI(token, "gemini-3.8-live")`, sets `voiceName="Puck"`, `responseModalities=["AUDIO"]`, input/output audio transcription on, `systemInstructions = SYSTEM_PROMPT`, adds `ShowPromptTool` (callback fills and reveals `#result`), connects, then creates `AudioPlayer` (`init()`) and `AudioStreamer` (`start()`), with the response handler copied from the example (AUDIO → play, INTERRUPTED → `interrupt()`, TOOL_CALL → `callFunction` then `sendToolResponse`, transcriptions → `#transcript`). `stop()` closes the socket and destroys streamer/player. Errors from mic (`NotAllowedError`) show "Microphone access denied"; token or WebSocket failure shows the error and resets the button. `SYSTEM_PROMPT` implements the spec's four rules verbatim in meaning (detect language and reply only in it; 3–5 short questions one at a time covering what/audience/stack/features/constraints; then call `show_prompt` with a complete structured English prompt; afterwards say briefly by voice it is ready). Copy button: `navigator.clipboard.writeText`, falling back to selecting the text.
- [ ] **Step 3:** `node --check frontend/script.js` → no errors.

### Task 4: Run and verify

- [ ] **Step 1:** User creates `prompt-maker/.env` with a real `GEMINI_API_KEY`. Start the server (`python server.py`) and confirm `POST http://localhost:8000/api/token` returns a token.
- [ ] **Step 2:** Open `http://localhost:8000` in the browser pane; confirm the page renders with no console errors and Start reaches "Connecting…" (mic prompt may appear).
- [ ] **Step 3:** User does one real voice session in their language and confirms the AI answers in that language, asks questions, and the prompt card appears and copies.
- [ ] **Step 4:** Run `pytest tests -v` and `node tests/tools.test.js` → all pass.
- [ ] **Step 5:** Add a short `README.md` (setup, `.env`, run command).
