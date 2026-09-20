"""JSA data model — the one shape shared by AI output, the API contract, and the
client's PDF drawing code (frontend/src/lib/schema.ts mirrors this).

Maps onto the F-ปธบ.-1202 form (3 columns):
  Column 1 "ขั้นตอนการทำงาน"      <- procedure + details
  Column 2 "อันตรายที่อาจเกิดขึ้น"  <- hazards[].hazard
  Column 3 "มาตรการป้องกัน/ควบคุม" <- hazards[].controls
"""

from datetime import date

from pydantic import BaseModel, Field, field_validator


class Hazard(BaseModel):
    hazard: str = Field(min_length=1, max_length=1000)
    controls: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("controls")
    @classmethod
    def drop_blank_controls(cls, v: list[str]) -> list[str]:
        return [c.strip() for c in v if c and c.strip()]


class JsaStep(BaseModel):
    no: int = Field(ge=1)
    procedure: str = Field(min_length=1, max_length=2000)
    details: str = Field(default="", max_length=4000)
    hazards: list[Hazard] = Field(default_factory=list, max_length=30)


class JsaHeader(BaseModel):
    work_activity: str = Field(min_length=1, max_length=500)
    supervisor: str = Field(min_length=1, max_length=200)
    analysis_date: date
    # Printed as "ผู้วิเคราะห์ <name>" at the end of the last PDF page.
    # Optional — left blank, the PDF falls back to the supervisor's name.
    analyst: str = Field(default="", max_length=200)


class JsaDocument(BaseModel):
    """A complete JSA document — the response shape of /api/jsa/generate,
    also mirrored by the frontend and passed straight into the client-side
    PDF builder without another round trip to the backend."""

    header: JsaHeader
    steps: list[JsaStep] = Field(min_length=1, max_length=200)
    assumptions: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("steps")
    @classmethod
    def renumber_steps(cls, v: list[JsaStep]) -> list[JsaStep]:
        """Step numbers must always run 1..n.

        Users can freely add/remove/reorder steps, so the frontend may send
        numbers out of sequence. Let the backend be the source of truth for
        the numbers printed on the document, so we never end up with two
        "Step 3"s.
        """
        for index, step in enumerate(v, start=1):
            step.no = index
        return v


# --------------------------------------------------------------------------- #
# API request / response
# --------------------------------------------------------------------------- #
class GenerateRequest(BaseModel):
    supervisor: str = Field(min_length=1, max_length=200)
    analysis_date: date
    work_description: str = Field(min_length=10, max_length=5000)
    analyst: str = Field(default="", max_length=200)


class AiJsaPayload(BaseModel):
    """What we expect back from the LLM — no full header yet, since the AI
    doesn't set the supervisor's name or the date."""

    work_activity: str = Field(min_length=1, max_length=500)
    steps: list[JsaStep] = Field(min_length=1, max_length=200)
    assumptions: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("assumptions")
    @classmethod
    def drop_blank_assumptions(cls, v: list[str]) -> list[str]:
        return [a.strip() for a in v if a and a.strip()]
