#!/usr/bin/env python3
"""GLiREL sidecar for the captions pipeline.

Reads a JSON object from stdin:
    {
      "sentences": [
        {
          "text": "Dan Brown founded a studio in Boston.",
          "entities": [
            {"start": 0, "end": 9, "label": "person", "surface": "Dan Brown"},
            {"start": 20, "end": 26, "label": "facility", "surface": "studio"},
            {"start": 30, "end": 36, "label": "location", "surface": "Boston"}
          ],
          "predicates": ["founded", "located_in", ...]
        },
        ...
      ],
      "threshold": 0.5,
      "model_id": "jackboyla/glirel-large-v0"
    }

Writes a JSON object to stdout:
    {
      "ok": true,
      "results": [
        [
          {"subjectIndex": 0, "objectIndex": 1, "predicate": "founded",    "score": 0.88},
          {"subjectIndex": 0, "objectIndex": 2, "predicate": "located_in", "score": 0.90}
        ],
        ...
      ]
    }

On failure:
    {"ok": false, "error": "..."}

One spawn per transcript. Batches all sentences in a single invocation
so the GLiREL model loads exactly once.

NOTE: GLiREL is a younger project and its Python API may shift between
versions. This script assumes the labeled-entity interface exposed by
the `glirel` package on PyPI. If the API differs in your installed
version, edit the `score_sentence` function below — the Node side is
agnostic to how scoring is performed as long as the JSON protocol is
honored.
"""

import json
import sys
import traceback
import warnings

# Silence huggingface_hub `resume_download` deprecation and any other
# transient library warnings. These are information-only.
warnings.filterwarnings("ignore")


