import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers";

test("home offers two document types and accepts a legacy job backup", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const modes = page.getByRole("radiogroup", { name: "เอกสารที่ต้องการสร้าง" });
  await expect(modes.getByRole("radio")).toHaveCount(2);
  await modes.getByRole("radio", { name: "JSA", exact: true }).press("ArrowRight");
  await expect(modes.getByRole("radio", { name: "JSA + ขั้นตอนปฏิบัติงาน" })).toBeChecked();
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
});
