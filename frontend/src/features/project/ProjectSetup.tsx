/* Project Mode, step 1 — ข้อมูลโครงการ
 *
 * Everything a project's JSAs share: its name, the people, the company,
 * ข้อจำกัด/หมายเหตุ, the tag list, and the phases in the order they're done
 * (one JSA each). Edits the project directly — there is no separate form
 * state to fall out of step with it, and every keystroke is already in the
 * session draft (and, once the project has been saved, in projects.ts).
 */

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUp, Plus, RotateCcw, Trash2, X } from "lucide-react";

import {
  AutoGrowTextarea,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
} from "../../components/ui";
import type { CompanyLogo } from "../../lib/companyLogo";
import { listItem } from "../../lib/motion";
import type { ProjectDocument, ProjectPhase } from "../../lib/schema";
import { CompanySection } from "../company/CompanySection";
import { findProblems, hasContent, newPhase, withProject, type ProjectProblems } from "./projectModel";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line pt-5">
      <div>
        <h2 className="text-lg font-semibold text-navy">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ProjectSetup({
  project,
  onChange,
  onContinue,
  onStartNew,
  started,
  logo,
  onLogoChange,
}: {
  project: ProjectDocument;
  onChange: (next: ProjectDocument) => void;
  onContinue: () => void;
  onStartNew: () => void;
  /** The project has been saved before (its JSA list exists) */
  started: boolean;
  logo: CompanyLogo | null;
  onLogoChange: (logo: CompanyLogo | null) => void;
}) {
  // Problems only show once the user has tried to continue, then stay live
  const [checked, setChecked] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [removing, setRemoving] = useState<ProjectPhase | null>(null);
  const problems: ProjectProblems | null = checked ? findProblems(project) : null;

  // Stable on-screen identities for the reference rows (never saved), so
  // deleting a row animates that row out rather than the last one — same
  // approach as EditorStep's step keys
  const refKeys = useRef<string[]>([]);
  const refKeySeq = useRef(0);
  const newRefKey = () => `ref-${(refKeySeq.current += 1)}`;
  if (refKeys.current.length !== project.references.length) {
    refKeys.current = Array.from({ length: project.references.length }, newRefKey);
  }

  const update = (patch: Partial<ProjectDocument>) => onChange(withProject({ ...project, ...patch }));
  const updatePhase = (id: string, patch: Partial<ProjectPhase>) =>
    update({ phases: project.phases.map((phase) => (phase.id === id ? { ...phase, ...patch } : phase)) });
  const movePhase = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= project.phases.length) return;
    const phases = [...project.phases];
    [phases[index], phases[target]] = [phases[target], phases[index]];
    update({ phases });
  };
  const removePhase = (id: string) => update({ phases: project.phases.filter((phase) => phase.id !== id) });

  const submit = () => {
    setChecked(true);
    if (!findProblems(project)) {
      onContinue();
      return;
    }
    // Take the user to the first thing to fix
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>("[aria-invalid='true']");
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <section>
      <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ข้อมูลโครงการ</h1>
      <p className="mt-1.5 text-muted">
        งานใหญ่ที่แบ่งเป็นหลายขั้นตอน แต่ละขั้นตอนได้ JSA ของตัวเอง
      </p>

      <div className="mt-4 grid gap-4">
        <div>
          <Label htmlFor="project_name" required>
            ชื่อโครงการ
          </Label>
          <Input
            id="project_name"
            value={project.name}
            maxLength={300}
            placeholder="เช่น งานซ่อมแซมท่อทาง KBY 2569 — Liquid LPG 8&quot; ท่า 2"
            aria-invalid={!!problems?.name}
            onChange={(event) => update({ name: event.target.value })}
          />
          <FieldError>{problems?.name}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="project_supervisor" required>
              ชื่อหัวหน้างาน
            </Label>
            <Input
              id="project_supervisor"
              autoComplete="name"
              value={project.supervisor}
              aria-invalid={!!problems?.supervisor}
              onChange={(event) => update({ supervisor: event.target.value })}
            />
            <FieldError>{problems?.supervisor}</FieldError>
          </div>
          <div>
            <Label htmlFor="project_analyst">ผู้วิเคราะห์</Label>
            <Input
              id="project_analyst"
              autoComplete="name"
              value={project.analyst}
              onChange={(event) => update({ analyst: event.target.value })}
            />
          </div>
        </div>

        <CompanySection
          name={project.company}
          nameField={
            <Input
              id="company"
              autoComplete="organization"
              value={project.company}
              onChange={(event) => update({ company: event.target.value })}
            />
          }
          logo={logo}
          onLogoChange={onLogoChange}
        />

        <div>
          <Label htmlFor="project_notes">ข้อจำกัด / หมายเหตุ</Label>
          <AutoGrowTextarea
            id="project_notes"
            minRows={2}
            maxRows={8}
            maxLength={2000}
            placeholder="เช่น ข้อจำกัดจากการประชุม เวลาปิดท่า เงื่อนไขพื้นที่"
            value={project.notes}
            onChange={(event) => update({ notes: event.target.value })}
          />
          <p className="mt-1.5 text-sm text-muted">ระบบใช้เป็นข้อมูลประกอบตอนร่าง JSA ทุกขั้นตอน</p>
        </div>

        <Section
          title="รายการอ้างอิง"
          hint="วาล์ว / Blind / Tag ที่ใช้ในโครงการ กรอกครั้งเดียว ระบบใช้เลขตามนี้เท่านั้น ไม่คิดเลขขึ้นเอง"
        >
          <ul className="grid list-none gap-2 p-0">
            <AnimatePresence initial={false}>
              {project.references.map((ref, index) => (
                <motion.li
                  key={refKeys.current[index]}
                  {...listItem}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2"
                >
                  <Input
                    aria-label={`Tag รายการที่ ${index + 1}`}
                    placeholder="เช่น HSV-335"
                    value={ref.tag}
                    maxLength={100}
                    onChange={(event) =>
                      update({
                        references: project.references.map((r, i) =>
                          i === index ? { ...r, tag: event.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={`รายละเอียดรายการที่ ${index + 1}`}
                    placeholder="เช่น ปิด + 8&quot; Breather Blind"
                    value={ref.note}
                    maxLength={300}
                    onChange={(event) =>
                      update({
                        references: project.references.map((r, i) =>
                          i === index ? { ...r, note: event.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`ลบรายการที่ ${index + 1}`}
                    className="text-muted hover:text-danger-text"
                    onClick={() => {
                      refKeys.current = refKeys.current.filter((_, i) => i !== index);
                      update({ references: project.references.filter((_, i) => i !== index) });
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => {
              refKeys.current = [...refKeys.current, newRefKey()];
              update({ references: [...project.references, { tag: "", note: "" }] });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            เพิ่มรายการ
          </Button>
        </Section>

        <Section title="ขั้นตอนของโครงการ" hint="1 ขั้นตอน = 1 JSA เรียงตามลำดับที่ทำจริง">
          <ol className="grid list-none gap-3 p-0">
            <AnimatePresence initial={false}>
              {project.phases.map((phase, index) => {
                const issue = problems?.phases[phase.id];
                return (
                  <motion.li
                    key={phase.id}
                    layout
                    {...listItem}
                    className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-card border border-line p-3 sm:p-4"
                  >
                    <span className="mt-1.5 flex size-8 items-center justify-center rounded-full bg-navy-soft text-sm font-semibold text-navy">
                      {index + 1}
                    </span>
                    <div className="grid min-w-0 gap-2">
                      <div>
                        <Input
                          aria-label={`ชื่องานของขั้นตอนที่ ${index + 1}`}
                          placeholder="ชื่องาน เช่น ใส่ Blind 3 จุด และ N2 Purging"
                          value={phase.work}
                          maxLength={500}
                          aria-invalid={!!issue?.work}
                          onChange={(event) => updatePhase(phase.id, { work: event.target.value })}
                        />
                        <FieldError>{issue?.work}</FieldError>
                      </div>
                      {phase.jsa ? (
                        // The description only matters for drafting — once the
                        // JSA exists, the JSA is what gets edited
                        <p className="text-sm text-muted">
                          มี JSA แล้ว ({phase.jsa.steps.length} ขั้นตอน) — แก้ไขเนื้อหาได้ที่หน้า JSA แต่ละขั้นตอน
                        </p>
                      ) : (
                        <div>
                          <AutoGrowTextarea
                            aria-label={`รายละเอียดงานของขั้นตอนที่ ${index + 1}`}
                            placeholder="รายละเอียดงานของขั้นตอนนี้ ระบุสิ่งที่ทราบให้ครบ เช่น จุดที่ทำงาน อุปกรณ์ วาล์วที่เกี่ยวข้อง"
                            minRows={2}
                            maxRows={10}
                            maxLength={5000}
                            value={phase.description}
                            aria-invalid={!!issue?.description}
                            onChange={(event) => updatePhase(phase.id, { description: event.target.value })}
                          />
                          <FieldError>{issue?.description}</FieldError>
                        </div>
                      )}
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ขึ้น`}
                          disabled={index === 0}
                          onClick={() => movePhase(index, -1)}
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`เลื่อนขั้นตอนที่ ${index + 1} ลง`}
                          disabled={index === project.phases.length - 1}
                          onClick={() => movePhase(index, 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`ลบขั้นตอนที่ ${index + 1}`}
                          className="text-muted hover:bg-danger-soft hover:text-danger-text"
                          onClick={() => (phase.jsa ? setRemoving(phase) : removePhase(phase.id))}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
          <FieldError>{problems?.noPhases}</FieldError>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => update({ phases: [...project.phases, newPhase()] })}
          >
            <Plus className="size-4" aria-hidden="true" />
            เพิ่มขั้นตอน
          </Button>
        </Section>

        {problems ? (
          <p className="text-sm text-danger-text">กรุณากรอกช่องที่มีเครื่องหมายสีแดงให้ครบ</p>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={!hasContent(project)}
            onClick={() => setConfirmNew(true)}
            className="max-[359px]:px-3"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            เริ่มโครงการใหม่
          </Button>
          <Button type="button" size="lg" onClick={submit} className="max-[359px]:px-4">
            {started ? "ไป JSA แต่ละขั้นตอน" : "ถัดไป"}
            <ArrowRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmNew}
        title="เริ่มโครงการใหม่?"
        description={
          started
            ? "โครงการนี้ยังบันทึกอยู่ในรายการโครงการด้านล่าง เปิดกลับมาแก้ไขได้"
            : "ข้อมูลที่กรอกไว้จะถูกลบและกู้คืนไม่ได้"
        }
        confirmLabel="เริ่มโครงการใหม่"
        onConfirm={() => {
          setConfirmNew(false);
          setChecked(false);
          onStartNew();
        }}
        onCancel={() => setConfirmNew(false)}
      />

      <ConfirmDialog
        open={removing !== null}
        title="ลบขั้นตอนนี้?"
        description={`"${removing?.work || "ขั้นตอนนี้"}" มี JSA แล้ว JSA ของขั้นตอนนี้จะถูกลบด้วยและกู้คืนไม่ได้`}
        confirmLabel="ลบขั้นตอน"
        onConfirm={() => {
          if (removing) removePhase(removing.id);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
