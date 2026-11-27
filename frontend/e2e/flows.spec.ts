/* The four ways through the app, start to finished files:
 * JSA or JSA + Procedure, drafted by the built-in AI or an outside one. */
import { expect, test } from "@playwright/test";
import { field, fillInput, forward, importAnswer, mockApi } from "./helpers";

test.describe("JSA", () => {
  test("built-in AI: describe → draft → review → PDF page", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page);
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
    await expect(page.getByRole("heading", { name: "กำลังสร้าง JSA" })).toBeVisible();
    await expect(field(page, "procedure-0")).toHaveValue("ขั้นตอนหลัก 1");

    await forward(page, "สร้าง PDF").click();
    await expect(page.getByRole("heading", { name: "เอกสาร JSA" })).toBeVisible();
    await expect(page.getByText("3 ขั้นตอน · 3 รายการอันตราย")).toBeVisible();
    expect(calls).toEqual({ jsa: 1, procedure: 0 });

    // Adding a WP from here asks which AI, suggesting the one the JSA came from
    await page.getByRole("button", { name: "สร้างขั้นตอนปฏิบัติงาน" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: /AI ในระบบ.*แนะนำ/ })).toBeVisible();
    await dialog.getByRole("button", { name: "ยกเลิก" }).click();
    expect(calls.procedure).toBe(0);
  });

  test("outside AI: import an answer with sub-steps → review → PDF page", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page);
    await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
    await expect(page.getByRole("heading", { name: "ใช้โมเดลภายนอก" })).toBeVisible();
    await importAnswer(page, "jsa-answer.json");

    await expect(field(page, "procedure-0-s1")).toHaveValue("กั้นเขตพื้นที่");
    await forward(page, "สร้าง PDF").click();
    await expect(page.getByText("3 ขั้นตอน · 5 ขั้นตอนย่อย · 8 รายการอันตราย")).toBeVisible();

    await page.getByRole("button", { name: "สร้างขั้นตอนปฏิบัติงาน" }).click();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: /ใช้โมเดลภายนอก.*แนะนำ/ })).toBeVisible();
    expect(calls).toEqual({ jsa: 0, procedure: 0 });
  });
});

