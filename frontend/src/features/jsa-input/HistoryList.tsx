/* Previously analysed jobs, kept on this PC only (see historyStore.ts)
 *
 * Sits below the input form on step 1. Renders nothing at all when there's no
 * history, so a first-time user still sees a clean single-purpose screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight,
  FileText,
  History,
  ListOrdered,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button, ConfirmDialog, Input, UndoToast } from "../../components/ui";
import { fadeSwap, FADE_IN_CLASS } from "../../lib/motion";
import * as historyStore from "../../history";
import type { HistoryEntry } from "../../history";
import { formatThaiDate, isoFromDate } from "../../lib/thaidate";

// Below this many entries, scanning the list beats typing — the search box
// would just be one more control in the way
const SEARCH_THRESHOLD = 5;
// Past this many, the list scrolls instead of growing the page — stacked
// below the form (below xl), there's no second column to size against, so a
// fixed 22rem cap (below, as the literal Tailwind class "max-h-[22rem]" — see
// its own comment for why it can't be this constant) is still the right call
// there: roughly 5-6 rows' worth, so the whole list stays reachable without
// the page itself getting tall on a long history. From xl up this cap is
// overridden (xl:max-h-none) — App.tsx's grid stretches this component's own
// <section> to the form's full height, and the list grows to fill it
// (xl:flex-1 + xl:min-h-0) instead.
const SCROLL_THRESHOLD = 6;
// Same undo window as EditorStep's step/hazard deletion
const UNDO_TIMEOUT_MS = 6000;

const UNTITLED = "JSA ไม่มีชื่องาน";

// The two "open this document" buttons on each row — tinted so they read as
// controls, not one more line of the row's metadata
// (border-transparent: same box as the dashed "create" button beside it, so
// every row is the same height)
const docButton =
  "flex min-w-0 items-center gap-1.5 rounded-full border border-transparent bg-navy-soft px-2.5 py-2 text-xs " +
  "font-medium text-navy hover:bg-navy-soft/70 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring/50";

function entryTitle(entry: HistoryEntry): string {
  return entry.doc.header.work_activity.trim() || UNTITLED;
}

export function HistoryList({
  onOpen,
  onOpenProcedure,
  onCreateProcedure,
}: {
  onOpen: (entry: HistoryEntry) => void;
  /** Open the entry's work procedure directly, skipping the JSA editor. Only
   * ever called for entries that have one. */
  onOpenProcedure: (entry: HistoryEntry) => void;
  /** Draft a work procedure for an entry that doesn't have one yet — the
   * same AI call as the button on the JSA PDF page, started from here. */
  onCreateProcedure: (entry: HistoryEntry) => void;
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
      const { work_activity, supervisor, analyst, company } = entry.doc.header;
      return [work_activity, supervisor, analyst, company]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, query]);

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

  const undoToast = <UndoToast open={!!undoEntry} message="ลบรายการแล้ว" onUndo={undoDelete} />;

  // Nothing to list: render nothing — except while the last entry's undo is
  // still on offer. The toast lives in this component, so returning null
  // here used to take it down too: deleting your only (or last) job left no
  // way to undo it.
  if (entries.length === 0) return undoEntry ? undoToast : null;

  return (
    // The top divider only makes sense when this sits BELOW the form
    // (narrow/stacked layout) — from xl up, App.tsx places this as its own
    // side column next to the form instead (see its own comment for why xl,
    // not lg), where a rule implying "continued from above" would be wrong.
    //
    // xl:flex xl:h-full xl:flex-col — App.tsx's grid stretches this
    // component's grid cell to the form's full height; without becoming a
    // flex column itself and claiming that height, the <section> would just
    // sit at its own content's height inside a taller, mostly-empty cell,
    // which looks identical to the bug this is fixing. The scrollable <ul>
    // below is the one piece that grows (flex-1 + min-h-0) — header, search
    // box and footer note all keep their natural height.
    <motion.section {...fadeSwap} className="mt-6 flex flex-col border-t border-line pt-4 xl:mt-0 xl:h-full xl:border-t-0 xl:pt-0">
      {/* flex-wrap: on a 320px phone the title + count and ล้างประวัติทั้งหมด
          don't fit one line — the button drops below instead of the title
          breaking in two */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 whitespace-nowrap text-lg font-semibold text-navy">
          <History className="size-5 shrink-0" aria-hidden="true" />
          งานที่เคยวิเคราะห์
          {/* How many there are — the list below scrolls inside itself, so
              without this a long history looks like just its first rows */}
          <span className="text-sm font-normal text-muted">({entries.length})</span>
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
        <div className={`relative mt-4 ${FADE_IN_CLASS}`}>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่องาน หัวหน้างาน ผู้วิเคราะห์ หรือบริษัท"
            aria-label="ค้นหางานที่เคยวิเคราะห์"
            className="pl-9 pr-9"
          />
          {/* Used to be a bare {searching ? <button> : null} — appeared and
              vanished with no transition at all, which read as a layout
              glitch next to the search icon that's always there. Fade+scale
              (transitions.dev's tooltip-appear shape — a small transient
              affordance near an input, not a full icon swap) on the same
              --duration-quick/--ease-smooth-out tokens the rest of the app's
              motion already uses. exit uses AnimatePresence so unmounting is
              animated too, not just the mount.
              Vertical centering moved from the Tailwind -translate-y-1/2
              class (used everywhere else in this file, e.g. the Search icon
              above) to Motion's own y: "-50%" — Motion's animate prop writes
              the element's whole `transform`, so a static Tailwind translate
              class here would simply be clobbered by whatever `scale` Motion
              computes, snapping the button off-center for the animation's
              duration. Keeping both the resting translate AND the animated
              scale in the same `animate`/`exit`/`initial` objects is what
              keeps centering correct through every frame. */}
          <AnimatePresence>
            {searching ? (
              <motion.button
                type="button"
                onClick={() => setQuery("")}
                aria-label="ล้างคำค้นหา"
                initial={{ opacity: 0, scale: 0.98, y: "-50%" }}
                animate={{ opacity: 1, scale: 1, y: "-50%" }}
                exit={{ opacity: 0, scale: 0.98, y: "-50%" }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-2 top-1/2 flex size-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-navy"
              >
                <X className="size-4" aria-hidden="true" />
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-muted">ไม่พบรายการที่ค้นหา</p>
      ) : (
        // Fixed-height scroll area once the list is long enough, rather than
        // an expand-in-place button — the whole list stays one scroll away
        // instead of growing the page under a long history. overflow-y-auto
        // only actually engages once content exceeds the 22rem cap below, so
        // this is a no-op below the threshold.
        //
        // The cap is a literal Tailwind class ("max-h-[22rem]"), not an
        // inline style — Tailwind's static scanner needs the exact class
        // string present in source to generate its CSS, so this can't be
        // built from a JS constant at runtime (a template-interpolated class
        // like `max-h-[${SOME_CONST}]` would never match anything; no CSS
        // rule gets generated for it at build time). An inline style would
        // work for the base case but always beat xl:max-h-none on
        // specificity, which needs to win once xl's flex layout takes over.
        // xl:flex-1 xl:max-h-none: at xl the <section> is already stretched
        // to the form's height (see its own comment), so here the list
        // should grow to fill whatever's left under the header/search box
        // rather than stop at the same cap used in the stacked, below-xl
        // layout. min-h-0 is required for a flex child to actually shrink
        // below its content size — without it flex-1 alone would let this
        // <ul> overflow the section instead of scrolling.
        //
        // content-start: once xl:flex-1 makes this grid taller than its rows
        // (a short history next to a tall form), a grid's default
        // align-content: stretch hands that extra height to the rows
        // themselves — every entry gets a big empty strip under it. This
        // keeps rows at their natural height and leaves the spare space as
        // one block at the bottom instead.
        <ul
          className={[
            "mt-3 grid content-start list-none gap-0 overflow-y-auto p-0",
            // 24rem, not 22: 22rem fit exactly three rows on a phone, so no
            // part of a fourth peeked out and the list read as complete
            scrollable ? "max-h-[24rem] overscroll-contain" : "",
            "xl:min-h-0 xl:flex-1 xl:max-h-none",
          ].join(" ")}
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
                className="group border-b border-line py-1"
              >
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className="t-history-row min-w-0 rounded-field py-2 pl-3 pr-1 text-left"
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
                      {/* Supervisor last: this line truncates at the end, and a
                          long name (rank + title + name) used to push the step
                          count out of view */}
                      {formatThaiDate(isoFromDate(new Date(entry.savedAt)))}
                      {` · ${entry.doc.steps.length} ขั้นตอน`}
                      {entry.doc.header.supervisor
                        ? ` · ${entry.doc.header.supervisor}`
                        : ""}
                    </span>
                  </button>

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
                    className="text-muted opacity-100 transition-opacity hover:bg-danger-soft hover:text-danger-text max-sm:size-10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>

                {/* The job's two documents side by side, the same two columns
                    on every row: JSA on the left, work procedure on the right.
                    Without a procedure the right-hand slot becomes the button
                    that drafts one, instead of being left out — that used to
                    make rows different heights and left the procedure
                    reachable only from the JSA's PDF page. Dashed and unfilled
                    so "create" never reads as "open": it starts a 1-3 minute
                    AI draft rather than opening something that exists. */}
                {/* One column under 360px: side by side, both labels were cut
                    to "ขั้นตอนปฏิบั…" on a 320px phone */}
                <div className="mb-1.5 mt-1 grid grid-cols-2 gap-2 max-[359px]:grid-cols-1">
                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    aria-label={`เปิด JSA ของ ${entryTitle(entry)}`}
                    className={docButton}
                  >
                    <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">JSA</span>
                    <ChevronRight className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
                  </button>
                  <AnimatePresence initial={false} mode="wait">
                  {entry.procedure ? (
                    <motion.div key="open" {...fadeSwap} className="grid min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProcedure(entry)}
                      aria-label={`เปิดขั้นตอนปฏิบัติงานของ ${entryTitle(entry)}`}
                      className={docButton}
                    >
                      <ListOrdered className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">ขั้นตอนปฏิบัติงาน</span>
                      <ChevronRight className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
                    </button>
                    </motion.div>
                  ) : (
                    <motion.div key="create" {...fadeSwap} className="grid min-w-0">
                    <button
                      type="button"
                      onClick={() => onCreateProcedure(entry)}
                      aria-label={`สร้างขั้นตอนปฏิบัติงานของ ${entryTitle(entry)}`}
                      className="flex min-w-0 items-center gap-1.5 rounded-full border border-dashed
                                 border-navy/40 px-2.5 py-2 text-xs font-medium text-navy
                                 hover:border-navy hover:bg-navy-soft focus-visible:outline-none
                                 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">สร้างขั้นตอนปฏิบัติงาน</span>
                    </button>
                    </motion.div>
                  )}
                  </AnimatePresence>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <p className="mt-4 text-sm text-muted">
        บันทึกไว้ในเครื่องนี้เท่านั้น (สูงสุด {historyStore.MAX_ENTRIES} งานล่าสุด)
      </p>

      {undoToast}

      <ConfirmDialog
        open={confirmClear}
        title="ล้างประวัติทั้งหมด?"
        description={`ประวัติ ${entries.length} รายการในเครื่องนี้จะถูกลบและกู้คืนไม่ได้`}
        confirmLabel="ล้างประวัติ"
        onConfirm={applyClear}
        onCancel={() => setConfirmClear(false)}
      />
    </motion.section>
  );
}
