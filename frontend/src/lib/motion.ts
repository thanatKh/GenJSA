/* Shared Motion (motion/react, formerly Framer Motion) presets, so every
 * animation in the app moves the same way. Values follow the --duration-*
 * / --ease-* tokens in styles/tokens.css (Motion takes seconds and arrays,
 * not CSS custom properties, so they're restated here).
 *
 * The phone's "reduce motion" setting is honoured app-wide by the
 * <MotionConfig reducedMotion="user"> in main.tsx: movement and size
 * changes are skipped, fades stay.
 */

import type { Transition, Variants } from "motion/react";

/** --ease-smooth-out */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** --duration-quick / --duration-fast, in seconds */
export const QUICK = 0.15;
export const FAST = 0.25;

/** Screen-to-screen: a fade only. A slide (transform) on the wrapper would
 * break the editors' position:fixed bottom bar and sticky table header for
 * the length of the animation — both re-anchor to a transformed ancestor. */
export const screenFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, pointerEvents: "auto", transition: { duration: 0.2, ease: EASE_OUT } },
  // pointer-events off the instant a screen starts leaving: for those 120ms
  // its buttons were still live, so a quick second tap could land on the old
  // screen's button (e.g. its own "กลับไปแก้ไข") instead of the new screen's
  // ease-out on the way out too: ease-in starts slow, which reads as lag
  exit: { opacity: 0, pointerEvents: "none", transition: { duration: 0.12, ease: EASE_OUT } },
};

/** An item joining or leaving a list (steps, hazards, sub-steps): rises in
 * slightly, fades out in place. Pair with `layout` so neighbours slide. */
export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  // Leaving is quicker than arriving: arriving is something to notice,
  // leaving should just get out of the way
  exit: { opacity: 0, y: 0, transition: { duration: QUICK, ease: EASE_OUT } },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};

/** A block that opens and closes in place (company section, warnings,
 * errors): height and opacity together, so the content below moves
 * smoothly instead of jumping. Needs overflow hidden while animating. */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0, transition: { duration: QUICK, ease: EASE_OUT } },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};

/** Two things trading places in one slot (logo box <-> logo, form <->
 * progress panel): old fades out, then the new one fades in. Use with
 * AnimatePresence mode="wait". */
export const fadeSwap = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: QUICK, ease: EASE_OUT } satisfies Transition,
};

/** CSS-only fade-in for an element that simply appears (buttons once a file
 * is ready, warning markers): plays when the element mounts, nothing to
 * wire up. tw-animate-css's animate-in, on the shared easing token; switched
 * off for reduced-motion users. A literal string so Tailwind finds it. */
export const FADE_IN_CLASS =
  "animate-in fade-in-0 duration-200 ease-(--ease-smooth-out) motion-reduce:animate-none";

/** Switching tabs (งานเดียว / โครงการ): the new form slides in from the side
 * of the tab that was picked and the old one leaves the other way, so the
 * move reads as sideways navigation rather than a page reload. `custom` is
 * the direction: 1 = moving to the right-hand tab, -1 = to the left. With
 * "reduce motion" on, MotionConfig drops the slide and keeps the fade. */
export const tabSlide: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
  center: { opacity: 1, x: 0, pointerEvents: "auto", transition: { duration: FAST, ease: EASE_OUT } },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -24,
    pointerEvents: "none",
    transition: { duration: QUICK, ease: EASE_OUT },
  }),
};

/** A picture arriving (step photo, company logo) */
export const popIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};
