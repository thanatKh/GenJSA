import { describe, expect, it } from "vitest";
import { balancedLines } from "./common";

describe("balancedLines — the Word cover title", () => {
  it("leaves a short title on one line", () => {
    expect(balancedLines("เปลี่ยนปะเก็นหน้าแปลน")).toEqual(["เปลี่ยนปะเก็นหน้าแปลน"]);
  });

  it("splits a long title into two lines of about equal length, between words", () => {
    const title = "เปลี่ยนปะเก็นหน้าแปลนท่อน้ำดับเพลิงขนาด 20 นิ้ว ที่คลังน้ำมัน";
    const lines = balancedLines(title);
    expect(lines).toHaveLength(2);
    expect(lines.join("").replace(/\s/g, "")).toBe(title.replace(/\s/g, ""));
    // Neither line is a lone short word
    expect(Math.min(...lines.map((l) => l.length))).toBeGreaterThan(title.length / 4);
    // Broken at a space between phrases, not inside "น้ำดับเพลิง"
    expect(lines[0].endsWith("ดับ")).toBe(false);
  });

  it("falls back to a word boundary when no space is near the middle", () => {
    const lines = balancedLines("ตรวจสอบและบำรุงรักษาเครื่องแลกเปลี่ยนความร้อนประจำปีของหน่วยผลิต");
    expect(lines).toHaveLength(2);
  });
});
