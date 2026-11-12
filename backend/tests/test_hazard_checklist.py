"""config/jsa-rules.yaml's hazard checklist must reach both prompts.

The built-in AI gets it through the rendered system prompt; the advanced
mode builds its outside-AI prompt in the browser from /api/config/public.
If either path drops the list, steps quietly go back to one hazard each.
"""

from fastapi.testclient import TestClient

from app.core.config import Term, get_settings
from app.models.jsa import MAX_SUB_STEPS
from app.main import app
from app.services.ai_service import jsa_prompt_context, procedure_prompt_context, render_prompt


def test_checklist_is_configured():
    assert get_settings().rules.hazard_checklist


def test_system_prompt_lists_every_checklist_item():
    rules = get_settings().rules
    prompt = render_prompt("jsa-generate.md", **jsa_prompt_context(get_settings()))
    for item in rules.hazard_checklist:
        assert item in prompt


def test_public_config_exposes_prompt_lists():
    rules = get_settings().rules
    body = TestClient(app).get("/api/config/public").json()
    assert body["jsaRules"]["hazardChecklist"] == rules.hazard_checklist
    assert body["jsaRules"]["considerWhenRelevant"] == rules.consider_when_relevant


def test_terminology_reaches_both_prompts(monkeypatch):
    settings = get_settings()
    # A Thai word to avoid must come out as itself, not a \u escape
    terms = settings.rules.terminology + [Term(use="คลังน้ำมัน", instead_of=["ถังฟาร์ม"])]
    monkeypatch.setattr(settings.rules, "terminology", terms)
    prompts = [
        render_prompt("jsa-generate.md", **jsa_prompt_context(settings)),
        render_prompt("procedure-generate.md", **procedure_prompt_context(settings)),
    ]
    for prompt in prompts:
        assert 'เขียน "Check Gas" ห้ามใช้ "Gas Test" หรือ "Gas Testing"' in prompt
        assert 'เขียน "คลังน้ำมัน" ห้ามใช้ "ถังฟาร์ม"' in prompt


def test_public_config_exposes_terminology():
    body = TestClient(app).get("/api/config/public").json()
    assert {"use": "Work Permit", "insteadOf": ["Permit to Work", "PTW"]} in body["jsaRules"]["terminology"]


def test_both_ais_get_the_same_rules():
    """The built-in AI's system prompt carries exactly the rules the
    ใช้ AI ภายนอก screen is given — one source, so the two can't drift."""
    settings = get_settings()
    body = TestClient(app).get("/api/config/public").json()["jsaRules"]["prompts"]
    jsa_prompt = render_prompt("jsa-generate.md", **jsa_prompt_context(settings))
    wp_prompt = render_prompt("procedure-generate.md", **procedure_prompt_context(settings))
    assert body["jsa"] and body["jsa"] in jsa_prompt
    assert body["procedure"] and body["procedure"] in wp_prompt
    # The built-in-only parts stay out of the shared rules
    assert "code fence" not in body["jsa"] and '"work_activity"' not in body["jsa"]
    assert '"purpose"' not in body["procedure"]


def test_user_steps_rule_keeps_meaning_and_tags_but_may_tidy_wording():
    rules = render_prompt("jsa-rules.md", **jsa_prompt_context(get_settings()))
    assert "ยึดตามลำดับและความหมาย" in rules
    assert "ห้ามแก้เลขอุปกรณ์ เลขวาล์ว ค่าตัวเลข" in rules
    # Splitting into sub-steps must not read as forbidden splitting of main steps
    assert "ไม่นับเป็นการแยกขั้นตอนหลัก" in rules
    assert f"ไม่เกิน {MAX_SUB_STEPS} ขั้นตอนย่อย" in rules
