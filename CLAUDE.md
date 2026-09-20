# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GenJSA drafts a Job Safety Analysis (การวิเคราะห์งานเพื่อความปลอดภัย) against the
`F-ปธบ.-1202` form: the user describes the work in natural Thai, an LLM drafts
the JSA, the user reviews/edits every field, and the finished document is
exported as an A4 PDF — entirely client-side.

```
Enter work details  →  AI drafts JSA  →  Review and edit  →  Open PDF
                                                               │
                                        (optional) ────────────┘
                                             ↓
              AI drafts work procedure  →  Review and edit  →  Open PDF
```

**The second document — ขั้นตอนปฏิบัติงาน (work procedure).** The JSA is
task-level by rule: its prompt bans move-by-move instructions. That leaves a
gap, because whoever actually does the job still needs the how-to. From the
JSA's PDF page the user can expand it into a work procedure — each JSA step
becomes concrete sub-steps — which is reviewed and exported the same way.
It's optional, and most users will stop at the JSA.

Unlike the JSA, the procedure matches no official company form, so its
structure is GenJSA's own (`config/procedure.yaml`) and can be changed freely.

## Non-negotiable design principles

These constraints shape almost every implementation decision here — check
against them before adding anything:

- **No database, no login, no server-side storage.**
- **No document content persistence on the server** — data lives in memory
  only for the duration of one request, then it's gone. Nothing is ever
  written server-side.
- **One document does travel back to the backend, deliberately.**
  `POST /api/procedure/generate` takes a finished `JsaDocument` in its request
  body, because a work procedure is generated *from* the JSA rather than from
  a fresh description. This is the single exception to "the browser only ever
  sends a work description." It does not weaken the rule above it: the JSA is
  used for that one request and never stored, logged, or written anywhere —
  `backend/app/api/jsa.py` logs its step count and nothing else. Any new
  endpoint that wants a whole document back needs the same justification.
- **Browser-local history is the one deliberate storage exception** — finished
  documents (never PDFs) are kept in `localStorage` by
  `frontend/src/history.ts`: this browser on this PC, 365-day expiry,
  deletable per-entry or all at once, never uploaded. It exists so a user can
  reopen yesterday's JSA instead of regenerating it. One entry holds the JSA
  and, when one was generated, its work procedure — written by two different
  pages, so `upsertDoc`/`upsertProcedure` merge rather than replace (writing a
  fresh entry object there silently erases the other document; that was a real
  bug). In-progress drafts stay tab-scoped in `sessionStorage`
  (`frontend/src/store.ts`), and `clearAllDrafts()` must never touch history.
  If this looks like a bug, it isn't — read `history.ts`'s header comment
  before "fixing" it.
- **No content logging** — logs capture error/status only, never work
  descriptions or AI responses. `uvicorn.access` logging is explicitly
  disabled in `backend/app/main.py`. When touching logging calls, log
  lengths/counts, not content.
- **AI drafts, humans review** — no automated review/approval step.
- **Config, not code, changes behavior** — anything a non-developer should
  be able to tune lives in `config/*.yaml`, not in source.
- **The ThaiLLM API key never reaches the browser** — it's read from the
  `THAILLM_API_KEY` env var on the backend only.

## Commands

### Backend (Python, FastAPI)

```bash
cd backend && source .venv/bin/activate   # venv at backend/.venv, Python 3.12+ required
uvicorn app.main:app --reload --port 8000
pytest                                     # run all tests
pytest tests/test_json_repair.py           # single file
pytest tests/test_json_repair.py::test_name -v   # single test
```

Tests don't call the real AI — `tests/conftest.py` sets a dummy
`THAILLM_API_KEY` and provides a `sample_doc` fixture.

### Frontend (React + TS + Vite + Tailwind v4)

```bash
cd frontend
npm run dev       # vite dev server on :5173, proxies /api and /health to :8000
npm run build      # tsc -b && vite build
npm run lint       # oxlint
npm run preview
```

There is no `npm test` — no frontend test suite exists.

### Model selection / connectivity check

```bash
cd backend && source .venv/bin/activate
python ../scripts/model_bench.py --probe   # verify ThaiLLM connectivity
python ../scripts/model_bench.py -n 10     # benchmark config/ai.yaml's candidate_models,
                                            # compare JSON-validity rate / step count / latency
```

## Architecture

### Request flow

`InputStep` (frontend) → `POST /api/jsa/generate` → `backend/app/api/jsa.py`
→ `services/ai_service.generate_jsa` → `providers/llm/*` (ThaiLLM) →
`services/json_repair` → validated into `models/jsa.JsaDocument` → returned
to the browser → held in React state + `sessionStorage` → user edits in
`EditorStep` → `PdfStep` renders it with jsPDF, entirely in the browser.

Then, optionally, from `PdfStep`: `POST /api/procedure/generate` (carrying the
finished JSA) → `services/procedure_service.generate_procedure` → the same
provider/repair/validate path → `models/procedure.ProcedureDocument` →
`ProcedureEditorStep` → `ProcedurePdfStep`.

