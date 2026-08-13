from datetime import date

from app.core.thaidate import format_thai_date, to_buddhist_year


def test_buddhist_year_offset():
    assert to_buddhist_year(date(2026, 8, 12)) == 2569


def test_format_matches_official_style():
    # Must be "12 สิงหาคม 2569", never 12/08/2026
    assert format_thai_date(date(2026, 8, 12)) == "12 สิงหาคม 2569"


def test_no_leading_zero_on_day():
    assert format_thai_date(date(2026, 1, 5)) == "5 มกราคม 2569"


def test_all_twelve_months_present():
    seen = {format_thai_date(date(2026, m, 1)).split()[1] for m in range(1, 13)}
    assert len(seen) == 12
    assert "ธันวาคม" in seen


def test_short_month_form():
    assert format_thai_date(date(2026, 8, 12), short=True) == "12 ส.ค. 2569"
