"""Generate a JSA with the LLM.

Pipeline: prompt (from file) -> LLM -> json_repair -> Pydantic validate -> JsaDocument.
If validation fails, retry per config/ai.yaml with a reminder to answer with
JSON only.
"""

import asyncio
import logging
from collections.abc import Sequence

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from pydantic import BaseModel, ValidationError

from ..core.config import PROMPTS_DIR, Settings
from ..core.errors import AppError, Errors
from ..models.jsa import MAX_SUB_STEPS, AiJsaPayload, GenerateRequest, JsaDocument, JsaHeader, ProjectContext
from ..providers.llm.base import LLMProvider
from .json_repair import repair_and_parse

logger = logging.getLogger("genjsa")

_RETRY_REMINDER = (
    "\n\nสำคัญ: ครั้งก่อนคุณตอบในรูปแบบที่ระบบอ่านไม่ได้ "
    "ครั้งนี้ให้ตอบเป็น JSON object เพียงอย่างเดียว "
    "เริ่มต้นด้วย { และจบด้วย } ห้ามมีข้อความอื่นใดนอก JSON "
    "ห้ามครอบด้วย markdown code fence"
)


# A loader rather than a bare Template so prompts can {% include %} the shared
# rules files. auto_reload re-reads a changed file on the next render, so
# editing a prompt still takes effect immediately during dev. StrictUndefined
# turns a missing value into an error instead of a silent blank in the prompt.
_PROMPTS = Environment(
    loader=FileSystemLoader(PROMPTS_DIR),
    auto_reload=True,
    undefined=StrictUndefined,
    keep_trailing_newline=True,
)


def render_prompt(filename: str, **context: object) -> str:
    """Render a prompt file from prompts/ as a Jinja2 template."""
    if not (PROMPTS_DIR / filename).exists():
        raise RuntimeError(f"Prompt file not found: {PROMPTS_DIR / filename}")
    return _PROMPTS.get_template(filename).render(**context)


def jsa_prompt_context(settings: Settings) -> dict[str, object]:
    """Everything jsa-generate.md and jsa-rules.md read — one place, so the
    built-in prompt and the outside-AI rules (public config) can't drift."""
    return {"rules": settings.rules, "max_sub_steps": MAX_SUB_STEPS}


def procedure_prompt_context(settings: Settings) -> dict[str, object]:
    """Same, for procedure-generate.md and procedure-rules.md. Terminology is
    the JSA's word list: one list for both documents."""
    return {
        "rules": settings.procedure,
        "terminology": settings.rules.terminology,
        "max_sub_steps": MAX_SUB_STEPS,
    }


def _load_system_prompt(settings: Settings) -> str:
    return render_prompt("jsa-generate.md", **jsa_prompt_context(settings))


def _build_user_prompt(request: GenerateRequest) -> str:
    description = f"รายละเอียดงานที่จะปฏิบัติ:\n\n{request.work_description.strip()}"
    if request.project is None:
        return description
    return f"{_project_context(request.project)}\n\n{description}"


def _project_context(project: ProjectContext) -> str:
    """Project Mode: tell the model this JSA is one phase of a bigger job.

    The phase list keeps other phases' work out of this JSA (each phase gets
    its own), and the reference list is the one source of tag numbers —
    the system prompt already forbids inventing equipment numbers, so these
    are the ones it may use.
    """
    lines = [f"งานนี้เป็นขั้นตอนหนึ่งของโครงการ: {project.name.strip()}", "", "ขั้นตอนทั้งหมดของโครงการ:"]
    for index, phase in enumerate(project.phases):
        marker = "  ← ร่าง JSA เฉพาะขั้นตอนนี้" if index == project.phase_index else ""
        lines.append(f"{index + 1}. {phase.strip()}{marker}")
    lines.append("ห้ามรวมงานของขั้นตอนอื่นไว้ใน JSA นี้ แต่ละขั้นตอนมี JSA ของตัวเอง")

    if project.notes.strip():
        lines += ["", f"ข้อจำกัด/หมายเหตุของโครงการ: {project.notes.strip()}"]

    if project.references:
        lines += ["", "รายการอ้างอิงของโครงการ (วาล์ว/Blind/Tag) — ใช้เลขตามรายการนี้เท่านั้น ห้ามคิดเลขขึ้นเอง:"]
        for ref in project.references:
            note = f": {ref.note.strip()}" if ref.note.strip() else ""
            lines.append(f"- {ref.tag.strip()}{note}")
    return "\n".join(lines)


