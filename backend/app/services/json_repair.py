"""Repair JSON that comes back from the LLM less than clean.

Many Thai LLMs don't really support structured response_format, so they
often reply with JSON that has extra baggage attached, e.g.:
  - wrapped in ```json ... ```
  - prefixed with prose like "Here's the JSA I drafted: {...}"
  - a trailing comma
  - smart quotes introduced by text normalization

All of this can be fixed without guessing at content, so we repair first and
let Pydantic validate afterward.
"""

import json
import re

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)\s*```", re.DOTALL)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def _strip_fence(text: str) -> str:
    match = _FENCE.search(text)
    return match.group(1) if match else text


def _extract_object(text: str) -> str | None:
    """Extract the first balanced JSON object by counting braces.

    Counting instead of regex, because our JSON nests several levels deep
    (steps -> hazards -> controls) and regex is unreliable at matching
    nested structures.
    """
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(text)):
        char = text[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    return None


def _normalize_quotes(text: str) -> str:
    # Smart quotes outside a string value would otherwise break parsing
    return text.replace("“", '"').replace("”", '"')


def repair_and_parse(raw: str) -> dict:
    """Return a dict if repair succeeds, otherwise raise ValueError.

    Tries fixes in order from least to most invasive to the content.
    """
    if not raw or not raw.strip():
        raise ValueError("empty response")

    candidates: list[str] = []

    cleaned = _strip_fence(raw.strip())
    candidates.append(cleaned)

    extracted = _extract_object(cleaned)
    if extracted:
        candidates.append(extracted)
        candidates.append(_TRAILING_COMMA.sub(r"\1", extracted))
        candidates.append(_normalize_quotes(_TRAILING_COMMA.sub(r"\1", extracted)))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("no valid JSON object found")
