"""HTTP API for prompt history, code projects and zip download. Everything is keyed by a random client_id kept in the browser."""
import collections
import datetime
import io
import mimetypes
import os
import re
import secrets
import sys
import time
import traceback
import uuid
import zipfile

from aiohttp import web

import codegen
import docgen
from db import DbError

# shortcut: client_id is a random id in the browser, not a login; anyone holding it can read that history. Upgrade to Supabase Auth with real row level security when accounts are added.


def err(status: int, message: str) -> web.Response:
    return web.json_response({"error": message}, status=status)


def client_ip(request) -> str:
    """The caller's address. Behind Vercel's proxy it is in x-forwarded-for, which the platform sets itself; anywhere else that
    header could be forged, so it is only trusted when running on Vercel."""
    if os.environ.get("VERCEL"):
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.remote or "unknown"


def limited(request, bucket: str, limit: int, window: int) -> bool:
    """Per-IP sliding window, one counter per bucket. (Per server instance: good enough to blunt abuse, not exact on serverless.)"""
    hits = request.app["limits"].setdefault((bucket, client_ip(request)), [])
    now = time.monotonic()
    hits[:] = [t for t in hits if now - t < window]
    if len(hits) >= limit:
        return True
    hits.append(now)
    return False


def as_uuid(value) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ValueError("client_id must be a UUID") from None


def text(value, max_len: int) -> str:
    return value.strip()[:max_len] if isinstance(value, str) else ""


async def body_of(request) -> dict:
    try:
        data = await request.json()
    except ValueError:
        raise ValueError("body must be JSON") from None
    if not isinstance(data, dict):
        raise ValueError("body must be an object")
    return data


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


