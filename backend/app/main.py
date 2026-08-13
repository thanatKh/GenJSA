"""GenJSA — FastAPI entry point

PRIVACY (a non-negotiable requirement):
  Never log JSA content, work descriptions, names, or AI responses, under any
  circumstances. No database, no file storage, no sessions — data lives in
  memory only for the duration of a single request, then it's gone.
  uvicorn's access log is disabled because per-request URLs/statuses aren't
  needed and constitute usage data.

PDF: built client-side with jsPDF (frontend/src/lib/pdf/) — the backend has no
Chromium and no PDF-generating route. It only sends layout values from
config/pdf.yaml via /api/config/public for the client to draw with.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.jsa import router as jsa_router
from .core.body_limit import BodySizeLimitMiddleware
from .core.config import ROOT, get_settings
from .core.errors import (
    AppError,
    Errors,
    app_error_handler,
    unhandled_error_handler,
)
from .providers.llm.registry import build_provider

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# Disable access logging — don't retain a per-request usage trail
logging.getLogger("uvicorn.access").disabled = True
logger = logging.getLogger("genjsa")

FRONTEND_DIST = ROOT / "frontend" / "dist"
FRONTEND_DIST_RESOLVED = FRONTEND_DIST.resolve()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    app.state.llm_provider = build_provider(settings)
    logger.info("GenJSA ready (provider=%s)", settings.ai.provider)

    try:
        yield
    finally:
        await app.state.llm_provider.aclose()


app = FastAPI(
    title="GenJSA",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

_settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.app.cors.allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=_settings.app.limits.max_request_bytes)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_handler(_, __) -> JSONResponse:
    """Pydantic reports exactly which field is wrong, but the user shouldn't see server-side field names."""
    return JSONResponse(
        status_code=Errors.INVALID_INPUT.status_code,
        content={
            "error": {
                "code": Errors.INVALID_INPUT.code,
                "message": Errors.INVALID_INPUT.message,
            }
        },
    )


app.include_router(jsa_router)


# --------------------------------------------------------------------------- #
# Static frontend — production only (dev uses the vite dev server via proxy)
# Must be registered after the API routes so the catch-all doesn't swallow /api/*
# --------------------------------------------------------------------------- #
if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> FileResponse:
        """SPA fallback — every non-API path is handed off to index.html.

        full_path comes straight from the URL and can contain ".." segments
        (Starlette's path converter does not normalize them), so the resolved
        candidate must be verified to still live inside FRONTEND_DIST before
        being served — otherwise a request like /../.env could read files
        outside the frontend build, including the .env secret one directory up.
        """
        candidate = (FRONTEND_DIST / full_path).resolve()
        if (
            full_path
            and candidate.is_file()
            and candidate.is_relative_to(FRONTEND_DIST_RESOLVED)
        ):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    logger.info("No frontend/dist yet — for dev mode, run vite separately (npm run dev)")
