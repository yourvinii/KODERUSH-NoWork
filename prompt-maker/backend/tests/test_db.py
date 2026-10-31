"""Tests for Supabase client initialization, URL normalization, headers, and error logging."""
import io
import os
import sys
from unittest.mock import patch

import pytest
import aiohttp
from aiohttp import web

from db import DbError, Supabase


def test_supabase_url_normalization():
    # Various ways the URL might be entered in .env or passed directly
    test_cases = [
        ("https://xyz.supabase.co/rest/v1/", "https://xyz.supabase.co"),
        ("https://xyz.supabase.co/rest/v1", "https://xyz.supabase.co"),
        ("https://xyz.supabase.co/", "https://xyz.supabase.co"),
        ("https://xyz.supabase.co", "https://xyz.supabase.co"),
        ("  https://xyz.supabase.co/rest/v1/  ", "https://xyz.supabase.co"),
    ]
    for input_url, expected in test_cases:
        client = Supabase(url=input_url, key="test-key")
        assert client.url == expected, f"Failed for input: {input_url}"


def test_supabase_keys_and_headers():
    client = Supabase(
        url="https://xyz.supabase.co",
        key="my-service-role-key",
        anon_key="my-anon-key",
    )
    assert client.service_role_key == "my-service-role-key"
    assert client.anon_key == "my-anon-key"
    assert client.key == "my-service-role-key"
    assert client.configured is True


def test_supabase_fallback_to_anon_key():
    client = Supabase(
        url="https://xyz.supabase.co",
        key="",
        anon_key="my-anon-key",
    )
    assert client.key == "my-anon-key"
    assert client.configured is True


def test_supabase_unconfigured():
    client = Supabase(url="", key="")
    assert client.configured is False


@pytest.mark.asyncio
async def test_supabase_unconfigured_raises_and_logs():
    client = Supabase(url="", key="")
    stderr_buf = io.StringIO()
    with patch("sys.stderr", stderr_buf):
        with pytest.raises(DbError, match="database is not configured"):
            await client.select("prompt_sets", {})
    assert "Supabase Configuration Error" in stderr_buf.getvalue()


@pytest.mark.asyncio
async def test_supabase_error_traceback_logging(aiohttp_client):
    # Mock PostgREST server that returns 401 Unauthorized
    async def postgrest_mock(request):
        return web.json_response(
            {"message": "Invalid API key", "hint": "Double check your keys."},
            status=401,
        )

    app = web.Application()
    app.router.add_get("/rest/v1/prompt_sets", postgrest_mock)
    mock_server = await aiohttp_client(app)

    # Use the mock server URL as our Supabase URL
    base_url = f"http://{mock_server.host}:{mock_server.port}/rest/v1/"
    client = Supabase(url=base_url, key="bad-key")
    # URL normalization should strip the trailing /rest/v1/
    assert client.url == f"http://{mock_server.host}:{mock_server.port}"

    stderr_buf = io.StringIO()
    with patch("sys.stderr", stderr_buf):
        with pytest.raises(DbError) as exc_info:
            await client.select("prompt_sets", {})
        assert "Invalid API key" in str(exc_info.value)

    logged = stderr_buf.getvalue()
    assert "[Supabase HTTP 401 Error]" in logged
    assert "Invalid API key" in logged
    assert "Traceback" in logged
    await client.close()

