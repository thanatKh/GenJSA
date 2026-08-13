"""json_repair must tolerate what Thai-language LLMs actually respond with."""

import pytest

from app.services.json_repair import repair_and_parse

CLEAN = '{"work_activity":"ทดสอบ","steps":[],"assumptions":[]}'


def test_clean_json():
    assert repair_and_parse(CLEAN)["work_activity"] == "ทดสอบ"


def test_markdown_code_fence():
    assert repair_and_parse(f"```json\n{CLEAN}\n```")["work_activity"] == "ทดสอบ"


def test_fence_without_language_tag():
    assert repair_and_parse(f"```\n{CLEAN}\n```")["work_activity"] == "ทดสอบ"


def test_leading_thai_prose():
    raw = f"นี่คือ JSA ที่ร่างให้ครับ:\n\n{CLEAN}\n\nหวังว่าจะเป็นประโยชน์"
    assert repair_and_parse(raw)["work_activity"] == "ทดสอบ"


def test_trailing_comma_in_object_and_array():
    raw = '{"work_activity":"ทดสอบ","steps":[1,2,],}'
    assert repair_and_parse(raw)["steps"] == [1, 2]


def test_nested_braces_are_balanced_correctly():
    raw = (
        'ผลลัพธ์: {"work_activity":"ก","steps":[{"no":1,"hazards":[{"hazard":"ข"}]}]} จบ'
    )
    parsed = repair_and_parse(raw)
    assert parsed["steps"][0]["hazards"][0]["hazard"] == "ข"


def test_brace_inside_string_does_not_confuse_extractor():
    raw = '{"work_activity":"ใช้สัญลักษณ์ } ในข้อความ","steps":[]}'
    assert repair_and_parse(raw)["work_activity"] == "ใช้สัญลักษณ์ } ในข้อความ"


def test_escaped_quote_inside_string():
    raw = '{"work_activity":"เรียกว่า \\"ปั๊ม\\" นะ","steps":[]}'
    assert "ปั๊ม" in repair_and_parse(raw)["work_activity"]


def test_smart_quotes_normalised():
    raw = '{“work_activity”:“ทดสอบ”,“steps”:[]}'
    assert repair_and_parse(raw)["work_activity"] == "ทดสอบ"


@pytest.mark.parametrize("raw", ["", "   ", "ไม่มี JSON เลย", "[1,2,3]", "{แตกจริง"])
def test_unrecoverable_raises_valueerror(raw):
    # Must be ValueError so ai_service can turn it into a Thai error and retry
    with pytest.raises(ValueError):
        repair_and_parse(raw)
