import { describe, expect, it } from "vitest";
import { hz, jsa, splitJsa, step } from "../test/fixtures";
import { hazardCount, jsaDocumentSchema, jsaFingerprint, jsaRows, linkedSubSteps, subStepCount } from "./schema";

describe("jsaRows — the printed numbering", () => {
  it("numbers a heading step, its sub-steps and a plain step", () => {
    const rows = jsaRows(splitJsa());
    expect(rows.map((r) => [r.kind, r.no, r.procedure])).toEqual([
      ["heading", "1", "เตรียมพื้นที่"],
      ["sub", "1.1", "กั้นเขต"],
      ["sub", "1.2", "Check Gas"],
      ["step", "2", "ตัดแยกระบบ"],
    ]);
  });

  it("gives a heading row no hazards, even if the step still carries some", () => {
    const doc = splitJsa();
    doc.steps[0].hazards = [hz("ไม่ควรพิมพ์")];
    expect(jsaRows(doc)[0].hazards).toEqual([]);
  });

  it("counts hazards across sub-steps, and sub-steps", () => {
    expect(hazardCount(splitJsa())).toBe(4);
    expect(subStepCount(splitJsa())).toBe(2);
  });
});

describe("linkedSubSteps — WP lines tied to the JSA", () => {
  it("locks a WP step whose JSA step has the same number of sub-steps", () => {
    expect(linkedSubSteps(splitJsa(), 0, 2)).toEqual({ titles: ["กั้นเขต", "Check Gas"], locked: true });
  });

  it("leaves a plain JSA step's WP lines free", () => {
    expect(linkedSubSteps(splitJsa(), 1, 3)).toEqual({ titles: [], locked: false });
  });

  it("unlocks when the WP no longer matches (the JSA changed afterwards)", () => {
    expect(linkedSubSteps(splitJsa(), 0, 3).locked).toBe(false);
  });

  it("copes with no JSA at all", () => {
    expect(linkedSubSteps(null, 0, 2)).toEqual({ titles: [], locked: false });
  });
});

describe("older documents", () => {
  it("parse without sub_steps, which default to none", () => {
    const old = {
      header: { work_activity: "ก", supervisor: "ข", analysis_date: "2026-01-01" },
      steps: [{ no: 1, procedure: "ค", details: "", hazards: [hz("ง")] }],
    };
    const doc = jsaDocumentSchema.parse(old);
    expect(doc.steps[0].sub_steps).toEqual([]);
    expect(doc.header.company).toBe("");
  });

  it("keep the fingerprint they had before sub-steps existed, so their WP isn't flagged stale", () => {
    const doc = jsa([step("ตัดแยกระบบ", [hz("น้ำมันรั่ว")])]);
    // The pre-sub-steps formula: header + [procedure, details] per step
    const before = JSON.stringify([doc.header, doc.steps.map((s) => [s.procedure.trim(), s.details.trim()])]);
    expect(jsaFingerprint(doc)).toBe(before);
  });

  it("change the fingerprint when a sub-step is renamed", () => {
    const a = splitJsa();
    const b = splitJsa();
    b.steps[0].sub_steps[1].procedure = "Check Gas ซ้ำ";
    expect(jsaFingerprint(a)).not.toBe(jsaFingerprint(b));
  });
});
