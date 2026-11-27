"""Assembly of a work procedure from a JSA plus an AI payload.

The point of these: the "AI must not restructure the steps" and "AI must not
invent references" rules are meant to be structural guarantees, not prompt
requests the model can drift away from. If a future refactor starts trusting
the model's own step list or lets `references` into the AI contract, these fail.
"""

from datetime import date
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import get_settings
from app.core.errors import AppError, Errors
from app.models.jsa import Hazard, JsaDocument, JsaHeader, JsaStep
from app.models.procedure import AiProcedurePayload, AiProcedureStep, SubStep, GenerateProcedureRequest
from app.providers.llm.base import LLMProvider
from app.providers.llm.thaillm import ThaiLLMProvider
from app.services.procedure_service import _assemble, _build_user_prompt, generate_procedure


@pytest.fixture
def settings():
    settings = get_settings().model_copy(deep=True)
    settings.ai.retry.backoff_seconds = 0
    return settings


@pytest.fixture
def jsa():
    return JsaDocument(
        header=JsaHeader(
            work_activity="เปลี่ยน mechanical seal ของ LPG Pump P-101",
            supervisor="สมชาย ใจดี",
            analysis_date=date(2026, 8, 12),
            analyst="สมหญิง",
        ),
        steps=[
            JsaStep(
                no=1,
                procedure="ตัดแยกระบบและ LOTO",
                details="ปิดวาล์วและตัดไฟ",
                hazards=[Hazard(hazard="ไฟฟ้าดูด", controls=["ตรวจสอบแรงดันก่อนสัมผัส"])],
            ),
            JsaStep(
                no=2,
                procedure="ระบายความดันและ drain product",
                details="",
                hazards=[Hazard(hazard="LPG รั่วไหล", controls=["ตรวจวัดก๊าซ"])],
            ),
        ],
        assumptions=[],
    )


def _payload(**kwargs) -> AiProcedurePayload:
    base = dict(
        purpose="เพื่อกำหนดวิธีปฏิบัติงาน",
        scope="ครอบคลุมปั๊ม P-101",
        tools=["ประแจปากตาย"],
        steps=[
            AiProcedureStep(no=1, sub_steps=[SubStep(no=1, action="ปิดวาล์ว")]),
            AiProcedureStep(no=2, sub_steps=[SubStep(no=1, action="เปิดวาล์วระบาย")]),
        ],
        assumptions=[],
    )
    base.update(kwargs)
    return AiProcedurePayload(**base)


def test_step_titles_come_from_the_jsa(jsa, settings):
    doc = _assemble(jsa, _payload(), settings)
    assert [s.procedure for s in doc.steps] == [
        "ตัดแยกระบบและ LOTO",
        "ระบายความดันและ drain product",
    ]


def test_header_is_inherited_unchanged(jsa, settings):
    doc = _assemble(jsa, _payload(), settings)
    assert doc.header == jsa.header


async def test_procedure_failover_after_model_404_preserves_reviewed_jsa(jsa, settings, monkeypatch):
    settings.ai.detailed_model = "primary"
    settings.ai.detailed_fallback_models = ["backup"]
    provider = ThaiLLMProvider(settings.ai, "test-key")
    post = AsyncMock(side_effect=[
        httpx.Response(404),
        httpx.Response(200, json={"choices": [{"message": {"content": _payload().model_dump_json()}}]}),
    ])
    monkeypatch.setattr(provider._client, "post", post)
    try:
        doc = await generate_procedure(GenerateProcedureRequest(jsa=jsa), provider, settings)
    finally:
        await provider.aclose()
    assert [c.kwargs["json"]["model"] for c in post.await_args_list] == ["primary", "backup"]
    assert doc.header == jsa.header
    assert [s.procedure for s in doc.steps] == [s.procedure for s in jsa.steps]
    assert all(s.sub_steps for s in doc.steps)
    assert doc.references == _assemble(jsa, _payload(), settings).references


