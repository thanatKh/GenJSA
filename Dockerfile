# GenJSA — single image: FastAPI serves both the API and the built frontend
#
# The PDF is built client-side (jsPDF) — this image has no Chromium, so it's
# small and runs comfortably on a small instance (no need to budget the
# 300-500MB RAM that Playwright would have required)

# ---------- stage 1: build frontend ----------
FROM node:22-slim AS frontend

WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------- stage 2: runtime ----------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Files that can be edited without touching code — config, prompt, logo
# (PDF fonts now live under frontend/src/assets/fonts/ and get bundled with the frontend build)
COPY config/    ./config/
COPY prompts/   ./prompts/
COPY assets/    ./assets/
COPY backend/   ./backend/

# The built frontend — main.py looks for files at <root>/frontend/dist
COPY --from=frontend /build/dist ./frontend/dist

WORKDIR /app/backend

# Render supplies $PORT — must bind to it (defaults to 8000 for local runs)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
