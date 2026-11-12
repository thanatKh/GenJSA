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
    ProjectProcedureContext,
    ProcedureStep,
    SubStep,
)
from ..core.thaidate import format_thai_date
from ..providers.llm.base import LLMProvider
from .ai_service import generate_validated, procedure_prompt_context, render_prompt

logger = logging.getLogger("genjsa")


def _project_context(project: ProjectProcedureContext) -> str:
    """Project Mode: where this section sits in the project's one procedure.

    Earlier phases are listed with their steps so the section can build on
    what they left in place ("Blind ที่ใส่ในขั้นตอนที่ 2") — the continuity
    that pasting separately drafted procedures together loses. Later phases
    are listed so their work stays out of this section.
    """
    current = project.phase_index
    lines = [
        f"เอกสารนี้เป็นขั้นตอนปฏิบัติงานฉบับเดียวของทั้งโครงการ: {project.name.strip()}",
        f"ครั้งนี้ให้ร่างเฉพาะส่วนของขั้นตอนที่ {current + 1} ของโครงการ",
        "",
        "ขั้นตอนทั้งหมดของโครงการ:",
    ]
    for index, phase in enumerate(project.phases):
        marker = "  ← ส่วนที่ต้องร่างครั้งนี้" if index == current else ""
        lines.append(f"{index + 1}. {phase.work.strip()}{marker}")
        # Earlier phases' steps: what's already been done by the time this one starts
        if index < current:
            lines += [f"   - {step.strip()}" for step in phase.steps if step.strip()]
    lines += [
        "",
        "ให้เขียนต่อเนื่องจากขั้นตอนก่อนหน้า: อ้างถึงสิ่งที่ทำไว้แล้วได้ (เช่น วาล์วที่ปิด หรือ Blind ที่ใส่ไว้ในขั้นตอนก่อน)",
        "ห้ามทำซ้ำงานของขั้นตอนอื่น และห้ามรวมงานของขั้นตอนถัดไปไว้ในส่วนนี้",
        "purpose และ scope ให้เขียนสำหรับทั้งโครงการ ไม่ใช่เฉพาะขั้นตอนนี้",
    ]
    if project.notes.strip():
        lines += ["", f"ข้อจำกัด/หมายเหตุของโครงการ: {project.notes.strip()}"]
    if project.references:
        lines += ["", "รายการอ้างอิงของโครงการ (วาล์ว/Blind/Tag) — ใช้เลขตามรายการนี้เท่านั้น ห้ามคิดเลขขึ้นเอง:"]
        for ref in project.references:
            note = f": {ref.note.strip()}" if ref.note.strip() else ""
            lines.append(f"- {ref.tag.strip()}{note}")
    return "\n".join(lines)


def _build_user_prompt(jsa: JsaDocument, project: ProjectProcedureContext | None = None) -> str:
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
    body = "\n".join(lines)
    return body if project is None else f"{_project_context(project)}\n\n{body}"


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
            sub_steps=_sub_steps(step, by_index[index].sub_steps if index in by_index else []),
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

    payload = await generate_validated(
        system_prompt=render_prompt("procedure-generate.md", **procedure_prompt_context(settings)),
        user_prompt=_build_user_prompt(request.jsa, request.project),
        model=model,
        payload_model=AiProcedurePayload,
        provider=provider,
        settings=settings,
        fallback_models=settings.ai.detailed_fallback_models,
    )

    return _assemble(request.jsa, payload, settings)
