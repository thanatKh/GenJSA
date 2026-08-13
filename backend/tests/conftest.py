import os
import sys
from datetime import date
from pathlib import Path

import pytest

# Let `import app.*` work without installing it as a package
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The config loader requires a key to load at all — tests never call the real AI, so a dummy value is fine
os.environ.setdefault("THAILLM_API_KEY", "test-key-not-real")


@pytest.fixture
def sample_doc():
    from app.models.jsa import Hazard, JsaDocument, JsaHeader, JsaStep

    return JsaDocument(
        header=JsaHeader(
            work_activity="เปลี่ยน mechanical seal ของ LPG Pump P-101",
            supervisor="สมชาย ใจดี",
            analysis_date=date(2026, 8, 12),
        ),
        steps=[
            JsaStep(
                no=1,
                procedure="เตรียมพื้นที่และกั้นเขตปฏิบัติงาน",
                details="ติดป้ายเตือน กั้นพื้นที่ และตรวจสอบทางหนีไฟ",
                hazards=[
                    Hazard(
                        hazard="ผู้ไม่เกี่ยวข้องเข้าพื้นที่",
                        controls=["กั้นเขตด้วยแผงกั้น", "ติดป้ายห้ามเข้า"],
                    )
                ],
            ),
            JsaStep(
                no=2,
                procedure="ตัดแยกระบบและระบายความดัน",
                details="ปิดวาล์ว ล็อกและติดป้าย ระบายความดันจนเป็นศูนย์",
                hazards=[
                    Hazard(
                        hazard="LPG รั่วไหลและติดไฟ",
                        controls=["ตรวจวัดก๊าซก่อนเปิดแนวท่อ", "เตรียมถังดับเพลิง"],
                    ),
                    Hazard(
                        hazard="ความดันตกค้างในระบบ",
                        controls=["ตรวจสอบเกจความดันเป็นศูนย์ก่อนถอด"],
                    ),
                ],
            ),
        ],
        assumptions=["สมมติว่าระบบมีจุดตัดแยกที่เข้าถึงได้ เนื่องจากไม่ได้ระบุมา"],
    )
