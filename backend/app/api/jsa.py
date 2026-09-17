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
from ..models.procedure import GenerateProcedureRequest, ProcedureDocument
from ..services.ai_service import generate_jsa
from ..services.procedure_service import generate_procedure

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
    proc = settings.procedure.document

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
        # The work procedure document (config/procedure.yaml) — same whitelist
        # discipline as above; it has no form code or API key to leak, but the
        # client still only gets what it needs to draw the document
        "procedure": {
            "titleTh": proc.title_th,
            "titleEn": proc.title_en,
            "formCode": proc.form_code,
            "footerText": proc.footer_text,
            "labels": proc.labels.model_dump(),
            "sections": proc.sections.model_dump(),
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
    enforce(request, settings.app.rate_limit.generate_per_minute, bucket="jsa")

    provider = request.app.state.llm_provider
    # Don't log the work description content — just its length, for debugging payload issues
    logger.info(
        "generate requested (%d chars, detailed=%s)",
        len(body.work_description),
        body.detailed,
    )
    return await generate_jsa(body, provider, settings)


@router.post("/api/procedure/generate")
async def generate_procedure_route(
    request: Request, body: GenerateProcedureRequest
) -> ProcedureDocument:
    """Expand a finished JSA into a step-by-step work procedure.

    This is the one route that takes a document back from the browser. It's
    held in memory for this request only and never written anywhere — see the
    persistence principles in CLAUDE.md, where the exception is documented.
    """
    settings = get_settings()
    # Its own bucket, so drafting a procedure doesn't eat the JSA allowance
    enforce(request, settings.app.rate_limit.generate_per_minute, bucket="procedure")

    provider = request.app.state.llm_provider
    # Step count only — never the step content
    logger.info("procedure requested (%d steps)", len(body.jsa.steps))
    return await generate_procedure(body, provider, settings)
