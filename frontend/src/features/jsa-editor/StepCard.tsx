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
        "rounded-[var(--radius)] border bg-white p-4 sm:p-5",
        incomplete ? "border-danger" : "border-line",
      )}
    >
      <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ขึ้น`}
            className="grid size-11 place-items-center rounded-md text-muted
                       hover:bg-raised hover:text-ink disabled:opacity-30
                       disabled:hover:bg-transparent"
          >
            <ChevronUp className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ลง`}
            className="grid size-11 place-items-center rounded-md text-muted
                       hover:bg-raised hover:text-ink disabled:opacity-30
                       disabled:hover:bg-transparent"
          >
            <ChevronDown className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total === 1}
            aria-label={`ลบขั้นตอนที่ ${index + 1}`}
            className="grid size-11 place-items-center rounded-md text-muted
                       hover:bg-danger-soft hover:text-danger-text
                       disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Trash2 className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Desktop/tablet-wide: a real 3-column table matching the printed PDF
          (ขั้นตอนการทำงาน / อันตรายที่อาจเกิดขึ้น / มาตรการป้องกัน/ควบคุม) — the
          procedure cell spans every hazard row, exactly like the PDF's merged
          left column. Below lg, there isn't room for 3 live text columns, so
          the stacked layout further down is used instead. */}
      <div
        className="mt-3 hidden overflow-hidden rounded-[var(--radius-sm)] border border-line lg:grid lg:grid-cols-[35%_1fr_1fr]"
      >
        <div
          style={{ gridRow: `span ${step.hazards.length}` }}
          className="border-r border-line p-3"
        >
          {/* EditorStep already prints this column's label once, above the
              whole step list — repeating it in every card read as noisy
              clutter, so it's screen-reader-only here (still needed for the
              label/input association) while the header row above carries it
              visually. */}
          <label
            htmlFor={`procedure-${index}`}
            className="sr-only"
          >
            ขั้นตอนการทำงาน
          </label>
          <AutoGrowTextarea
            id={`procedure-${index}`}
            minRows={2}
            maxRows={10}
            maxLength={PROCEDURE_MAX}
            value={step.procedure}
            onChange={(event) => patch({ procedure: event.target.value })}
            className="bg-white"
          />
          <label
            htmlFor={`details-${index}`}
            className="mt-3 block text-sm font-medium text-muted"
          >
            รายละเอียด
          </label>
          <AutoGrowTextarea
            id={`details-${index}`}
            minRows={2}
            maxRows={10}
            maxLength={DETAILS_MAX}
            value={step.details}
            onChange={(event) => patch({ details: event.target.value })}
            className="mt-1 bg-white"
          />
        </div>

        {step.hazards.map((hazard, hazardIndex) => (
          <Fragment key={hazardIndex}>
            <div
              className={cx(
                "border-r border-line bg-raised p-3",
                hazardIndex > 0 && "border-t",
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
                minRows={2}
                maxRows={8}
                maxLength={HAZARD_MAX}
                value={hazard.hazard}
                onChange={(event) =>
                  patchHazard(hazardIndex, { hazard: event.target.value })
                }
                className="bg-white"
              />
            </div>
            <div
              className={cx(
                "bg-raised p-3",
                hazardIndex > 0 && "border-t border-line",
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
                className="bg-white"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">พิมพ์หนึ่งมาตรการต่อบรรทัด</p>
                {step.hazards.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onRemoveHazard(hazardIndex)}
                    aria-label="ลบอันตรายนี้"
                    className="grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger-text"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          </Fragment>
        ))}

        <div
          style={{ gridColumn: "1 / -1" }}
          className="border-t border-line p-3"
        >
          <Button variant="outline" onClick={addHazard}>
            <Plus className="size-4" aria-hidden="true" />
            เพิ่มอันตราย
          </Button>
        </div>
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
            minRows={2}
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
                  minRows={2}
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
