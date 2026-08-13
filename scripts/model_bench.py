#!/usr/bin/env python3
"""Compare ThaiLLM models using the same prompt and sample job.

Used to choose the default model for config/ai.yaml — never exposed for the
user to pick in the web app.
What it measures:
  - % of responses with usable JSON (most important — if unstable, increase retries)
  - number of steps / hazards produced
  - whether it's genuinely task-level (guessed from how long step titles are)
  - time taken

Usage:
    cd backend && source .venv/bin/activate
    python ../scripts/model_bench.py                 # every candidate_models entry, 5 rounds
    python ../scripts/model_bench.py -n 10           # 10 rounds
    python ../scripts/model_bench.py -m openthaigpt  # test one model only
    python ../scripts/model_bench.py --probe         # just check the endpoint connects
"""

import argparse
import asyncio
import statistics
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.core.config import get_settings  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.models.jsa import AiJsaPayload, GenerateRequest  # noqa: E402
from app.providers.llm.thaillm import ThaiLLMProvider  # noqa: E402
from app.services.ai_service import _build_user_prompt, _load_system_prompt  # noqa: E402
from app.services.json_repair import repair_and_parse  # noqa: E402

# Sample work description, deliberately in Thai — this simulates what a real user would type
SAMPLE_WORK = (
    "เปลี่ยน mechanical seal ของ LPG Pump P-101 ที่ Tank Farm "
    "ต้อง isolate ปั๊ม ระบายความดันและ drain product ก่อนเริ่มงาน "
    "จากนั้นถอด seal เดิม ติดตั้ง seal ใหม่ และตรวจสอบการรั่วก่อนคืนระบบ"
)


async def probe(settings) -> None:
    """Check that base_url + key actually work before spending time on a full bench run."""
    provider = ThaiLLMProvider(settings.ai, settings.thaillm_api_key)
    url = settings.ai.api.base_url + settings.ai.api.chat_completions_path
    print(f"Probing: {url}")
    print(f"model: {settings.ai.model}")
    try:
        reply = await provider.complete(
            "Respond with JSON only",
            'Respond with {"ok":true}',
            model=settings.ai.model,
            json_mode=settings.ai.request_json_mode,
        )
        print(f"\n✓ Connected — got a {len(reply)}-character response")
        print(f"  Sample: {reply[:200]}")
    except AppError as exc:
        print(f"\n✗ Failed: [{exc.code}] {exc.message}")
        print("\nThings to check:")
        print("  - Is base_url / chat_completions_path in config/ai.yaml correct?")
        print("  - Is THAILLM_API_KEY in .env correct and not expired?")
        print("  - Does the model name match what your key has access to?")
    finally:
        await provider.aclose()


async def bench_model(settings, model: str, rounds: int) -> dict:
    provider = ThaiLLMProvider(settings.ai, settings.thaillm_api_key)
    system_prompt = _load_system_prompt(settings)
    request = GenerateRequest(
        supervisor="ผู้ทดสอบ",
        analysis_date=__import__("datetime").date.today(),
        work_description=SAMPLE_WORK,
    )
    user_prompt = _build_user_prompt(request)

    ok = 0
    latencies: list[float] = []
    steps: list[int] = []
    hazards: list[int] = []
    title_lengths: list[int] = []
    failures: dict[str, int] = {}

    try:
        for round_index in range(1, rounds + 1):
            started = time.monotonic()
            try:
                raw = await provider.complete(
                    system_prompt,
                    user_prompt,
                    model=model,
                    json_mode=settings.ai.request_json_mode,
                )
                payload = AiJsaPayload.model_validate(repair_and_parse(raw))
            except AppError as exc:
                failures[exc.code] = failures.get(exc.code, 0) + 1
                print(f"  Round {round_index}: ✗ {exc.code}")
                continue
            except Exception as exc:
                key = type(exc).__name__
                failures[key] = failures.get(key, 0) + 1
                print(f"  Round {round_index}: ✗ JSON/schema failed ({key})")
                continue

            elapsed = time.monotonic() - started
            ok += 1
            latencies.append(elapsed)
            steps.append(len(payload.steps))
            hazards.append(sum(len(s.hazards) for s in payload.steps))
            title_lengths.extend(len(s.procedure) for s in payload.steps)
            print(
                f"  Round {round_index}: ✓ {len(payload.steps)} steps "
                f"({elapsed:.1f}s)"
            )
    finally:
        await provider.aclose()

    return {
        "model": model,
        "rounds": rounds,
        "ok": ok,
        "json_rate": ok / rounds if rounds else 0,
        "latency_med": statistics.median(latencies) if latencies else None,
        "steps_med": statistics.median(steps) if steps else None,
        "hazards_med": statistics.median(hazards) if hazards else None,
        "title_len_med": statistics.median(title_lengths) if title_lengths else None,
        "failures": failures,
    }


def report(results: list[dict]) -> None:
    print("\n" + "=" * 78)
    print("Summary")
    print("=" * 78)
    header = f"{'model':<18}{'JSON ok':>9}{'time(med)':>11}{'steps':>9}{'hazards':>9}{'title len':>12}"
    print(header)
    print("-" * 78)
    for r in results:
        latency = f"{r['latency_med']:.1f}s" if r["latency_med"] else "-"
        print(
            f"{r['model']:<18}"
            f"{r['ok']}/{r['rounds']:<7}"
            f"{latency:>11}"
            f"{str(r['steps_med'] or '-'):>9}"
            f"{str(r['hazards_med'] or '-'):>9}"
            f"{str(r['title_len_med'] or '-'):>12}"
        )
        if r["failures"]:
            detail = ", ".join(f"{k}×{v}" for k, v in r["failures"].items())
            print(f"{'':<18}Issues seen: {detail}")

    print("\nHow to read this:")
    print("  JSON ok    — below 90%, increase retry.max_attempts in config/ai.yaml")
    print("  steps      — should sit in the 3-12 range per jsa-rules.yaml")
    print("  title len  — over ~60 characters usually means the AI is writing work")
    print("               instructions instead of task-level steps — reinforce that in prompts/jsa-generate.md")
    print("\nPick whichever model is most stable at returning JSON first, then judge content quality.")
    print("Put the chosen model into config/ai.yaml -> model:")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Compare ThaiLLM models")
    parser.add_argument("-n", "--rounds", type=int, default=5, help="rounds per model")
    parser.add_argument("-m", "--model", help="test a single model only")
    parser.add_argument("--probe", action="store_true", help="just check the connection")
    args = parser.parse_args()

    settings = get_settings()

    if args.probe:
        await probe(settings)
        return

    models = [args.model] if args.model else (
        settings.ai.candidate_models or [settings.ai.model]
    )

    results = []
    for model in models:
        print(f"\n=== {model} ({args.rounds} rounds) ===")
        results.append(await bench_model(settings, model, args.rounds))

    report(results)


if __name__ == "__main__":
    asyncio.run(main())
