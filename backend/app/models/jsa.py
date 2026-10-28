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
    # The company that prepared this document, when it isn't PTTOR itself —
    # a vendor submitting it to PTTOR for a permit to work on site. Optional:
    # blank means PTTOR's own document, and the PDF prints no company row.
    # Never sent to the AI; like analyst, it only rides along on the header.
    company: str = Field(default="", max_length=200)
    # Project Mode: the project this JSA is one phase of, printed as an extra
    # header row above งาน/กิจกรรม. Blank on a Single Mode JSA, which then
    # prints no project row. Optional for the same reason as company.
    project: str = Field(default="", max_length=300)


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
class ProjectReference(BaseModel):
    """One row of a project's shared tag list — a valve, blind or tag number
    and what's done with it (e.g. "HSV-335" / "ปิด + 8\" Breather Blind")."""

    tag: str = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=300)


class ProjectContext(BaseModel):
    """Project Mode: what a phase's JSA needs to know about the rest of the
    project. Used for this one request's prompt and never stored, like the
    work description itself."""

    name: str = Field(min_length=1, max_length=300)
    notes: str = Field(default="", max_length=2000)
    references: list[ProjectReference] = Field(default_factory=list, max_length=100)
    # Every phase's work name, in order, so the model knows where this one
    # sits — and can keep other phases' work out of it
    phases: list[str] = Field(min_length=1, max_length=50)
    phase_index: int = Field(ge=0)

    @field_validator("phase_index")
    @classmethod
    def index_in_range(cls, v: int, info) -> int:
        phases = info.data.get("phases") or []
        if v >= len(phases):
            raise ValueError("phase_index out of range")
        return v


class GenerateRequest(BaseModel):
    supervisor: str = Field(min_length=1, max_length=200)
    analysis_date: date
    work_description: str = Field(min_length=10, max_length=5000)
    analyst: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    # Project Mode only — absent for a Single Mode JSA
    project: ProjectContext | None = None


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
