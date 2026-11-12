/* The PDF and Word builders, run in the browser exactly as the app runs
 * them, on a JSA with sub-steps and its WP. */
import { expect, test } from "@playwright/test";
import { readFixture } from "./helpers";

type Answer = { work_activity: string; steps: { procedure: string; details: string; hazards: unknown[]; sub_steps: object[] }[] };

test("JSA with sub-steps and its WP build as PDF and Word", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "builds don't depend on screen size");
  await page.route("**/api/config/public", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/");
  const answer = readFixture<Answer>("jsa-answer.json");

  const built = await page.evaluate(async (a) => {
    const doc = {
      header: { work_activity: a.work_activity, supervisor: "สมชาย", analysis_date: "2026-11-12", analyst: "", company: "", project: "" },
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
