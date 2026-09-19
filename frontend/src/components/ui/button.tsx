import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react"
import { motion, useReducedMotion, AnimatePresence } from "motion/react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // active:not-aria-[haspopup]:translate-y-px is CSS-only press feedback —
  // kept alongside the motion-driven press scale below (not replaced by it)
  // because it still applies with zero JS to <a>/Slot-rendered buttons this
  // file doesn't wrap in <motion.button> (see the asChild branch), and it's
  // a no-op double-up (a barely visible 1px shift) on the ones that do get
  // the richer scale treatment, not a conflict.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // bg-raised (not bg-muted) — --color-muted is GenJSA's pre-existing
        // TEXT color token (text-muted, used all over the app), a naming
        // collision with shadcn's own "muted background" convention. bg-raised
        // already means exactly the light background shadcn wants here.
        outline:
          "border-border bg-background hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:hover:bg-raised/50",
        // Stock shadcn destructive for this preset is a soft/tinted style
        // (bg-destructive/10, not filled) — kept exactly as generated, no
        // custom re-styling, per the decision to adopt shadcn's stock look
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Default/lg/icon overridden below (44px/52px/44px) — every stock size
      // in this preset (h-8/h-9/size-8) is well under GenJSA's 44px minimum
      // tap target. icon was the one gap: default/lg got bumped when this
      // file was first patched, but the bare icon-only size stayed at the
      // stock 32px, so icon-only buttons needing the 44px minimum (mobile
      // step-card controls) had to be hand-rolled as raw <button>s instead of
      // going through this component. xs/sm/icon-xs/icon-sm/icon-lg are
      // deliberately left at their stock (sub-44px) sizes — they're for
      // secondary/dense contexts where the full tap-target minimum doesn't
      // apply (see each call site's own reasoning).
      size: {
        default: "h-11 gap-2 px-4",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-13 gap-2 px-6 text-[1.0625rem]",
        icon: "size-11",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Motion tokens (styles/tokens.css) as raw numbers/strings — framer-motion's
// transition prop takes numbers (seconds) and eased curves, not CSS var()
// strings, so these are the same values the app's --duration-fast/
// --ease-smooth-out already name, just re-expressed for JS. Kept local
// rather than reading getComputedStyle at runtime: they're used on every
// button press in the app, so a synchronous constant beats a per-render
// style read for no benefit (these tokens don't change at runtime).
const PRESS_TRANSITION = { duration: 0.15, ease: [0.22, 1, 0.36, 1] } as const
const STATUS_ICON_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] } as const

export type ButtonStatus = "idle" | "loading" | "success" | "error"

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  status,
  successText,
  errorText,
  disabled,
  children,
  ...props
}: Omit<
  React.ComponentProps<"button">,
  // motion.button's own event props (drag/animation lifecycle) collide with
  // the native DOM handlers of the same name at incompatible signatures —
  // this component never uses drag or the framer animation-lifecycle
  // callbacks, so the plain native ones are omitted from the accepted type
  // rather than widened/cast, keeping ...props assignable to
  // HTMLMotionProps<"button"> below without an `as` escape hatch.
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    // shadcn's Button has no loading state of its own (its own convention is to
    // compose Spinner + disabled per call site) — kept as a light wrapper prop
    // here since InputStep's submit button already relied on it
    loading?: boolean
    // Superset of `loading`: idle/loading are unchanged, success/error add a
    // transient icon+label swap (checkmark / triangle) so an async action
    // that already tracks its own error string (usePdfDelivery's handleSave/
    // handleShare, see PdfDeliveryCard) can show a real "it worked" moment
    // on the button itself instead of the button just reverting to idle with
    // no visible confirmation at all. Optional and independent of `loading`
    // — a caller using only `loading` (every existing call site) is
    // unaffected; `status` is additive, not a replacement for it.
    status?: ButtonStatus
    // Shown in place of `children` while status is "success"/"error". Falls
    // back to `children` itself if omitted, so passing `status` alone (no
    // separate label) still renders something rather than an empty button.
    successText?: React.ReactNode
    errorText?: React.ReactNode
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const reduceMotion = useReducedMotion()
  const effectiveStatus: ButtonStatus = status ?? (loading ? "loading" : "idle")

  const content = asChild ? (
    // Slot expects exactly one child element to clone props onto — never
    // inject a loading spinner or status icon alongside it. A caller passing
    // asChild + status would silently get neither; none currently do (asChild
    // is only ever used for the "open PDF" link, which has no loading state).
    children
  ) : (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {effectiveStatus === "loading" ? (
          <motion.span
            key="loading"
            initial={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            transition={STATUS_ICON_TRANSITION}
          >
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          </motion.span>
        ) : effectiveStatus === "success" ? (
          <motion.span
            key="success"
            initial={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            transition={STATUS_ICON_TRANSITION}
          >
            <CircleCheck className="size-4" aria-hidden="true" />
          </motion.span>
        ) : effectiveStatus === "error" ? (
          <motion.span
            key="error"
            initial={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            transition={STATUS_ICON_TRANSITION}
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
          </motion.span>
        ) : null}
      </AnimatePresence>
      {effectiveStatus === "success"
        ? (successText ?? children)
        : effectiveStatus === "error"
          ? (errorText ?? children)
          : children}
    </>
  )

  // asChild renders a plain Slot — no press/hover scale. The real <a> inside
  // it (PdfDeliveryCard's "เปิดเอกสาร PDF") must stay a directly-clickable
  // anchor with no wrapping element between it and the click, for the same
  // popup-blocking reason usePdfDelivery.ts's header documents; wrapping it
  // in <motion.button> here would break that by inserting exactly such an
  // element (Slot.Root merges props onto its child, motion.button does not).
  if (asChild) {
    return (
      <Comp
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {content}
      </Comp>
    )
  }

  return (
    <motion.button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      // Press/hover scale — idea borrowed from a third-party motion button
      // primitive we reviewed but didn't adopt wholesale (different variant/
      // size system than ours); this is the one piece worth having: a subtle
      // tactile response CSS active: alone doesn't give. whileTap fires on
      // every pointer/touch press regardless of hover capability; whileHover
      // is harmless on touch (never triggers without a real hover) so it
      // doesn't need its own capability check the way the reference
      // implementation had one.
      whileTap={reduceMotion || disabled || loading ? undefined : { scale: 0.96 }}
      whileHover={reduceMotion || disabled || loading ? undefined : { scale: 1.015 }}
      transition={PRESS_TRANSITION}
      {...props}
    >
      {content}
    </motion.button>
  )
}

// Generated shadcn file — exports both the component and its cva variants by convention
export { Button, buttonVariants } // eslint-disable-line react-refresh/only-export-components
