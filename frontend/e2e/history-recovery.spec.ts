import { expect, test } from "@playwright/test";
import { field, fillInput, mockApi } from "./helpers";

const KEY = "genjsa.history.v1";
const job = (id: number) => ({
  id: `job-${id}`,
  savedAt: id,
  doc: {
    header: { work_activity: `งานเดิม ${id}`, supervisor: "ผู้ทดสอบ", analysis_date: "2026-11-26" },
    steps: [{ no: 1, procedure: "ตรวจพื้นที่", hazards: [{ hazard: "พื้นลื่น", controls: ["ตรวจสภาพพื้น"] }] }],
  },
});

test("editing the same JSA in two tabs preserves both versions", async ({ page, context }) => {
  await context.addInitScript(({ key, entry }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ v: 1, entries: [entry] }));
  }, { key: KEY, entry: job(1) });
  const other = await context.newPage();
  await mockApi(page);
  await mockApi(other);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await page.getByRole("button", { name: /เปิด JSA.*งานเดิม 1/ }).click();
  await other.getByRole("button", { name: /เปิด JSA.*งานเดิม 1/ }).click();
  await page.locator("#work_activity").fill("แก้ชื่องานในแท็บแรก");

  const entries = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).entries, KEY);
  await expect.poll(async () => (await entries())[0].doc.header.work_activity).toBe("แก้ชื่องานในแท็บแรก");

  await field(other, "procedure-0").fill("แก้ขั้นตอนในแท็บที่สอง");
  const copy = other.getByRole("button", { name: "บันทึกเป็นสำเนา" });
  await expect(copy).toBeVisible();
  await other.reload();
  await expect(copy).toBeVisible();
  expect((await entries())[0].doc.steps[0].procedure).toBe("ตรวจพื้นที่");

  await copy.click();
  await expect(other.getByText("บันทึกในเบราว์เซอร์นี้แล้ว", { exact: true })).toBeVisible();
  const both = await entries();
  expect(both).toHaveLength(2);
  expect(both.find((entry: ReturnType<typeof job>) => entry.id === "job-1").doc.header.work_activity).toBe("แก้ชื่องานในแท็บแรก");
  expect(both.find((entry: ReturnType<typeof job>) => entry.id !== "job-1").doc.steps[0].procedure).toBe("แก้ขั้นตอนในแท็บที่สอง");
});

for (const reason of ["quota", "100-job limit"] as const) {
  test(`a failed save at the ${reason} keeps all existing jobs`, async ({ page }) => {
    const count = reason === "quota" ? 2 : 100;
    await page.addInitScript(({ key, entries, reason }) => {
      sessionStorage.setItem("audit-limit", "true");
      localStorage.setItem(key, JSON.stringify({ v: 1, entries }));
      if (reason === "quota") {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, value) {
          if (this === localStorage && k === key && sessionStorage.getItem("audit-limit") &&
              JSON.parse(value).entries.length > entries.length) {
            throw new DOMException("Simulated quota", "QuotaExceededError");
          }
          setItem.call(this, k, value);
        };
      }
    }, { key: KEY, entries: Array.from({ length: count }, (_, i) => job(i)), reason });
    await mockApi(page);
    await fillInput(page);
    await page.getByRole("button", { name: "สร้างเอกสาร" }).click();
    const retry = page.getByRole("button", { name: "ลองบันทึกอีกครั้ง" });
    await expect(retry).toBeVisible();
    const ids = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).entries.map((entry: { id: string }) => entry.id), KEY);
    expect(await ids()).toEqual(Array.from({ length: count }, (_, i) => `job-${i}`));
    await expect(field(page, "procedure-0")).toBeVisible();

    if (reason === "quota") {
      await page.evaluate(() => sessionStorage.removeItem("audit-limit"));
      await retry.click();
      await expect(page.getByText("บันทึกในเบราว์เซอร์นี้แล้ว", { exact: true })).toBeVisible();
      expect(await ids()).toEqual(expect.arrayContaining(["job-0", "job-1"]));
      expect(await ids()).toHaveLength(3);
    }
  });
}