async def generate_validated[T: BaseModel](
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
    payload_model: type[T],
    provider: LLMProvider,
    settings: Settings,
    fallback_models: Sequence[str] = (),
) -> T:
    """Call the LLM until it returns something that validates as `payload_model`.

    Document-agnostic on purpose: both the JSA and the work procedure run through
    here, so the retry/backoff/json-mode-fallback behaviour can only ever be
    fixed (or broken) in one place.
    """
    attempts = max(1, settings.ai.retry.max_attempts)
    json_mode = settings.ai.request_json_mode
    last_error: AppError = Errors.AI_BAD_RESPONSE
    # One total attempt budget across models, so failover cannot multiply wait time.
    models = list(dict.fromkeys([model, *(m.strip() for m in fallback_models if m.strip())]))
    model_index = 0

    for attempt in range(1, attempts + 1):
        prompt = system_prompt if attempt == 1 else system_prompt + _RETRY_REMINDER

        try:
            raw = await provider.complete(
                prompt,
                user_prompt,
                model=models[model_index],
                json_mode=json_mode,
            )
        except AppError as exc:
            # A different model can recover from an unavailable worker / timeout.
            # Never switch for auth or quota errors: backups share the same key.
            if exc.code in (Errors.AI_TIMEOUT.code, Errors.AI_UNAVAILABLE.code):
                if model_index + 1 < len(models) and attempt < attempts:
                    model_index += 1
                    json_mode = settings.ai.request_json_mode
                    logger.warning("AI model failover (%s) on attempt %d/%d", exc.code, attempt, attempts)
                    continue
                if exc.code == Errors.AI_TIMEOUT.code:
                    raise
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
            return payload_model.model_validate(repair_and_parse(raw))
        except (ValueError, ValidationError):
            # Log only the attempt number — never the response itself, since it contains work content
            logger.warning("AI response invalid on attempt %d/%d", attempt, attempts)
            last_error = Errors.AI_BAD_RESPONSE
            await _backoff(settings, attempt, attempts)
            continue

    raise last_error


async def generate_jsa(
    request: GenerateRequest,
    provider: LLMProvider,
    settings: Settings,
) -> JsaDocument:
    payload = await generate_validated(
        system_prompt=_load_system_prompt(settings),
        user_prompt=_build_user_prompt(request),
        model=settings.ai.model,
        payload_model=AiJsaPayload,
        provider=provider,
        settings=settings,
        fallback_models=settings.ai.fallback_models,
    )

    project = request.project
    # In Project Mode the user already named this phase — that name is the
    # one the project uses everywhere, so it wins over the model's summary
    work_activity = (
        project.phases[project.phase_index].strip() if project else ""
    ) or payload.work_activity.strip()

    return JsaDocument(
        header=JsaHeader(
            work_activity=work_activity,
            project=project.name.strip() if project else "",
            supervisor=request.supervisor.strip(),
            analysis_date=request.analysis_date,
            analyst=request.analyst.strip(),
            company=request.company.strip(),
        ),
        steps=payload.steps,
        assumptions=payload.assumptions,
    )


async def _backoff(settings: Settings, attempt: int, attempts: int) -> None:
    if attempt < attempts and settings.ai.retry.backoff_seconds > 0:
        await asyncio.sleep(settings.ai.retry.backoff_seconds)
