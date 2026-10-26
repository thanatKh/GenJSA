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
  exit: { opacity: 0, pointerEvents: "none", transition: { duration: 0.12, ease: "easeIn" } },
};

/** An item joining or leaving a list (steps, hazards, sub-steps): rises in
 * slightly, fades out in place. Pair with `layout` so neighbours slide. */
export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 0 },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};

/** A block that opens and closes in place (company section, warnings,
 * errors): height and opacity together, so the content below moves
 * smoothly instead of jumping. Needs overflow hidden while animating. */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};

/** A picture arriving (step photo, company logo) */
export const popIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: FAST, ease: EASE_OUT } satisfies Transition,
};
