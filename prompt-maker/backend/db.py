"""Minimal Supabase (PostgREST) client over aiohttp. Server side only: it uses the service role key."""
import asyncio
import os
import sys
import traceback

import aiohttp
from dotenv import load_dotenv

# Ensure backend/.env is loaded
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.isfile(_env_path):
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()


class DbError(Exception):
    """Raised when the database is missing, misconfigured or rejects a request."""


class Supabase:
    def __init__(
        self,
        url: str | None = None,
        key: str | None = None,
        anon_key: str | None = None,
    ):
        if url is None:
            raw_url = os.environ.get("SUPABASE_URL", "")
        else:
            raw_url = url
        raw_url = raw_url.strip().rstrip("/")
        # If url was provided with /rest/v1 or /rest/v1/, strip it to get the base url
        if raw_url.endswith("/rest/v1"):
            raw_url = raw_url[:-len("/rest/v1")].rstrip("/")
        self.url = raw_url

        if key is None:
            self.service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        else:
            self.service_role_key = key.strip()

        if anon_key is None:
            self.anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
        else:
            self.anon_key = anon_key.strip()

        # PostgREST server-side operations use the service role key; fallback to anon key if not set
        self.key = self.service_role_key or self.anon_key

        self._session: aiohttp.ClientSession | None = None
        self._loop = None

    @property
    def configured(self) -> bool:
        return bool(self.url and self.key)

    async def _request(self, method: str, table: str, *, params=None, json=None, prefer: str | None = None):
        if not self.configured:
            missing = []
            if not self.url:
                missing.append("SUPABASE_URL")
            if not self.key:
                missing.append("SUPABASE_SERVICE_ROLE_KEY")
            err_msg = f"database is not configured: missing {', '.join(missing)}"
            print(f"\n[Supabase Configuration Error] {err_msg}", file=sys.stderr)
            raise DbError(err_msg)

        loop = asyncio.get_running_loop()
        if self._session is None or self._session.closed or self._loop is not loop:  # a session belongs to the loop that made it
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
            self._loop = loop

        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer

        table_path = table.strip("/")
        endpoint = f"{self.url}/rest/v1/{table_path}"

        try:
            async with self._session.request(method, endpoint, params=params, json=json, headers=headers) as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = await r.text()

                if r.status >= 400:
                    if isinstance(body, dict):
                        msg = body.get("message") or body.get("error") or str(body)
                        hint = body.get("hint")
                        details = body.get("details")
                        parts = [str(msg)]
                        if hint:
                            parts.append(f"hint: {hint}")
                        if details:
                            parts.append(f"details: {details}")
                        msg = " - ".join(parts)
                    else:
                        msg = str(body)
                    err_msg = f"{table_path}: HTTP {r.status} - {msg}"
                    print(f"\n[Supabase HTTP {r.status} Error] {method} {endpoint}:\n  {err_msg}", file=sys.stderr)
                    err = DbError(err_msg)
                    try:
                        raise err
                    except DbError:
                        traceback.print_exc(file=sys.stderr)
                        raise
                return body
        except DbError:
            raise
        except Exception as e:
            print(f"\n[Supabase Connection Error] {method} {endpoint}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise DbError(f"{table_path}: {e}") from e

    async def insert(self, table: str, rows: list[dict]) -> list[dict]:
        return await self._request("POST", table, json=rows, prefer="return=representation")

    async def select(self, table: str, params: dict) -> list[dict]:
        return await self._request("GET", table, params=params)

    async def update(self, table: str, params: dict, values: dict) -> list[dict]:
        return await self._request("PATCH", table, params=params, json=values, prefer="return=representation")

    async def close(self):
        if self._session:
            await self._session.close()
