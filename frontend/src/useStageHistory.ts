/* Makes the browser's Back / Forward (and the phone's Back gesture) move
 * between GenJSA's screens, so it behaves like an app instead of a web page
 * that Back throws you out of.
 *
 * App.tsx keeps "which screen" in one `stage` value; this hook just mirrors
 * it into the browser's history. The mirroring is deliberately the only
 * thing it does — App.tsx's own navigation code is unchanged.
 *
 * - Going to a screen you haven't been to yet adds a history entry.
 * - Going to a screen already earlier in the trail (กลับไปแก้ไข, the stepper,
 *   เริ่มใหม่) steps BACK along the trail instead of adding a new entry, so
 *   Back never replays a loop of screens and เริ่มใหม่ leaves a clean trail.
 * - Back / Forward set `stage` to the screen that entry stands for.
 *
 * Nothing goes in the address bar: the URL never changes, and the only thing
 * stored is a short list of screen numbers in the history entry's state
 * (nothing from the documents) — consistent with the no-content-in-URLs
 * rule. If a screen can't be shown with the data present (Forward to the
 * editor after เริ่มใหม่), App.tsx's existing guards bounce back to a valid
 * one, and this hook follows that move like any other.
 */

import { useEffect, useRef } from "react";

type StageState = { genjsa: 1; trail: number[] };

function trailOf(state: unknown): number[] | null {
  const s = state as Partial<StageState> | null;
  return s?.genjsa === 1 && Array.isArray(s.trail) && s.trail.length > 0 ? s.trail : null;
}

export function useStageHistory<S extends number>(stage: S, setStage: (stage: S) => void) {
  const started = useRef(false);

  // Stage -> history
  useEffect(() => {
    if (!started.current) {
      // First run: the entry we're on stands for the opening screen
      started.current = true;
      window.history.replaceState({ genjsa: 1, trail: [stage] } satisfies StageState, "");
      return;
    }
    const trail = trailOf(window.history.state);
    if (trail && trail[trail.length - 1] === stage) return; // already in step (e.g. we got here via Back)

    const seen = trail ? trail.lastIndexOf(stage) : -1;
    if (trail && seen >= 0) {
      // Been there already: walk back to it rather than stacking a new entry
      window.history.go(seen - (trail.length - 1));
    } else {
      window.history.pushState({ genjsa: 1, trail: [...(trail ?? []), stage] } satisfies StageState, "");
    }
  }, [stage]);

  // history -> stage
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const trail = trailOf(event.state);
      if (!trail) return;
      setStage(trail[trail.length - 1] as S);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setStage]);
}
