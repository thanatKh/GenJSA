"""In-memory per-IP rate limiter.

Deliberately not backed by Redis — the requirement forbids adding
infrastructure. Accepted limitation: if scaled to multiple instances, each
instance counts independently, which is fine for an internal tool running
as a single instance.
"""

import time
from collections import defaultdict, deque

from fastapi import Request

from .config import get_settings
from .errors import Errors

_WINDOW_SECONDS = 60

# ip -> timestamps of recent requests within the window
_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Render sits behind a reverse proxy, so read X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(request: Request, limit_per_minute: int, bucket: str = "") -> None:
    """Count this request against `bucket` for the caller's IP.

    `bucket` gives an endpoint its own window. Without it, generating a JSA and
    then a procedure for the same job would spend two of the same six requests,
    so a user doing the normal thing would hit the limit twice as fast. The
    default empty bucket keeps existing callers on exactly the key they had.
    """
    settings = get_settings()
    if not settings.app.rate_limit.enabled:
        return

    now = time.monotonic()
    stamps = _hits[f"{_client_ip(request)}|{bucket}" if bucket else _client_ip(request)]

    while stamps and now - stamps[0] > _WINDOW_SECONDS:
        stamps.popleft()

    if len(stamps) >= limit_per_minute:
        raise Errors.TOO_MANY_REQUESTS

    stamps.append(now)

    # Prevent unbounded dict growth if odd IPs keep showing up
    if len(_hits) > 5000:
        _prune(now)


def _prune(now: float) -> None:
    stale = [ip for ip, q in _hits.items() if not q or now - q[-1] > _WINDOW_SECONDS]
    for ip in stale:
        _hits.pop(ip, None)
