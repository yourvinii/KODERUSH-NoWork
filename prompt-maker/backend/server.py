#!/usr/bin/env python3
"""Server for Gemini Live API with Ephemeral Tokens
Provides an endpoint to generate ephemeral tokens and serves static files.
"""

import asyncio
import datetime
import json
import mimetypes
import os
import sys
import time
import traceback

from aiohttp import web
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables from backend/.env file explicitly
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.isfile(env_path):
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

import api
import docgen
import rag
from db import Supabase

# Configuration
HTTP_PORT = 8000  # Port for HTTP server
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
RATE_LIMIT = 10  # token requests per IP per window
RATE_WINDOW = 60  # seconds
INDEX = rag.Index(rag.load_chunks())

# Initialize the Gemini GenAI client (None until a key is set; /api/token then returns 500)
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
if not client:
    print("Warning: GEMINI_API_KEY not found. Set it in .env.")


def rate_limited(request) -> bool:
    """Per-IP sliding window shared by the endpoints that cost us something."""
    hits = request.app["hits"].setdefault(api.client_ip(request), [])
    now_s = time.monotonic()
    hits[:] = [t for t in hits if now_s - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        return True
    hits.append(now_s)
    return False


async def get_ephemeral_token(request):
    """Generates an ephemeral token for the Gemini Live API."""
    if rate_limited(request):
        return web.json_response({"error": "rate limited"}, status=429)
    try:
        if request.app["client"] is None:
            raise RuntimeError("GEMINI_API_KEY is not set on the server")
        # Optional: Allow client to pass an API key
        # data = await request.json()
        # api_key = data.get("api_key")
        # if api_key:
        #     local_client = genai.Client(api_key=api_key, http_options={'api_version': 'v1beta'})
        # else:
        #     local_client = client

        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expire_time = now + datetime.timedelta(minutes=30)
        
        # Create an ephemeral token
        token = request.app["client"].auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": expire_time.isoformat(),
                "new_session_expire_time": (now + datetime.timedelta(minutes=1)).isoformat(),
                "http_options": {"api_version": "v1beta"},
            }
        )

        return web.json_response({
            "token": token.name,
            "expires_at": expire_time.isoformat()
        })
    except Exception as e:
        print(f"Error generating ephemeral token: {e}")
        return web.json_response({"error": str(e)}, status=500)


async def rag_search(request):
    """Returns knowledge-base passages the AI must answer from."""
    try:
        query = (await request.json())["query"]
        if not isinstance(query, str) or not query.strip():
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return web.json_response({"error": "query is required"}, status=400)
    return web.json_response({"results": INDEX.search(query)})


async def make_doc(request):
    """Turns the six prompts into a downloadable Word document."""
    if rate_limited(request):
        return web.json_response({"error": "rate limited"}, status=429)
    try:
        ai_tool, steps = docgen.validate(await request.json())
    except ValueError as e:  # includes bad JSON
        return web.json_response({"error": str(e)}, status=400)
    return web.Response(
        body=docgen.build_docx(ai_tool, steps),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="NoWork-prompts.docx"'},
    )


async def serve_static_file(request):
    """Serve static files from the frontend directory."""
    path = request.match_info.get("path", "index.html")

    # Security: prevent directory traversal
    path = path.lstrip("/")
    if ".." in path:
        return web.Response(text="Invalid path", status=400)

    # Default to index.html
    if not path or path == "/":
        path = "index.html"

    # Get the full file path - serve from frontend folder
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    file_path = os.path.join(frontend_dir, path)

    # Check if file exists
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return web.Response(text="File not found", status=404)

    # Determine content type
    content_type, _ = mimetypes.guess_type(file_path)
    if content_type is None:
        content_type = "application/octet-stream"

    # Read and serve the file
    try:
        with open(file_path, "rb") as f:
            content = f.read()
        # The speaker model is 26 MB: let the browser keep it (and the font) instead of downloading it every visit.
        headers = {"Cache-Control": "public, max-age=86400"} if path.startswith(("models/", "fonts/")) else None
        return web.Response(body=content, content_type=content_type, headers=headers)
    except Exception as e:
        print(f"Error serving file {path}: {e}")
        return web.Response(text="Internal server error", status=500)


def make_app(gemini_client=None, db=None):
    app = web.Application()
    app["client"] = gemini_client or client
    app["db"] = db or Supabase()

    async def close_db(app):
        await app["db"].close()

    app.on_cleanup.append(close_db)
    app["hits"] = {}
    app.router.add_post("/api/token", get_ephemeral_token)
    app.router.add_post("/api/rag", rag_search)
    app.router.add_post("/api/doc", make_doc)
    api.add_routes(app)  # must come before the static catch-all below
    app.router.add_get("/", serve_static_file)
    app.router.add_get("/{path:.*}", serve_static_file)
    return app


async def main():
    """Starts the HTTP server."""
    app = make_app()

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", HTTP_PORT)
    await site.start()
    
    print(f"Voice Prompt Maker running at http://localhost:{HTTP_PORT}")
    
    # Check Supabase connectivity on startup
    db = app.get("db")
    if db and db.configured:
        try:
            await db.select("prompt_sets", {"select": "id", "limit": "1"})
            print("Supabase database connected successfully.")
        except Exception as e:
            print(f"\n[Startup Warning] Cannot reach Supabase database: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
    elif db:
        print("Notice: Supabase database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env")

    # Keep the server running
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Server stopped")