async def health(request):
    db = request.app["db"]
    if not db.configured:
        print("[Database Health Check] Supabase is not configured.", file=sys.stderr)
        return web.json_response({"db": False, "reason": "not configured"})
    try:
        await db.select("prompt_sets", {"select": "id", "limit": "1"})
    except DbError as e:
        print(f"[Database Health Check] Failed to reach Supabase: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return web.json_response({"db": False, "reason": str(e)})
    return web.json_response({"db": True})


async def create_set(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        data = await body_of(request)
        client_id = as_uuid(data.get("client_id"))
        ai_tool, steps = docgen.validate(data)
    except ValueError as e:
        return err(400, str(e))
    row = {
        "client_id": client_id,
        "title": text(data.get("title"), 120) or steps[0]["title"],
        "summary": text(data.get("summary"), 1000),
        "ai_tool": ai_tool,
        "wants_code": data.get("wants_code") is True,
    }
    db = request.app["db"]
    try:
        [created] = await db.insert("prompt_sets", [row])
        rows = await db.insert("prompt_steps", [{"set_id": created["id"], "position": i + 1, **s} for i, s in enumerate(steps)])
    except DbError as e:
        print(f"[Database Error] Failed in create_set: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"id": created["id"], "steps": [{"id": r["id"], "position": r["position"]} for r in rows]})


async def list_sets(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        client_id = as_uuid(request.query.get("client_id"))
    except ValueError as e:
        return err(400, str(e))
    db = request.app["db"]
    try:
        sets = await db.select("prompt_sets", {"client_id": f"eq.{client_id}", "order": "created_at.desc", "limit": "20", "select": "*"})
        steps = []
        if sets:
            ids = ",".join(s["id"] for s in sets)
            steps = await db.select("prompt_steps", {"set_id": f"in.({ids})", "order": "position.asc", "select": "id,set_id,position,title,prompt,downloaded_at"})
    except DbError as e:
        print(f"[Database Error] Failed in list_sets: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    for s in sets:
        s["steps"] = [st for st in steps if st["set_id"] == s["id"]]
    return web.json_response({"sets": sets})


async def mark_downloaded(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        client_id = as_uuid((await body_of(request)).get("client_id"))
        step_id = as_uuid(request.match_info["step_id"])
    except ValueError as e:
        return err(400, str(e))
    db = request.app["db"]
    try:
        step = await db.select("prompt_steps", {"id": f"eq.{step_id}", "select": "id,set_id"})
        owner = await db.select("prompt_sets", {"id": f"eq.{step[0]['set_id']}", "client_id": f"eq.{client_id}", "select": "id"}) if step else []
        if not owner:
            return err(404, "step not found")
        set_id = step[0]["set_id"]
        await db.update("prompt_steps", {"id": f"eq.{step_id}"}, {"downloaded_at": now_iso()})
        left = await db.select("prompt_steps", {"set_id": f"eq.{set_id}", "downloaded_at": "is.null", "select": "id"})
        if not left:
            await db.update("prompt_sets", {"id": f"eq.{set_id}"}, {"completed_at": now_iso()})
    except DbError as e:
        print(f"[Database Error] Failed in mark_downloaded: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"completed": not left})


async def create_code(request):
    if limited(request, "code", 4, 600):  # each call is a paid model request
        return err(429, "too many code requests, try again in a few minutes")
    try:
        data = await body_of(request)
        client_id = as_uuid(data.get("client_id"))
        set_id = as_uuid(data["set_id"]) if data.get("set_id") else None
        _, steps = docgen.validate(data)
    except ValueError as e:
        return err(400, str(e))
    client = request.app["client"]
    if client is None:
        return err(503, "GEMINI_API_KEY is not set on the server")
    title = text(data.get("title"), 120) or "My project"
    try:
        files = await codegen.generate(client, title, text(data.get("summary"), 1000), steps)
    except Exception as e:  # model error, timeout or invalid output; the caller can retry
        print(f"code generation failed: {e!r}")
        return err(502, "code generation failed, please try again")
    project_id = None
    try:
        [saved] = await request.app["db"].insert("code_projects", [{"client_id": client_id, "set_id": set_id, "title": title, "files": files}])
        project_id = saved["id"]
    except DbError as e:
        print(f"\n[Database Warning] Failed to save code project to Supabase (falling back to client storage): {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
    return web.json_response({"id": project_id, "title": title, "files": files, "saved": project_id is not None})


async def latest_code(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        client_id = as_uuid(request.query.get("client_id"))
    except ValueError as e:
        return err(400, str(e))
    try:
        rows = await request.app["db"].select("code_projects", {"client_id": f"eq.{client_id}", "order": "created_at.desc", "limit": "1", "select": "*"})
    except DbError as e:
        print(f"[Database Error] Failed in latest_code: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"project": rows[0] if rows else None})


async def list_code(request):
    """History of this client's code projects, newest first. Metadata only: the files are loaded when a project is opened."""
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        client_id = as_uuid(request.query.get("client_id"))
    except ValueError as e:
        return err(400, str(e))
    try:
        rows = await request.app["db"].select("code_projects", {"client_id": f"eq.{client_id}", "order": "created_at.desc", "limit": "30", "select": "id,title,created_at,set_id"})
    except DbError as e:
        print(f"[Database Error] Failed in list_code: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"projects": rows})


async def get_code(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        client_id = as_uuid(request.query.get("client_id"))
        project_id = as_uuid(request.match_info["project_id"])
    except ValueError as e:
        return err(400, str(e))
    try:
        rows = await request.app["db"].select("code_projects", {"id": f"eq.{project_id}", "client_id": f"eq.{client_id}", "select": "*"})
    except DbError as e:
        print(f"[Database Error] Failed in get_code: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"project": rows[0]}) if rows else err(404, "project not found")


async def update_code(request):
    """Saves the user's edits. The client_id filter on the update is what keeps one client from touching another's project."""
    if limited(request, "edit", 120, 60):  # its own counter: typing must not use up the history endpoints' allowance
        return err(429, "rate limited")
    try:
        data = await body_of(request)
        client_id = as_uuid(data.get("client_id"))
        project_id = as_uuid(request.match_info["project_id"])
        files = codegen.validate_files(data.get("files"), require_index=True)
    except ValueError as e:
        return err(400, str(e))
    try:
        rows = await request.app["db"].update("code_projects", {"id": f"eq.{project_id}", "client_id": f"eq.{client_id}"}, {"files": files})
    except DbError as e:
        print(f"[Database Error] Failed in update_code: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return err(503, str(e))
    return web.json_response({"saved": True}) if rows else err(404, "project not found")


async def make_zip(request):
    if limited(request, "rw", 60, 60):
        return err(429, "rate limited")
    try:
        files = codegen.validate_files((await body_of(request)).get("files"))
    except ValueError as e:
        return err(400, str(e))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.writestr(f["path"], f["content"])
    return web.Response(body=out.getvalue(), content_type="application/zip", headers={"Content-Disposition": 'attachment; filename="nowork-project.zip"'})


# ---------- live preview: the generated site served as a real URL (http://127.0.0.1:8000/p/<token>/) ----------
PREVIEW_MAX = 50  # newest previews kept in memory; older ones are dropped
LOOPBACK = {"127.0.0.1", "localhost"}
# No external resources, and forms can only post back to the page itself.
PREVIEW_CSP = "default-src 'self' 'unsafe-inline' data: blob:; base-uri 'self'; form-action 'self'"
# A page that cannot touch localStorage (opaque origin) gets an in-memory one so generated apps still run.
STORAGE_POLYFILL = (
    "<script>(function(){function mk(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},"
    "setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},"
    "get length(){return Object.keys(m).length}}}['localStorage','sessionStorage'].forEach(function(n){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(e){}})})()</script>"
)


async def put_preview(request):
    """Publishes a project as a live site and returns its token. A saved project (project_id + client_id) is published from the
    database, so the link works from any serverless instance and survives restarts; the token is the project id. Anything else
    (a project that only exists in the browser) is kept in this server's memory."""
    if limited(request, "preview", 240, 60):  # its own counter: one refresh per typing pause is ~85 a minute
        return err(429, "rate limited")
    try:
        data = await body_of(request)
        files = codegen.validate_files(data.get("files"), require_index=True)
        project_id = as_uuid(data["project_id"]) if data.get("project_id") else None
        client_id = as_uuid(data.get("client_id")) if project_id else None
    except ValueError as e:
        return err(400, str(e))
    if project_id:
        try:
            rows = await request.app["db"].update("code_projects", {"id": f"eq.{project_id}", "client_id": f"eq.{client_id}"}, {"files": files})
        except DbError as e:
            print(f"[Database Error] Failed in put_preview: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return err(503, str(e))
        return web.json_response({"token": project_id}) if rows else err(404, "project not found")
    store = request.app["previews"]
    token = data.get("token")
    if not (isinstance(token, str) and token in store):
        token = secrets.token_urlsafe(12)
    store[token] = {f["path"]: f["content"] for f in files}
    store.move_to_end(token)
    while len(store) > PREVIEW_MAX:
        store.popitem(last=False)
    return web.json_response({"token": token})


async def preview_redirect(request):
    raise web.HTTPFound(f"/p/{request.match_info['token']}/")  # relative links in the page need the trailing slash


async def preview_file(request):
    token = request.match_info["token"]
    files = request.app["previews"].get(token)
    if files is None:  # not in this instance's memory: it may be a saved project, whose token is its id
        try:
            rows = await request.app["db"].select("code_projects", {"id": f"eq.{as_uuid(token)}", "select": "files"})
        except DbError as e:
            print(f"[Database Error] Failed in preview_file fetching {token}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            rows = []
        except ValueError:
            rows = []
        files = {f["path"]: f["content"] for f in rows[0]["files"]} if rows else None
    path = request.match_info["path"] or "index.html"
    if files is None or path not in files:
        return web.Response(status=404, text="Preview not found. Open the Code page and press Run to create it again.")
    body = files[path]
    csp = PREVIEW_CSP
    if request.url.host not in LOOPBACK:
        # Not the loopback pair the Code page swaps between, so this could share an origin with the app: lock the page down.
        csp += "; sandbox allow-scripts allow-forms allow-modals allow-popups"
        if path == "index.html":
            body = re.sub(r"<head[^>]*>", lambda m: m.group(0) + STORAGE_POLYFILL, body, count=1, flags=re.I) if re.search(r"<head[^>]*>", body, re.I) else STORAGE_POLYFILL + body
    return web.Response(
        text=body,
        content_type=mimetypes.guess_type(path)[0] or "text/plain",
        charset="utf-8",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": csp},
    )


def add_routes(app: web.Application) -> None:
    app["limits"] = {}
    app["previews"] = collections.OrderedDict()
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/prompt-sets", create_set)
    app.router.add_get("/api/prompt-sets", list_sets)
    app.router.add_post("/api/prompt-steps/{step_id}/downloaded", mark_downloaded)
    app.router.add_post("/api/code", create_code)
    app.router.add_get("/api/code", latest_code)
    app.router.add_get("/api/code-projects", list_code)
    app.router.add_get("/api/code-projects/{project_id}", get_code)
    app.router.add_put("/api/code-projects/{project_id}", update_code)
    app.router.add_post("/api/zip", make_zip)
    app.router.add_post("/api/preview", put_preview)
    app.router.add_get("/p/{token}", preview_redirect)
    app.router.add_get("/p/{token}/{path:.*}", preview_file)
