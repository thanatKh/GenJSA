"""API routes: generate JSA + public config

The PDF is not generated on the backend — the browser builds it itself
(frontend/src/lib/pdf/). The backend's job is to send "layout values from
config/" for the client to draw with, so the document's appearance can still
be tuned via config/pdf.yaml without touching code.
"""

import logging

from fastapi import APIRouter, Request

from ..core.config import get_settings
from ..core.ratelimit import enforce
from ..models.jsa import GenerateRequest, JsaDocument
from ..services.ai_service import generate_jsa

logger = logging.getLogger("genjsa")
router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Render uses this to check the service is alive — keep it light, don't touch the AI."""
    return {"status": "ok"}


@router.get("/api/config/public")
async def public_config() -> dict:
    """Data the frontend needs for both display and drawing the PDF.

    Never send the API key or model name — the user doesn't choose the model
    and shouldn't know it.
    """
    settings = get_settings()
    doc = settings.document.document
    company = settings.company.company
    pdf = settings.pdf

    return {
        "appName": settings.app.app.name,
        "company": {"name": company.name, "department": company.department},
        "document": {
            "formCode": doc.form_code,
            "footerText": doc.footer_text,
            "titleTh": doc.title_th,
            "titleEn": doc.title_en,
            "labels": doc.labels.model_dump(),
            "columns": doc.columns.model_dump(),
        },
        "limits": {
            "workDescriptionMaxChars": settings.app.limits.work_description_max_chars,
            "supervisorMaxChars": settings.app.limits.supervisor_max_chars,
        },
        # Values the client uses to draw the document — the full config/pdf.yaml
        "pdf": {
            "page": pdf.page.model_dump(),
            "font": pdf.font.model_dump(),
            "table": pdf.table.model_dump(),
            "logo": pdf.logo.model_dump(),
            "footer": pdf.footer.model_dump(),
            "signature": pdf.signature.model_dump(),
        },
    }


@router.post("/api/jsa/generate")
async def generate(request: Request, body: GenerateRequest) -> JsaDocument:
    settings = get_settings()
    enforce(request, settings.app.rate_limit.generate_per_minute)

    provider = request.app.state.llm_provider
    # Don't log the work description content — just its length, for debugging payload issues
    logger.info("generate requested (%d chars)", len(body.work_description))
    return await generate_jsa(body, provider, settings)
