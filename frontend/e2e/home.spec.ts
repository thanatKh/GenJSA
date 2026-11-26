import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test("home offers two document types and accepts a legacy job backup", async ({ page, isMobile }) => {
  await mockApi(page);
  if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const modes = page.getByRole("radiogroup", { name: "เอกสารที่ต้องการสร้าง" });
  const heading = page.getByRole("heading", { level: 1 });
  const description = page.getByRole("textbox", { name: "รายละเอียดงาน" });
  const [headingBox, modeBox, descriptionBox] = await Promise.all([
    heading.boundingBox(), modes.boundingBox(), description.boundingBox(),
  ]);
  expect(modeBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height);
  expect(descriptionBox!.y).toBeGreaterThan(modeBox!.y + modeBox!.height);
  await expect(modes.getByRole("radio")).toHaveCount(2);
  await modes.getByRole("radio", { name: "JSA", exact: true }).press("ArrowRight");
  const procedureMode = modes.getByRole("radio", { name: "JSA + ขั้นตอนปฏิบัติงาน" });
  await expect(procedureMode).toBeChecked();
  await procedureMode.press("Tab");
  await expect(description).toBeFocused();
  await expect(page.getByRole("button", { name: "โครงการ", exact: true })).toHaveCount(0);

  const doc = {
    header: { work_activity: "งานจากไฟล์สำรองเดิม", supervisor: "สมชาย", analysis_date: "2026-11-12", project: "" },
    steps: [{ no: 1, procedure: "เตรียมพื้นที่", hazards: [{ hazard: "พื้นลื่น", controls: ["ตรวจสภาพพื้น"] }] }],
  };
  const backup = {
    kind: "genjsa-backup", version: 1, createdAt: "2026-11-12", assets: [],
    entries: [{ id: "legacy-job", savedAt: 1, doc }],
  };
  const file = page.getByLabel("เลือกไฟล์สำรอง GenJSA");
  const upload = (projects: unknown[]) => file.setInputFiles({
    name: "genjsa-backup.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...backup, projects })),
  });

  await upload([{ id: "unsupported-project" }]);
  await expect(page.getByText("ไฟล์สำรองนี้มีข้อมูลโครงการ ซึ่ง GenJSA รุ่นนี้ไม่นำเข้า")).toBeVisible();
  await expect(page.getByText(doc.header.work_activity)).toHaveCount(0);
  await upload([]);
  await page.getByRole("button", { name: "นำเข้า", exact: true }).click();
  await expect(page.getByText(doc.header.work_activity, { exact: true })).toBeVisible();

  const formPanel = page.locator(".work-panel").filter({ has: modes });
  const historyPanel = page.locator(".work-panel").filter({
    has: page.getByRole("heading", { name: /งานที่เคยวิเคราะห์/ }),
  });
  await expect(formPanel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(historyPanel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 246, 250)");
  const formBox = (await formPanel.boundingBox())!;
  const historyBox = (await historyPanel.boundingBox())!;
  if (isMobile) {
    expect(historyBox.y).toBeGreaterThan(formBox.y + formBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } else {
    expect(historyBox.x).toBeGreaterThan(formBox.x + formBox.width);
    expect(historyBox.height).toBeLessThan(formBox.height / 2);
  }
});
