/* Previously analysed jobs, kept on this PC only (see historyStore.ts)
 *
 * Sits below the input form on step 1. Renders nothing at all when there's no
 * history, so a first-time user still sees a clean single-purpose screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, History, Search, Trash2, X } from "lucide-react";

import { Button, ConfirmDialog, Input, UndoToast } from "../../components/ui";
import * as historyStore from "../../history";
import type { HistoryEntry } from "../../history";
import { formatThaiDate, isoFromDate } from "../../lib/thaidate";

// Below this many entries, scanning the list beats typing — the search box
// would just be one more control in the way
const SEARCH_THRESHOLD = 5;
const COLLAPSED_COUNT = 5;
// Same undo window as EditorStep's step/hazard deletion
const UNDO_TIMEOUT_MS = 6000;

const UNTITLED = "JSA ไม่มีชื่องาน";

function entryTitle(entry: HistoryEntry): string {
  return entry.doc.header.work_activity.trim() || UNTITLED;
}

export function HistoryList({
  onOpen,
}: {
  onOpen: (entry: HistoryEntry) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => historyStore.list());
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [undoEntry, setUndoEntry] = useState<HistoryEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    // Thai has no case and no word boundaries, so plain substring matching is
    // the right primitive here — no tokenizer, no fuzzy library
    return entries.filter((entry) => {
      const { work_activity, supervisor, analyst } = entry.doc.header;
      return [work_activity, supervisor, analyst]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, query]);

  if (entries.length === 0) return null;

  const searching = query.trim().length > 0;
  // A search should show everything it found; the collapse only applies to the
  // full, unfiltered list
  const visible = searching || expanded ? matches : matches.slice(0, COLLAPSED_COUNT);
  const hiddenCount = matches.length - visible.length;

  const deleteEntry = (entry: HistoryEntry) => {
    historyStore.remove(entry.id);
    setEntries(historyStore.list());
    setUndoEntry(entry);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoEntry(null), UNDO_TIMEOUT_MS);
  };

  const undoDelete = () => {
    if (!undoEntry) return;
    historyStore.restore(undoEntry);
    setEntries(historyStore.list());
    setUndoEntry(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  const applyClear = () => {
    historyStore.clear();
    setEntries([]);
    setQuery("");
    setConfirmClear(false);
  };

  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-navy">
          <History className="size-5 shrink-0" aria-hidden="true" />
          งานที่เคยวิเคราะห์
        </h2>
        {/* default, not sm — this deletes up to MAX_ENTRIES saved JSAs at
            once (more consequential than EditorStep's "เริ่มใหม่", which was
            sized up to lg), so it shouldn't be the smallest button in the app */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirmClear(true)}
        >
          ล้างประวัติทั้งหมด
        </Button>
      </div>

      {entries.length >= SEARCH_THRESHOLD ? (
        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาจากชื่องาน หัวหน้างาน หรือผู้วิเคราะห์"
            aria-label="ค้นหางานที่เคยวิเคราะห์"
            className="pl-9 pr-9"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="ล้างคำค้นหา"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-navy"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-muted">ไม่พบรายการที่ค้นหา</p>
      ) : (
        <ul className="mt-3 grid list-none gap-0 p-0">
          <AnimatePresence initial={false}>
            {visible.map((entry, index) => (
              <motion.li
                key={entry.id}
                layout
                initial={{ opacity: 0, y: "var(--distance-base)" }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: "calc(var(--distance-medium) * -1)" }}
                transition={{
                  duration: 0.25,
                  ease: [0.22, 1, 0.36, 1],
                  // Stagger only on first paint; a deleted row must not make
                  // the rows below it ripple
                  delay: expanded || searching ? 0 : index * 0.04,
                }}
                className="group grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line"
              >
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="t-history-row min-w-0 rounded-md py-3 pl-2 pr-1 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-medium text-ink group-hover:text-navy">
                      {entryTitle(entry)}
                    </span>
                    <ChevronRight
                      className="t-history-chevron size-4 shrink-0 text-navy"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">
                    {formatThaiDate(isoFromDate(new Date(entry.savedAt)))}
                    {entry.doc.header.supervisor
                      ? ` · ${entry.doc.header.supervisor}`
                      : ""}
                    {` · ${entry.doc.steps.length} ขั้นตอน`}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => deleteEntry(entry)}
                  aria-label={`ลบ ${entryTitle(entry)}`}
                  className="text-muted opacity-100 transition-opacity hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 flex items-center gap-1 text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
          ดูเพิ่มอีก {hiddenCount} รายการ
        </button>
      ) : null}

      <p className="mt-4 text-sm text-muted">
        เก็บไว้ในเบราว์เซอร์ของเครื่องนี้ {historyStore.RETENTION_DAYS} วัน
        ไม่ถูกส่งขึ้นเซิร์ฟเวอร์
      </p>

      <UndoToast
        open={!!undoEntry}
        message="ลบรายการแล้ว"
        onUndo={undoDelete}
      />

      <ConfirmDialog
        open={confirmClear}
        title="ล้างประวัติทั้งหมด?"
        description={`ประวัติ ${entries.length} รายการในเครื่องนี้จะถูกลบและกู้คืนไม่ได้`}
        confirmLabel="ล้างประวัติ"
        onConfirm={applyClear}
        onCancel={() => setConfirmClear(false)}
      />
    </section>
  );
}
