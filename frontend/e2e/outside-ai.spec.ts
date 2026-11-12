/* The ใช้ AI ภายนอก screen itself: copy is the main action and the prompt
 * stays folded away, a file can be dropped on the drop zone, and the check
 * button leads until the answer passes. */
import { expect, test } from "@playwright/test";
import { fillInput, fixture, mockApi } from "./helpers";
import { readFileSync } from "node:fs";

test("prompt folded, drop a file, check button leads", async ({ page }, info) => {
  await mockApi(page);
  await fillInput(page);
  await page.getByRole("button", { name: "ใช้ AI ภายนอก" }).click();

  // The prompt is there but folded; the copy button is the main action
  await expect(page.locator("#personal-prompt")).toBeHidden();
  await expect(page.locator("#personal-prompt")).toHaveValue(/# หลักการร่าง JSA|ไล่ตรวจแหล่งอันตราย/);
  await page.getByText("ดูคำสั่งที่จะส่ง").click();
  await expect(page.locator("#personal-prompt")).toBeVisible();

  // Each outside AI is a link that opens in a new tab, keeping this page as it is
  for (const [name, href] of [["ChatGPT", "https://chatgpt.com/"], ["Claude", "https://claude.ai/new"], ["Gemini", "https://gemini.google.com/app"]]) {
    const links = page.getByRole("link", { name, exact: true });
    await expect(links).toHaveCount(2); // in the intro, and next to the copy button
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
    const zone = page.getByText(/ลากไฟล์คำตอบ .* มาวางที่นี่/);
    await zone.dispatchEvent("dragover", { dataTransfer });
    await zone.dispatchEvent("drop", { dataTransfer });
    await expect(page.getByText("นำเข้าไฟล์ genjsa-jsa.json แล้ว")).toBeVisible();
  } else {
    await page.getByLabel("เลือกไฟล์คำตอบจาก AI").setInputFiles(fixture("jsa-answer.json"));
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
