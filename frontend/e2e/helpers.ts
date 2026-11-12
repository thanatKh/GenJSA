import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

const dir = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => path.join(dir, "fixtures", name);
export const readFixture = <T>(name: string): T => JSON.parse(readFileSync(fixture(name), "utf8")) as T;

export const DESCRIPTION = [
  "เปลี่ยนวาล์ว 6 นิ้วบนท่อน้ำมันดีเซลที่คลัง",
  "1. ขอ Work Permit และกั้นเขต",
  "2. ตัดแยกระบบและระบายน้ำมัน",
  "3. ถอดวาล์วเดิมและติดตั้งวาล์วใหม่",
].join("\n");

type Calls = { jsa: number; procedure: number };

/** Answer every /api call in the browser — no backend, no AI.
 *
 * /api/config/public fails on purpose: the app must work on its built-in
 * fallbacks (the backend's own tests cover what that endpoint serves). The
 * two generate endpoints answer with a small, valid document built from the
 * request, after a short delay so the waiting screens show. */
export async function mockApi(page: Page): Promise<Calls> {
  const calls: Calls = { jsa: 0, procedure: 0 };
  await page.route("**/api/config/public", (route) => route.fulfill({ status: 503, body: "" }));
  await page.route("**/api/jsa/generate", async (route) => {
    calls.jsa += 1;
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      json: {
        header: { work_activity: "เปลี่ยนวาล์ว 6 นิ้ว", supervisor: body.supervisor, analysis_date: body.analysis_date, analyst: body.analyst ?? "", company: "", project: "" },
        steps: [1, 2, 3].map((no) => ({ no, procedure: `ขั้นตอนหลัก ${no}`, details: "", hazards: [{ hazard: `อันตราย ${no}`, controls: ["มาตรการ"] }], sub_steps: [] })),
        assumptions: [],
      },
    });
  });
  await page.route("**/api/procedure/generate", async (route) => {
    calls.procedure += 1;
    const { jsa } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      json: {
        header: jsa.header, purpose: "p", scope: "s", references: ["ref"], tools: [], assumptions: [],
        steps: jsa.steps.map((s: { procedure: string; sub_steps: unknown[] }, i: number) => ({
          no: i + 1,
          procedure: s.procedure,
          sub_steps: (s.sub_steps.length ? s.sub_steps : [0, 0]).map((_, j) => ({ no: j + 1, action: `วิธีปฏิบัติ ${i + 1}.${j + 1}` })),
        })),
      },
    });
  });
  return calls;
}

/** A JSA editor field, whichever layout is showing: the desktop table uses
 * `procedure-0`, the phone cards `procedure-m-0` */
export function field(page: Page, id: string): Locator {
  const phone = id.replace(/^(procedure|details|hazard|controls)-/, "$1-m-");
  return page.locator(`[id="${id}"]:visible, [id="${phone}"]:visible`);
}

/** Fill the first screen. `mode` picks the tab first. */
export async function fillInput(page: Page, mode: "JSA" | "JSA + Procedure" = "JSA") {
  await page.goto("/");
  if (mode !== "JSA") await page.getByText(mode, { exact: true }).first().click();
  await page.locator("textarea").first().fill(DESCRIPTION);
  await page.getByLabel("ชื่อหัวหน้างาน").fill("สมชาย ใจดี");
}

/** On the ใช้ AI ภายนอก screen: hand it an answer file and open the draft */
export async function importAnswer(page: Page, fixtureName: string) {
  await page.getByLabel("เลือกไฟล์คำตอบจาก AI").setInputFiles(fixture(fixtureName));
  await page.getByRole("button", { name: "เปิดร่างเพื่อตรวจทาน" }).click();
}

/** The page's own forward button at the bottom (สร้าง PDF / ถัดไป) */
export const forward = (page: Page, name: RegExp | string) => page.locator("button:visible", { hasText: name }).last();