test.describe("JSA + Procedure", () => {
  test("built-in AI for both: ถัดไป asks, then drafts the WP → both files", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page, "JSA + Procedure");
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
    await expect(field(page, "procedure-0")).toBeVisible();

    await forward(page, "ถัดไป").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: /AI ในระบบ.*แนะนำ/ })).toBeVisible();
    await dialog.getByRole("button", { name: /AI ในระบบ/ }).click();

    await expect(page.getByRole("heading", { name: "ตรวจทานขั้นตอนปฏิบัติงาน" })).toBeVisible();
    // Plain JSA steps: WP sub-steps can be added and removed freely
    await expect(page.getByRole("button", { name: "เพิ่มขั้นตอนย่อย" })).toHaveCount(3);
    await forward(page, "สร้าง PDF").click();

    await expect(page.getByRole("heading", { name: "เอกสาร PDF" })).toBeVisible();
    await expect(page.getByText("3 ขั้นตอน · 6 ขั้นตอนย่อย")).toBeVisible();
    await expect(page.getByText("3 ขั้นตอน · 3 รายการอันตราย")).toBeVisible();
    expect(calls).toEqual({ jsa: 1, procedure: 1 });
  });

  test("a failed WP draft stays visible by ถัดไป and leaves the reviewed JSA available", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/procedure/generate", (route) => route.fulfill({
      status: 502,
      json: { error: { code: "ai_bad_response", message: "ร่างเอกสารไม่สำเร็จ" } },
    }), { times: 1 });
    await fillInput(page, "JSA + Procedure");
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
    await expect(field(page, "procedure-0")).toHaveValue("ขั้นตอนหลัก 1");
    await forward(page, "ถัดไป").click();
    await page.getByRole("alertdialog").getByRole("button", { name: /AI ในระบบ/ }).click();

    const next = forward(page, "ถัดไป");
    const alert = page.locator(".editor-action-bar").getByRole("alert");
    await expect(alert).toContainText("ร่างขั้นตอนปฏิบัติงานไม่สำเร็จ ข้อมูล JSA ยังอยู่");
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });
    await expect(field(page, "procedure-0")).toHaveValue("ขั้นตอนหลัก 1");

    await next.click();
    await page.getByRole("alertdialog").getByRole("button", { name: /ใช้โมเดลภายนอก/ }).click();
    await expect(page.getByRole("heading", { name: "ใช้โมเดลภายนอก", exact: true })).toBeVisible();
  });

  test("outside AI for both: never calls the built-in AI, WP locked to JSA sub-steps", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page, "JSA + Procedure");
    await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
    await importAnswer(page, "jsa-answer.json");
    await expect(field(page, "procedure-0")).toBeVisible();

    await forward(page, "ถัดไป").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: /ใช้โมเดลภายนอก.*แนะนำ/ })).toBeVisible();
    await dialog.getByRole("button", { name: /ใช้โมเดลภายนอก/ }).click();

    await expect(page.getByRole("heading", { name: "ใช้โมเดลภายนอก" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "ละเอียด", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /แตกขั้นตอน/ })).toHaveCount(0);
    await expect(page.locator("#personal-prompt")).toHaveValue(/1\.1 ขอ Work Permit/);
    await importAnswer(page, "wp-answer.json");

    await expect(page.getByRole("heading", { name: "ตรวจทานขั้นตอนปฏิบัติงาน" })).toBeVisible();
    // Steps 1 and 3 are tied to the JSA's sub-steps; only plain step 2 can grow
    await expect(page.getByText(/^JSA 1\.2 ·/)).toBeVisible();
    await expect(page.getByText(/^JSA \d+\.\d+ ·/)).toHaveCount(5);
    await expect(page.getByRole("button", { name: /ลบขั้นตอนย่อยที่ 1\./ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ลบขั้นตอนย่อยที่ 2\./ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "เพิ่มขั้นตอนย่อย" })).toHaveCount(1);
    // PPE arrives as its own list, separate from tools
    await expect(page.locator("#ppe")).toHaveValue("หมวกนิรภัย\nแว่นตานิรภัย\nถุงมือกันสารเคมี");

    await forward(page, "สร้าง PDF").click();
    await expect(page.getByText("3 ขั้นตอน · 7 ขั้นตอนย่อย")).toBeVisible();
    expect(calls).toEqual({ jsa: 0, procedure: 0 });
  });

  test("a history row's WP button asks which AI too", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page);
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
    await expect(field(page, "procedure-0")).toBeVisible();
    // Back to the start, where the job is now in the history list
    await page.getByRole("button", { name: "เริ่มใหม่" }).click();
    const confirm = page.getByRole("alertdialog");
    if (await confirm.isVisible()) await confirm.getByRole("button").last().click();

    await page.getByRole("button", { name: /^สร้างขั้นตอนปฏิบัติงานของ/ }).first().click();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: /AI ในระบบ/ })).toBeVisible();
    expect(calls.procedure).toBe(0);
  });

  test("JSA and WP review restore their own scroll positions on Back and Forward", async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
    await mockApi(page);
    await page.route("**/api/jsa/generate", (route) => route.fulfill({ json: {
      header: { work_activity: "งานทดสอบการเลื่อนหน้า", supervisor: "ผู้ทดสอบ", analysis_date: "2026-11-26" },
      steps: Array.from({ length: 16 }, (_, index) => ({
        no: index + 1, procedure: `ขั้นตอน ${index + 1}`, details: "ตรวจพื้นที่ก่อนเริ่มงาน",
        hazards: [{ hazard: "พื้นลื่น", controls: ["ตรวจสภาพพื้น"] }], sub_steps: [],
      })),
    } }));
    await fillInput(page, "JSA + Procedure");
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();

    const jsa = page.getByRole("heading", { name: "ตรวจทานและแก้ไข" });
    const wp = page.getByRole("heading", { name: "ตรวจทานขั้นตอนปฏิบัติงาน" });
    const position = () => page.evaluate(() => window.scrollY);
    const scrollTo = async (top: number) => {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
      await expect.poll(position).toBe(top);
    };
    const expectRestoredPosition = async (top: number) => {
      // Scroll anchoring can shift the offset slightly as the editor mounts.
      // Returning within one line still keeps the same step in view.
      await expect.poll(async () => Math.abs((await position()) - top)).toBeLessThanOrEqual(16);
    };

    await expect(jsa).toBeVisible();
    await scrollTo(640);
    await forward(page, "ถัดไป").click();
    await page.getByRole("alertdialog").getByRole("button", { name: /AI ในระบบ/ }).click();
    await expect(wp).toBeVisible();
    await expect(jsa).toHaveCount(0);
    await expect.poll(position).toBe(0);
    await scrollTo(420);

    await page.goBack();
    await expect(jsa).toBeFocused();
    await expectRestoredPosition(640);
    await page.goForward();
    await expect(wp).toBeFocused();
    await expectRestoredPosition(420);

    await page.getByRole("button", { name: "กลับไปตรวจทาน JSA", exact: true }).click();
    await expect(jsa).toBeFocused();
    await expectRestoredPosition(640);
    await forward(page, "ถัดไป").click();
    await expect(wp).toBeFocused();
    await expectRestoredPosition(420);
  });
});
