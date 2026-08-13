"""Configuration loader.

Everything that can change lives in config/*.yaml — loaded once at startup.
Secrets are read from environment variables only, never from YAML files.
"""

import functools
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# backend/app/core/config.py -> parents: core, app, backend, GenJSA
ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = ROOT / "config"
PROMPTS_DIR = ROOT / "prompts"
ASSETS_DIR = ROOT / "assets"


# --------------------------------------------------------------------------- #
# app.yaml
# --------------------------------------------------------------------------- #
class AppSection(BaseModel):
    name: str = "GenJSA"


class Limits(BaseModel):
    work_description_max_chars: int = 5000
    supervisor_max_chars: int = 200
    max_request_bytes: int = 262144


class RateLimit(BaseModel):
    enabled: bool = True
    generate_per_minute: int = 6


class Cors(BaseModel):
    allow_origins: list[str] = Field(default_factory=list)


class AppConfig(BaseModel):
    app: AppSection = Field(default_factory=AppSection)
    limits: Limits = Field(default_factory=Limits)
    rate_limit: RateLimit = Field(default_factory=RateLimit)
    cors: Cors = Field(default_factory=Cors)


# --------------------------------------------------------------------------- #
# ai.yaml
# --------------------------------------------------------------------------- #
class AiApi(BaseModel):
    base_url: str
    chat_completions_path: str = "/chat/completions"
    timeout_seconds: float = 120
    max_tokens: int = 8192
    temperature: float = 0.3


class AiRetry(BaseModel):
    max_attempts: int = 3
    backoff_seconds: float = 2


class AiConfig(BaseModel):
    provider: str = "thaillm"
    model: str
    api: AiApi
    request_json_mode: bool = True
    retry: AiRetry = Field(default_factory=AiRetry)
    candidate_models: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# company.yaml
# --------------------------------------------------------------------------- #
class CompanySection(BaseModel):
    name_en: str = ""
    name_th: str = ""
    department_en: str = ""
    department_th: str = ""
    logo: str = "assets/logo.png"

    @property
    def department(self) -> str:
        """Thai department name if set, otherwise fall back to English."""
        return self.department_th.strip() or self.department_en.strip()

    @property
    def name(self) -> str:
        return self.name_th.strip() or self.name_en.strip()


class CompanyConfig(BaseModel):
    company: CompanySection = Field(default_factory=CompanySection)


# --------------------------------------------------------------------------- #
# document.yaml
# --------------------------------------------------------------------------- #
class DocLabels(BaseModel):
    work_activity: str = "งาน/กิจกรรม"
    supervisor: str = "ชื่อหัวหน้างาน"
    analysis_date: str = "วันที่วิเคราะห์"
    analyst: str = "ผู้วิเคราะห์"


class DocColumns(BaseModel):
    procedure: str = "ขั้นตอนการทำงาน"
    procedure_hint: str = "(ระบุทุกขั้นตอน)"
    hazard: str = "อันตรายที่อาจเกิดขึ้น"
    control: str = "มาตรการป้องกัน/ควบคุม"


class DocumentSection(BaseModel):
    form_code: str
    footer_text: str = ""
    title_th: str
    title_en: str = ""
    labels: DocLabels = Field(default_factory=DocLabels)
    columns: DocColumns = Field(default_factory=DocColumns)


class DocumentConfig(BaseModel):
    document: DocumentSection


# --------------------------------------------------------------------------- #
# pdf.yaml — values sent to the client for drawing the document (frontend/src/lib/pdf/)
# --------------------------------------------------------------------------- #
class PdfPage(BaseModel):
    size: str = "A4"
    orientation: str = "portrait"
    margin_top_mm: float = 12
    margin_bottom_mm: float = 14
    margin_left_mm: float = 12
    margin_right_mm: float = 12


class PdfFont(BaseModel):
    family: str = "TH Sarabun New"
    body_pt: float = 14
    header_label_pt: float = 16
    table_header_pt: float = 14
    title_th_pt: float = 20
    title_en_pt: float = 18
    footer_pt: float = 9
    line_height: float = 1.5


class PdfTable(BaseModel):
    column_widths_percent: list[float] = Field(default_factory=lambda: [35.0, 31.7, 33.3])
    header_fill: str = "#FCD5B4"
    border_color: str = "#000000"
    border_width_pt: float = 0.75
    outer_border_width_pt: float = 1.5
    cell_padding_mm: float = 1.5
    repeat_header_each_page: bool = True
    avoid_row_split: bool = True


class PdfLogo(BaseModel):
    max_height_mm: float = 14
    max_width_mm: float = 40


class PdfFooter(BaseModel):
    show_page_number: bool = True
    page_number_format: str = "หน้า {page} / {total}"
    show_company: bool = True


class PdfSignature(BaseModel):
    """The analyst line below the table on the last page (see config/pdf.yaml).
    The label wording itself lives in document.yaml's labels.analyst."""

    show: bool = True
    gap_above_mm: float = 8
    label_pt: float = 14


class PdfConfig(BaseModel):
    page: PdfPage = Field(default_factory=PdfPage)
    font: PdfFont = Field(default_factory=PdfFont)
    table: PdfTable = Field(default_factory=PdfTable)
    logo: PdfLogo = Field(default_factory=PdfLogo)
    footer: PdfFooter = Field(default_factory=PdfFooter)
    signature: PdfSignature = Field(default_factory=PdfSignature)


# --------------------------------------------------------------------------- #
# jsa-rules.yaml
# --------------------------------------------------------------------------- #
class JsaGeneration(BaseModel):
    detail_level: str = "task"
    language: str = "th"
    steps_typical_min: int = 3
    steps_typical_max: int = 12
    steps_suggest_split_above: int = 20
    respect_user_defined_steps: bool = True
    hazards_per_step_min: int = 1
    hazards_per_step_max: int = 4


class JsaRulesConfig(BaseModel):
    generation: JsaGeneration = Field(default_factory=JsaGeneration)
    consider_when_relevant: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Aggregate
# --------------------------------------------------------------------------- #
class Settings(BaseModel):
    app: AppConfig
    ai: AiConfig
    company: CompanyConfig
    document: DocumentConfig
    pdf: PdfConfig
    rules: JsaRulesConfig
    thaillm_api_key: str

    @property
    def logo_path(self) -> Path:
        return ROOT / self.company.company.logo


def _load_yaml(name: str) -> dict:
    path = CONFIG_DIR / name
    if not path.exists():
        raise RuntimeError(f"ไม่พบไฟล์ config: {path}")
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load all config once and cache it (subsequent calls are cheap)."""
    load_dotenv(ROOT / ".env")

    api_key = os.getenv("THAILLM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "ไม่พบ THAILLM_API_KEY — คัดลอก .env.example เป็น .env แล้วเติม key "
            "(บน Render ให้ตั้งใน Dashboard → Environment)"
        )

    return Settings(
        app=AppConfig(**_load_yaml("app.yaml")),
        ai=AiConfig(**_load_yaml("ai.yaml")),
        company=CompanyConfig(**_load_yaml("company.yaml")),
        document=DocumentConfig(**_load_yaml("document.yaml")),
        pdf=PdfConfig(**_load_yaml("pdf.yaml")),
        rules=JsaRulesConfig(**_load_yaml("jsa-rules.yaml")),
        thaillm_api_key=api_key,
    )
