/* UI primitives — thin app-specific wrappers around shadcn/ui components
 * living in src/components/ui/*.tsx (generated via the shadcn CLI, then
 * patched for GenJSA's brand tokens, tap-target sizes, and iOS zoom fix —
 * see the comments in each generated file for what changed and why).
 *
 * Every icon comes from lucide-react (SVG) — never use emoji in the UI.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";

import { collapse, EASE_OUT, FAST } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Label as ShadcnLabel } from "./ui/label";
import { Textarea as ShadcnTextarea } from "./ui/textarea";
import { Card as ShadcnCard, CardContent } from "./ui/card";
import { Alert as ShadcnAlert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export { Button } from "./ui/button";
export { Input } from "./ui/input";

/* ------------------------------------------------------------------- Field */

export function Label({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <ShadcnLabel htmlFor={htmlFor} className="mb-1.5 block text-ink">
      {children}
      {required ? (
        <span className="text-danger-text ml-0.5" aria-hidden="true">
          *
        </span>
      ) : null}
    </ShadcnLabel>
  );
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    // role="alert": announced by screen readers the moment it appears —
    // aria-invalid alone only marks the field, it says nothing about why
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger-text flex items-start gap-1.5">
      <TriangleAlert className="size-4 mt-1 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* --------------------------------------------------------- AutoGrowTextarea */

type AutoGrowProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  maxRows?: number;
};

/**
 * A textarea that grows with its content — so a long work description doesn't
 * force scrolling inside a tiny box. Uses scrollHeight because field-sizing:
 * content isn't reliably supported on Safari yet (the generated Textarea's
 * own field-sizing-content class is stripped for the same reason).
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowProps>(
  // maxRows defaults to no limit: these boxes hold safety content that a
  // reviewer must see in full. A capped box scrolled inside itself with no
  // cue — a hazard with 8 controls showed 3-4 of them, and the rest could
  // be approved unseen. Pass maxRows only where text is being typed, not
  // reviewed (the first screen's description).
  ({ minRows = 3, maxRows = Infinity, className, onChange, value, ...rest }, ref) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);

    const resize = () => {
      const el = inner.current;
      if (!el) return;
      const styles = window.getComputedStyle(el);
      const lineHeight = parseFloat(styles.lineHeight) || 24;
      const padding =
        parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      el.style.height = "auto";
      const next = Math.min(
        Math.max(el.scrollHeight, minRows * lineHeight + padding),
        maxRows * lineHeight + padding,
      );
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > next ? "auto" : "hidden";
    };

    useEffect(resize, [value, minRows, maxRows]);

    // Wrapping also changes when the window/container changes width. Observe
    // width only: writing height must not cause a ResizeObserver feedback loop.
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      let width = -1;
      let frame = 0;
      const measure = () => {
        const next = el.getBoundingClientRect().width;
        if (next === 0) { width = 0; return; }
        if (next === width) return;
        width = next;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resize);
      };
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => { observer.disconnect(); cancelAnimationFrame(frame); };
      // resize reads current DOM styles; row constraints restart this observer.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minRows, maxRows]);

    // Google Sans/Google Sans Text load with font-display: swap (fonts.css)
    // — text first paints in the fallback font, which wraps Thai differently,
    // then the real font swaps in and can push content onto another line
    // with nothing re-measuring the box. Without this, that extra line ends
    // up clipped (overflow was already locked to hidden from the first,
    // fallback-font measurement) rather than the box growing to fit it.
    // el.scrollHeight below is read live from the DOM, not from a value
    // closed over here, so this stays correct even if the field was edited
    // in the meantime — safe to run just once, on mount.
    useEffect(() => {
      void document.fonts?.ready?.then(() => resize());
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <ShadcnTextarea
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={minRows}
        value={value}
        onChange={(event) => {
          onChange?.(event);
          resize();
        }}
        // cn(), not plain string concat — callers that need to *remove* a
        // base style (e.g. StepCard.tsx's borderless desktop-table cells,
        // which override rounded-lg/border/px-3.5 py-2.5 to nothing) need
        // tailwind-merge's conflict resolution, not just class concatenation.
        //
        // min-h-0 overrides the generated Textarea's own min-h-16 (64px) —
        // that's a sensible floor for its default standalone use, but this
        // component already computes its own floor from minRows via the
        // resize() height math above, so for minRows 1-2 callers the CSS
        // min-height was clamping the box back up past what was asked for
        // (a one-row field rendering ~64px tall instead of ~44px).
        className={cn("resize-none leading-[1.75] min-h-0", className)}
        {...rest}
      />
    );
  },
);
AutoGrowTextarea.displayName = "AutoGrowTextarea";

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ShadcnCard className={className}>
      <CardContent>{children}</CardContent>
    </ShadcnCard>
  );
}

/* ------------------------------------------------------------------- Alert */

