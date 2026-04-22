#!/usr/bin/env python3
"""Sentence-embedding sidecar for the captions pipeline.

Plan 04 §B (plans2/04-contradictions-v2.md). Takes a batch of text
strings and returns one embedding per text. Used by the cross-video
contradiction detector to replace token-Jaccard with semantic cosine
similarity.

Protocol:

    stdin:  {
              "texts": ["claim text 1", "claim text 2", ...],
              "model_id": "all-MiniLM-L6-v2",          # optional
              "normalize": true,                        # optional (default true)
              "batch_size": 64                          # optional
            }

    stdout: {
              "ok": true,
              "model_id": "<resolved>",
              "dimensions": 384,
              "embeddings": [[...], [...], ...]         # len == len(texts)
            }

    on failure: { "ok": false, "error": "..." }

One spawn per batch. Model loads once per invocation. For corpus-scale
re-embedding, call once with all texts. The Node side caches output
keyed by claim text so re-runs are cheap.
"""

import json
import sys
import traceback
import warnings

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

    texts = payload.get("texts", [])
    model_id = payload.get("model_id", "all-MiniLM-L6-v2")
    normalize = bool(payload.get("normalize", True))
    batch_size = int(payload.get("batch_size", 64))

    if not isinstance(texts, list):
        fail("`texts` must be a list of strings")
        return
    if len(texts) == 0:
        sys.stdout.write(
            json.dumps(
                {"ok": True, "model_id": model_id, "dimensions": 0, "embeddings": []}
            )
        )
        return

    # Coerce to strings; the sentence-transformers API tolerates
    # anything str-able, but we want the JSON output deterministic.
    texts = [str(t) for t in texts]

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        fail(f"sentence-transformers not installed: {exc}")
        return

    try:
        model = SentenceTransformer(model_id)
    except Exception as exc:
        fail(f"failed to load model {model_id}: {exc}\n{traceback.format_exc(limit=3)}")
        return

    try:
        # `encode` is synchronous and batches internally; batch_size is
        # a hint, not a hard limit. Pre-normalized vectors let the Node
        # cosine implementation skip magnitude division (dot product is
        # cosine for unit vectors).
        vecs = model.encode(
            texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=normalize,
            show_progress_bar=False,
        )
    except Exception as exc:
        fail(f"encode failed: {exc}\n{traceback.format_exc(limit=3)}")
        return

    try:
        dims = int(vecs.shape[1]) if vecs.ndim == 2 else 0
        out = {
            "ok": True,
            "model_id": model_id,
            "dimensions": dims,
            "embeddings": vecs.tolist(),
        }
        sys.stdout.write(json.dumps(out))
        sys.stdout.flush()
    except Exception as exc:
        fail(f"serialize failed: {exc}")


if __name__ == "__main__":
    main()
