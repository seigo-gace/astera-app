from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

import sacrebleu

MODEL_ID = "google/madlad400-3b-mt"
MODEL_REVISION = "fa184c675da0b5c9e1c8694fccd4e12e2d422094"


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def call_engine(origin: str, token: str, source: str, target_language: str, timeout: float) -> tuple[str, float, dict[str, Any]]:
    request = urllib.request.Request(
        f"{origin.rstrip('/')}/v1/translate",
        data=json.dumps({"texts": [source], "target_language": target_language, "strategy": "document"}, ensure_ascii=False).encode("utf-8"),
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"translation engine HTTP {error.code}: {body[:1000]}") from error
    elapsed_ms = (time.perf_counter() - started) * 1000
    if payload.get("model") != MODEL_ID or payload.get("model_revision") != MODEL_REVISION:
        raise RuntimeError("benchmark engine does not match pinned model identity")
    if int(payload.get("external_api_calls", -1)) != 0:
        raise RuntimeError("benchmark engine reported an external API call")
    translations = payload.get("translations")
    if not isinstance(translations, list) or len(translations) != 1 or not isinstance(translations[0], str):
        raise RuntimeError("translation engine returned invalid translations")
    return translations[0], elapsed_ms, payload


def load_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        value = json.loads(raw)
        required = ["id", "source", "target_language", "reference"]
        if not isinstance(value, dict) or any(not isinstance(value.get(key), str) or not value[key].strip() for key in required):
            raise ValueError(f"invalid benchmark case at line {line_number}: required string fields are {required}")
        critical = value.get("critical_tokens", [])
        if not isinstance(critical, list) or not all(isinstance(item, str) and item for item in critical):
            raise ValueError(f"invalid critical_tokens at line {line_number}")
        cases.append(value)
    if not cases:
        raise ValueError("benchmark case file is empty")
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark the pinned local MADLAD translation engine against human references.")
    parser.add_argument("--cases", required=True, help="UTF-8 JSONL: id, source, target_language, reference, optional source_language/category/critical_tokens.")
    parser.add_argument("--origin", default=os.environ.get("ASTERA_TRANSLATION_ENGINE_ORIGIN", "http://127.0.0.1:8792"))
    parser.add_argument("--token", default=os.environ.get("ASTERA_TRANSLATION_INTERNAL_TOKEN", ""))
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--output", help="Optional JSON report output path.")
    args = parser.parse_args()
    if not args.token:
        raise RuntimeError("ASTERA_TRANSLATION_INTERNAL_TOKEN or --token is required")
    if not (args.origin.startswith("http://127.0.0.1") or args.origin.startswith("http://localhost") or args.origin.startswith("http://[::1]")):
        raise RuntimeError("benchmark origin must be loopback-local")

    cases = load_cases(Path(args.cases))
    rows: list[dict[str, Any]] = []
    grouped: dict[str, list[int]] = defaultdict(list)
    latencies: list[float] = []
    critical_total = 0
    critical_preserved = 0

    for index, case in enumerate(cases):
        translated, elapsed_ms, payload = call_engine(args.origin, args.token, case["source"], case["target_language"], args.timeout)
        latencies.append(elapsed_ms)
        source_language = str(case.get("source_language", "auto"))
        pair = f"{source_language}->{case['target_language']}"
        grouped[pair].append(index)
        critical_tokens = case.get("critical_tokens", [])
        preserved = sum(1 for token in critical_tokens if translated.count(token) == case["reference"].count(token) == 1)
        critical_total += len(critical_tokens)
        critical_preserved += preserved
        rows.append({
            "id": case["id"],
            "category": case.get("category", "unspecified"),
            "pair": pair,
            "source": case["source"],
            "reference": case["reference"],
            "translation": translated,
            "latency_ms": round(elapsed_ms, 2),
            "input_tokens": payload.get("input_tokens", 0),
            "output_tokens": payload.get("output_tokens", 0),
            "critical_tokens": len(critical_tokens),
            "critical_tokens_preserved": preserved,
        })

    hypotheses = [row["translation"] for row in rows]
    references = [[row["reference"] for row in rows]]
    bleu = sacrebleu.corpus_bleu(hypotheses, references, tokenize="flores101")
    chrf = sacrebleu.corpus_chrf(hypotheses, references, word_order=2)

    by_pair: dict[str, Any] = {}
    for pair, indices in sorted(grouped.items()):
        pair_hyp = [hypotheses[index] for index in indices]
        pair_ref = [[rows[index]["reference"] for index in indices]]
        by_pair[pair] = {
            "cases": len(indices),
            "bleu": round(float(sacrebleu.corpus_bleu(pair_hyp, pair_ref, tokenize="flores101").score), 3),
            "chrf_pp": round(float(sacrebleu.corpus_chrf(pair_hyp, pair_ref, word_order=2).score), 3),
        }

    report = {
        "schema_version": 1,
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "external_api_calls": 0,
        "cases": len(rows),
        "quality": {
            "bleu": round(float(bleu.score), 3),
            "chrf_pp": round(float(chrf.score), 3),
            "critical_token_exact_rate": round(critical_preserved / critical_total, 6) if critical_total else None,
            "critical_token_total": critical_total,
        },
        "latency_ms": {
            "mean": round(statistics.fmean(latencies), 2),
            "p50": round(percentile(latencies, 0.50), 2),
            "p95": round(percentile(latencies, 0.95), 2),
            "max": round(max(latencies), 2),
        },
        "by_pair": by_pair,
        "rows": rows,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
