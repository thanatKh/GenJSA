"""Retry/validation behaviour of the shared generation core.

These cover generate_validated, which both /api/jsa/generate and
/api/procedure/generate run through — a regression here breaks both document
types at once, which is exactly why it's worth testing the fake-provider path
even though no test ever calls the real AI.
"""

from datetime import date

import pytest
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import AppError, Errors
from app.models.jsa import GenerateRequest, JsaDocument
from app.providers.llm.base import LLMProvider
from app.services.ai_service import generate_jsa, generate_validated


class Payload(BaseModel):
    ok: bool


class FakeProvider(LLMProvider):
    """Replays a scripted list of responses; an AppError entry is raised instead."""

    def __init__(self, *responses: str | AppError) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    async def complete(
        self, system_prompt: str, user_prompt: str, *, model: str, json_mode: bool
    ) -> str:
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "model": model,
                "json_mode": json_mode,
            }
        )
        nxt = self._responses.pop(0)
        if isinstance(nxt, AppError):
            raise nxt
        return nxt

    async def aclose(self) -> None:  # pragma: no cover - nothing to close
        pass


@pytest.fixture
def settings():
    """A private deep copy of the real settings.

    get_settings() is lru_cached, so mutating what it returns would leak into
    every other test in the session (tests here set detailed_model /
    max_attempts). Copying keeps the real config as the source of truth without
    letting these tests scribble on it.
    """
    s = get_settings().model_copy(deep=True)
    # Keep the suite fast — the real backoff is seconds per attempt
    s.ai.retry.backoff_seconds = 0
    return s


async def _run(provider, settings, payload_model=Payload):
    return await generate_validated(
        system_prompt="sys",
        user_prompt="user",
        model="test-model",
        payload_model=payload_model,
        provider=provider,
        settings=settings,
    )


async def test_returns_validated_payload_on_first_try(settings):
    provider = FakeProvider('{"ok": true}')
    result = await _run(provider, settings)
    assert result.ok is True
    assert len(provider.calls) == 1


async def test_retries_after_unparseable_response(settings):
    provider = FakeProvider("not json at all", '{"ok": true}')
    result = await _run(provider, settings)
    assert result.ok is True
    assert len(provider.calls) == 2


async def test_retry_appends_json_only_reminder(settings):
    """The 2nd+ attempt must nudge the model, or a model that ignores the schema
    once will usually ignore it again in exactly the same way."""
    provider = FakeProvider("nope", '{"ok": true}')
    await _run(provider, settings)
    assert provider.calls[0]["system_prompt"] == "sys"
    assert provider.calls[1]["system_prompt"].startswith("sys")
    assert len(provider.calls[1]["system_prompt"]) > len("sys")


async def test_bad_response_disables_json_mode_for_next_attempt(settings):
    """A provider that rejects response_format answers 400 -> AI_BAD_RESPONSE.
    Retrying with json_mode still on would just fail the same way forever."""
    settings.ai.request_json_mode = True
    provider = FakeProvider(Errors.AI_BAD_RESPONSE, '{"ok": true}')
    await _run(provider, settings)
    assert provider.calls[0]["json_mode"] is True
    assert provider.calls[1]["json_mode"] is False


async def test_unavailable_is_retried(settings):
    provider = FakeProvider(Errors.AI_UNAVAILABLE, '{"ok": true}')
    result = await _run(provider, settings)
    assert result.ok is True
    assert len(provider.calls) == 2


async def test_auth_error_is_not_retried(settings):
    """Auth won't fix itself in two seconds — surfacing it immediately beats
    burning the user's whole retry budget on it."""
    provider = FakeProvider(Errors.AI_AUTH, '{"ok": true}')
    with pytest.raises(AppError) as excinfo:
        await _run(provider, settings)
    assert excinfo.value.code == Errors.AI_AUTH.code
    assert len(provider.calls) == 1


async def test_raises_after_exhausting_attempts(settings):
    settings.ai.retry.max_attempts = 3
    provider = FakeProvider("bad", "also bad", "still bad")
    with pytest.raises(AppError) as excinfo:
        await _run(provider, settings)
    assert excinfo.value.code == Errors.AI_BAD_RESPONSE.code
    assert len(provider.calls) == 3


