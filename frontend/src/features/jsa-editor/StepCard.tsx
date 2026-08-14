import { Fragment } from "react";
import { ChevronDown, ChevronUp, Plus, TriangleAlert, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { AutoGrowTextarea, Button } from "../../components/ui";
import type { JsaStep } from "../../lib/schema";

// Mirrors backend/app/models/jsa.py's per-field caps — keeps the editor from
// growing a document past what the backend would accept if it were ever
// re-validated (procedure/details/hazard max_length, controls joined by "\n").
const PROCEDURE_MAX = 2000;
const DETAILS_MAX = 4000;
const HAZARD_MAX = 1000;
// controls is a list[str] capped at 20 items server-side, joined here by "\n"
// for editing — 20 lines x ~200 chars/line is a generous per-line budget.
const CONTROLS_MAX = 20 * 200;

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// Desktop table only (lg:) — the field's own border/rounding/background is
// stripped so the grid cell's own border lines (drawn by the cell <div>s
// below) read as the table's grid, not a form field floating inside it —
// "true grid" rather than boxed inputs sitting in a loose layout.
//
// Deliberately no "grow" here: the cell <div> is already stretched to match
// its row's tallest sibling by CSS Grid itself (grid items stretch to their
// track height regardless of what's inside them), so this field doesn't
// need to grow to reach that height too. It used to, and the field's own
// "+ เพิ่มอันตราย"/"ลบอันตรายนี้" button — sitting right after it in the same
// flex column — got dragged down with it, stranding the button far below a
// short field with a large dead gap between them. Without grow, the field
// keeps its natural height, the button sits right under it, and any leftover
// row height just trails as blank space at the bottom of the cell instead.
//
// p-1.5 — not p-0 — even though the cell <div> already has its own p-2:
// without it, text sat flush against the cell's own edge with no breathing
// room of its own, on top of whatever focus treatment the cell applies.
//
// focus-visible:ring-0 cancels the generated Textarea's own
// focus-visible:ring-2 — CELL_FOCUS_WITHIN below already draws a ring on the
// cell, so without this every field showed two: the cell's outline plus this
// field's own ring nested inside it.
const CELL_INPUT = "rounded-none border-0 bg-transparent p-1.5 focus-visible:ring-0";

// Focus lives on the CELL, not the field inside it — an outline drawn right
// on the cell's own border, like Excel's selection rectangle sitting on the
// gridline, rather than a ring inset within the field's padding. Negative
// offset keeps it from bleeding a pixel into the neighboring cell; z-10
// keeps it painted above that neighbor's edge rather than under it.
const CELL_FOCUS_WITHIN =
  "focus-within:relative focus-within:z-10 focus-within:bg-cyan-soft " +
  "focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring";

export function StepCard({
  step,
  index,
  total,
  incomplete = false,
  onChange,
  onRemove,
  onRemoveHazard,
  onMove,
}: {
  step: JsaStep;
  index: number;
  total: number;
  incomplete?: boolean;
  onChange: (next: JsaStep) => void;
  onRemove: () => void;
  onRemoveHazard: (hazardIndex: number) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const patch = (partial: Partial<JsaStep>) => onChange({ ...step, ...partial });

  const patchHazard = (hazardIndex: number, partial: Partial<JsaStep["hazards"][number]>) => {
    const hazards = step.hazards.map((hz, i) =>
      i === hazardIndex ? { ...hz, ...partial } : hz,
    );
    patch({ hazards });
  };

  const addHazard = () =>
    patch({ hazards: [...step.hazards, { hazard: "", controls: [""] }] });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cx(
        // Below lg: unchanged standalone card. On lg: the frame around <ul>
        // in EditorStep.tsx owns the border/rounding, and every card becomes
        // one row of a continuous table — only a top divider remains (skipped
        // on the first row), so a 6-step JSA reads as one sheet, not 6 boxes.
        "rounded-[var(--radius)] border bg-white p-3 sm:p-4",
        incomplete ? "border-danger" : "border-line",
        "lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-transparent lg:p-0 lg:border-line",
        index === 0 && "lg:border-t-0",
      )}
    >
      {/* Mobile/tablet header — step number, incomplete flag, move/delete.
          Hidden on lg: the desktop table below carries a compact version of
          the same controls inside the procedure cell instead, since a full
          44px-tall header row per step is the single biggest cost in the old
          layout and the number/controls fit far more cheaply merged into the
          content column. */}
      <div className="flex items-center gap-2 lg:hidden">
        <span className="flex size-7 items-center justify-center rounded-full bg-navy-soft text-sm font-semibold text-navy">
          {index + 1}
        </span>
        <h3 className="font-display font-semibold text-ink">
          ขั้นตอนที่ {index + 1}
        </h3>
        {incomplete ? (
          <span
            className="flex items-center gap-1 text-sm font-medium text-danger-text"
            title="ยังไม่ได้กรอกขั้นตอนการทำงาน"
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">ยังไม่ครบ</span>
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {/* ปุ่มเลื่อนขึ้น/ลง ใช้ได้ทั้งคีย์บอร์ดและมือถือ — ลากด้วยนิ้วบนจอเล็กทำยาก */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ขึ้น`}
            className="text-muted"
          >
            <ChevronUp className="size-5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ลง`}
            className="text-muted"
          >
            <ChevronDown className="size-5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={total === 1}
            aria-label={`ลบขั้นตอนที่ ${index + 1}`}
            className="text-muted hover:bg-danger-soft hover:text-danger-text"
          >
            <Trash2 className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Desktop/tablet-wide: a real 4-column table matching the printed PDF
          (row number / ขั้นตอนการทำงาน / อันตรายที่อาจเกิดขึ้น /
          มาตรการป้องกัน/ควบคุม) — the row-number and procedure cells each span
          every hazard row, exactly like the PDF's merged left column. Below
          lg, there isn't room for live text columns at all, so the stacked
          layout further down is used instead. */}
      <div
        className="mt-3 hidden overflow-hidden lg:mt-0 lg:grid lg:grid-cols-[3rem_35%_1fr_1fr]"
      >
        {/* Row-number gutter, Excel-style — shaded like a row header (never
            editable, so unlike the data cells it's fine — expected, even —
            for this one to read as chrome rather than content). Move/delete
            live here too now, stacked below the number — freeing the
            procedure cell to start right at its own text, and keeping every
            per-step control in one place instead of split across columns. */}
        <div
          style={{ gridRow: `span ${step.hazards.length}` }}
          className={cx(
            "flex flex-col items-center gap-1 border-r border-line pt-2 pb-2",
            incomplete ? "bg-danger-soft" : "bg-raised",
          )}
        >
          <h3 className="sr-only">ขั้นตอนที่ {index + 1}</h3>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-soft text-xs font-semibold text-navy">
            {index + 1}
          </span>
          {incomplete ? (
            <span title="ยังไม่ได้กรอกขั้นตอนการทำงาน">
              <TriangleAlert
                className="size-4 shrink-0 text-danger-text"
                aria-hidden="true"
              />
            </span>
          ) : null}
          <div className="mt-1 flex flex-col items-center gap-0.5">
            {/* hover:bg-white overrides ghost's default hover:bg-raised —
                this gutter's own background already is bg-raised (or
                bg-danger-soft), so the stock ghost hover would be invisible */}
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ขึ้น`}
              className="text-muted hover:bg-white hover:text-ink"
            >
              <ChevronUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ลง`}
              className="text-muted hover:bg-white hover:text-ink"
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={onRemove}
              disabled={total === 1}
              aria-label={`ลบขั้นตอนที่ ${index + 1}`}
              // hover:bg-white, not the usual hover:bg-danger-soft — this
              // gutter's own background is already bg-danger-soft whenever
              // the step is incomplete, so that hover was invisible exactly
              // when this button was most likely to get used
              className="text-muted hover:bg-white hover:text-danger-text"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div
          style={{ gridRow: `span ${step.hazards.length}` }}
          className={cx(
            "flex flex-col border-r border-line p-2",
            incomplete ? "bg-danger-soft" : "bg-white",
            CELL_FOCUS_WITHIN,
          )}
        >
          <label
            htmlFor={`procedure-${index}`}
            className="sr-only"
          >
            ขั้นตอนการทำงาน
          </label>
          <AutoGrowTextarea
            id={`procedure-${index}`}
            minRows={1}
            maxRows={10}
            maxLength={PROCEDURE_MAX}
            value={step.procedure}
            onChange={(event) => patch({ procedure: event.target.value })}
            className={CELL_INPUT}
          />
          <label
            htmlFor={`details-${index}`}
            className="mt-2 block text-sm font-medium text-muted"
          >
            รายละเอียด
          </label>
          <AutoGrowTextarea
            id={`details-${index}`}
            minRows={1}
            maxRows={10}
            maxLength={DETAILS_MAX}
            value={step.details}
            onChange={(event) => patch({ details: event.target.value })}
            className={cx("mt-1", CELL_INPUT)}
          />
        </div>

        {step.hazards.map((hazard, hazardIndex) => (
          <Fragment key={hazardIndex}>
            <div
              className={cx(
                "flex flex-col border-r border-line bg-white p-2",
                hazardIndex > 0 && "border-t",
                CELL_FOCUS_WITHIN,
              )}
            >
              <label
                htmlFor={`hazard-${index}-${hazardIndex}`}
                className="sr-only"
              >
                อันตรายที่อาจเกิดขึ้น
              </label>
              <AutoGrowTextarea
                id={`hazard-${index}-${hazardIndex}`}
                minRows={1}
                maxRows={8}
                maxLength={HAZARD_MAX}
                value={hazard.hazard}
                onChange={(event) =>
                  patchHazard(hazardIndex, { hazard: event.target.value })
                }
                className={CELL_INPUT}
              />
              {/* "เพิ่มอันตราย" lives in the hazard column, on the last row —
                  mirrors ลบอันตรายนี้ sitting in the controls column beside
                  it, rather than a detached full-width row under the table.
                  mt-auto (not mt-1) anchors it to the bottom of the cell
                  instead of hugging short hazard text — this row's height is
                  set by whichever of hazard/controls is taller, so without
                  mt-auto the two buttons end up at different heights
                  whenever one column has more text than the other. */}
              {hazardIndex === step.hazards.length - 1 ? (
                <div className="mt-auto flex justify-start pt-1">
                  <Button variant="ghost" size="sm" onClick={addHazard}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    เพิ่มอันตราย
                  </Button>
                </div>
              ) : null}
            </div>
            <div
              className={cx(
                "flex flex-col bg-white p-2",
                hazardIndex > 0 && "border-t border-line",
                CELL_FOCUS_WITHIN,
              )}
            >
              <label
                htmlFor={`controls-${index}-${hazardIndex}`}
                className="sr-only"
              >
                มาตรการป้องกัน/ควบคุม
              </label>
              <AutoGrowTextarea
                id={`controls-${index}-${hazardIndex}`}
                minRows={2}
                maxRows={10}
                maxLength={CONTROLS_MAX}
                // One line = one control — easier for users to manage than adding fields one at a time
                value={hazard.controls.join("\n")}
                onChange={(event) =>
                  patchHazard(hazardIndex, {
                    controls: event.target.value.split("\n"),
                  })
                }
                className={CELL_INPUT}
              />
              {step.hazards.length > 1 ? (
                <div className="mt-auto flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    onClick={() => onRemoveHazard(hazardIndex)}
                    aria-label="ลบอันตรายนี้"
                    className="shrink-0 text-muted hover:bg-danger-soft hover:text-danger-text"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Mobile/narrow tablet: stacked fields (no room for 3 live columns) */}
      <div className="mt-3 grid gap-3 lg:hidden">
        <div>
          <label
            htmlFor={`procedure-m-${index}`}
            className="text-sm font-medium text-muted"
          >
            ขั้นตอนการทำงาน
          </label>
          <AutoGrowTextarea
            id={`procedure-m-${index}`}
            minRows={1}
            maxRows={6}
            maxLength={PROCEDURE_MAX}
            value={step.procedure}
            onChange={(event) => patch({ procedure: event.target.value })}
            className="mt-1"
          />
        </div>

        <div>
          <label
            htmlFor={`details-m-${index}`}
            className="text-sm font-medium text-muted"
          >
            รายละเอียด
          </label>
          <AutoGrowTextarea
            id={`details-m-${index}`}
            minRows={1}
            maxRows={8}
            maxLength={DETAILS_MAX}
            value={step.details}
            onChange={(event) => patch({ details: event.target.value })}
            className="mt-1"
          />
        </div>

        {step.hazards.map((hazard, hazardIndex) => (
          <div
            key={hazardIndex}
            className="rounded-[var(--radius-sm)] border border-line bg-raised p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`hazard-m-${index}-${hazardIndex}`}
                  className="text-sm font-medium text-muted"
                >
                  อันตรายที่อาจเกิดขึ้น
                </label>
                <AutoGrowTextarea
                  id={`hazard-m-${index}-${hazardIndex}`}
                  minRows={1}
                  maxRows={6}
                  maxLength={HAZARD_MAX}
                  value={hazard.hazard}
                  onChange={(event) =>
                    patchHazard(hazardIndex, { hazard: event.target.value })
                  }
                  className="mt-1 bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor={`controls-m-${index}-${hazardIndex}`}
                  className="text-sm font-medium text-muted"
                >
                  มาตรการป้องกัน/ควบคุม
                </label>
                <AutoGrowTextarea
                  id={`controls-m-${index}-${hazardIndex}`}
                  minRows={2}
                  maxRows={8}
                  maxLength={CONTROLS_MAX}
                  value={hazard.controls.join("\n")}
                  onChange={(event) =>
                    patchHazard(hazardIndex, {
                      controls: event.target.value.split("\n"),
                    })
                  }
                  className="mt-1 bg-white"
                />
                <p className="mt-1 text-xs text-muted">พิมพ์หนึ่งมาตรการต่อบรรทัด</p>
              </div>
            </div>

            {step.hazards.length > 1 ? (
              <div className="mt-2 flex justify-end">
                <Button variant="destructive" onClick={() => onRemoveHazard(hazardIndex)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  ลบอันตรายนี้
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        <div>
          <Button variant="outline" onClick={addHazard}>
            <Plus className="size-4" aria-hidden="true" />
            เพิ่มอันตราย
          </Button>
        </div>
      </div>
    </motion.li>
  );
}
