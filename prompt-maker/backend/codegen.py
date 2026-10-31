"""Generates a vanilla HTML/CSS/JS project from the six prompts, using a Gemini text model."""
import asyncio
import json
import os
import re

from google.genai import types

CODE_MODEL = os.environ.get("CODE_MODEL", "gemini-3.5-flash")
TIMEOUT_S = 150
MAX_FILES = 12
MAX_FILE = 120_000
MAX_TOTAL = 400_000
_PATH = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,80}$")

SYSTEM = """You are a senior front-end developer writing a complete, working starter project for a beginner.
Rules:
- Use ONLY vanilla HTML, CSS and JavaScript. No frameworks, no npm, no build step, no external libraries, no network requests.
- Files: index.html (it must link style.css and script.js), style.css, script.js. Optionally README.md with 3 short run steps.
- The project must open by double-clicking index.html and actually work: implement the real features from the brief with believable sample data.
- There is no backend or database: keep data in localStorage and wrap it in small functions so a real API could replace it later; say so in a comment.
- Make it responsive, accessible (labels, focus states, contrast) and polished. Include loading, empty and error states and form validation where relevant.
- Add short beginner-friendly comments. Keep each file focused and readable.
Return JSON: {"files": [{"path": "...", "content": "..."}]} and nothing else."""

SCHEMA = {
    "type": "object",
    "properties": {
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
        }
    },
    "required": ["files"],
}


def validate_files(files, require_index: bool = False) -> list[dict]:
    """Checks a list of {path, content}. Paths come from a model or a browser, so they must be plain relative names."""
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError(f"files must be a list of 1 to {MAX_FILES} items")
    clean, seen, total = [], set(), 0
    for f in files:
        path, content = (f.get("path"), f.get("content")) if isinstance(f, dict) else (None, None)
        if not (isinstance(path, str) and isinstance(content, str)):
            raise ValueError("each file needs a path and content")
        if not _PATH.match(path) or ".." in path or path.endswith("/") or "//" in path:
            raise ValueError(f"bad file path: {path[:40]}")
        if path in seen:
            raise ValueError(f"duplicate file path: {path}")
        if len(content) > MAX_FILE:
            raise ValueError(f"file too large: {path}")
        total += len(content)
        seen.add(path)
        clean.append({"path": path, "content": content})
    if total > MAX_TOTAL:
        raise ValueError("project too large")
    if require_index and "index.html" not in seen:
        raise ValueError("index.html is missing")
    return clean


def build_brief(title: str, summary: str, steps: list[dict]) -> str:
    """The six prompts are the spec. Design, UI and frontend steps matter most for a vanilla front end."""
    parts = [f"Project: {title}", f"Summary: {summary}" if summary else ""]
    for s in steps:
        parts.append(f"## {s['title']}\n{s['prompt'][:6000]}")
    return "\n\n".join(p for p in parts if p)


async def generate(client, title: str, summary: str, steps: list[dict]) -> list[dict]:
    resp = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=CODE_MODEL,
            contents=build_brief(title, summary, steps),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM,
                response_mime_type="application/json",
                response_schema=SCHEMA,
                temperature=0.4,
                thinking_config=types.ThinkingConfig(thinking_budget=0),  # faster; the brief is already detailed
            ),
        ),
        TIMEOUT_S,
    )
    return validate_files(json.loads(resp.text)["files"], require_index=True)
