"""Generate a JSA with the LLM.

Pipeline: prompt (from file) -> LLM -> json_repair -> Pydantic validate -> JsaDocument.
If validation fails, retry per config/ai.yaml with a reminder to answer with
JSON only.
"""

import asyncio
import logging

from jinja2 import Template
from pydantic import ValidationError

from ..core.config import PROMPTS_DIR, Settings
from ..core.errors import AppError, Errors
from ..models.jsa import AiJsaPayload, GenerateRequest, JsaDocument, JsaHeader
from ..providers.llm.base import LLMProvider
from .json_repair import repair_and_parse

logger = logging.getLogger("genjsa")

_RETRY_REMINDER = (
    "\n\nสำคัญ: ครั้งก่อนคุณตอบในรูปแบบที่ระบบอ่านไม่ได้ "
    "ครั้งนี้ให้ตอบเป็น JSON object เพียงอย่างเดียว "
    "เริ่มต้นด้วย { และจบด้วย } ห้ามมีข้อความอื่นใดนอก JSON "
    "ห้ามครอบด้วย markdown code fence"
)


def _load_system_prompt(settings: Settings) -> str:
    """Load the prompt from disk every time, rendered with values from config/jsa-rules.yaml.

    Not cached, so editing the prompt takes effect immediately during dev
    (the file is small, so this is cheap).
    """
    path = PROMPTS_DIR / "jsa-generate.md"
    if not path.exists():
        raise RuntimeError(f"Prompt file not found: {path}")
    return Template(path.read_text(encoding="utf-8")).render(rules=settings.rules)


def _build_user_prompt(request: GenerateRequest) -> str:
    return f"รายละเอียดงานที่จะปฏิบัติ:\n\n{request.work_description.strip()}"


async def generate_jsa(
    request: GenerateRequest,
    provider: LLMProvider,
    settings: Settings,
) -> JsaDocument:
    system_prompt = _load_system_prompt(settings)
    user_prompt = _build_user_prompt(request)

    attempts = max(1, settings.ai.retry.max_attempts)
    json_mode = settings.ai.request_json_mode
    last_error: AppError = Errors.AI_BAD_RESPONSE

    for attempt in range(1, attempts + 1):
        prompt = system_prompt if attempt == 1 else system_prompt + _RETRY_REMINDER

        try:
            raw = await provider.complete(
                prompt,
                user_prompt,
                model=settings.ai.model,
                json_mode=json_mode,
            )
        except AppError as exc:
            # timeout / auth / rate limit — retrying won't help (timeout would just double the
            # wait since timeout_seconds is already generous; auth/rate-limit won't resolve
            # themselves in a couple seconds). AI_UNAVAILABLE (DNS/TLS/connection-refused) is
            # the one transient case worth a retry — it's often a momentary blip.
            if exc.code not in (Errors.AI_BAD_RESPONSE.code, Errors.AI_UNAVAILABLE.code):
                raise
            last_error = exc
            if exc.code == Errors.AI_BAD_RESPONSE.code:
                # The provider may not support json_mode — try without it next time
                json_mode = False
            logger.warning("AI call failed (%s) on attempt %d/%d", exc.code, attempt, attempts)
            await _backoff(settings, attempt, attempts)
            continue

        try:
            payload = AiJsaPayload.model_validate(repair_and_parse(raw))
        except (ValueError, ValidationError):
            # Log only the attempt number — never the response itself, since it contains work content
            logger.warning("AI response invalid on attempt %d/%d", attempt, attempts)
            last_error = Errors.AI_BAD_RESPONSE
            await _backoff(settings, attempt, attempts)
            continue

        return JsaDocument(
            header=JsaHeader(
                work_activity=payload.work_activity.strip(),
                supervisor=request.supervisor.strip(),
                analysis_date=request.analysis_date,
                analyst=request.analyst.strip(),
            ),
            steps=payload.steps,
            assumptions=payload.assumptions,
        )

    raise last_error


async def _backoff(settings: Settings, attempt: int, attempts: int) -> None:
    if attempt < attempts and settings.ai.retry.backoff_seconds > 0:
        await asyncio.sleep(settings.ai.retry.backoff_seconds)