async def test_out_of_order_main_steps_are_matched_by_number(jsa, settings):
    provider = AsyncMock(spec=LLMProvider)
    expected = _payload()
    provider.complete.return_value = _payload(steps=expected.steps[::-1]).model_dump_json()

    doc = await generate_procedure(GenerateProcedureRequest(jsa=jsa), provider, settings)

    assert [s.no for s in doc.steps] == [1, 2]
    assert [s.sub_steps for s in doc.steps] == [s.sub_steps for s in expected.steps]
    assert provider.complete.await_count == 1


@pytest.mark.parametrize("numbers", [[2], [1, 1], [1, 3], [1, 2, 3]])
async def test_invalid_main_step_numbers_retry_before_assembly(jsa, settings, numbers):
    provider = AsyncMock(spec=LLMProvider)
    expected = _payload()
    invalid = _payload(steps=[AiProcedureStep(no=no, sub_steps=[SubStep(no=1, action="คำตอบที่ต้องทิ้ง")]) for no in numbers])
    provider.complete.side_effect = [invalid.model_dump_json(), expected.model_dump_json()]

    doc = await generate_procedure(GenerateProcedureRequest(jsa=jsa), provider, settings)

    assert [step.sub_steps for step in doc.steps] == [step.sub_steps for step in expected.steps]
    assert provider.complete.await_count == 2


async def test_repeated_invalid_main_step_numbers_use_only_the_configured_retry_budget(jsa, settings):
    settings.ai.retry.max_attempts = 2
    provider = AsyncMock(spec=LLMProvider)
    provider.complete.return_value = _payload(steps=[]).model_dump_json()

    with pytest.raises(AppError) as exc:
        await generate_procedure(GenerateProcedureRequest(jsa=jsa), provider, settings)

    assert exc.value.code == Errors.AI_BAD_RESPONSE.code
    assert provider.complete.await_count == 2


def test_references_are_built_from_the_jsa(jsa, settings):
    """Never from the AI — a model asked for references invents standard numbers."""
    doc = _assemble(jsa, _payload(), settings)
    assert len(doc.references) == 1
    assert "เปลี่ยน mechanical seal ของ LPG Pump P-101" in doc.references[0]
    assert settings.procedure.document.jsa_reference_label in doc.references[0]


def test_ai_payload_has_no_references_field():
    """The guarantee is structural: the model is never given the field at all."""
    assert "references" not in AiProcedurePayload.model_fields


def test_ai_payload_has_no_step_title_field():
    """Same for step titles — they can only come from the JSA."""
    assert "procedure" not in AiProcedureStep.model_fields


def test_sub_steps_are_renumbered(jsa, settings):
    payload = _payload(
        steps=[
            AiProcedureStep(
                no=1,
                sub_steps=[
                    SubStep(no=5, action="ก"),
                    SubStep(no=9, action="ข"),
                ],
            ),
            AiProcedureStep(no=2, sub_steps=[]),
        ]
    )
    doc = _assemble(jsa, payload, settings)
    assert [s.no for s in doc.steps[0].sub_steps] == [1, 2]


def test_user_prompt_omits_hazards_and_controls(jsa):
    """Safety text a human already approved must not be resent for rewording,
    and leaving it out roughly halves the prompt."""
    prompt = _build_user_prompt(jsa)
    assert "ตัดแยกระบบและ LOTO" in prompt
    assert "ไฟฟ้าดูด" not in prompt
    assert "ตรวจสอบแรงดันก่อนสัมผัส" not in prompt


async def test_procedure_system_prompt_uses_site_terminology(jsa, settings):
    # The word list lives in config/jsa-rules.yaml, not procedure.yaml, so it
    # has to be handed to the procedure prompt explicitly
    provider = AsyncMock(spec=LLMProvider)
    provider.complete.return_value = _payload().model_dump_json()

    await generate_procedure(GenerateProcedureRequest(jsa=jsa), provider, settings)

    system_prompt = provider.complete.await_args.args[0]
    for term in settings.rules.terminology:
        assert f'เขียน "{term.use}"' in system_prompt
