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
from ..models.jsa import JsaDocument, JsaStep
from ..models.procedure import (
    AiProcedurePayload,
    GenerateProcedureRequest,
    ProcedureDocument,
    ProcedureStep,
    SubStep,
)
from ..core.thaidate import format_thai_date
from ..providers.llm.base import LLMProvider
from .ai_service import generate_validated, procedure_prompt_context, render_prompt

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
        # A JSA that already has sub-steps fixes the WP's sub-steps too: one
        # each, in the same order, so the WP's 1.1 is the JSA's 1.1
        for sub in step.sub_steps:
            lines.append(f"   {step.no}.{sub.no} {sub.procedure.strip()}")
            if sub.details.strip():
                lines.append(f"      รายละเอียด: {sub.details.strip()}")
    return "\n".join(lines)


def _sub_steps(step: JsaStep, ai_subs: list[SubStep]) -> list[SubStep]:
    """The WP sub-steps under one JSA step.

    A JSA step without sub-steps takes whatever the model wrote. One with
    sub-steps fixes the shape the same way step titles do: one WP line per
    JSA sub-step, zipped by index. A missing line falls back to the JSA
    sub-step's own title rather than leaving a gap that would shift every
    number after it; extras are dropped.
    """
    if not step.sub_steps:
        return ai_subs
    if len(ai_subs) != len(step.sub_steps):
        logger.warning(
            "procedure sub-step count mismatch: model returned %d for %d JSA sub-steps",
            len(ai_subs),
            len(step.sub_steps),
        )
    return [
        SubStep(no=i + 1, action=ai_subs[i].action if i < len(ai_subs) else sub.procedure)
        for i, sub in enumerate(step.sub_steps)
    ]


def _assemble(
    jsa: JsaDocument, payload: AiProcedurePayload, settings: Settings
) -> ProcedureDocument:
    """Fit the AI's sub-steps onto the JSA's own step list.

    The payload has already been checked for a complete set of main step
    numbers. Match by number so an out-of-order response still aligns with
    the JSA, which supplies the titles and order.
    """
    by_number = {step.no: step for step in payload.steps}
    steps = [
        ProcedureStep(
            no=step.no,
            procedure=step.procedure,
            sub_steps=_sub_steps(step, by_number[step.no].sub_steps),
        )
        for step in jsa.steps
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
        ppe=payload.ppe,
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
    expected_steps = {step.no for step in request.jsa.steps}

    def validate_step_numbers(payload: AiProcedurePayload) -> None:
        numbers = [step.no for step in payload.steps]
        if len(numbers) != len(expected_steps) or set(numbers) != expected_steps:
            raise ValueError("WP main step numbers must match the JSA without duplicates")

    payload = await generate_validated(
        system_prompt=render_prompt("procedure-generate.md", **procedure_prompt_context(settings)),
        user_prompt=_build_user_prompt(request.jsa),
        model=model,
        payload_model=AiProcedurePayload,
        provider=provider,
        settings=settings,
        fallback_models=settings.ai.detailed_fallback_models,
        validate_payload=validate_step_numbers,
    )

    return _assemble(request.jsa, payload, settings)
