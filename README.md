# GenJSA

A tool for drafting a **Job Safety Analysis (การวิเคราะห์งานเพื่อความปลอดภัย)**
per the `F-ปธบ.-1202` form — describe the work in natural Thai, AI drafts a
JSA, the user edits every field, and it's exported as an A4 PDF.

```
Enter work details  →  AI drafts JSA  →  Review and edit  →  Open PDF
```

## Principles this system follows

| Principle | Meaning |
|---|---|
| **No database** | No DB, no login, no history, no file storage |
| **No JSA content persistence** | Data lives in memory only for the duration of one request, then it's gone |
| **No content logging** | Logs capture only error/status level — never work descriptions or JSA content |
| **AI drafts, humans review** | No automated review system — the supervisor reviews and is responsible |
| **Config, not code, changes behavior** | No admin UI — everything changeable lives in `config/` |
| **API key stays on the backend** | The key never reaches the browser |

## Prerequisites

- **Python 3.12+** — install from [python.org](https://www.python.org/downloads/) (no Homebrew needed)
  The macOS-bundled Python 3.9 won't work — current fastapi/uvicorn/pytest all require ≥3.10
- **Node 20+**
- **A ThaiLLM API key**

## Running locally

```bash
# 1) backend
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

cp .env.example .env                 # then fill in THAILLM_API_KEY

cd backend && uvicorn app.main:app --reload --port 8000

# 2) frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 — vite already proxies `/api` to the backend.

### Check the ThaiLLM connection

```bash
cd backend && source .venv/bin/activate
python ../scripts/model_bench.py --probe
```

If it can't connect, fix `base_url` / `chat_completions_path` in `config/ai.yaml`.

### Choose the default model

```bash
python ../scripts/model_bench.py -n 10
```

Fires the same prompt at every model in `candidate_models` and compares how
reliably each returns valid JSON, how many steps it produces, and how long
it takes → put the result in `config/ai.yaml`.

## Tests

```bash
cd backend && source .venv/bin/activate && pytest
```

## What to change → where

| Want to change | Edit |
|---|---|
| AI model | `config/ai.yaml` → `model` |
| ThaiLLM endpoint / timeout / retry | `config/ai.yaml` |
| Company name / department | `config/company.yaml` |
| Logo | Overwrite `assets/logo.png` with a new file |
| Form number / effective-date text | `config/document.yaml` |
| Header field labels / column names | `config/document.yaml` |
| PDF font size / margins / header color | `config/pdf.yaml` |
| JSA drafting rules (step count, etc.) | `config/jsa-rules.yaml` |
| How the AI thinks / what it must not do | `prompts/jsa-generate.md` |
| PDF layout logic | `frontend/src/lib/pdf/buildJsaPdf.ts` |
| Request size / rate limit / CORS | `config/app.yaml` |
| Brand colors / UI theme | `frontend/src/styles/tokens.css` |

## PDF generation

The PDF is built **entirely in the browser** with jsPDF
(`frontend/src/lib/pdf/`) — the backend has no Chromium, no PDF route, and
never sees the finished document. It only serves layout values from
`config/pdf.yaml` via `GET /api/config/public`, so the document's appearance
can still be tuned from config without touching code on either side.

Because jsPDF has no HTML/CSS layout engine, `buildJsaPdf.ts` measures text,
wraps lines, computes row heights, and paginates by hand. One accepted
trade-off: Thai line wrapping has no word-segmentation dictionary, so a
break can occasionally land mid-word — still readable, never overflows a
column.

## Fonts

| Used for | Font | Location |
|---|---|---|
| PDF | TH Sarabun New (Regular/Bold) | `frontend/src/assets/fonts/` |
| Web UI | Google Sans / Google Sans Text | `frontend/public/fonts/` |

Both sets are self-hosted — no external CDN calls at runtime. The original
form uses CordiaNew, but that's a Microsoft-licensed font, so TH Sarabun New
(one of Thailand's 13 free national fonts) is used instead.

To regenerate the web fonts, pull fresh files from Google Fonts and
overwrite `frontend/src/styles/fonts.css` + `frontend/public/fonts/` (keep
only the `latin`, `latin-ext`, and `thai` subsets).

## Deploying to Render

1. Push the repo to GitHub (make sure `.env` isn't included — it's already in `.gitignore`)
2. Render → New → Blueprint → select the repo (it reads `render.yaml` automatically)
3. Set `THAILLM_API_KEY` in Dashboard → Environment
4. Deploy

Since PDF generation is client-side, the backend has no Chromium and needs
very little memory — `render.yaml` uses the `starter` plan (512MB), which is
plenty.

## Structure

```
GenJSA/
├── frontend/           React + TS + Vite + Tailwind v4 (3-step wizard)
│   └── src/
│       ├── lib/pdf/     PDF layout engine (jsPDF, runs client-side)
│       ├── features/    input / editor / pdf-view steps
│       └── components/
│           ├── ui/        shadcn/ui primitives (Radix) — generated via the
│           │               shadcn CLI, then hand-patched for brand tokens/
│           │               tap-target sizes; see CLAUDE.md before re-running
│           │               `shadcn add` on an already-patched file
│           └── ui.tsx     app-specific wrappers over components/ui/*
├── backend/             FastAPI (stateless)
│   └── app/
│       ├── api/          routes
│       ├── core/         config, errors, rate limiting, Thai dates
│       ├── models/       Pydantic schema for a JSA
│       ├── providers/    LLM provider (swap vendors without touching JSA logic)
│       └── services/     generation, JSON repair
├── config/              everything that's meant to be changed
├── prompts/             the AI's prompt
├── assets/              logo + PDF fonts
├── references/          the original form (source of truth, not committed)
└── scripts/             model_bench.py
```