async def test_generate_jsa_keeps_request_owned_header_fields(settings):
    """The AI supplies work_activity/steps; the supervisor, date and analyst come
    from the request and must never be taken from the model's response."""
    raw = """{"work_activity": "งานทดสอบ",
              "steps": [{"no": 1, "procedure": "ขั้นตอน", "details": "",
                         "hazards": [{"hazard": "อันตราย", "controls": ["มาตรการ"]}]}],
              "assumptions": []}"""
    provider = FakeProvider(raw)
    request = GenerateRequest(
        supervisor="สมชาย ใจดี",
        analysis_date=date(2026, 8, 12),
        work_description="ทดสอบการสร้าง JSA ด้วยข้อมูลจำลอง",
        analyst="สมหญิง",
        company="  บจ. เอบีซี เอ็นจิเนียริ่ง  ",
    )

    doc = await generate_jsa(request, provider, settings)

    assert doc.header.work_activity == "งานทดสอบ"
    assert doc.header.supervisor == "สมชาย ใจดี"
    assert doc.header.analysis_date == date(2026, 8, 12)
    assert doc.header.analyst == "สมหญิง"
    assert doc.header.company == "บจ. เอบีซี เอ็นจิเนียริ่ง"
    # The company is header-only: it must never reach the AI
    assert all(
        "เอบีซี" not in call["system_prompt"] + call["user_prompt"] for call in provider.calls
    )


def test_company_is_optional_for_documents_saved_before_it_existed(sample_doc):
    """History entries and requests from before the company field must still
    validate — blank company means PTTOR's own document."""
    data = sample_doc.model_dump(mode="json")
    data["header"].pop("company", None)
    doc = JsaDocument.model_validate(data)
    assert doc.header.company == ""


async def test_generate_jsa_always_uses_the_plain_model(settings):
    """JSA generation used to have a "วิเคราะห์อย่างละเอียด" toggle that switched
    to settings.ai.detailed_model — removed because the qwen model it used
    there wrote unnaturally over-detailed steps, not how a human actually
    writes a JSA. generate_jsa must never read detailed_model at all now,
    however it's set — that model is still used elsewhere (procedure_service),
    so this guards against JSA generation accidentally being re-wired to it."""
    settings.ai.detailed_model = "detailed-test-model"
    raw = """{"work_activity": "งาน", "steps": [{"no": 1, "procedure": "ขั้นตอน",
              "details": "", "hazards": []}], "assumptions": []}"""
    provider = FakeProvider(raw)
    request = GenerateRequest(
        supervisor="สมชาย",
        analysis_date=date(2026, 8, 12),
        work_description="ทดสอบว่าไม่ใช้ detailed_model",
    )

    await generate_jsa(request, provider, settings)

    assert provider.calls[0]["model"] == settings.ai.model


def _project_request(**project):
    return GenerateRequest(
        supervisor="สมชาย",
        analysis_date=date(2026, 11, 1),
        work_description="ใส่ Blind 3 จุดและ N2 Purging ท่อ Liquid 8 นิ้ว",
        project={
            "name": "ซ่อมท่อ KBY 2569",
            "notes": "ข้อจำกัดด้าน IGG",
            "references": [{"tag": "HSV-335", "note": "8 นิ้ว Breather Blind"}],
            "phases": ["Empty ระบบ", "ใส่ Blind และ N2 Purging", "Cold Cut"],
            "phase_index": 1,
            **project,
        },
    )


_ONE_STEP = """{"work_activity": "ชื่อที่ระบบตั้งเอง", "steps": [{"no": 1,
  "procedure": "ขั้นตอน", "details": "", "hazards": []}], "assumptions": []}"""


async def test_project_context_reaches_the_prompt(settings):
    """Project Mode sends the phase list (with this phase marked), the notes
    and the tag list — the tags are the only equipment numbers the model may use."""
    provider = FakeProvider(_ONE_STEP)
    await generate_jsa(_project_request(), provider, settings)

    prompt = provider.calls[0]["user_prompt"]
    assert "ซ่อมท่อ KBY 2569" in prompt
    assert "2. ใส่ Blind และ N2 Purging  ← ร่าง JSA เฉพาะขั้นตอนนี้" in prompt
    assert "ข้อจำกัดด้าน IGG" in prompt
    assert "- HSV-335: 8 นิ้ว Breather Blind" in prompt
    # The description still comes last, after the context
    assert prompt.rstrip().endswith("ท่อ Liquid 8 นิ้ว")


async def test_project_jsa_takes_the_users_phase_name_and_project(settings):
    provider = FakeProvider(_ONE_STEP)
    doc = await generate_jsa(_project_request(), provider, settings)

    assert doc.header.work_activity == "ใส่ Blind และ N2 Purging"
    assert doc.header.project == "ซ่อมท่อ KBY 2569"


async def test_single_mode_prompt_is_unchanged(settings):
    provider = FakeProvider(_ONE_STEP)
    request = GenerateRequest(
        supervisor="สมชาย", analysis_date=date(2026, 11, 1), work_description="เปลี่ยนวาล์ว Drain ถัง V-101"
    )
    doc = await generate_jsa(request, provider, settings)

    assert provider.calls[0]["user_prompt"] == "รายละเอียดงานที่จะปฏิบัติ:\n\nเปลี่ยนวาล์ว Drain ถัง V-101"
    assert doc.header.project == ""
    assert doc.header.work_activity == "ชื่อที่ระบบตั้งเอง"


def test_phase_index_must_point_at_a_phase():
    with pytest.raises(ValueError):
        _project_request(phase_index=3)
