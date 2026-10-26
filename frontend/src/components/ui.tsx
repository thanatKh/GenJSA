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
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";

import { collapse } from "../lib/motion";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 text-sm text-danger-text flex items-start gap-1.5">
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

/* ------------------------------------------------------------- InfoDialog */

export function InfoDialog({
  open,
  title,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* sm:max-w-none needed alongside max-w-none — the generated file's
          sm:max-w-sm lives in a different modifier scope than a plain
          max-w-none override, so tailwind-merge doesn't treat them as
          conflicting and both would otherwise ship, letting sm:max-w-sm win
          the cascade at any viewport >= 640px */}
      <DialogContent
        className="flex max-h-[85dvh] w-[min(92vw,36rem)] max-w-none sm:max-w-none flex-col gap-0 overflow-hidden p-0"
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
          <Button variant="outline" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
