/* The JSA editor's sub-steps: split, add, move, delete with undo, and the
 * last one gone turning the step back into a plain step. */
import { expect, test, type Page } from "@playwright/test";
import { field, fillInput, importAnswer, mockApi } from "./helpers";

async function openDraftedJsa(page: Page) {
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
  await expect(field(page, "procedure-0")).toHaveValue("ขั้นตอนหลัก 1");
}

const undo = (page: Page) => page.getByRole("button", { name: "เลิกทำ" }).click();
/** A deleted card animates out while the next one moves into its number —
 * for that moment two fields share an id. Wait for the animation to finish. */
const settled = (page: Page, id: string) => expect(field(page, id)).toHaveCount(1);
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).locator("visible=true").first();

test("split a step: its hazards move to x.1 and the title waits to be filled", async ({ page }) => {
  await openDraftedJsa(page);
  await page.locator("#jsa-step-1").getByRole("button", { name: "แบ่งเป็นขั้นตอนย่อย" }).locator("visible=true").click();

  await expect(field(page, "procedure-1-s0")).toBeFocused();
  await expect(field(page, "procedure-1-s0")).toHaveValue("");
  await expect(field(page, "hazard-1-s0-0")).toHaveValue("อันตราย 2");
  // The heading itself no longer has hazard fields
  await expect(field(page, "hazard-1-0")).toHaveCount(0);
});

test("add, move, delete and undo sub-steps", async ({ page }) => {
  await openDraftedJsa(page);
  await page.locator("#jsa-step-1").getByRole("button", { name: "แบ่งเป็นขั้นตอนย่อย" }).locator("visible=true").click();
  await field(page, "procedure-1-s0").fill("ปิดวาล์ว");
  await page.locator("#jsa-step-1").getByRole("button", { name: "เพิ่มขั้นตอนย่อย" }).locator("visible=true").click();
  await field(page, "procedure-1-s1").fill("ระบายแรงดัน");

  await button(page, "เลื่อนขั้นตอนที่ 2.2 ขึ้น").click();
  await expect(field(page, "procedure-1-s0")).toHaveValue("ระบายแรงดัน");
  await expect(field(page, "procedure-1-s1")).toHaveValue("ปิดวาล์ว");

  await button(page, "ลบขั้นตอนที่ 2.1").click();
  await settled(page, "procedure-1-s0");
  await expect(field(page, "procedure-1-s0")).toHaveValue("ปิดวาล์ว");
  await undo(page);
  await expect(field(page, "procedure-1-s0")).toHaveValue("ระบายแรงดัน");
  await expect(field(page, "procedure-1-s1")).toHaveValue("ปิดวาล์ว");
});

test("deleting the last sub-step turns the step back into a plain one, hazards kept", async ({ page }) => {
  await openDraftedJsa(page);
  await page.locator("#jsa-step-1").getByRole("button", { name: "แบ่งเป็นขั้นตอนย่อย" }).locator("visible=true").click();
  await field(page, "procedure-1-s0").fill("ปิดวาล์ว");

  await button(page, "ลบขั้นตอนที่ 2.1").click();
  await expect(field(page, "procedure-1-s0")).toHaveCount(0);
  await expect(field(page, "hazard-1-0")).toHaveValue("อันตราย 2");

  await undo(page);
  await expect(field(page, "procedure-1-s0")).toHaveValue("ปิดวาล์ว");
});

test("controls are bulleted, not numbered 1.1, in a JSA with sub-steps", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the bullet sits in the desktop table's control cell");
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้ AI ภายนอก" }).click();
  await importAnswer(page, "jsa-answer.json");
  // Step 1.2 has two hazards — numbered controls would read 1.1, 1.2, 2.1
  const row = page.locator("#jsa-step-0-s1");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/\b2\.1\b/);
});
