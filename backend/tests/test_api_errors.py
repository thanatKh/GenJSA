"""The user must never see a traceback, and logs must never contain JSA content."""

import httpx
import pytest

from app.core.errors import Errors
from app.models.jsa import GenerateRequest
from app.providers.llm.base import LLMProvider
from app.services.ai_service import generate_jsa
from app.core.config import get_settings

VALID_AI_JSON = """
{"work_activity":"เปลี่ยน seal ปั๊ม",
 "steps":[{"no":1,"procedure":"เตรียมพื้นที่","details":"",
           "hazards":[{"hazard":"ลื่นล้ม","controls":["ทำความสะอาดพื้น"]}]}],
 "assumptions":[]}
"""


class ScriptedProvider(LLMProvider):
    """A fake provider that answers per a script — never touches the network."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0
        self.json_modes = []

    async def complete(self, system_prompt, user_prompt, *, model, json_mode):
        self.calls += 1
        self.json_modes.append(json_mode)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def aclose(self):
        pass


def _request():
    from datetime import date

    return GenerateRequest(
        supervisor="สมชาย",
        analysis_date=date(2026, 8, 12),
        work_description="เปลี่ยน mechanical seal ของ LPG pump P-101 ต้อง isolate ก่อน",
    )


@pytest.mark.asyncio
async def test_happy_path_builds_document():
    provider = ScriptedProvider([VALID_AI_JSON])
    doc = await generate_jsa(_request(), provider, get_settings())

    assert doc.header.supervisor == "สมชาย"
    assert doc.header.work_activity == "เปลี่ยน seal ปั๊ม"
    assert doc.steps[0].hazards[0].controls == ["ทำความสะอาดพื้น"]


@pytest.mark.asyncio
async def test_retries_then_succeeds_on_garbage_first_response():
    provider = ScriptedProvider(["ขอโทษครับ ผมไม่เข้าใจ", VALID_AI_JSON])
    doc = await generate_jsa(_request(), provider, get_settings())

    assert provider.calls == 2
    assert doc.steps[0].procedure == "เตรียมพื้นที่"


@pytest.mark.asyncio
async def test_gives_up_with_thai_error_after_max_attempts():
    settings = get_settings()
    attempts = settings.ai.retry.max_attempts
    provider = ScriptedProvider(["ไม่ใช่ JSON"] * attempts)

    with pytest.raises(Exception) as excinfo:
        await generate_jsa(_request(), provider, settings)

    error = excinfo.value
    assert error.code == Errors.AI_BAD_RESPONSE.code
    # The message must be Thai and free of server-side technical jargon
    assert "JSON" not in error.message
    assert "traceback" not in error.message.lower()


@pytest.mark.asyncio
async def test_timeout_is_not_retried():
    """Retrying a timeout doesn't help and doubles how long the user waits."""
    provider = ScriptedProvider([Errors.AI_TIMEOUT, VALID_AI_JSON])

    with pytest.raises(Exception) as excinfo:
        await generate_jsa(_request(), provider, get_settings())

    assert excinfo.value.code == Errors.AI_TIMEOUT.code
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_json_mode_disabled_after_provider_rejects_it():
    """A provider that doesn't recognize response_format must not permanently break generation."""
    provider = ScriptedProvider([Errors.AI_BAD_RESPONSE, VALID_AI_JSON])
    await generate_jsa(_request(), provider, get_settings())

    assert provider.json_modes[0] is True
    assert provider.json_modes[1] is False


@pytest.mark.asyncio
async def test_no_jsa_content_in_logs(caplog):
    secret = "ถังเก็บ LPG หมายเลข TK-999 ที่คลังลับ"
    provider = ScriptedProvider([VALID_AI_JSON])

    from datetime import date

    request = GenerateRequest(
        supervisor="สมชาย", analysis_date=date(2026, 8, 12), work_description=secret
    )
    with caplog.at_level("DEBUG"):
        await generate_jsa(request, provider, get_settings())

    assert secret not in caplog.text
    assert "TK-999" not in caplog.text
