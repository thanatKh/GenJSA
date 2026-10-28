"""Assembly of a work procedure from a JSA plus an AI payload.

The point of these: the "AI must not restructure the steps" and "AI must not
invent references" rules are meant to be structural guarantees, not prompt
requests the model can drift away from. If a future refactor starts trusting
the model's own step list or lets `references` into the AI contract, these fail.
"""

from datetime import date

import pytest

from app.core.config import get_settings
from app.models.jsa import Hazard, JsaDocument, JsaHeader, JsaStep
from app.models.procedure import AiProcedurePayload, AiProcedureStep, SubStep
from app.services.procedure_service import _assemble, _build_user_prompt


@pytest.fixture
def settings():
    return get_settings().model_copy(deep=True)


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


def test_extra_ai_steps_cannot_grow_the_step_list(jsa, settings):
    """A model that invents a third step must not add it to the document."""
    payload = _payload(
        steps=[
            AiProcedureStep(no=1, sub_steps=[SubStep(no=1, action="ก")]),
            AiProcedureStep(no=2, sub_steps=[SubStep(no=1, action="ข")]),
            AiProcedureStep(no=3, sub_steps=[SubStep(no=1, action="ขั้นตอนที่แต่งขึ้นเอง")]),
        ]
    )
    doc = _assemble(jsa, payload, settings)
    assert len(doc.steps) == 2


def test_missing_ai_steps_leave_the_step_present_but_empty(jsa, settings):
    """A short response loses detail; it must not drop a step from the document."""
    payload = _payload(steps=[AiProcedureStep(no=1, sub_steps=[SubStep(no=1, action="ก")])])
    doc = _assemble(jsa, payload, settings)
    assert len(doc.steps) == 2
    assert doc.steps[1].procedure == "ระบายความดันและ drain product"
    assert doc.steps[1].sub_steps == []


def test_steps_zip_by_index_not_by_model_numbering(jsa, settings):
    """Models renumber. Position in the list is what counts, not `no`."""
    payload = _payload(
        steps=[
            AiProcedureStep(no=7, sub_steps=[SubStep(no=1, action="ของขั้นตอนแรก")]),
            AiProcedureStep(no=9, sub_steps=[SubStep(no=1, action="ของขั้นตอนที่สอง")]),
        ]
    )
    doc = _assemble(jsa, payload, settings)
    assert doc.steps[0].sub_steps[0].action == "ของขั้นตอนแรก"
    assert doc.steps[1].sub_steps[0].action == "ของขั้นตอนที่สอง"
    # ...and the document's own numbering is renormalised to 1..n
    assert [s.no for s in doc.steps] == [1, 2]


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


def _context(phase_index=1):
    from app.models.procedure import ProjectProcedureContext

    return ProjectProcedureContext(
        name="ซ่อมท่อ KBY 2569",
        notes="ข้อจำกัดด้าน IGG",
        references=[{"tag": "HSV-335", "note": "8 นิ้ว Breather Blind"}],
        phases=[
            {"work": "ใส่ Blind และ N2 Purging", "steps": ["ปิดวาล์วและ LOTO", "ใส่ Blind 3 จุด"]},
            {"work": "Cold Cut และเชื่อม", "steps": ["ตัดท่อเดิม"]},
            {"work": "ถอด Blind และคืนระบบ", "steps": ["ถอด Blind"]},
        ],
        phase_index=phase_index,
    )


def test_project_section_prompt_builds_on_earlier_phases(jsa):
    """A project section is told what the phases before it already did (so it
    can refer back instead of redoing it), which phase it is, the tag list and
    the notes — the continuity separately drafted procedures lack."""
    prompt = _build_user_prompt(jsa, _context(phase_index=1))

    assert "ซ่อมท่อ KBY 2569" in prompt
    assert "2. Cold Cut และเชื่อม  ← ส่วนที่ต้องร่างครั้งนี้" in prompt
    # The earlier phase's steps are listed; the later phase's are not
    assert "   - ใส่ Blind 3 จุด" in prompt
    assert "   - ถอด Blind" not in prompt
    assert "- HSV-335: 8 นิ้ว Breather Blind" in prompt
    assert "ข้อจำกัดด้าน IGG" in prompt
    # The JSA's own skeleton still follows
    assert prompt.rstrip().endswith(_build_user_prompt(jsa).rstrip())


def test_single_mode_procedure_prompt_is_unchanged(jsa):
    assert _build_user_prompt(jsa, None) == _build_user_prompt(jsa)
    assert "โครงการ" not in _build_user_prompt(jsa)


def test_project_phase_index_must_point_at_a_phase():
    with pytest.raises(ValueError):
        _context(phase_index=3)
