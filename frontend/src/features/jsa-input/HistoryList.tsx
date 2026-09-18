/* Previously analysed jobs, kept on this PC only (see historyStore.ts)
 *
 * Sits below the input form on step 1. Renders nothing at all when there's no
 * history, so a first-time user still sees a clean single-purpose screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, History, Search, Trash2, X } from "lucide-react";

import { Button, ConfirmDialog, Input, UndoToast } from "../../components/ui";
import * as historyStore from "../../history";
import type { HistoryEntry } from "../../history";
import { formatThaiDate, isoFromDate } from "../../lib/thaidate";

// Below this many entries, scanning the list beats typing — the search box
// would just be one more control in the way
const SEARCH_THRESHOLD = 5;
// Past this many, the list scrolls in a fixed-height area instead of
// growing the page — roughly 5-6 rows' worth, so the whole list is still
// reachable without the page itself getting tall on a long history
const SCROLL_MAX_HEIGHT = "22rem";
const SCROLL_THRESHOLD = 6;
// Same undo window as EditorStep's step/hazard deletion
const UNDO_TIMEOUT_MS = 6000;

const UNTITLED = "JSA ไม่มีชื่องาน";

function entryTitle(entry: HistoryEntry): string {
  return entry.doc.header.work_activity.trim() || UNTITLED;
}

export function HistoryList({
  onOpen,
  onOpenProcedure,
}: {
  onOpen: (entry: HistoryEntry) => void;
  /** Open the entry's work procedure directly, skipping the JSA editor. Only
   * ever called for entries that have one — the badge that triggers it isn't
   * rendered otherwise. */
  onOpenProcedure: (entry: HistoryEntry) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => historyStore.list());
  const [query, setQuery] = useState("");
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
  const scrollable = matches.length > SCROLL_THRESHOLD;

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
    // The top divider only makes sense when this sits BELOW the form
    // (narrow/stacked layout) — from xl up, App.tsx places this as its own
    // side column next to the form instead (see its own comment for why xl,
    // not lg), where a rule implying "continued from above" would be wrong.
    <section className="mt-10 border-t border-line pt-6 xl:mt-0 xl:border-t-0 xl:pt-0">
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
        // Fixed-height scroll area once the list is long enough, rather than
        // an expand-in-place button — the whole list stays one scroll away
        // instead of growing the page under a long history. overflow-y-auto
        // only actually engages once content exceeds SCROLL_MAX_HEIGHT, so
        // this is a no-op below the threshold.
        <ul
          className="mt-3 grid list-none gap-0 overflow-y-auto p-0"
          style={scrollable ? { maxHeight: SCROLL_MAX_HEIGHT } : undefined}
        >
          <AnimatePresence initial={false}>
            {matches.map((entry, index) => (
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
                  // the rows below it ripple. Capped rather than per-index so
                  // a long list's stagger doesn't drag on for a full second.
                  delay: searching ? 0 : Math.min(index, 10) * 0.04,
                }}
                className="group grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line"
              >
                {/* The row button and the procedure badge share this cell so
                    the badge never competes with the title for width — at
                    360px its own grid column truncated the title to a useless
                    "เปลี่ยน mech…". Below sm the badge sits under the metadata
                    line; from sm up there's room for it inline. */}
                <div className="flex min-w-0 flex-col py-1 sm:flex-row sm:items-center sm:gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className="t-history-row min-w-0 rounded-md py-2 pl-2 pr-1 text-left"
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

                  {/* Its own button, a sibling of the row (never nested —
                      nested buttons are invalid HTML). It used to be an inert
                      <span> inside the row's metadata line, which made it a
                      lie: it advertised a second document but the click it sat
                      inside always landed on the JSA editor. Only rendered
                      when there IS a procedure — a "no procedure" marker on
                      every other row would be noise to flag the exception. */}
                  {entry.procedure ? (
                    <button
                      type="button"
                      onClick={() => onOpenProcedure(entry)}
                      aria-label={`เปิดขั้นตอนปฏิบัติงานของ ${entryTitle(entry)}`}
                      // Full 44px tap height below sm (always visible and
                      // touch-tapped there, like the delete button); compact
                      // once it moves inline on desktop hover targets.
                      className="ml-2 self-start whitespace-nowrap rounded-full bg-surface
                                 px-2.5 text-xs text-navy hover:bg-navy-soft
                                 focus-visible:outline-none focus-visible:ring-2
                                 focus-visible:ring-ring/50
                                 max-sm:flex max-sm:h-11 max-sm:items-center
                                 sm:ml-0 sm:self-auto sm:py-0.5"
                    >
                      + ขั้นตอนปฏิบัติงาน
                    </button>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => deleteEntry(entry)}
                  aria-label={`ลบ ${entryTitle(entry)}`}
                  // max-sm:size-11 — this button is a destructive action and,
                  // unlike on desktop (hover-gated, mouse-precise), it's
                  // always visible and touch-tapped below sm, so it gets the
                  // app's full 44px minimum there instead of icon-lg's
                  // stock 36px; desktop keeps the more compact hover size.
                  className="text-muted opacity-100 transition-opacity hover:text-danger max-sm:size-11 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

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
