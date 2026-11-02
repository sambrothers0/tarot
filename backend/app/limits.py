"""Abuse limits: request rates, request body size, and a daily egress budget.

All of this lives in process memory, which is correct only because the API
runs as a single instance (`--max-instances 1` in deploy.sh). A restart, or
Cloud Run scaling to zero after idling, resets the counters. That is accepted:
the limits exist to blunt an attack *while it runs*, and the billing kill
switch (infra/billing-killswitch/) stays the hard ceiling on cost.

Nothing here keys on client IP. Behind Cloud Run the leftmost
X-Forwarded-For entry is whatever the client sent, so an IP key would be
trivially spoofable; per-user keys come from a verified session instead.
"""

import json
import math
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings


class SlidingWindow:
    """At most `limit` hits per `window` seconds for each key."""

    def __init__(
        self, limit: int, window: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.limit = limit
        self.window = window
        self._clock = clock
        self._hits: dict[object, deque[float]] = {}
        self._lock = threading.Lock()  # sync routes run on a thread pool

    def hit(self, key: object) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until the next
        hit would be."""
        now = self._clock()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(hits[0] + self.window - now, 0.0)
            hits.append(now)
            # Keep the map from growing without bound across many keys.
            if len(self._hits) > 10_000:
                self._hits = {k: v for k, v in self._hits.items() if v}
            return None


class DailyBudget:
    """Bytes allowed per UTC day, across every response."""

    def __init__(
        self,
        limit: int,
        today: Callable[[], str] = lambda: datetime.now(timezone.utc).date().isoformat(),
    ) -> None:
        self.limit = limit
        self._today = today
        self._day = ""
        self._used = 0
        self._lock = threading.Lock()

    def _roll(self) -> None:
        day = self._today()
        if day != self._day:
            self._day, self._used = day, 0

    def exhausted(self) -> bool:
        with self._lock:
            self._roll()
            return self._used >= self.limit

    def spend(self, n: int) -> None:
        with self._lock:
            self._roll()
            self._used += n


@dataclass
class Limits:
    per_user: SlidingWindow
    sign_ins: SlidingWindow
    egress: DailyBudget
    max_body_bytes: int

    @classmethod
    def from_settings(cls, s: Settings) -> "Limits":
        return cls(
            per_user=SlidingWindow(s.requests_per_minute_per_user, 60),
            sign_ins=SlidingWindow(s.sign_ins_per_minute, 60),
            egress=DailyBudget(s.egress_bytes_per_day),
            max_body_bytes=s.max_body_bytes,
        )


def retry_after(seconds: float) -> dict[str, str]:
    return {"Retry-After": str(max(1, math.ceil(seconds)))}


class GuardMiddleware:
    """Pure ASGI, so it sees every request before FastAPI parses a byte.

    - Refuses a body larger than `max_body_bytes` (413) from its
      Content-Length, and a chunked body with no length at all (411). The
      server then enforces the declared length, so nothing bigger is read.
    - Refuses everything once the day's egress budget is spent (503), and
      counts every response byte against it.
    - Adds `nosniff`, and `no-store` unless a route chose its own caching.
    """

    def __init__(self, app: ASGIApp, get_limits: Callable[[], Limits]) -> None:
        self.app = app
        self.get_limits = get_limits

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limits = self.get_limits()
        headers = dict(scope["headers"])

        length = headers.get(b"content-length")
        if length is None and b"chunked" in headers.get(b"transfer-encoding", b"").lower():
            await _reply(send, 411, "A Content-Length is required.")
            return
        if length is not None:
            try:
                too_big = int(length) > limits.max_body_bytes
            except ValueError:
                await _reply(send, 400, "Bad Content-Length.")
                return
            if too_big:
                await _reply(send, 413, "Request body is too large.")
                return

        if limits.egress.exhausted() and scope["path"] != "/health":
            await _reply(
                send, 503, "The server is resting until tomorrow.", retry_after(3600)
            )
            return

        async def guarded_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                names = {k.lower() for k, _ in message.get("headers", [])}
                extra = [(b"x-content-type-options", b"nosniff")]
                if b"cache-control" not in names:
                    extra.append((b"cache-control", b"no-store"))
                message["headers"] = list(message.get("headers", [])) + extra
            elif message["type"] == "http.response.body":
                limits.egress.spend(len(message.get("body", b"")))
            await send(message)

        await self.app(scope, receive, guarded_send)


async def _reply(
    send: Send, status: int, detail: str, headers: dict[str, str] | None = None
) -> None:
    body = json.dumps({"detail": detail}).encode()
    raw = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"x-content-type-options", b"nosniff"),
        (b"cache-control", b"no-store"),
    ] + [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})
