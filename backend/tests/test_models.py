"""Model invariants the document relies on."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.models.jsa import (
    AiJsaPayload,
    GenerateRequest,
    Hazard,
    JsaDocument,
    JsaHeader,
    JsaStep,
)


def _header():
    return JsaHeader(
        work_activity="งานทดสอบ", supervisor="ผู้ทดสอบ", analysis_date=date(2026, 8, 12)
    )


def _step(no: int, procedure: str = "ขั้นตอน"):
    return JsaStep(no=no, procedure=procedure, hazards=[])


def test_steps_are_renumbered_sequentially():
    """Users can freely reorder/delete steps — the document must never have duplicate or skipped numbers."""
    doc = JsaDocument(
        header=_header(),
        steps=[_step(7, "ก"), _step(7, "ข"), _step(2, "ค")],
    )
    assert [s.no for s in doc.steps] == [1, 2, 3]
    # Content order must not change — only the numbers get rewritten
    assert [s.procedure for s in doc.steps] == ["ก", "ข", "ค"]


def test_document_requires_at_least_one_step():
    with pytest.raises(ValidationError):
        JsaDocument(header=_header(), steps=[])


def test_blank_controls_are_dropped():
    hz = Hazard(hazard="อันตราย", controls=["  ", "", "มาตรการจริง", "  อีกอัน  "])
    assert hz.controls == ["มาตรการจริง", "อีกอัน"]


def test_blank_assumptions_are_dropped():
    payload = AiJsaPayload(
        work_activity="ก",
        steps=[_step(1)],
        assumptions=["", "   ", "ข้อสันนิษฐานจริง"],
    )
    assert payload.assumptions == ["ข้อสันนิษฐานจริง"]


def test_generate_request_rejects_too_short_description():
    with pytest.raises(ValidationError):
        GenerateRequest(
            supervisor="ก", analysis_date=date(2026, 8, 12), work_description="สั้น"
        )


def test_generate_request_rejects_oversized_description():
    with pytest.raises(ValidationError):
        GenerateRequest(
            supervisor="ก",
            analysis_date=date(2026, 8, 12),
            work_description="ก" * 5001,
        )