/**
 * Errors are shown inline right where they matter, never as a toast that
 * disappears on its own. A field worker may look away and come back —
 * the message needs to still be there. Always the danger/error treatment —
 * no current call site needs any other tone.
 */
export function Alert({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <ShadcnAlert
      variant="destructive"
      className="items-start border-danger/40 bg-danger-soft [&>svg]:text-danger"
    >
      <TriangleAlert className="mt-0.5 size-5" aria-hidden="true" />
      <AlertDescription className="text-danger-text">
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </AlertDescription>
    </ShadcnAlert>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function SkeletonCard() {
  return (
    <div className="rounded-card border border-line p-4 sm:p-5">
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Reveal */

/**
 * Shows/hides its children with a height + fade, so whatever is below moves
 * smoothly instead of jumping — warnings, errors, the company section's
 * fields. `initial={false}`: something already showing when the page opens
 * just appears; only changes while you're on the page animate.
 */
export function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div {...collapse} className={cn("overflow-hidden", className)}>
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------- Disclosure */

/**
 * A fold-out: a trigger line with a chevron, and a panel that opens and
 * closes by height and opacity. Animated with Motion rather than a native
 * <details> + CSS (::details-content with interpolate-size), because that
 * CSS only animates in Chrome and Edge — Safari and Firefox open it
 * instantly, and most of GenJSA's users are on a phone.
 *
 * The panel stays mounted while closed (callers may read or select its
 * contents), but is inert and visibility:hidden — out of the tab order, the
 * accessibility tree and find-in-page — once the close animation ends.
 * Controlled, so the caller can also open it from code.
 */
export function Disclosure({
  open,
  onOpenChange,
  label,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="press flex min-h-11 cursor-pointer items-center gap-1 rounded-md text-sm text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: FAST, ease: EASE_OUT }} className="flex">
          <ChevronDown className="size-4" aria-hidden="true" />
        </motion.span>
        {label}
      </button>
      <motion.div
        id={panelId}
        initial={false}
        inert={!open}
        animate={
          open
            ? { height: "auto", opacity: 1, visibility: "visible" }
            : { height: 0, opacity: 0, transitionEnd: { visibility: "hidden" } }
        }
        transition={{ duration: FAST, ease: EASE_OUT }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    </div>
  );
}

/* The one toast stack for the whole app — mounted once in App.tsx */
export { Toaster } from "./ui/sonner";

/* ---------------------------------------------------------------- UndoToast */

/**
 * A brief "deleted — undo?" toast, for actions that used to be instant and
 * irreversible (removing a step/hazard/history entry). The caller owns the
 * timer and just says whether to show; this drives the app-wide Sonner
 * <Toaster> (components/ui/sonner.tsx, mounted once in App.tsx), so every
 * toast shares one look and one stack.
 *
 * Sonner's own timer is turned off (duration Infinity) — the caller's
 * UNDO_TIMEOUT_MS is the single source of truth for how long undo lasts,
 * and the toast closes when `open` goes false. It also closes when the page
 * that showed it unmounts: an undo surviving onto another page would run a
 * handler for state that no longer exists.
 */
export function UndoToast({
  open,
  message,
  onUndo,
}: {
  open: boolean;
  message: string;
  onUndo: () => void;
}) {
  // Read at click time, not captured when the toast opened — the handler
  // closes over the caller's latest state
  const onUndoRef = useRef(onUndo);
  useEffect(() => {
    onUndoRef.current = onUndo;
  });

  const id = useId();
  useEffect(() => {
    if (!open) return;
    toast(message, {
      id,
      duration: Infinity,
      dismissible: false,
      action: {
        label: (
          <>
            <Undo2 className="size-4" aria-hidden="true" />
            เลิกทำ
          </>
        ),
        onClick: () => onUndoRef.current(),
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [open, message, id]);

  return null;
}

/* --------------------------------------------------------- ConfirmDialog */

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* The generated file's max-width lives under data-[size=default]: and
          data-[size=default]:sm: scopes — an unscoped max-w-none doesn't
          conflict with those in tailwind-merge's eyes (different modifier
          scope), so it silently loses the cascade at sm+ viewports. Override
          at the exact same scopes so it's actually recognized as a conflict. */}
      <AlertDialogContent className="w-[min(92vw,26rem)] max-w-none data-[size=default]:max-w-none data-[size=default]:sm:max-w-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg text-navy">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ----------------------------------------------------------- ChoiceDialog */

export type Choice = {
  label: string;
  description: string;
  icon?: ReactNode;
  /** The suggested option — drawn as the primary button, and listed first */
  recommended?: boolean;
  onSelect: () => void;
};

/** "Which way?" — two or more options, each a full-width button with a line
 * explaining it, plus ยกเลิก. The recommended one leads and is filled. */
export function ChoiceDialog({
  open,
  title,
  description,
  choices,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  choices: Choice[];
  onCancel: () => void;
}) {
  const ordered = [...choices].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="w-[min(92vw,28rem)] max-w-none data-[size=default]:max-w-none data-[size=default]:sm:max-w-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg text-navy">{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <div className="grid gap-2">
          {ordered.map((choice) => (
            <Button
              key={choice.label}
              type="button"
              variant={choice.recommended ? "default" : "outline"}
              onClick={choice.onSelect}
              className="h-auto min-h-14 w-full flex-col items-start gap-0.5 whitespace-normal px-4 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 font-semibold">
                {choice.icon}
                {choice.label}
                {choice.recommended ? <span className="text-xs font-normal opacity-80">(แนะนำ)</span> : null}
              </span>
              <span className={cn("text-sm font-normal", choice.recommended ? "opacity-90" : "text-muted")}>
                {choice.description}
              </span>
            </Button>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>ยกเลิก</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------- InfoDialog */

export function InfoDialog({
  trigger,
  title,
  icon,
  children,
}: {
  trigger: ReactElement;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* sm:max-w-none needed alongside max-w-none — the generated file's
          sm:max-w-sm lives in a different modifier scope than a plain
          max-w-none override, so tailwind-merge doesn't treat them as
          conflicting and both would otherwise ship, letting sm:max-w-sm win
          the cascade at any viewport >= 640px */}
      <DialogContent
        className="flex max-h-[85dvh] w-[min(92vw,36rem)] max-w-none sm:max-w-none flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-2.5 border-b border-line px-5 py-4">
          {icon ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy-soft text-navy">
              {icon}
            </span>
          ) : null}
          <DialogTitle className="text-lg text-navy">{title}</DialogTitle>
        </DialogHeader>
        <div className="divide-y divide-line overflow-y-auto overscroll-contain px-5 text-sm leading-relaxed [&>*]:py-4 first:[&>*]:pt-4">
          {children}
        </div>
        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-line bg-transparent px-5 py-4">
          <DialogClose asChild><Button variant="outline">ปิด</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
