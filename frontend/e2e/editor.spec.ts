/* The JSA editor's sub-steps: split, add, move, delete with undo, and the
 * last one gone turning the step back into a plain step. */
import { expect, test, type Locator, type Page } from "@playwright/test";
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

test("the mobile editors keep save feedback above the keyboard and fit a wide photo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "coarse-pointer keyboard layout");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1,
    });
    Object.defineProperty(window, "visualViewport", { value: viewport });
  });

  await mockApi(page);
  await fillInput(page, "JSA + Procedure");
  await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
  const bar = page.locator(".editor-action-bar");
  const updateViewport = (keyboard: boolean, scale = 1) => page.evaluate(({ keyboard, scale }) => {
    const viewport = window.visualViewport!;
    Object.assign(viewport, { height: keyboard ? 400 : window.innerHeight, offsetTop: keyboard ? 24 : 0, scale });
    viewport.dispatchEvent(new Event("resize"));
  }, { keyboard, scale });

  const typeWithKeyboard = async (input: Locator, action: Locator) => {
    await expect(action).toBeVisible();
    await input.focus();
    await updateViewport(true);
    await expect(action).toBeHidden();
    await expect.poll(() => bar.evaluate((node) => Math.round(node.getBoundingClientRect().bottom))).toBe(424);
    const before = (await input.boundingBox())!.height;
    await input.fill("ตรวจพื้นที่และบันทึกรายละเอียด\n".repeat(5));
    await expect(input).toBeFocused();
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(before);
    await expect(bar.getByRole("status")).toContainText("กำลังบันทึก");
    await expect(bar.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom)))
      .toBeGreaterThan(296);
    await input.evaluate((node) => node.scrollIntoView({ block: "end", behavior: "instant" }));
    const inputBottom = await input.evaluate((node) => node.getBoundingClientRect().bottom);
    const barTop = await bar.evaluate((node) => node.getBoundingClientRect().top);
    expect(inputBottom).toBeLessThanOrEqual(barTop);
    await updateViewport(false);
    await expect(action).toBeVisible();
  };

  const next = page.getByRole("button", { name: "ถัดไป", exact: true });
  await typeWithKeyboard(field(page, "procedure-0"), next);
  await updateViewport(true, 1.25);
  await expect.poll(() => bar.evaluate((node) => Math.round(node.getBoundingClientRect().bottom))).toBe(720);
  await expect(next).toBeVisible();
  await updateViewport(false);

  await next.click();
  await page.getByRole("alertdialog").getByRole("button", { name: /AI ในระบบ/ }).click();
  await expect(page.getByRole("heading", { name: "ตรวจทานขั้นตอนปฏิบัติงาน" })).toBeVisible();
  await typeWithKeyboard(page.locator("#purpose"), page.getByRole("button", { name: "สร้าง PDF", exact: true }));

  const photoSlot = page.getByRole("button", { name: "เพิ่มรูปภาพประกอบหัวข้อ 1", exact: true }).locator("..");
  const wideImage = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 200;
    const painter = canvas.getContext("2d")!;
    painter.fillRect(0, 0, 800, 200);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await photoSlot.locator("input[type=file]").setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: Buffer.from(wideImage, "base64") });
  await expect(page.getByRole("img", { name: "รูปภาพประกอบหัวข้อ 1", exact: true })).toBeVisible();
  await expect(page.locator("#procedure-step-1").getByRole("button", { name: "ลบรูปภาพ", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

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
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
  await importAnswer(page, "jsa-answer.json");
  // Step 1.2 has two hazards — numbered controls would read 1.1, 1.2, 2.1
  const row = page.locator("#jsa-step-0-s1");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/\b2\.1\b/);
});
