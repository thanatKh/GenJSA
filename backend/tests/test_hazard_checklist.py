"""config/jsa-rules.yaml's hazard checklist must reach both prompts.

The built-in AI gets it through the rendered system prompt; the advanced
mode builds its outside-AI prompt in the browser from /api/config/public.
If either path drops the list, steps quietly go back to one hazard each.
"""

from fastapi.testclient import TestClient

from app.core.config import get_settings
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
    assert body["jsaRules"] == {
        "hazardChecklist": rules.hazard_checklist,
        "considerWhenRelevant": rules.consider_when_relevant,
    }
