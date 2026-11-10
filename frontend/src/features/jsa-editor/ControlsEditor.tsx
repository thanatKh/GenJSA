import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AutoGrowTextarea, Button, UndoToast } from "../../components/ui";

/** Numbers are presentation only, matching buildJsaPdf/buildJsaDocx. Never
 * write them into the stored text or they will appear twice in exports. */
export function ControlsEditor({ id, controls, hazardIndex, multiple, onChange }: {
  id: string;
  controls: string[];
  hazardIndex: number;
  multiple: boolean;
  onChange: (controls: string[]) => void;
}) {
  const items = controls.length ? controls : [""];
  const latest = useRef(items);
  latest.current = items;
  const [deleted, setDeleted] = useState<{ text: string; index: number; only: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const focusItem = (index: number) => requestAnimationFrame(() => {
    document.getElementById(`${id}-${index}`)?.focus();
  });
  let number = 0;
  return (
    <div>
      <ol className="m-0 grid list-none gap-1 p-0" aria-label="มาตรการป้องกันและควบคุม">
        {items.map((control, index) => {
          if (control.trim()) number++;
          const prefix = control.trim() ? (multiple ? `${hazardIndex + 1}.${number}` : "–") : "–";
          return (
            <li key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)_2rem] items-start gap-0.5 rounded-md border-b border-line/60 pb-1 last:border-b-0">
              <span className="pt-1.5 text-sm font-medium tabular-nums text-navy" aria-hidden="true">{prefix}</span>
              <AutoGrowTextarea
                id={`${id}-${index}`}
                aria-label={`มาตรการข้อ ${index + 1} ของอันตรายที่ ${hazardIndex + 1}`}
                minRows={1}
                maxLength={4000}
                placeholder="ระบุมาตรการ"
                value={control}
                onChange={(event) => onChange(items.map((item, i) => i === index ? event.target.value : item))}
                className="rounded-none border-0 bg-transparent px-1 py-1.5 focus-visible:ring-inset"
              />
              <Button type="button" variant="ghost" size="icon-sm"
                className="mt-1 text-muted hover:bg-danger-soft hover:text-danger-text max-lg:min-h-10 max-lg:min-w-8"
                aria-label={`ลบมาตรการข้อ ${index + 1} ของอันตรายที่ ${hazardIndex + 1}`}
                onClick={() => {
                  setDeleted({ text: control, index, only: items.length === 1 });
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => setDeleted(null), 6000);
                  onChange(items.length > 1 ? items.filter((_, i) => i !== index) : [""]);
                  focusItem(Math.max(0, Math.min(index, items.length - 2)));
                }}>
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="ghost" size="sm" className="mt-1 max-lg:min-h-10"
        disabled={items.length + (deleted ? 1 : 0) >= 20}
        onClick={() => { onChange([...items, ""]); focusItem(items.length); }}>
        <Plus className="size-3.5" aria-hidden="true" />เพิ่มมาตรการ
      </Button>
      <UndoToast open={!!deleted} message="ลบมาตรการแล้ว" onUndo={() => {
        if (!deleted) return;
        const next = [...latest.current];
        if (deleted.only && next.length === 1 && !next[0].trim()) next[0] = deleted.text;
        else next.splice(Math.min(deleted.index, next.length), 0, deleted.text);
        onChange(next); setDeleted(null);
        if (timer.current) clearTimeout(timer.current);
        focusItem(deleted.index);
      }} />
    </div>
  );
}
