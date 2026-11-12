"""config/jsa-rules.yaml's hazard checklist must reach both prompts.

The built-in AI gets it through the rendered system prompt; the advanced
mode builds its outside-AI prompt in the browser from /api/config/public.
If either path drops the list, steps quietly go back to one hazard each.
"""

from fastapi.testclient import TestClient

from app.core.config import Term, get_settings
from app.main import app
from app.services.ai_service import render_prompt


def test_checklist_is_configured():
    assert get_settings().rules.hazard_checklist


def test_system_prompt_lists_every_checklist_item():
    rules = get_settings().rules
    prompt = render_prompt("jsa-generate.md", rules=rules)
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
        render_prompt("jsa-generate.md", rules=settings.rules),
        render_prompt("procedure-generate.md", rules=settings.procedure, terminology=terms),
    ]
    for prompt in prompts:
        assert 'เขียน "Check Gas" ห้ามใช้ "Gas Test" หรือ "Gas Testing"' in prompt
        assert 'เขียน "คลังน้ำมัน" ห้ามใช้ "ถังฟาร์ม"' in prompt


def test_public_config_exposes_terminology():
    body = TestClient(app).get("/api/config/public").json()
    assert {"use": "Work Permit", "insteadOf": ["Permit to Work", "PTW"]} in body["jsaRules"]["terminology"]