def fail(msg: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": msg}))
    sys.stdout.flush()
    sys.exit(1)


def _tokenize(text):
    """Whitespace tokenizer. Returns a parallel list of (token, char_start,
    char_end) so we can map char-based entity spans onto token indices."""
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        while i < n and text[i].isspace():
            i += 1
        if i >= n:
            break
        start = i
        while i < n and not text[i].isspace():
            i += 1
        tokens.append((text[start:i], start, i))
    return tokens


def _char_span_to_token_range(tok_info, char_start, char_end):
    """Map [char_start, char_end) to an inclusive [tok_start, tok_end]
    token range, or None if no token overlaps."""
    first = None
    last = None
    for ti, (_, cs, ce) in enumerate(tok_info):
        overlaps = cs < char_end and ce > char_start
        if overlaps:
            if first is None:
                first = ti
            last = ti
    if first is None:
        return None
    return (first, last)


DEBUG = False  # set by main() from payload


def dbg(msg):
    if DEBUG:
        sys.stderr.write(f"[glirel.py] {msg}\n")


def score_sentence(model, sentence, predicates, threshold):
    """Run GLiREL on one sentence and return a list of scored triples
    in the project's on-wire format.

    GLiREL's inference API takes:
      - tokens:  List[str]
      - labels:  List[str]  (relation types)
      - ner:     List[[tok_start, tok_end, entity_type, entity_text]]
        (inclusive token indices)
      - threshold, top_k

    and returns relations shaped like:
      { head_pos: [s,e], tail_pos: [s,e], head_text, tail_text, label, score }

    We feed GLiREL the whitespace-tokenized sentence, translate each
    char-based entity span (from GLiNER) into inclusive token indices,
    call predict_relations, then match each returned head_pos/tail_pos
    back to the original entity index by finding the entity whose
    token-start matches.
    """
    text = sentence["text"]
    entities = sentence["entities"]
    if not text or len(entities) < 2:
        return []

    tok_info = _tokenize(text)
    if len(tok_info) == 0:
        return []
    tokens = [t for (t, _, _) in tok_info]

    ner = []
    entity_token_ranges = []  # parallel to `entities`; (tok_start, tok_end) or None
    for ent in entities:
        span = _char_span_to_token_range(
            tok_info, int(ent["start"]), int(ent["end"])
        )
        entity_token_ranges.append(span)
        if span is None:
            continue
        ts, te = span
        ner.append(
            [
                ts,
                te,
                ent.get("label", "entity"),
                " ".join(tokens[ts : te + 1]),
            ]
        )

    dbg(f"sentence: tokens={len(tokens)} entities={len(entities)} ner={len(ner)}")
    if len(ner) < 2:
        return []

    # GLiREL is a zero-shot model trained on natural-language relation
    # labels (e.g. "country of origin", "founder", "headquartered in").
    # Our internal schema uses snake_case so the rest of the pipeline
    # gets stable predicate ids. Translate snake_case to spaces on the
    # way into the model, then translate back when reading the output.
    def label_to_natural(p):
        return p.replace("_", " ")
    def natural_to_label(p):
        return p.replace(" ", "_")
    natural_predicates = [label_to_natural(p) for p in predicates]

    try:
        preds = model.predict_relations(
            tokens,
            natural_predicates,
            threshold=threshold,
            ner=ner,
            top_k=1,
        )
    except Exception as exc:
        sys.stderr.write(f"[glirel.py] predict_relations failed: {exc}\n")
        return []
    dbg(f"  predict_relations returned {len(preds)} raw preds (threshold={threshold})")
    if preds and DEBUG:
        dbg(f"  sample pred: {json.dumps(preds[0], default=str)[:400]}")

    # Match each (head_pos, tail_pos) back to an index into the original
    # `entities` list by finding the entity whose recorded token-start
    # matches the prediction's token-start. If the package's output uses
    # exclusive ends we still match on starts, which is reliable enough.
    def find_entity_by_token_start(tok_start):
        for i, tr in enumerate(entity_token_ranges):
            if tr is not None and tr[0] == tok_start:
                return i
        return None

    out = []
    for p in preds:
        try:
            head_pos = p.get("head_pos") or []
            tail_pos = p.get("tail_pos") or []
            raw_label = p.get("label") or p.get("predicate")
            label = natural_to_label(raw_label) if raw_label else None
            score = float(p.get("score", 0.0))
            if label is None or not head_pos or not tail_pos:
                continue
            subj_idx = find_entity_by_token_start(int(head_pos[0]))
            obj_idx = find_entity_by_token_start(int(tail_pos[0]))
            if subj_idx is None or obj_idx is None or subj_idx == obj_idx:
                continue
            out.append(
                {
                    "subjectIndex": subj_idx,
                    "objectIndex": obj_idx,
                    "predicate": label,
                    "score": score,
                }
            )
        except Exception:
            continue
    return out


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as exc:
        fail(f"bad input json: {exc}")
        return

    sentences = payload.get("sentences", [])
    threshold = float(payload.get("threshold", 0.5))
    model_id = payload.get("model_id", "jackboyla/glirel-large-v0")
    global DEBUG
    DEBUG = bool(payload.get("debug", False))
    dbg(f"received {len(sentences)} sentences, threshold={threshold}")

    if not isinstance(sentences, list):
        fail("sentences must be a list")
        return
    if len(sentences) == 0:
        sys.stdout.write(json.dumps({"ok": True, "results": []}))
        return

    try:
        from glirel import GLiREL
    except ImportError as exc:
        fail(f"glirel not installed: {exc}")
        return

    # Workaround for huggingface_hub API drift: some GLiREL versions
    # define `_from_pretrained` with required keyword-only args
    # (`proxies`, `resume_download`) that newer huggingface_hub releases
    # no longer pass through. Patch defaults in so the load still works
    # without forcing the user to downgrade huggingface_hub.
    try:
        import inspect
        orig_cm = GLiREL.__dict__.get("_from_pretrained")
        if orig_cm is not None:
            orig_fn = getattr(orig_cm, "__func__", orig_cm)
            params = inspect.signature(orig_fn).parameters
            needs_patch = any(
                name in params
                and params[name].kind == inspect.Parameter.KEYWORD_ONLY
                and params[name].default is inspect.Parameter.empty
                for name in ("proxies", "resume_download")
            )
            if needs_patch:
                def _patched(cls, *args, **kwargs):
                    kwargs.setdefault("proxies", None)
                    kwargs.setdefault("resume_download", None)
                    return orig_fn(cls, *args, **kwargs)
                GLiREL._from_pretrained = classmethod(_patched)
    except Exception as exc:
        sys.stderr.write(f"[glirel.py] monkey-patch skipped: {exc}\n")

    try:
        model = GLiREL.from_pretrained(model_id)
    except Exception as exc:
        fail(f"failed to load model {model_id}: {exc}")
        return

    results = []
    for idx, sent in enumerate(sentences):
        try:
            predicates = sent.get("predicates", [])
            if not predicates:
                results.append([])
                continue
            scored = score_sentence(model, sent, predicates, threshold)
            dbg(f"  sentence[{idx}]: {len(scored)} scored triples returned")
            results.append(scored)
        except Exception as exc:
            sys.stderr.write(f"[glirel.py] sentence[{idx}] failed: {exc}\n")
            results.append([])

    sys.stdout.write(json.dumps({"ok": True, "results": results}))


def process_request(model, payload):
    """Shared inference logic for both one-shot and daemon modes."""
    sentences = payload.get("sentences", [])
    threshold = float(payload.get("threshold", 0.5))
    if not isinstance(sentences, list) or len(sentences) == 0:
        return {"ok": True, "results": []}

    results = []
    for idx, sent in enumerate(sentences):
        try:
            predicates = sent.get("predicates", [])
            if not predicates:
                results.append([])
                continue
            scored = score_sentence(model, sent, predicates, threshold)
            results.append(scored)
        except Exception as exc:
            sys.stderr.write(f"[glirel.py] sentence[{idx}] failed: {exc}\n")
            results.append([])

    return {"ok": True, "results": results}


def _load_glirel(model_id):
    """Load GLiREL with the huggingface_hub monkey-patch for API drift."""
    from glirel import GLiREL
    try:
        import inspect
        orig_cm = GLiREL.__dict__.get("_from_pretrained")
        if orig_cm is not None:
            orig_fn = getattr(orig_cm, "__func__", orig_cm)
            params = inspect.signature(orig_fn).parameters
            needs_patch = any(
                name in params
                and params[name].kind == inspect.Parameter.KEYWORD_ONLY
                and params[name].default is inspect.Parameter.empty
                for name in ("proxies", "resume_download")
            )
            if needs_patch:
                def _patched(cls, *args, **kwargs):
                    kwargs.setdefault("proxies", None)
                    kwargs.setdefault("resume_download", None)
                    return orig_fn(cls, *args, **kwargs)
                GLiREL._from_pretrained = classmethod(_patched)
    except Exception as exc:
        sys.stderr.write(f"[glirel.py] monkey-patch skipped: {exc}\n")
    return GLiREL.from_pretrained(model_id)


def daemon_mode():
    """Long-lived mode: load model once, process line-delimited JSON."""
    model_id = "jackboyla/glirel-large-v0"
    try:
        from glirel import GLiREL  # noqa: F401 — needed for _load_glirel
    except ImportError as exc:
        sys.stdout.write(json.dumps({"ready": False, "error": f"glirel not installed: {exc}"}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    try:
        model = _load_glirel(model_id)
    except Exception as exc:
        sys.stdout.write(json.dumps({"ready": False, "error": f"model load failed: {exc}"}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    sys.stdout.write(json.dumps({"ready": True, "model": model_id}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as exc:
            sys.stdout.write(json.dumps({"ok": False, "error": f"bad json: {exc}"}) + "\n")
            sys.stdout.flush()
            continue
        try:
            result = process_request(model, payload)
        except Exception as exc:
            result = {"ok": False, "error": f"inference error: {exc}"}
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--daemon" in sys.argv:
        daemon_mode()
    else:
        main()
