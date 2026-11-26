/* The PDF and Word builders, run in the browser exactly as the app runs
 * them, on a JSA with sub-steps and its WP. */
import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { readFixture } from "./helpers";

type Answer = { work_activity: string; steps: { procedure: string; details: string; hazards: unknown[]; sub_steps: object[] }[] };

test("JSA with sub-steps and its WP build as PDF and Word", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "builds don't depend on screen size");
  await page.route("**/api/config/public", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/");
  const answer = readFixture<Answer>("jsa-answer.json");

  const built = await page.evaluate(async (a) => {
    const doc = {
      header: { work_activity: a.work_activity, supervisor: "สมชาย", analysis_date: "2026-11-12", analyst: "", company: "" },
      steps: a.steps.map((s, i) => ({ ...s, no: i + 1, sub_steps: s.sub_steps.map((x, j) => ({ ...x, no: j + 1 })) })),
      assumptions: [],
    };
    const wp = {
      header: doc.header, purpose: "p", scope: "s", references: ["ref"], tools: [], assumptions: [],
      steps: doc.steps.map((s) => ({ no: s.no, procedure: s.procedure, sub_steps: (s.sub_steps.length ? s.sub_steps : [0]).map((_, j) => ({ no: j + 1, action: "วิธีปฏิบัติ" })) })),
    };
    const head = async (blob: Blob) => ({ size: blob.size, head: new TextDecoder().decode((await blob.slice(0, 4).arrayBuffer())) });
    const { buildJsaPdf } = await import("/src/lib/pdf/buildJsaPdf.ts");
    const { buildProcedurePdf } = await import("/src/lib/pdf/buildProcedurePdf.ts");
    const { buildJsaDocx } = await import("/src/lib/word/buildJsaDocx.ts");
    const { buildProcedureDocx } = await import("/src/lib/word/buildProcedureDocx.ts");
    return {
      jsaPdf: await head(await buildJsaPdf(doc)),
      wpPdf: await head(await buildProcedurePdf(wp)),
      jsaDocx: await head(await buildJsaDocx(doc)),
      wpDocx: await head(await buildProcedureDocx(wp)),
    };
  }, answer);

  expect(built.jsaPdf.head).toBe("%PDF");
  expect(built.wpPdf.head).toBe("%PDF");
  expect(built.jsaDocx.head.slice(0, 2)).toBe("PK"); // a .docx is a zip
  expect(built.wpDocx.head.slice(0, 2)).toBe("PK");
  for (const file of Object.values(built)) expect(file.size).toBeGreaterThan(10_000);
});

test("the final JSA page includes table content alongside the analyst line", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "builds don't depend on screen size");
  await page.route("**/api/config/public", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/");

  const bytes = await page.evaluate(async () => {
    const { buildJsaPdf } = await import("/src/lib/pdf/buildJsaPdf.ts");
    const content = "ตรวจสภาพพื้นที่และสื่อสารกับผู้ควบคุมงานก่อนเริ่มดำเนินการ ";
    const blob = await buildJsaPdf({
      header: {
        work_activity: "ตรวจงานตัวอย่าง " + "ภาษาไทยและเครื่องจักร ".repeat(11),
        supervisor: "Audit supervisor", analysis_date: "2026-11-26", analyst: "", company: "",
      },
      assumptions: [],
      steps: Array.from({ length: 12 }, (_, i) => ({
        no: i + 1,
        procedure: "ขั้นตอนตรวจสอบภาษาไทย  ".repeat(i % 3 + 1) + "LONG_EQUIPMENT_IDENTIFIER_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789",
        details: content.repeat(i % 5 + 1),
        hazards: Array.from({ length: 3 }, (_, j) => ({ hazard: `รายการอันตราย ${j + 1} ${content}`, controls: [content.repeat(2), content, content] })),
        sub_steps: [],
      })),
    });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  const pdf = Buffer.from(bytes).toString("latin1");
  const pages = [...pdf.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)];
  expect(pages.length).toBeGreaterThan(1);
  const streamObject = pdf.indexOf(`\n${pages.at(-1)![1]} 0 obj\n`);
  expect(streamObject).toBeGreaterThan(0);
  const streamMarker = pdf.indexOf("\nstream\n", streamObject);
  const streamLength = Number(/\/Length (\d+)/.exec(pdf.slice(streamObject, streamMarker))?.[1]);
  const lastPage = inflateSync(Buffer.from(pdf.slice(streamMarker + 8, streamMarker + 8 + streamLength), "latin1")).toString("latin1");
  // The signature and footer are only text. A table slice draws rectangles.
  expect(lastPage).toMatch(/\bre\s+S\b/);
});

test("WP justification aligns wrapped Thai text and leaves paragraph endings natural", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "document layout does not depend on screen size");
  await page.route("**/api/config/public", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/");

  const lines = await page.evaluate(async () => {
    const { createEngine } = await import("/src/lib/pdf/engine.ts");
    const { FALLBACK_LAYOUT } = await import("/src/lib/pdf/layout.ts");
    const engine = await createEngine(FALLBACK_LAYOUT);
    const width = 250;
    const text = "ตรวจสอบความเรียบร้อยของอุปกรณ์ก่อนเริ่มดำเนินงานตามแบบที่อนุมัติ".repeat(4) +
      "\nบันทึกผล WP-204.5";
    const wrapped = engine.wrap(text, width, "normal", FALLBACK_LAYOUT.font.body_pt, "1.1", true);
    const output: { text: string; justify?: boolean; right: number; runs: number }[] = [];
    const drawText = engine.doc.text.bind(engine.doc);
    let runs: { right: number }[] = [];
    engine.doc.text = (...args) => {
      const [content, x] = args;
      if (typeof content === "string") runs.push({ right: x + engine.doc.getTextWidth(content) });
      return drawText(...args);
    };

    for (const line of wrapped) {
      runs = [];
      engine.drawLines([line], 0, 24, width);
      output.push({ text: line.text, justify: line.justify, right: runs.at(-1)!.right, runs: runs.length });
    }
    return output;
  });

  expect(lines[0].runs).toBeGreaterThan(2);
  expect(lines[0].right).toBeCloseTo(250, 2);
  expect(lines.at(-2)?.justify).toBe(false);
  expect(lines.at(-1)).toMatchObject({ text: "บันทึกผล WP-204.5", justify: false, runs: 1 });
  expect(lines.at(-1)!.right).toBeLessThan(250);
});