The backend **never generates a PDF**. `GET /api/config/public` hands the
frontend layout values sourced from `config/pdf.yaml` (page size, fonts,
table widths, colors) so `frontend/src/lib/pdf/` can draw the documents
itself. This keeps the backend Chromium-free and lets document appearance be
config-tunable from both sides without duplicating logic.

### Backend generation pipeline (`backend/app/services/ai_service.py`)

`generate_validated()` is the shared core — both document types run through
it, so retry behaviour can only ever be fixed (or broken) in one place:

1. Load the prompt via `render_prompt()`, rendered with Jinja2 against its
   config (not cached — edits take effect immediately).
2. Call the LLM provider (`providers/llm/`) with the system + user prompt.
3. `services/json_repair.py` attempts to coerce the raw text into valid JSON.
4. Validate into the caller's payload model (Pydantic).
5. On failure (bad JSON / invalid schema / provider rejects `json_mode`),
   retry up to `config/ai.yaml`'s `retry.max_attempts`, appending a Thai
   "answer with JSON only" reminder and falling back to non-JSON-mode.

`generate_jsa` then combines `AiJsaPayload` (AI-owned: `work_activity`,
`steps`, `assumptions`) with request-supplied fields (`supervisor`,
`analysis_date`) into the final `JsaDocument`.

`JsaDocument.steps` numbering is re-derived server-side on every validation
(`renumber_steps`) — the frontend can freely add/remove/reorder steps, and
the backend is the single source of truth for step numbers printed on the
document. `ProcedureDocument` does the same for its steps and sub-steps.

### Procedure generation (`backend/app/services/procedure_service.py`)

Two rules are enforced **structurally, not by the prompt**, because a model
will drift from either one. Keep it that way when editing:

- **The AI cannot restructure the steps.** `AiProcedurePayload` has no field
  for step titles — they're copied from the source JSA — and sub-steps are
  zipped onto the JSA's list *by index, not by the model's own numbering*. A
  short or renumbered response loses detail instead of corrupting the shape.
- **The AI cannot invent references.** `เอกสารอ้างอิง` is built in code from
  the JSA header. Asked for references, a model produces plausible standard
  numbers it has no basis for, so it is never offered the field.

Hazards and controls are deliberately **not** sent in the prompt: they aren't
needed to write how-to steps, and it keeps safety text a human already
approved from being reworded.

### Provider abstraction (`backend/app/providers/llm/`)

`base.py` defines the `LLMProvider` interface; `thaillm.py` implements it for
ThaiLLM; `registry.py` maps `config/ai.yaml`'s `provider:` string to a class
in `_PROVIDERS`. Adding a vendor means writing a new provider class and
registering it here — no changes needed to `ai_service.py`.

### Config system (`backend/app/core/config.py`)

Every `config/*.yaml` file maps 1:1 to a Pydantic model, all aggregated into
`Settings` and loaded once via `get_settings()` (`lru_cache`). Secrets
(`THAILLM_API_KEY`) come only from the environment/`.env`, never YAML.
`GET /api/config/public` deliberately whitelists which fields cross to the
browser — never the model name or API key.

### Frontend structure (`frontend/src/`)

`App.tsx`'s `stage` state drives everything. 0-2 are the JSA wizard and map
1:1 onto `Stepper`; 3-4 are the optional work procedure, reached only from
stage 2. **The Stepper stays three steps** (`Math.min(stage, 2)`) — a fourth
circle would imply the JSA is unfinished without a procedure, and most users
will stop at the JSA.

