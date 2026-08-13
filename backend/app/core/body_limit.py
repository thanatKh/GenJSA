"""ASGI middleware enforcing Limits.max_request_bytes.

Plain BaseHTTPMiddleware still buffers the whole body into memory before
handler code (or Pydantic) ever sees it, so a Content-Length check alone
isn't enough — a request can omit/understate that header. This drains the
ASGI receive channel itself, counting bytes as they arrive, and — the
moment the running total crosses the limit — stops calling into the rest
of the app entirely and sends the 413 response directly over `send`.

(Raising from inside a receive() callable passed down to the app doesn't
reliably surface through FastAPI's AppError exception-handler machinery —
Starlette's own body-parsing wraps receive() and turns any exception from
it into a generic 400 before our app-level exception middleware ever sees
it, verified empirically. Draining and responding before ever invoking
self.app avoids relying on that propagation path.)
"""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import Errors


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        buffered: list[Message] = []
        total = 0

        while True:
            message = await receive()
            if message["type"] != "http.request":
                buffered.append(message)
                break
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                await _send_413(send)
                return
            buffered.append(message)
            if not message.get("more_body", False):
                break

        replayed = iter(buffered)

        async def replay_receive() -> Message:
            try:
                return next(replayed)
            except StopIteration:
                return await receive()

        await self.app(scope, replay_receive, send)


async def _send_413(send: Send) -> None:
    error = Errors.PAYLOAD_TOO_LARGE
    body = json.dumps({"error": {"code": error.code, "message": error.message}}).encode(
        "utf-8"
    )
    await send(
        {
            "type": "http.response.start",
            "status": error.status_code,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})
