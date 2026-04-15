#!/usr/bin/env python3
"""GLiNER sidecar for the captions pipeline.

Reads a JSON object from stdin:
    {
      "text": "<flattened transcript text>",
      "labels": ["person", "organization", ...],
      "threshold": 0.5,
      "model_id": "urchade/gliner_large-v2.1"
    }

Writes a JSON object to stdout:
    {
      "ok": true,
      "mentions": [
        {"label": "person", "start": 0, "end": 9, "score": 0.95, "text": "Dan Brown"},
        ...
      ]
    }

On failure:
    {"ok": false, "error": "..."}

One spawn per transcript. Model loads once per invocation. For corpus-
scale batch runs, consider a long-lived variant later — this is the
"simplest correct thing" per the project's Python policy.
"""

import json
import sys
import traceback


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
    labels = payload.get("labels", [])
    threshold = float(payload.get("threshold", 0.5))
    model_id = payload.get("model_id", "urchade/gliner_large-v2.1")

    if not isinstance(text, str) or not text:
        sys.stdout.write(json.dumps({"ok": True, "mentions": []}))
        return
    if not isinstance(labels, list) or len(labels) == 0:
        fail("labels must be a non-empty list")
        return

    try:
        from gliner import GLiNER
    except ImportError as exc:
        fail(f"gliner not installed: {exc}")
        return

    try:
        model = GLiNER.from_pretrained(model_id)
    except Exception as exc:
        fail(f"failed to load model {model_id}: {exc}")
        return

    # YouTube auto-generated transcripts have almost no punctuation, so
    # handing the whole flattened text to GLiNER results in internal
    # truncation to ~384 tokens. Chunking per-cue goes the other way —
    # each cue is so short (a handful of words) that GLiNER has too
    # little context to fire at all. The sweet spot is to group cues
    # into windowed chunks that are large enough for context but still
    # comfortably under the model window.
    #
    # Strategy: walk lines (cue boundaries from flatten() on the Node
    # side), accumulate them into a running buffer, and emit a chunk
    # whenever the buffer would exceed TARGET_CHUNK_CHARS. Preserves a
    # global offset back into the original text so returned spans can
    # be rebased.
    TARGET_CHUNK_CHARS = 800  # ~250 tokens, well under the 384 window

    # First pass: collect (line, offset) pairs.
    lines = []
    cursor = 0
    while cursor < len(text):
        nl = text.find("\n", cursor)
        if nl == -1:
            nl = len(text)
        line = text[cursor:nl]
        if line.strip():
            lines.append((line, cursor))
        cursor = nl + 1
    if not lines:
        lines = [(text, 0)]

    # Second pass: merge lines into windowed chunks. Each chunk stores
    # its text and the global offset of its first character.
    chunks = []
    buf_parts = []
    buf_start = None
    buf_len = 0
    for line, off in lines:
        # If this line alone is bigger than the window, flush whatever
        # we have and emit the long line as its own chunk (GLiNER's
        # internal windowing will take it from there).
        if len(line) > TARGET_CHUNK_CHARS:
            if buf_parts:
                chunks.append(("\n".join(buf_parts), buf_start))
                buf_parts = []
                buf_start = None
                buf_len = 0
            chunks.append((line, off))
            continue
        prospective = buf_len + (1 if buf_parts else 0) + len(line)
        if buf_parts and prospective > TARGET_CHUNK_CHARS:
            chunks.append(("\n".join(buf_parts), buf_start))
            buf_parts = []
            buf_start = None
            buf_len = 0
        if not buf_parts:
            buf_start = off
            buf_len = len(line)
        else:
            buf_len = prospective
        buf_parts.append(line)
    if buf_parts:
        chunks.append(("\n".join(buf_parts), buf_start))

    debug = bool(payload.get("debug", False))
    if debug:
        sys.stderr.write(
            f"[gliner.py] processing {len(chunks)} chunks "
            f"(target={TARGET_CHUNK_CHARS} chars, total_text={len(text)} chars)\n"
        )

    mentions = []
    for chunk_text, offset in chunks:
        try:
            ents = model.predict_entities(chunk_text, labels, threshold=threshold)
        except Exception as exc:
            sys.stderr.write(f"[gliner.py] chunk failed: {exc}\n")
            continue
        for e in ents:
            try:
                start = int(e["start"]) + offset
                end = int(e["end"]) + offset
                mentions.append(
                    {
                        "label": e["label"],
                        "start": start,
                        "end": end,
                        "score": float(e.get("score", 0.0)),
                        "text": e.get("text", text[start:end]),
                    }
                )
            except Exception:
                continue

    sys.stdout.write(json.dumps({"ok": True, "mentions": mentions}))


if __name__ == "__main__":
    main()
