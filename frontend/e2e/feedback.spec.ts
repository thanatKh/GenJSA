/* Buttons and blocks that answer back: the fold-out prompt, the file and
 * backup buttons confirming on themselves, and blocks that ease in and out
 * instead of popping. */
import { expect, test } from "@playwright/test";
import { fillInput, fixture, mockApi } from "./helpers";

test("closing the company fields leaves both form actions free of dotted underlines", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const company = page.getByRole("button", { name: /บริษัท \(ไม่บังคับ\)/ });
  const name = page.getByRole("textbox", { name: "ชื่อบริษัท" });
  await company.click();
  await name.fill("บริษัทตัวอย่าง");
  await company.click();
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(name).toBeHidden();
  await expect(company).toContainText("บริษัทตัวอย่าง");

  await expect(page.getByRole("button", { name: /กรอกแบบฟอร์ม JSA เองทั้งหมด/ }))
    .toHaveCSS("text-decoration-line", "none");
  await expect(page.getByRole("button", { name: "ใช้โมเดลภายนอก" }))
    .toHaveCSS("text-decoration-line", "none");

  await company.click();
  await expect(name).toHaveValue("บริษัทตัวอย่าง");
});

test("the prompt fold-out opens, closes and is out of reach while closed", async ({ page }) => {
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();

  const toggle = page.getByRole("button", { name: "ดูคำสั่งที่จะคัดลอก" });
  const prompt = page.locator("#personal-prompt");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(prompt).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(prompt).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(prompt).toBeHidden(); // once the close animation has ended
});

test("the file button says it worked, and the checked answer eases in and out", async ({ page }) => {
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();

  const pick = page.getByRole("button", { name: "เลือกไฟล์คำตอบ" });
  await page.getByLabel("เลือกไฟล์คำตอบจาก AI").setInputFiles(fixture("jsa-answer.json"));
  await expect(page.getByRole("button", { name: "นำเข้าแล้ว" })).toBeVisible();
  await expect(pick).toBeVisible({ timeout: 4000 }); // back to normal by itself

  // The checked answer shows its card in place of the check button …
  const open = page.getByRole("button", { name: "เปิดร่างเพื่อตรวจทาน" });
  await expect(open).toBeVisible();
  await expect(page.getByRole("button", { name: "ตรวจคำตอบ" })).toBeHidden();
  // … and editing the answer takes it away again, check button back
  await page.locator("#personal-answer").fill('{"x":1}');
  await expect(open).toBeHidden();
  await expect(page.getByRole("button", { name: "ตรวจคำตอบ" })).toBeVisible();
});

test("JSA defaults to detailed with sub-steps and remembers changes to both", async ({ page }) => {
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
  const target = page.locator("#personal-target");
  const split = page.getByLabel(/แตกขั้นตอนหลักเป็นขั้นตอนย่อย/);
  const detailed = page.getByRole("radio", { name: "ละเอียด", exact: true });
  await expect(detailed).toBeChecked();
  await expect(split).toBeChecked();
  await expect(target).toBeVisible();
  await split.uncheck();
  await expect(target).toBeHidden();
  await split.check();
  await expect(target).toBeVisible();
  await split.uncheck();
  await page.getByRole("radio", { name: "กระชับ", exact: true }).check();
  await page.getByRole("button", { name: "กลับไปกรอกข้อมูล" }).click();
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
  await expect(page.getByRole("radio", { name: "กระชับ", exact: true })).toBeChecked();
  await expect(split).not.toBeChecked();
});

test("the backup button says it worked, then goes back", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const backup = page.getByRole("button", { name: "สำรองข้อมูล" });
  const download = page.waitForEvent("download");
  await backup.click();
  await download;
  await expect(page.getByRole("button", { name: "สำรองแล้ว" })).toBeVisible();
  await expect(backup).toBeVisible({ timeout: 4000 });
});
