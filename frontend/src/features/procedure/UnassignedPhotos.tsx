import { useState } from "react";
import { Button } from "../../components/ui";
import type { PhotoMap, StepPhoto } from "../../lib/pdf/layout";

/** Preserved after redrafting, but excluded from exports until a human pairs
 * each image with the new text. Never infer identity from printed numbers. */
export function UnassignedPhotos({ photos, targets, onChange }: {
  photos: PhotoMap;
  targets: { key: string; label: string }[];
  onChange: (key: string, photo: StepPhoto | null) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const pending = Object.entries(photos).filter(([key]) => key.startsWith("unassigned:"));
  if (!pending.length) return null;
  return <section className="mt-4 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
    <h2 className="font-semibold text-ink">รูปที่ต้องจับคู่ใหม่ ({pending.length})</h2>
    <p className="mt-1 text-sm text-muted">ร่างใหม่แล้ว รูปเหล่านี้ยังไม่ถูกใส่ในเอกสาร กรุณาเลือกข้อความที่ตรงกับภาพ</p>
    <ul className="mt-3 grid list-none gap-3 p-0">
      {pending.map(([key, photo]) => <li key={key} className="flex flex-wrap items-center gap-2">
        <img src={photo.data} alt="รูปเดิมที่รอจับคู่กับขั้นตอนใหม่" className="size-16 rounded-lg object-contain" />
        <select aria-label="เลือกขั้นตอนสำหรับรูปเดิม" value={choices[key] ?? ""}
          className="min-w-0 max-w-full flex-1 rounded-lg border border-line bg-white p-2 text-base"
          onChange={(e) => setChoices({ ...choices, [key]: e.target.value })}>
          <option value="">เลือกขั้นตอน…</option>
          {targets.filter((target) => !photos[target.key]).map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
        </select>
        <Button type="button" variant="outline" disabled={!choices[key] || !!photos[choices[key]]}
          onClick={() => { onChange(choices[key], photo); onChange(key, null); }}>ใช้รูปนี้</Button>
      </li>)}
    </ul>
  </section>;
}
