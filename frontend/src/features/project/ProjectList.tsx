/* Saved projects, on the โครงการ tab — HistoryList.tsx's counterpart
 *
 * Deliberately simpler than HistoryList: projects are few (capped at
 * MAX_PROJECTS) and each is opened as a whole, so one row = one button,
 * plus delete with the same undo window. Renders nothing when there are none.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, FolderKanban, Trash2 } from "lucide-react";

import { Button, UndoToast } from "../../components/ui";
import { fadeSwap } from "../../lib/motion";
import { formatThaiDate, isoFromDate } from "../../lib/thaidate";
import * as projectStore from "../../projects";
import type { ProjectEntry } from "../../projects";

const UNDO_TIMEOUT_MS = 6000;

function title(entry: ProjectEntry) {
  return entry.project.name.trim() || "โครงการไม่มีชื่อ";
}

export function ProjectList({ onOpen }: { onOpen: (entry: ProjectEntry) => void }) {
  const [entries, setEntries] = useState<ProjectEntry[]>(() => projectStore.list());
  const [undoEntry, setUndoEntry] = useState<ProjectEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const remove = (entry: ProjectEntry) => {
    projectStore.remove(entry.id);
    setEntries(projectStore.list());
    setUndoEntry(entry);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoEntry(null), UNDO_TIMEOUT_MS);
  };

  const undo = () => {
    if (!undoEntry) return;
    projectStore.restore(undoEntry);
    setEntries(projectStore.list());
    setUndoEntry(null);
  };

  const toast = <UndoToast open={!!undoEntry} message="ลบโครงการแล้ว" onUndo={undo} />;
  if (entries.length === 0) return undoEntry ? toast : null;

  return (
    <motion.section {...fadeSwap} className="mt-6 flex flex-col border-t border-line pt-4 xl:mt-0 xl:border-t-0 xl:pt-0">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-navy">
        <FolderKanban className="size-5 shrink-0" aria-hidden="true" />
        โครงการที่บันทึกไว้
        <span className="text-sm font-normal text-muted">({entries.length})</span>
      </h2>

      <ul className="mt-3 grid list-none content-start gap-0 p-0">
        <AnimatePresence initial={false}>
          {entries.map((entry) => {
            const { phases } = entry.project;
            const reviewed = phases.filter((phase) => phase.jsa && phase.reviewed).length;
            return (
              <motion.li
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="group grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line py-1"
              >
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  aria-label={`เปิดโครงการ ${title(entry)}`}
                  className="t-history-row min-w-0 rounded-field py-2 pl-3 pr-1 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-medium text-ink group-hover:text-navy">{title(entry)}</span>
                    <ChevronRight className="t-history-chevron size-4 shrink-0 text-navy" aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">
                    {formatThaiDate(isoFromDate(new Date(entry.savedAt)))}
                    {` · ${phases.length} JSA · ตรวจแล้ว ${reviewed}`}
                    {entry.project.supervisor ? ` · ${entry.project.supervisor}` : ""}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => remove(entry)}
                  aria-label={`ลบโครงการ ${title(entry)}`}
                  className="text-muted opacity-100 transition-opacity hover:bg-danger-soft hover:text-danger-text max-sm:size-10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <p className="mt-4 text-sm text-muted">
        บันทึกไว้ในเครื่องนี้เท่านั้น (สูงสุด {projectStore.MAX_PROJECTS} โครงการล่าสุด)
      </p>
      {toast}
    </motion.section>
  );
}
