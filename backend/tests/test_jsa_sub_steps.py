"""JSA sub-steps (1.1, 1.2 …) and how the work procedure pairs with them.

The two shape rules are structural, like the procedure's step titles: a step
with sub-steps never carries hazards of its own, and a WP built from it has
exactly one line per JSA sub-step, in order, whatever the model answers.
"""

from datetime import date

import pytest

from app.core.config import get_settings
from app.models.jsa import Hazard, JsaDocument, JsaHeader, JsaStep, JsaSubStep
from app.models.procedure import AiProcedurePayload, AiProcedureStep, SubStep
from app.services.procedure_service import _assemble, _build_user_prompt


def _hz(text: str) -> Hazard:
    return Hazard(hazard=text, controls=["มาตรการ"])


@pytest.fixture
def jsa():
    return JsaDocument(
        header=JsaHeader(work_activity="ล้างถัง", supervisor="สมชาย", analysis_date=date(2026, 8, 12)),
        steps=[
            JsaStep(no=9, procedure="เตรียมพื้นที่", hazards=[_hz("ควรถูกลบ")], sub_steps=[
                JsaSubStep(no=5, procedure="กั้นเขตพื้นที่", hazards=[_hz("สะดุดล้ม")]),
                JsaSubStep(no=5, procedure="Check Gas", details="ก่อนเริ่มงาน", hazards=[_hz("ก๊าซไวไฟ")]),
            ]),
            JsaStep(no=9, procedure="ระบายน้ำมัน", hazards=[_hz("น้ำมันหก")]),
        ],
    )


def test_heading_step_drops_its_own_hazards(jsa):
    assert jsa.steps[0].hazards == []
    assert [s.hazards[0].hazard for s in jsa.steps[0].sub_steps] == ["สะดุดล้ม", "ก๊าซไวไฟ"]
    # A step without sub-steps keeps its hazards as before
    assert jsa.steps[1].hazards[0].hazard == "น้ำมันหก"


def test_sub_steps_are_renumbered(jsa):
    assert [s.no for s in jsa.steps] == [1, 2]
    assert [s.no for s in jsa.steps[0].sub_steps] == [1, 2]


def test_old_documents_without_sub_steps_still_load():
    doc = JsaDocument.model_validate({
        "header": {"work_activity": "ก", "supervisor": "ข", "analysis_date": "2026-08-12"},
        "steps": [{"no": 1, "procedure": "ค", "hazards": [{"hazard": "ง", "controls": ["จ"]}]}],
    })
    assert doc.steps[0].sub_steps == []


def test_procedure_prompt_lists_jsa_sub_steps(jsa):
    prompt = _build_user_prompt(jsa)
    assert "1.1 กั้นเขตพื้นที่" in prompt
    assert "1.2 Check Gas" in prompt
    assert "รายละเอียด: ก่อนเริ่มงาน" in prompt


def _payload(first_step_subs: list[str]) -> AiProcedurePayload:
    return AiProcedurePayload(steps=[
        AiProcedureStep(no=1, sub_steps=[SubStep(no=i + 1, action=a) for i, a in enumerate(first_step_subs)]),
        AiProcedureStep(no=2, sub_steps=[SubStep(no=1, action="เปิดวาล์ว"), SubStep(no=2, action="รองถาด")]),
    ])


def test_wp_sub_steps_pair_one_to_one_with_jsa_sub_steps(jsa):
    doc = _assemble(jsa, _payload(["กั้นเขตด้วยแผงกั้น", "Check Gas ด้วยเครื่องวัด"]), get_settings())
    assert [s.action for s in doc.steps[0].sub_steps] == ["กั้นเขตด้วยแผงกั้น", "Check Gas ด้วยเครื่องวัด"]
    # A JSA step without sub-steps still takes as many WP lines as the model wrote
    assert len(doc.steps[1].sub_steps) == 2


def test_short_answer_falls_back_to_jsa_sub_step_title(jsa):
    doc = _assemble(jsa, _payload(["กั้นเขตด้วยแผงกั้น"]), get_settings())
    assert [s.action for s in doc.steps[0].sub_steps] == ["กั้นเขตด้วยแผงกั้น", "Check Gas"]


def test_extra_wp_sub_steps_are_dropped(jsa):
    doc = _assemble(jsa, _payload(["ก", "ข", "ค"]), get_settings())
    assert [s.action for s in doc.steps[0].sub_steps] == ["ก", "ข"]
    assert [s.no for s in doc.steps[0].sub_steps] == [1, 2]


def test_ai_payload_sub_steps_need_no_numbers():
    from app.models.jsa import AiJsaPayload

    payload = AiJsaPayload.model_validate({
        "work_activity": "ล้างถัง",
        "steps": [{"no": 1, "procedure": "เตรียมพื้นที่", "hazards": [], "sub_steps": [
            {"procedure": "กั้นเขต", "hazards": [{"hazard": "สะดุด", "controls": ["จัดพื้นที่"]}]},
        ]}],
    })
    assert payload.steps[0].sub_steps[0].procedure == "กั้นเขต"


def test_a_full_step_of_sub_steps_fits_the_wp_too():
    from app.models.jsa import MAX_SUB_STEPS

    doc = JsaDocument(
        header=JsaHeader(work_activity="ล้างถัง", supervisor="สมชาย", analysis_date=date(2026, 8, 12)),
        steps=[JsaStep(no=1, procedure="งานใหญ่", sub_steps=[
            JsaSubStep(procedure=f"งานย่อย {i}", hazards=[_hz("อันตราย")]) for i in range(MAX_SUB_STEPS)
        ])],
    )
    payload = AiProcedurePayload(steps=[AiProcedureStep(no=1, sub_steps=[SubStep(no=i + 1, action="ทำ") for i in range(MAX_SUB_STEPS)])])
    wp = _assemble(doc, payload, get_settings())
    assert MAX_SUB_STEPS == 30
    assert len(wp.steps[0].sub_steps) == MAX_SUB_STEPS
