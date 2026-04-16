#!/usr/bin/env python3
"""Coreference resolution sidecar for the captions pipeline.

Reads a JSON object from stdin:
    {"text": "<flattened transcript text>"}

Writes a JSON object to stdout:
    {"ok": true, "resolved_text": "...", "clusters": [[[start,end], ...], ...]}

On failure:
    {"ok": false, "error": "..."}

This is the simplest correct thing. Node spawns `python tools/coref.py`,
pipes one JSON object in, reads one JSON object out, moves on. No HTTP, no
long-lived process, no shared state. If fastcoref isn't installed the script
exits nonzero with a JSON error and the Node side logs a warning and skips
coref — the pipeline still runs.
"""

import json
import sys
import traceback
import warnings

# Silence huggingface_hub `resume_download` deprecation and any other
# transient library warnings.
warnings.filterwarnings("ignore")


def fail(msg: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": msg}))
    sys.stdout.flush()
    sys.exit(1)


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as exc:
        fail(f"bad input json: {exc}")
        return

    text = payload.get("text", "")
    if not isinstance(text, str) or not text:
        sys.stdout.write(json.dumps({"ok": True, "resolved_text": text, "clusters": []}))
        return

    try:
        from fastcoref import FCoref
    except ImportError as exc:
        fail(f"fastcoref not installed: {exc}")
        return

    try:
        model = FCoref(device="cpu")
        preds = model.predict(texts=[text])
        pred = preds[0]
        clusters = pred.get_clusters(as_strings=False)
        resolved = text
        try:
            resolved = pred.get_resolved_text() if hasattr(pred, "get_resolved_text") else text
        except Exception:
            resolved = text
        sys.stdout.write(json.dumps({
            "ok": True,
            "resolved_text": resolved,
            "clusters": clusters,
        }))
    except Exception as exc:
        fail(f"coref inference failed: {exc}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
