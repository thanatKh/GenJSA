"""Work procedure (ขั้นตอนปฏิบัติงาน) data model.

The counterpart to models/jsa.py, and deliberately a separate file: the JSA
maps onto the official F-ปธบ.-1202 form and its three fixed columns, while this
document has no official form at all — its structure is GenJSA's own design and
can be changed freely (see config/procedure.yaml).

Where the JSA is task-level by rule ("ตัดแยกระบบและระบายความดัน", never "ใช้ประแจ
เบอร์ 24 คลายน็อตตัวที่ 1"), this document is the opposite: it expands each JSA
step into the how-to detail the JSA refuses to carry.

A procedure is always generated FROM a finished JSA, which is why the AI is
never allowed to invent the step list — see AiProcedurePayload below.
"""

from pydantic import BaseModel, Field, field_validator

from .jsa import JsaDocument, JsaHeader


class SubStep(BaseModel):
    no: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=1000)
    # One optional slot for "ระวัง…" / "ตรวจสอบว่า…" / an acceptance criterion.
    # Deliberately one free-text field rather than three structured ones: the
    # model files these inconsistently, and the PDF renders it as a single
    # indented line under the action either way.
    note: str = Field(default="", max_length=1000)


class ProcedureStep(BaseModel):
    no: int = Field(ge=1)
    # Copied verbatim from the source JSA — never written by the AI (see below)
    procedure: str = Field(min_length=1, max_length=2000)
    sub_steps: list[SubStep] = Field(default_factory=list, max_length=20)


class ProcedureDocument(BaseModel):
    """A complete work procedure — the response shape of /api/procedure/generate.

    Section order matches the printed document (see config/procedure.yaml's
    `sections`). Every section except `steps` may be empty, and an empty one
    simply isn't printed rather than leaving a heading over blank space.
    """

    header: JsaHeader
    purpose: str = Field(default="", max_length=1000)
    scope: str = Field(default="", max_length=1000)
    # Built in code from the source JSA, never by the AI — letting the model
    # populate this produces fabricated standard/regulation numbers, which
    # prompts/jsa-generate.md's own "ห้ามอ้างว่าเป็นไปตามกฎหมายหรือมาตรฐานใด" rule exists to stop
    references: list[str] = Field(default_factory=list, max_length=10)
    tools: list[str] = Field(default_factory=list, max_length=40)
    steps: list[ProcedureStep] = Field(min_length=1, max_length=200)
    # Shown in the editor, never printed — same treatment as the JSA's
    assumptions: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("steps")
    @classmethod
    def renumber_steps(cls, v: list[ProcedureStep]) -> list[ProcedureStep]:
        """Step and sub-step numbers must always run 1..n.

        Same reasoning as JsaDocument.renumber_steps: the frontend can add,
        remove and reorder sub-steps freely, so the backend stays the single
        source of truth for the numbers printed on the document.
        """
        for index, step in enumerate(v, start=1):
            step.no = index
            for sub_index, sub in enumerate(step.sub_steps, start=1):
                sub.no = sub_index
        return v


# --------------------------------------------------------------------------- #
# API request / response
# --------------------------------------------------------------------------- #
class GenerateProcedureRequest(BaseModel):
    """The finished JSA to expand.

    This is the one place a document travels *back* to the backend. It's held in
    memory for the duration of the request and never written anywhere — see the
    persistence principles in CLAUDE.md, which call this exception out.
    """

    jsa: JsaDocument


class AiProcedureStep(BaseModel):
    no: int = Field(ge=1)
    sub_steps: list[SubStep] = Field(default_factory=list, max_length=20)


class AiProcedurePayload(BaseModel):
    """What we expect back from the LLM.

    Narrower than ProcedureDocument on purpose. Two fields are withheld from the
    model entirely rather than merely discouraged by the prompt:

    - `procedure` (step titles) — taken from the source JSA, so "the AI must not
      restructure the steps" is a structural guarantee, not a prompt instruction
      the model can drift away from.
    - `references` — assembled in code, so fabricated standard numbers are
      impossible rather than unlikely.
    """

    purpose: str = Field(default="", max_length=1000)
    scope: str = Field(default="", max_length=1000)
    tools: list[str] = Field(default_factory=list, max_length=40)
    steps: list[AiProcedureStep] = Field(default_factory=list, max_length=200)
    assumptions: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("tools", "assumptions")
    @classmethod
    def drop_blanks(cls, v: list[str]) -> list[str]:
        return [item.strip() for item in v if item and item.strip()]
