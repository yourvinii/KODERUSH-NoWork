"""The same app, driven through the ASGI adapter (what Vercel's Python runtime and uvicorn call)."""
import io
import json
import uuid
import zipfile

import httpx
import pytest

import aio_asgi
import server
from test_api import CLIENT, GOOD_CODE, SITE, FakeDb, FakeGemini
from test_server import FakeClient

STEPS = [{"title": f"Step {i + 1}", "prompt": f"Prompt text {i + 1}"} for i in range(6)]


def make_client(db=None, gemini=None):
    """One 'serverless instance': a fresh app sharing whatever database is passed in."""
    app = aio_asgi.wrap(server.make_app(gemini, db or FakeDb()))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


async def test_routes_json_and_query_work_through_asgi():
    async with make_client() as c:
        assert (await c.get("/api/health")).json() == {"db": True}
        made = await c.post("/api/prompt-sets", json={"client_id": CLIENT, "title": "Todo", "steps": STEPS})
        assert made.status_code == 200 and len(made.json()["steps"]) == 6
        listed = await c.get("/api/prompt-sets", params={"client_id": CLIENT})
        assert [s["title"] for s in listed.json()["sets"]] == ["Todo"]


async def test_errors_keep_their_status_and_json_shape():
    async with make_client() as c:
        assert (await c.post("/api/prompt-sets", content="not json")).status_code == 400
        bad = await c.post("/api/prompt-sets", json={"client_id": "nope", "steps": STEPS})
        assert bad.status_code == 400 and "error" in bad.json()
        assert (await c.get("/api/nothing-here")).status_code == 404
        assert (await c.delete("/api/health")).status_code == 405


async def test_binary_response_and_headers_survive():
    async with make_client() as c:
        r = await c.post("/api/zip", json={"files": SITE})
        assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
        assert 'filename="nowork-project.zip"' in r.headers["content-disposition"]
        assert int(r.headers["content-length"]) == len(r.content)
        assert sorted(zipfile.ZipFile(io.BytesIO(r.content)).namelist()) == ["index.html", "script.js", "style.css"]
        doc = await c.post("/api/doc", json={"ai_tool": "Cursor", "steps": STEPS[:1]})
        assert "wordprocessingml" in doc.headers["content-type"] and doc.content[:2] == b"PK"


async def test_large_request_bodies_are_read_in_full():
    big = [{"title": f"Step {i}", "prompt": "word " * 3000} for i in range(6)]  # ~90 KB, past the stream reader's flow-control mark
    async with make_client() as c:
        r = await c.post("/api/doc", json={"steps": big})
        assert r.status_code == 200
        too_big = await c.post("/api/doc", content=b"x" * (aio_asgi.MAX_BODY + 10))
        assert too_big.status_code == 413


async def test_redirect_is_returned_as_a_redirect_not_raised():
    async with make_client() as c:
        token = (await c.post("/api/preview", json={"files": SITE})).json()["token"]
        r = await c.get(f"/p/{token}", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == f"/p/{token}/"
        page = await c.get(f"/p/{token}/")
        assert page.status_code == 200 and "text/html" in page.headers["content-type"]
        assert "default-src 'self'" in page.headers["content-security-policy"]


async def test_live_site_of_a_saved_project_works_from_a_different_instance():
    """Serverless: the request that publishes and the request that views may land on different instances."""
    db = FakeDb()
    async with make_client(db, FakeGemini(GOOD_CODE)) as one:
        body = {"client_id": CLIENT, "title": "App", "summary": "s", "steps": STEPS}
        project_id = (await one.post("/api/code", json=body)).json()["id"]
        edited = [{"path": "index.html", "content": "<h1>edited live</h1>"}]
        pub = await one.post("/api/preview", json={"files": edited, "project_id": project_id, "client_id": CLIENT})
        assert pub.json() == {"token": project_id}
    async with make_client(db) as other:  # new instance: empty memory, same database
        page = await other.get(f"/p/{project_id}/")
        assert page.status_code == 200 and "edited live" in page.text
        assert (await other.get(f"/p/{project_id}/missing.js")).status_code == 404
        assert (await other.get(f"/p/{uuid.uuid4()}/")).status_code == 404


async def test_publishing_someone_elses_project_is_refused():
    db = FakeDb()
    async with make_client(db, FakeGemini(GOOD_CODE)) as c:
        project_id = (await c.post("/api/code", json={"client_id": CLIENT, "title": "App", "steps": STEPS})).json()["id"]
        stranger = str(uuid.uuid4())
        r = await c.post("/api/preview", json={"files": SITE, "project_id": project_id, "client_id": stranger})
        assert r.status_code == 404
        assert (await c.post("/api/preview", json={"files": SITE, "project_id": "nope", "client_id": CLIENT})).status_code == 400


async def test_rate_limit_keys_on_the_forwarded_address_only_on_vercel(monkeypatch):
    async with make_client(gemini=FakeClient()) as c:
        for _ in range(server.RATE_LIMIT):  # without VERCEL the header is ignored: all calls share one address
            assert (await c.post("/api/token", headers={"x-forwarded-for": str(uuid.uuid4())})).status_code == 200
        assert (await c.post("/api/token", headers={"x-forwarded-for": "1.2.3.4"})).status_code == 429
    monkeypatch.setenv("VERCEL", "1")
    async with make_client(gemini=FakeClient()) as c:  # on Vercel each forwarded address gets its own allowance
        for i in range(server.RATE_LIMIT + 3):
            r = await c.post("/api/token", headers={"x-forwarded-for": f"9.9.9.{i}, 10.0.0.1"})
            assert r.status_code == 200


async def test_a_crashing_handler_returns_500_json(monkeypatch):
    import api

    async def boom(request):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(api, "health", boom)
    async with make_client() as c:
        r = await c.get("/api/health")
        assert r.status_code == 500 and r.json() == {"error": "internal error"}


async def test_lifespan_startup_and_shutdown_complete():
    app = aio_asgi.wrap(server.make_app(None, FakeDb()))
    sent, queue = [], [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message["type"])

    await app({"type": "lifespan"}, receive, send)
    assert sent == ["lifespan.startup.complete", "lifespan.shutdown.complete"]
