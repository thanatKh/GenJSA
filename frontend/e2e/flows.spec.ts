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
    await page.getByRole("button", { name: "ใช้ AI ภายนอก" }).click();
    await expect(page.getByRole("heading", { name: "ใช้ AI ภายนอก" })).toBeVisible();
    await importAnswer(page, "jsa-answer.json");

    await expect(field(page, "procedure-0-s1")).toHaveValue("กั้นเขตพื้นที่");
    await forward(page, "สร้าง PDF").click();
    await expect(page.getByText("3 ขั้นตอน · 5 ขั้นตอนย่อย · 8 รายการอันตราย")).toBeVisible();

    await page.getByRole("button", { name: "สร้างขั้นตอนปฏิบัติงาน" }).click();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: /ใช้ AI ภายนอก.*แนะนำ/ })).toBeVisible();
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

  test("outside AI for both: never calls the built-in AI, WP locked to JSA sub-steps", async ({ page }) => {
    const calls = await mockApi(page);
    await fillInput(page, "JSA + Procedure");
    await page.getByRole("button", { name: "ใช้ AI ภายนอก" }).click();
    await importAnswer(page, "jsa-answer.json");
    await expect(field(page, "procedure-0")).toBeVisible();

    await forward(page, "ถัดไป").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: /ใช้ AI ภายนอก.*แนะนำ/ })).toBeVisible();
    await dialog.getByRole("button", { name: /ใช้ AI ภายนอก/ }).click();

    await expect(page.getByRole("heading", { name: "ใช้ AI ภายนอก" })).toBeVisible();
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
});
