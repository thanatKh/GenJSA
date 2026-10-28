/* Drafting phases' documents, one request at a time — their JSAs, or their
 * sections of the project's work procedure (App.tsx runs one of each).
 *
 * One at a time on purpose: each draft takes as long as a Single Mode
 * document, the backend rate-limits per minute, and a queue of parallel
 * requests would mostly just fail together. "ร่างทั้งหมด" queues the phases
 * and works down the list; ยกเลิก stops the whole run.
 *
 * Results are applied with a functional update against the LATEST project,
 * so the user can keep reviewing other phases while one is drafting. Each
 * request is built from the latest project too (projectRef), so an edit made
 * while waiting in the queue is what gets sent.
 */

import { useEffect, useRef, useState } from "react";

import { ApiError, CancelledError, generateJsa, generateProcedure } from "../../lib/api";
import type { ProjectDocument } from "../../lib/schema";
import { generateInput, procedureInput, withPhaseJsa, withPhaseProcedure } from "./projectModel";

export type PhaseDrafting = ReturnType<typeof usePhaseDrafting>;

export function usePhaseDrafting(
  project: ProjectDocument | null,
  setProject: (update: (current: ProjectDocument) => ProjectDocument) => void,
  kind: "jsa" | "procedure",
) {
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const controller = useRef<AbortController | null>(null);

  const [current, setCurrent] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Leaving the project (or the app) mid-draft must not land a result later
  useEffect(() => () => controller.current?.abort(), []);

  /** `replace`: redraft even if the phase already has this document (the
   * stale-section "ร่างใหม่" path, which has already asked the user) */
  const draft = async (ids: string[], { replace = false } = {}) => {
    if (controller.current || ids.length === 0) return;
    const run = new AbortController();
    controller.current = run;
    setErrors((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))));
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const latest = projectRef.current;
        const index = latest?.phases.findIndex((phase) => phase.id === id) ?? -1;
        const phase = index >= 0 ? latest?.phases[index] : undefined;
        // Deleted, done by hand, or (for a section) no JSA yet while it waited — skip
        if (!latest || !phase) continue;
        if (kind === "jsa" && phase.jsa && !replace) continue;
        if (kind === "procedure" && (!phase.jsa || (phase.procedure && !replace))) continue;

        setCurrent(id);
        setQueued(ids.slice(i + 1));
        setStartedAt(Date.now());
        try {
          if (kind === "jsa") {
            const jsa = await generateJsa(generateInput(latest, index), { signal: run.signal });
            setProject((p) => withPhaseJsa(p, id, jsa, false));
          } else {
            const section = await generateProcedure(
              phase.jsa!,
              { signal: run.signal },
              procedureInput(latest, index),
            );
            setProject((p) => withPhaseProcedure(p, id, section));
          }
        } catch (caught) {
          if (caught instanceof CancelledError) return;
          const fallback = kind === "jsa" ? "ร่าง JSA ไม่สำเร็จ" : "ร่างขั้นตอนปฏิบัติงานไม่สำเร็จ";
          setErrors((all) => ({
            ...all,
            [id]: caught instanceof ApiError ? caught.message : `${fallback} กรุณาลองอีกครั้ง`,
          }));
          // The next request would most likely fail the same way (network,
          // rate limit) — stop and let the user retry
          return;
        }
      }
    } finally {
      controller.current = null;
      setCurrent(null);
      setQueued([]);
    }
  };

  return {
    draft,
    cancel: () => controller.current?.abort(),
    /** The phase being drafted right now */
    current,
    /** Phases waiting their turn in this run */
    queued,
    startedAt,
    errors,
  };
}
