"""Generate a work procedure (ขั้นตอนปฏิบัติงาน) from a finished JSA.

Pipeline: prompt (from file) -> LLM -> json_repair -> Pydantic validate ->
ProcedureDocument. The retry/backoff/json-mode behaviour is shared with the JSA
path via ai_service.generate_validated.

The source JSA is the skeleton: its step list and header come through
untouched, and the AI only fills in the how-to detail underneath. See
_assemble below for why that's enforced in code rather than trusted to the prompt.
"""

import logging

from ..core.config import Settings
from ..models.jsa import JsaDocument
from ..models.procedure import (
    AiProcedurePayload,
    GenerateProcedureRequest,
    ProcedureDocument,
    ProcedureStep,
)
from ..core.thaidate import format_thai_date
from ..providers.llm.base import LLMProvider
from .ai_service import generate_validated, render_prompt

logger = logging.getLogger("genjsa")


def _build_user_prompt(jsa: JsaDocument) -> str:
    """Hand the model the work and the step skeleton — nothing else.

    Hazards and controls are deliberately left out: the model doesn't need them
    to write how-to steps, dropping them roughly halves the prompt, and it
    removes any chance of the model rewording safety text a human already
    approved in the JSA editor.
    """
    lines = [f"งาน/กิจกรรม: {jsa.header.work_activity.strip()}", "", "ขั้นตอนหลักที่ต้องขยาย:"]
    for step in jsa.steps:
        lines.append(f"{step.no}. {step.procedure.strip()}")
        if step.details.strip():
            lines.append(f"   รายละเอียด: {step.details.strip()}")
    return "\n".join(lines)


def _assemble(
    jsa: JsaDocument, payload: AiProcedurePayload, settings: Settings
) -> ProcedureDocument:
    """Fit the AI's sub-steps onto the JSA's own step list.

    Zipped by index, not by the payload's `no`: models renumber, skip, and
    occasionally return fewer steps than asked. The JSA's step list is the
    source of truth for how many steps exist and what they're called, so a
    short or misnumbered response loses detail rather than corrupting the
    structure.
    """
    by_index = {index: ai_step for index, ai_step in enumerate(payload.steps)}
    if len(payload.steps) != len(jsa.steps):
        # Count only — never the content, per the no-content-logging principle
        logger.warning(
            "procedure step count mismatch: model returned %d for %d JSA steps",
            len(payload.steps),
            len(jsa.steps),
        )

    steps = [
        ProcedureStep(
            no=step.no,
            procedure=step.procedure,
            sub_steps=by_index[index].sub_steps if index in by_index else [],
        )
        for index, step in enumerate(jsa.steps)
    ]

    # Built here, not by the AI: a model asked for "references" produces
    # plausible-looking standard and regulation numbers it has no basis for.
    reference = (
        f"{settings.procedure.document.jsa_reference_label}: "
        f"{jsa.header.work_activity.strip()} — {format_thai_date(jsa.header.analysis_date)}"
    )

    return ProcedureDocument(
        header=jsa.header,
        purpose=payload.purpose.strip(),
        scope=payload.scope.strip(),
        references=[reference],
        tools=payload.tools,
        steps=steps,
        assumptions=payload.assumptions,
    )


async def generate_procedure(
    request: GenerateProcedureRequest,
    provider: LLMProvider,
    settings: Settings,
) -> ProcedureDocument:
    # Writing usable how-to detail is a more demanding task than drafting the
    # JSA itself, so this always uses the thorough model when one is configured
    model = settings.ai.detailed_model or settings.ai.model

    payload = await generate_validated(
        system_prompt=render_prompt("procedure-generate.md", rules=settings.procedure),
        user_prompt=_build_user_prompt(request.jsa),
        model=model,
        payload_model=AiProcedurePayload,
        provider=provider,
        settings=settings,
    )

    return _assemble(request.jsa, payload, settings)
