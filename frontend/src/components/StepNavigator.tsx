import { Button } from "./ui";

export function StepNavigator({ steps }: { steps: { id: string; label: string }[] }) {
  if (steps.length < 4) return null;
  return <nav aria-label="ไปยังขั้นตอนในเอกสาร" className="my-4 flex items-center gap-2">
    <label className="text-sm text-muted shrink-0" htmlFor="jump-to-step">ไปขั้นตอน</label>
    <select id="jump-to-step" value="" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
      onChange={(event) => {
        const target = document.getElementById(event.target.value);
        if (!target) return;
        target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" });
      }}>
      <option value="">เลือกขั้นตอน…</option>
      {steps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}
    </select>
    <Button type="button" variant="ghost" onClick={() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading) { heading.tabIndex = -1; heading.focus(); }
      window.scrollTo({ top: 0 });
    }}>ขึ้นบน</Button>
  </nav>;
}
