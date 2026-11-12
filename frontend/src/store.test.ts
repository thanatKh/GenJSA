// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllDrafts, docDraft, jsaSourceDraft } from "./store";

describe("session drafts", () => {
  beforeEach(() => sessionStorage.clear());

  it("fills in sub_steps on a JSA draft saved before they existed", () => {
    sessionStorage.setItem("genjsa.draft.doc", JSON.stringify({
      header: { work_activity: "งานเก่า", supervisor: "ก", analysis_date: "2026-01-01" },
      steps: [{ no: 1, procedure: "ขั้นตอนเก่า", details: "", hazards: [] }],
      assumptions: [],
    }));
    expect(docDraft.load()?.steps[0].sub_steps).toEqual([]);
  });

  it("remembers whether the JSA came from an outside AI, and forgets with the drafts", () => {
    expect(jsaSourceDraft.load()).toBe("builtin");
    jsaSourceDraft.save("outside");
    expect(jsaSourceDraft.load()).toBe("outside");
    clearAllDrafts();
    expect(jsaSourceDraft.load()).toBe("builtin");
  });
});
