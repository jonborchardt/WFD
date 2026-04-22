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
        # ST 5.x `encode` can trip on a single malformed text in a batch
        # (the underlying tokenizer raises a TextEncodeInput error that
        # taints the whole call). Encode chunk-by-chunk so one bad row
        # doesn't kill the batch; fall through to an empty vector for
        # any row that individually fails, log the bad text's first
        # 80 chars to stderr so the operator can diagnose.
        import numpy as np

        # Coerce hard: strip control chars, truncate extreme outliers,
        # and replace empty / whitespace-only entries with a single
        # space so the tokenizer still returns a valid (if meaningless)
        # vector.
        # Grab the tokenizer off the first module so we can do a proper
        # 400-token truncation rather than the previous char-cap heuristic
        # (Plan 04 edge-case). Falls back to the char cap if the module
        # doesn't expose one (rare on this family of models).
        tokenizer = None
        try:
            tokenizer = model.tokenizer  # type: ignore[attr-defined]
        except Exception:
            tokenizer = None

        def clean(t):
            if not isinstance(t, str):
                t = str(t)
            # remove chars that commonly break HF tokenizers
            t = "".join(
                ch for ch in t if ch == "\n" or ch == "\t" or ord(ch) >= 0x20
            )
            t = t.strip()
            if not t:
                t = " "
            # Token-aware cap: truncate to the model's useful window
            # (400 tokens is comfortably under all-MiniLM's 512 max,
            # leaving room for special tokens). Tokenize + decode back
            # to a string so the downstream encode call doesn't re-
            # tokenize with a padding that would overflow.
            if tokenizer is not None:
                try:
                    enc = tokenizer.encode(t, add_special_tokens=False)
                    if len(enc) > 400:
                        enc = enc[:400]
                        t = tokenizer.decode(enc, skip_special_tokens=True)
                except Exception:
                    # fall through to char cap on any tokenizer oddity
                    pass
            if len(t) > 4000:
                t = t[:4000]
            return t

        cleaned = [clean(t) for t in texts]

        all_vecs = []
        dims = 0
        start = 0
        while start < len(cleaned):
            end = min(start + batch_size, len(cleaned))
            chunk = cleaned[start:end]
            try:
                v = model.encode(chunk, show_progress_bar=False)
                if hasattr(v, "cpu"):
                    v = v.cpu().numpy()
                v = np.asarray(v, dtype=np.float32)
                if v.ndim == 1:
                    v = v.reshape(1, -1)
                if dims == 0 and v.ndim == 2:
                    dims = int(v.shape[1])
                for row in v:
                    all_vecs.append(row)
            except Exception as chunk_exc:
                # Fall back to one-at-a-time within this chunk so one
                # bad row only costs itself.
                sys.stderr.write(
                    f"[embeddings] chunk {start}..{end} failed "
                    f"({chunk_exc}); falling back per-row\n"
                )
                for t in chunk:
                    try:
                        v = model.encode([t], show_progress_bar=False)
                        if hasattr(v, "cpu"):
                            v = v.cpu().numpy()
                        v = np.asarray(v, dtype=np.float32)
                        if v.ndim == 1:
                            v = v.reshape(1, -1)
                        if dims == 0:
                            dims = int(v.shape[1])
                        all_vecs.append(v[0])
                    except Exception as row_exc:
                        sys.stderr.write(
                            f"[embeddings] row failed "
                            f"({str(row_exc)[:60]}): "
                            f"{t[:80]!r}\n"
                        )
                        # Zero vector so indices stay aligned with the
                        # caller's batch; caller can detect all-zeros
                        # and fall back to Jaccard for this claim.
                        all_vecs.append(np.zeros(dims or 384, dtype=np.float32))
            start = end

        vecs = np.vstack(all_vecs) if all_vecs else np.zeros((0, dims or 384), dtype=np.float32)

        if normalize and vecs.ndim == 2 and vecs.shape[0] > 0:
            norms = np.linalg.norm(vecs, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            vecs = vecs / norms
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
