"""
ASGI front door for the aiohttp app, so the same handlers run under uvicorn locally and under Vercel's Python runtime.

Vercel's Python functions speak ASGI or WSGI, not aiohttp. Rather than rewrite every handler, each ASGI request is turned
into an aiohttp Request (aiohttp.test_utils.make_mocked_request is the public way to build one), run through the app's own
router and middlewares via Application._handle, and the Response is sent back as ASGI messages.
"""
import asyncio
from unittest import mock

from aiohttp import streams, web
from aiohttp.test_utils import make_mocked_request
from multidict import CIMultiDict

MAX_BODY = 4 * 1024 * 1024  # bigger than any real request here (code projects are capped at 400 KB)
HOP_BY_HOP = {"content-length", "transfer-encoding", "connection"}


def wrap(aio_app: web.Application):
    """Returns an ASGI callable serving aio_app."""
    aio_app.freeze()  # builds the middleware chain; _handle expects a frozen app

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            return

        body, more = b"", True
        while more:
            message = await receive()
            body += message.get("body", b"")
            more = message.get("more_body", False)
            if len(body) > MAX_BODY:
                return await _send(send, web.json_response({"error": "request too large"}, status=413))

        loop = asyncio.get_running_loop()
        payload = streams.StreamReader(mock.Mock(), 2**16, loop=loop)
        payload.feed_data(body)
        payload.feed_eof()
        headers = CIMultiDict((k.decode("latin1"), v.decode("latin1")) for k, v in scope["headers"])
        target = scope["raw_path"].decode("latin1") if scope.get("raw_path") else scope["path"]
        if scope.get("query_string"):
            target += "?" + scope["query_string"].decode("latin1")
        peer = tuple(scope["client"]) if scope.get("client") else None
        transport = mock.Mock()
        transport.get_extra_info = lambda name, default=None: peer if name == "peername" else default
        request = make_mocked_request(scope["method"], target, headers=headers, app=aio_app, payload=payload, transport=transport, client_max_size=MAX_BODY)

        try:
            response = await aio_app._handle(request)
        except web.HTTPException as exc:  # 404, 405, redirects raised by handlers
            response = exc
        except Exception as exc:  # a bug in a handler must not take the whole function down
            print(f"unhandled error on {scope['method']} {scope['path']}: {exc!r}")
            response = web.json_response({"error": "internal error"}, status=500)
        await _send(send, response)

    return app


async def _send(send, response: web.StreamResponse):
    body = response.body if isinstance(getattr(response, "body", None), (bytes, bytearray)) else b""
    headers = [(k.lower().encode("latin1"), v.encode("latin1")) for k, v in response.headers.items() if k.lower() not in HOP_BY_HOP]
    headers.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": response.status, "headers": headers})
    await send({"type": "http.response.body", "body": bytes(body)})
