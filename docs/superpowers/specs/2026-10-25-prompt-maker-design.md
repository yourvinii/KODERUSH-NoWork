# Voice Prompt Maker — Design

## Goal
A website where a user **speaks in any language** about what they want to build. The AI replies **by voice in the same language**, asks a few questions, then shows a finished, ready-to-paste prompt on screen. Built on `google-gemini/gemini-live-api-examples` → `gemini-live-ephemeral-tokens-websocket`.

## Decisions (agreed)
- Interaction: **voice only** (no typing box).
- Connection: **ephemeral tokens** — Python server mints a one-use token; browser connects straight to Gemini Live over WebSocket. API key stays server-side in `.env`.
- Output: AI calls a function `show_prompt`; page renders the prompt with a Copy button (not read aloud).
- Prompt text is **English by default** (meant for other AI tools); AI offers the user's language if asked.

## Layout (`Nowork/prompt-maker/`, copied from the example)
| File | Change |
|---|---|
| `server.py` | Keep. Add small per-IP rate limit on `POST /api/token`. |
| `requirements.txt` | Keep. |
| `frontend/geminilive.js`, `mediaUtils.js`, `audio-processors/*` | Untouched. |
| `frontend/tools.js` | Replace example tools with `show_prompt(prompt, language)`. |
| `frontend/index.html`, `script.js` | Replace with minimal UI: mic button, status, live transcript, result card + Copy. |
| `tests/test_server.py` | New. |

## System instruction
1. Detect user's language from first words; reply only in it.
2. Ask 3–5 short questions, one at a time: what they build, audience, tech stack, key features, constraints.
3. Then call `show_prompt` with a complete, structured prompt.
4. After the call, say briefly by voice that it is ready.

## Errors
- Mic denied → clear on-screen message.
- Token fetch / WebSocket drop → "Reconnect" button.
- Missing `GEMINI_API_KEY` → server startup warning (already in example); `/api/token` returns 500 with message.

## Testing
- `pytest`: `/api/token` returns token (Gemini client mocked); rate limit returns 429 after N calls.
- Manual: user tests the real voice conversation in a browser (mic input cannot be exercised automatically).

## Out of scope
Accounts, saved history, camera/video, multiple templates, deployment config.

## Risks
- Token endpoint is public: rate limit mitigates but does not eliminate quota abuse.
- Live model ID is read from the example's `script.js` at build time; may change.

## Addendum (user-requested, approved at build time)
- Output is **6 prompts** (design, architecture, UI/UX, frontend, backend, database) via `show_prompts`, replacing the single `show_prompt`; tailored to the user's chosen AI tool and platform.
- Multiple-choice questions via `ask_choice` (tap or speak) for AI tool, platform, experience, auth, database, look and feel.
- **RAG**: `lookup_knowledge` tool -> `POST /api/rag` over `knowledge/*.md` (keyword-overlap ranking, no embeddings). The model is instructed to state facts only from results, else say it is unsure.
- AI confirms its understanding of the idea before asking follow-ups.
