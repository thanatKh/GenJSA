/* The ใช้โมเดลภายนอก screen itself: copy is the main action and the prompt
 * stays folded away, a file can be dropped on the drop zone, and the check
 * button leads until the answer passes. */
import { expect, test } from "@playwright/test";
import { fillInput, fixture, mockApi } from "./helpers";
import { readFileSync } from "node:fs";

test("denied clipboard access selects the prompt after it opens", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
  }));
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();
  await page.getByRole("button", { name: "คัดลอกคำสั่ง" }).click();
  const prompt = page.locator("#personal-prompt");
  await expect(page.getByRole("status").filter({ hasText: "เลือกข้อความแล้ว" })).toBeVisible();
  await expect(prompt).toBeFocused();
  expect(await prompt.evaluate((field: HTMLTextAreaElement) => field.value.slice(field.selectionStart, field.selectionEnd)))
    .toBe(await prompt.inputValue());
});

test("the copy button confirms on itself, then goes back", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();

  const copy = page.getByRole("button", { name: "คัดลอกคำสั่ง" });
  const initialWidth = await copy.evaluate((button: HTMLElement) => button.offsetWidth);
  await copy.click();
  // The button itself says it worked …
  const done = page.getByRole("button", { name: "คัดลอกแล้ว" });
  await expect(done).toBeVisible();
  expect(await done.evaluate((button: HTMLElement) => button.offsetWidth)).toBe(initialWidth);
  // … and what was copied is the prompt
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("genjsa-jsa.json");
  // … then it returns to "คัดลอกคำสั่ง" by itself
  await expect(copy).toBeVisible({ timeout: 4000 });

  // Changing the prompt after copying never leaves a stale "copied"
  await copy.click();
  await expect(done).toBeVisible();
  const instructions = page.locator("#personal-instructions");
  await expect(instructions).toBeHidden();
  await page.getByRole("button", { name: "คำขอเพิ่มเติม (ไม่บังคับ)" }).click();
  await instructions.fill("เพิ่มเติม");
  await expect(copy).toBeVisible();
  await page.getByRole("button", { name: "คำขอเพิ่มเติม (มีข้อความแล้ว)" }).click();
  await expect(instructions).toBeHidden();
  await copy.click();
  await expect(done).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("เพิ่มเติม");
});

test("prompt folded, drop a file, check button leads", async ({ page }, info) => {
  if (info.project.name === "phone") await page.setViewportSize({ width: 320, height: 720 });
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้โมเดลภายนอก" }).click();

  const prepare = page.getByRole("region", { name: "1. เตรียมคำสั่ง" });
  const receive = page.getByRole("form", { name: "2. นำคำตอบกลับมา" });
  await expect(prepare).toBeVisible();
  await expect(receive).toBeVisible();
  const answer = receive.getByLabel("วางคำตอบจาก AI");
  const upload = receive.getByRole("button", { name: "เลือกไฟล์คำตอบ" });
  await expect(answer).toBeVisible();
  await expect(upload).toBeVisible();
  const left = (await prepare.boundingBox())!;
  const right = (await receive.boundingBox())!;
  const uploadBox = (await upload.boundingBox())!;
  const answerBox = (await answer.boundingBox())!;
  expect(uploadBox.height).toBeGreaterThanOrEqual(112);
  expect(uploadBox.width).toBeCloseTo(answerBox.width);
  expect(uploadBox.y + uploadBox.height).toBeLessThan(answerBox.y);
  if (info.project.name === "desktop") {
    expect(right.x).toBeGreaterThan(left.x + left.width);
    expect(Math.abs(right.y - left.y)).toBeLessThan(2);
  } else {
    expect(right.y).toBeGreaterThan(left.y + left.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "ไปที่ช่องคำตอบ", exact: true }).click();
    await expect(receive.getByRole("heading")).toBeFocused();
  }

  // The prompt is there but folded; the copy button is the main action
  await expect(page.locator("#personal-prompt")).toBeHidden();
  await expect(page.locator("#personal-prompt")).toHaveValue(/# หลักการร่าง JSA|ไล่ตรวจแหล่งอันตราย/);
  await page.getByRole("button", { name: "ดูคำสั่งที่จะคัดลอก" }).click();
  await expect(page.locator("#personal-prompt")).toBeVisible();

  // Each outside AI is a link that opens in a new tab, keeping this page as it is
  for (const [name, href] of [["ChatGPT", "https://chatgpt.com/"], ["Claude", "https://claude.ai/new"], ["Gemini", "https://gemini.google.com/app"]]) {
    const links = page.getByRole("link", { name, exact: true });
    await expect(links).toHaveCount(1); // next to the copy button
    await expect(links.first()).toHaveAttribute("href", href);
    await expect(links.first()).toHaveAttribute("target", "_blank");
  }

  const check = page.getByRole("button", { name: "ตรวจคำตอบ" });
  await expect(check).toBeDisabled();

  if (info.project.name === "desktop") {
    // Drop the answer file on the drop zone, as dragging it from Downloads would
    const text = readFileSync(fixture("jsa-answer.json"), "utf8");
    const dataTransfer = await page.evaluateHandle((content) => {
      const data = new DataTransfer();
      data.items.add(new File([content], "genjsa-jsa.json", { type: "application/json" }));
      return data;
    }, text);
    await upload.dispatchEvent("dragover", { dataTransfer });
    await expect(page.getByText(/วางไฟล์คำตอบที่นี่/)).toBeVisible();
    await upload.dispatchEvent("drop", { dataTransfer });
    await expect(page.getByText("genjsa-jsa.json", { exact: true })).toBeVisible();
    await expect(page.getByText("ตรวจรูปแบบผ่าน", { exact: true })).toBeVisible();
  } else {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), upload.tap()]);
    await chooser.setFiles(fixture("jsa-answer.json"));
  }

  // A good answer is checked straight away: the check button gives way to the next step
  await expect(page.getByRole("button", { name: "เปิดร่างเพื่อตรวจทาน" })).toBeVisible();
  await expect(check).toHaveCount(0);

  // Editing the answer brings the check back, enabled
  await page.locator("#personal-answer").fill('{"bad": true}');
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByText(/คำตอบไม่ครบหรือผิดรูปแบบ/)).toBeVisible();
});