- `features/jsa-input/InputStep.tsx` — work description form → triggers generate.
- `features/jsa-input/HistoryList.tsx` — previously analysed jobs, listed under the form on step 0. Searchable, per-entry delete with undo, clear-all. Clicking one loads it into `EditorStep`; entries that also have a procedure are badged.
- `features/jsa-editor/EditorStep.tsx` — edit the generated `JsaDocument` before export.
- `features/pdf-view/PdfStep.tsx` — the JSA PDF, plus the card that starts a work procedure.
- `features/pdf-view/usePdfDelivery.ts` — **shared by both PDF pages**: builds the blob and routes save/share by browser capability. Its header documents the popup-blocking, iOS-viewer and user-activation constraints behind every rule in it; each one is a fix for something that actually broke. Read it before changing how those buttons behave, and don't reimplement it inline for a third document.
- `features/procedure/ProcedureEditorStep.tsx` — review the drafted procedure. Step titles are read-only here (they belong to the JSA) and a warning appears if the JSA's steps changed after the procedure was generated.
- `features/procedure/ProcedurePdfStep.tsx` — the procedure PDF, same delivery hook.
- `lib/schema.ts` — TS types/zod schema mirroring `backend/app/models/*.py` by hand (keep both in sync when the shape changes). Also `stepFingerprint()`, which drives the stale-procedure warning.
- `lib/api.ts` — typed fetch wrapper for `/api/*`.
- `lib/pdf/` — the PDF layout engines (jsPDF). `engine.ts` holds what both documents share: fonts, geometry, text wrapping, the title bar, header fields, the signature line, the per-page frame pass and the footer. `buildJsaPdf.ts` draws the bordered 3-column F-ปธบ.-1202 table (its pagination loop, orphan/widow guard and row-splitting stay there — they're table-specific). `buildProcedurePdf.ts` draws a flowing numbered document with no grid at all. Thai line wrapping has no word-segmentation dictionary — a break can occasionally land mid-word by design trade-off (never overflows a column, though).
- `store.ts` — sessionStorage-backed drafts, tab-scoped (see persistence principle above).
- `history.ts` — localStorage-backed history of finished documents, per-PC and 365-day capped (see persistence principle above). `App.tsx` owns the current entry's id and debounces writes; `clearAllDrafts()` deliberately leaves history alone.

⚠️ **Bundle boundary**: `engine.ts` statically imports jsPDF (~230KB with its
transitive deps), so it must only ever be reached through a dynamic
`import()`. That's why `fileName.ts` exists as a separate, dependency-free
module — the PDF pages import file names statically and the builders
dynamically. Check the chunk list after `npm run build` if you touch this.

In dev, Vite proxies `/api` and `/health` to `127.0.0.1:8000` (`vite.config.ts`).
In prod, FastAPI serves `frontend/dist` directly and mounts the SPA fallback
route (`backend/app/main.py`) — same origin, no proxy needed. The SPA
catch-all route is registered *after* the API router so it doesn't swallow
`/api/*`.

### UI primitives (`frontend/src/components/`)

Built on shadcn/ui (Radix base, `components.json` at `frontend/`) —
`components/ui/*.tsx` are the CLI-generated primitives, patched in place for
GenJSA's brand tokens/tap-target sizes/iOS-zoom-safe font size (see the
comment block at the top of each generated file for exactly what changed).
`components/ui.tsx` is a thin app-specific wrapper layer on top of those
(`Label` adds a `required` asterisk, `AutoGrowTextarea` adds scrollHeight-based
auto-grow, `Card`/`Alert` fix colors/radius, `ConfirmDialog`/`InfoDialog` wrap
`AlertDialog`/`Dialog`) — feature code imports from `components/ui`, never
directly from `components/ui/*`. Brand colors live in
`styles/tokens.css`, aliased onto shadcn's expected semantic token names
(`--primary`, `--destructive`, etc.) so generated components resolve to the
same colors as hand-rolled ones — never re-run `shadcn init` or accept its
font/color defaults without diffing first.

**Updating a generated component**: several files here are already
hand-patched (`button.tsx`'s sizes/`loading` prop, `input.tsx`/`textarea.tsx`'s
`text-base` iOS-zoom fix, `card.tsx`/`dialog.tsx`/`alert-dialog.tsx`'s
brand-radius override). Never run `shadcn add <component> --overwrite`
against these — it silently destroys the patch. Use `--diff`/`--dry-run`
first, then hand-merge.

## What to change → where

| Want to change | Edit |
|---|---|
| AI model | `config/ai.yaml` → `model` |
| ThaiLLM endpoint / timeout / retry | `config/ai.yaml` |
| Company name / department | `config/company.yaml` |
| Logo | Overwrite `frontend/src/assets/logo.png` (the app and the PDF both import from there) |
| Tab icon (favicon) | `frontend/public/favicon.svg`, then regenerate `favicon.ico` via `scripts/build_icons.mjs` (see its header comment) |
| Form number / effective-date text | `config/document.yaml` |
| Header field labels / column names | `config/document.yaml` |
| PDF font size / margins / header color | `config/pdf.yaml` |
| Analyst line at the end of the PDF | `config/pdf.yaml` → `signature` (wording: `config/document.yaml` → `labels.analyst`) |
| JSA drafting rules (step count, etc.) | `config/jsa-rules.yaml` |
| How the AI thinks / what it must not do | `prompts/jsa-generate.md` |
| Work procedure titles / section headings / labels | `config/procedure.yaml` (optional file — deleting it falls back to built-in defaults) |
| Work procedure drafting rules (sub-steps per step) | `config/procedure.yaml` → `generation` |
| How the AI writes the procedure | `prompts/procedure-generate.md` |
| PDF layout logic | `frontend/src/lib/pdf/buildJsaPdf.ts` (JSA table), `buildProcedurePdf.ts` (procedure), `engine.ts` (shared drawing primitives) |
| History retention / entry cap | `frontend/src/history.ts` → `RETENTION_DAYS` / `MAX_ENTRIES` |
| Request size / rate limit / CORS | `config/app.yaml` |

## Fonts

Self-hosted, no external CDN calls at runtime: TH Sarabun New for the PDF
(`frontend/src/assets/fonts/`), Google Sans/Google Sans Text for the web UI
(`frontend/public/fonts/`). TH Sarabun New substitutes for the original
form's CordiaNew, which is Microsoft-licensed.
