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
from app.models.jsa import GenerateRequest
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
    every other test in the session (several tests here set detailed_model /
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
    )

    doc = await generate_jsa(request, provider, settings)

    assert doc.header.work_activity == "งานทดสอบ"
    assert doc.header.supervisor == "สมชาย ใจดี"
    assert doc.header.analysis_date == date(2026, 8, 12)
    assert doc.header.analyst == "สมหญิง"


async def test_generate_jsa_uses_detailed_model_when_requested(settings):
    settings.ai.detailed_model = "detailed-test-model"
    raw = """{"work_activity": "งาน", "steps": [{"no": 1, "procedure": "ขั้นตอน",
              "details": "", "hazards": []}], "assumptions": []}"""
    provider = FakeProvider(raw)
    request = GenerateRequest(
        supervisor="สมชาย",
        analysis_date=date(2026, 8, 12),
        work_description="ทดสอบโหมดวิเคราะห์อย่างละเอียด",
        detailed=True,
    )

    await generate_jsa(request, provider, settings)

    assert provider.calls[0]["model"] == "detailed-test-model"


async def test_detailed_flag_noops_when_no_detailed_model_configured(settings):
    """Blanking detailed_model in config must disable the toggle completely —
    same model and same prompt as a normal request."""
    settings.ai.detailed_model = ""
    raw = """{"work_activity": "งาน", "steps": [{"no": 1, "procedure": "ขั้นตอน",
              "details": "", "hazards": []}], "assumptions": []}"""

    plain = FakeProvider(raw)
    await generate_jsa(
        GenerateRequest(
            supervisor="ส", analysis_date=date(2026, 8, 12),
            work_description="ทดสอบโหมดปกติเพื่อเทียบ prompt", detailed=False,
        ),
        plain, settings,
    )

    detailed = FakeProvider(raw)
    await generate_jsa(
        GenerateRequest(
            supervisor="ส", analysis_date=date(2026, 8, 12),
            work_description="ทดสอบโหมดปกติเพื่อเทียบ prompt", detailed=True,
        ),
        detailed, settings,
    )

    assert detailed.calls[0]["model"] == plain.calls[0]["model"] == settings.ai.model
    assert detailed.calls[0]["system_prompt"] == plain.calls[0]["system_prompt"]
