"""Thai-style dates — Buddhist era year and Thai month names.

Must produce "12 สิงหาคม 2569", never "12/08/2026".
The frontend has the same logic in frontend/src/lib/thaidate.ts — keep both in sync.
"""

from datetime import date

THAI_MONTHS = (
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
)

THAI_MONTHS_SHORT = (
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
)

# Buddhist era year = Gregorian year + 543
BUDDHIST_OFFSET = 543


def to_buddhist_year(value: date) -> int:
    return value.year + BUDDHIST_OFFSET


def format_thai_date(value: date, short: bool = False) -> str:
    """`date(2026, 8, 12)` -> `'12 สิงหาคม 2569'`"""
    months = THAI_MONTHS_SHORT if short else THAI_MONTHS
    return f"{value.day} {months[value.month - 1]} {to_buddhist_year(value)}"
