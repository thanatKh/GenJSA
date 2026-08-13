# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GenJSA drafts a Job Safety Analysis (การวิเคราะห์งานเพื่อความปลอดภัย) against the
`F-ปธบ.-1202` form: the user describes the work in natural Thai, an LLM drafts
the JSA, the user reviews/edits every field, and the finished document is
exported as an A4 PDF — entirely client-side.

```
Enter work details  →  AI drafts JSA  →  Review and edit  →  Open PDF
```

## Non-negotiable design principles

These constraints shape almost every implementation decision here — check
against them before adding anything:

- **No database, no login, no history, no file storage.**
- **No JSA content persistence** — data lives in memory only for the
  duration of one request, then it's gone. The frontend keeps drafts only in
  `sessionStorage` (tab-scoped, gone on tab close; see `frontend/src/store.ts`).
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

The backend **never generates a PDF**. `GET /api/config/public` hands the
frontend layout values sourced from `config/pdf.yaml` (page size, fonts,
table widths, colors) so `frontend/src/lib/pdf/buildJsaPdf.ts` can draw the
document itself. This keeps the backend Chromium-free and lets document
appearance be config-tunable from both sides without duplicating logic.

### Backend generation pipeline (`backend/app/services/ai_service.py`)

1. Load `prompts/jsa-generate.md`, render it with Jinja2 against
   `config/jsa-rules.yaml` (not cached — edits take effect immediately).
2. Call the LLM provider (`providers/llm/`) with the system + user prompt.
3. `services/json_repair.py` attempts to coerce the raw text into valid JSON.
4. Validate into `models.jsa.AiJsaPayload` (Pydantic).
5. On failure (bad JSON / invalid schema / provider rejects `json_mode`),
   retry up to `config/ai.yaml`'s `retry.max_attempts`, appending a Thai
   "answer with JSON only" reminder and falling back to non-JSON-mode.
6. On success, `AiJsaPayload` (AI-owned fields: `work_activity`, `steps`,
   `assumptions`) is combined with request-supplied fields (`supervisor`,
   `analysis_date`) into the final `JsaDocument`.

`JsaDocument.steps` numbering is re-derived server-side on every validation
(`renumber_steps`) — the frontend can freely add/remove/reorder steps, and
the backend is the single source of truth for step numbers printed on the
document.

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

Three-step wizard driven by `App.tsx`'s `stage` state (0/1/2):

- `features/jsa-input/InputStep.tsx` — work description form → triggers generate.
- `features/jsa-editor/EditorStep.tsx` — edit the generated `JsaDocument` before export.
- `features/pdf-view/PdfStep.tsx` — renders/downloads the PDF.
- `lib/schema.ts` — TS types/zod schema mirroring `backend/app/models/jsa.py` by hand (keep both in sync when the shape changes).
- `lib/api.ts` — typed fetch wrapper for `/api/*`.
- `lib/pdf/` — the PDF layout engine (jsPDF). `buildJsaPdf.ts` measures text, wraps lines, computes row heights, and paginates by hand since jsPDF has no HTML/CSS layout engine. Thai line wrapping has no word-segmentation dictionary — a break can occasionally land mid-word by design trade-off (never overflows a column, though).
- `store.ts` — sessionStorage-backed drafts (see persistence principle above).

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
| Logo | Overwrite `assets/logo.png` |
| Form number / effective-date text | `config/document.yaml` |
| Header field labels / column names | `config/document.yaml` |
| PDF font size / margins / header color | `config/pdf.yaml` |
| JSA drafting rules (step count, etc.) | `config/jsa-rules.yaml` |
| How the AI thinks / what it must not do | `prompts/jsa-generate.md` |
| PDF layout logic | `frontend/src/lib/pdf/buildJsaPdf.ts` |
| Request size / rate limit / CORS | `config/app.yaml` |

## Fonts

Self-hosted, no external CDN calls at runtime: TH Sarabun New for the PDF
(`frontend/src/assets/fonts/`), Google Sans/Google Sans Text for the web UI
(`frontend/public/fonts/`). TH Sarabun New substitutes for the original
form's CordiaNew, which is Microsoft-licensed.
