import { describe, expect, it } from "vitest";
import { hz, splitJsa } from "../test/fixtures";
import { jsaProblems } from "./jsaValidation";

describe("jsaProblems", () => {
  it("finds nothing wrong with a complete JSA", () => {
    expect(jsaProblems(splitJsa())).toEqual([]);
  });

  it("points at a sub-step's own fields, by the ids the editor uses", () => {
    const doc = splitJsa();
    doc.steps[0].sub_steps[1].procedure = " ";
    doc.steps[0].sub_steps[1].hazards = [hz("ไอน้ำมัน", " ")];
    expect(jsaProblems(doc)).toEqual([
      { id: "procedure-0-s1", message: "กรุณากรอกชื่อขั้นตอนที่ 1.2" },
      { id: "controls-0-s1-0-0", message: "ขั้นตอน 1.2: กรุณาระบุมาตรการของอันตรายที่ 1" },
    ]);
  });

  it("still checks plain steps by their old ids", () => {
    const doc = splitJsa();
    doc.steps[1].hazards[0].hazard = "";
    expect(jsaProblems(doc)).toEqual([{ id: "hazard-1-0", message: "ขั้นตอน 2: กรุณาระบุอันตรายที่ 1" }]);
  });
});
