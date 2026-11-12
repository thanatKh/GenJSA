import { describe, expect, it } from "vitest";
import { splitJsa } from "../test/fixtures";
import {
  buildPersonalProcedurePrompt,
  buildPersonalPrompt,
  parsePersonalDraft,
  parsePersonalProcedure,
  procedureSourceText,
} from "./personalAi";
import type { JsaPromptRules } from "./api";

const hazard = { hazard: "สะดุดล้ม", controls: ["จัดพื้นที่"] };
const answer = (steps: unknown[]) => JSON.stringify({ work_activity: "เปลี่ยนวาล์ว", steps, assumptions: [] });

describe("parsePersonalDraft — reading an outside AI's JSA", () => {
  it("reads a fenced answer with a byte-order mark, as a downloaded file may be", () => {
    const text = "﻿```json\n" + answer([{ procedure: "กั้นเขต", hazards: [hazard] }]) + "\n```";
    const draft = parsePersonalDraft(text);
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]).toMatchObject({ no: 1, procedure: "กั้นเขต", sub_steps: [] });
  });

  it("numbers sub-steps and drops a heading's own hazards", () => {
    const draft = parsePersonalDraft(answer([
      { procedure: "เตรียมพื้นที่", hazards: [hazard], sub_steps: [
        { procedure: "กั้นเขต", hazards: [hazard] },
        { procedure: "Check Gas", hazards: [hazard] },
      ] },
    ]));
    expect(draft.steps[0].hazards).toEqual([]);
    expect(draft.steps[0].sub_steps.map((s) => s.no)).toEqual([1, 2]);
  });

  it("rejects a plain step with no hazards, naming the field", () => {
    expect(() => parsePersonalDraft(answer([{ procedure: "กั้นเขต", hazards: [] }]))).toThrow("ที่ ขั้นตอน 1 · อันตราย");
  });

  it("names a sub-step's problem in the user's terms, not as a JSON path", () => {
    const bad = answer([{ procedure: "เตรียม", hazards: [], sub_steps: [
      { procedure: "กั้นเขต", hazards: [hazard] },
      { procedure: "Check Gas", hazards: [{ hazard: "ไอน้ำมัน", controls: [] }] },
    ] }]);
    expect(() => parsePersonalDraft(bad)).toThrow("ที่ ขั้นตอน 1.2 · มาตรการ");
  });

  it("rejects text that isn't JSON with a message the user can act on", () => {
    expect(() => parsePersonalDraft("นี่คือ JSA ของคุณ")).toThrow(/คัดลอก JSON/);
  });
});

describe("parsePersonalProcedure — reading an outside AI's WP", () => {
  const wp = (steps: unknown[]) => JSON.stringify({ purpose: "p", scope: "s", tools: [], assumptions: [], steps });

  it("ties WP lines one-to-one to the JSA's sub-steps", () => {
    const doc = parsePersonalProcedure(wp([
      { no: 1, sub_steps: [{ action: "กั้นเขต: วางแผงกั้น" }] }, // one short: 1.2 falls back
      { no: 2, sub_steps: [{ action: "ปิดวาล์ว" }, { action: "ล็อก" }, { action: "ระบาย" }] },
    ]), splitJsa());
    expect(doc.steps[0].sub_steps.map((s) => [s.no, s.action])).toEqual([[1, "กั้นเขต: วางแผงกั้น"], [2, "Check Gas"]]);
    // A plain JSA step keeps whatever the AI wrote
    expect(doc.steps[1].sub_steps).toHaveLength(3);
    // Titles always come from the JSA
    expect(doc.steps.map((s) => s.procedure)).toEqual(["เตรียมพื้นที่", "ตัดแยกระบบ"]);
  });

  it("drops extra lines under a JSA step that has sub-steps", () => {
    const doc = parsePersonalProcedure(wp([
      { no: 1, sub_steps: [{ action: "ก" }, { action: "ข" }, { action: "เกิน" }] },
      { no: 2, sub_steps: [{ action: "ค" }] },
    ]), splitJsa());
    expect(doc.steps[0].sub_steps.map((s) => s.action)).toEqual(["ก", "ข"]);
  });

  it("refuses an answer whose main step numbers don't match the JSA", () => {
    expect(() => parsePersonalProcedure(wp([{ no: 1, sub_steps: [{ action: "ก" }] }]), splitJsa())).toThrow(/เลขขั้นตอนหลัก/);
  });

  it("keeps PPE as its own list", () => {
    const doc = parsePersonalProcedure(JSON.stringify({ tools: ["ประแจ"], ppe: ["หมวกนิรภัย"], steps: [
      { no: 1, sub_steps: [{ action: "ก" }] },
      { no: 2, sub_steps: [{ action: "ข" }] },
    ] }), splitJsa());
    expect(doc.ppe).toEqual(["หมวกนิรภัย"]);
    expect(doc.tools).toEqual(["ประแจ"]);
  });

  it("builds the reference from the JSA, never from the AI", () => {
    const doc = parsePersonalProcedure(wp([
      { no: 1, sub_steps: [{ action: "ก" }] },
      { no: 2, sub_steps: [{ action: "ข" }] },
    ]), splitJsa(), "JSA");
    expect(doc.references).toEqual(["JSA: เปลี่ยนวาล์ว — 12 พฤศจิกายน 2569"]);
  });
});

describe("prompts for an outside AI", () => {
  const rules: JsaPromptRules = {
    hazardChecklist: ["ไฟฟ้า"],
    considerWhenRelevant: [],
    terminology: [{ use: "Check Gas", insteadOf: ["Gas Test"] }],
    prompts: { jsa: "# หลักการร่าง JSA\nกฎจากเซิร์ฟเวอร์", procedure: "# หลักการเขียนขั้นตอนปฏิบัติงาน\nกฎ WP" },
  };

  it("uses the server's rules — the same ones the built-in AI follows", () => {
    const prompt = buildPersonalPrompt("งานทดสอบ", "มาตรฐาน", "", rules);
    expect(prompt).toContain("กฎจากเซิร์ฟเวอร์");
    expect(prompt).toContain("genjsa-jsa.json");
    expect(prompt).toContain("# รายละเอียดงาน\nงานทดสอบ");
    expect(prompt).not.toContain("แตกแต่ละขั้นตอนหลัก");
  });

  it("falls back to a short version of the rules without the server's", () => {
    const prompt = buildPersonalPrompt("งานทดสอบ", "มาตรฐาน", "", { ...rules, prompts: undefined });
    expect(prompt).toContain('เขียน "Check Gas" ห้ามใช้ "Gas Test"');
    expect(prompt).toContain("- ไฟฟ้า");
  });

  it("asks for a split, with the rough total when one is given", () => {
    expect(buildPersonalPrompt("ก", "ละเอียด", "", rules, true)).toContain("แตกแต่ละขั้นตอนหลักเป็นขั้นตอนย่อย");
    expect(buildPersonalPrompt("ก", "ละเอียด", "", rules, true, 40)).toContain("ประมาณ 40 ขั้นตอนย่อย");
  });

  it("lists the JSA's sub-steps for the WP prompt, under its rules", () => {
    const source = procedureSourceText(splitJsa());
    expect(source).toContain("1. เตรียมพื้นที่\n   1.1 กั้นเขต\n   1.2 Check Gas");
    const prompt = buildPersonalProcedurePrompt(source, "มาตรฐาน", "", rules);
    expect(prompt).toContain("กฎ WP");
    expect(prompt).toContain("genjsa-wp.json");
  });
});
