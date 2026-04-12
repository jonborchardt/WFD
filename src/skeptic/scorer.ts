// Real-time speaker credibility / skeptic scorer.
//
// Consumes transcript chunks (cues, or arbitrary text fragments) and emits a
// rolling credibility score in [0, 1] where higher is more credible. Signals:
//   - hedging language ("maybe", "I think", "sort of", "kind of")
//   - evasion patterns ("no comment", "can't recall", "not that I know of")
//   - absolutes that commonly precede walkbacks ("never", "100%", "always")
//   - contradictions against claims already asserted by this speaker
//   - contradictions against the existing graph (if a GraphStore is wired)
//
// Output: the rolling score, the per-chunk delta, and the signals that fired.

import { GraphStore } from "../graph/store.js";

const HEDGES = [
  "maybe",
  "i think",
  "i guess",
  "sort of",
  "kind of",
  "i suppose",
  "probably",
  "possibly",
];

const EVASIONS = [
  "no comment",
  "i don't recall",
  "can't recall",
  "not that i know of",
  "i'd have to check",
  "i don't remember",
];

const ABSOLUTES = ["never", "always", "100%", "every single", "nobody", "everyone"];

export type SignalKind =
  | "hedge"
  | "evasion"
  | "absolute"
  | "self-contradiction"
  | "graph-contradiction";

export interface Signal {
  kind: SignalKind;
  weight: number;
  text: string;
}

export interface ScoreUpdate {
  score: number;
  delta: number;
  signals: Signal[];
}

export interface SkepticOptions {
  store?: GraphStore;
  initialScore?: number;
  // How fast the score decays back towards 0.5 in the absence of signals.
  decay?: number;
}

export class SkepticScorer {
  private score: number;
  private priorAssertions: string[] = [];
  constructor(private opts: SkepticOptions = {}) {
    this.score = opts.initialScore ?? 0.7;
  }

  get current(): number {
    return this.score;
  }

  ingest(text: string): ScoreUpdate {
    const lower = text.toLowerCase();
    const signals: Signal[] = [];
    for (const h of HEDGES) if (lower.includes(h)) signals.push({ kind: "hedge", weight: -0.02, text: h });
    for (const e of EVASIONS) if (lower.includes(e)) signals.push({ kind: "evasion", weight: -0.08, text: e });
    for (const a of ABSOLUTES) if (lower.includes(a)) signals.push({ kind: "absolute", weight: -0.03, text: a });

    // Self-contradiction: negation of a prior assertion.
    const negated = `not ${lower}`;
    for (const prior of this.priorAssertions) {
      if (prior === negated || lower === `not ${prior}`) {
        signals.push({ kind: "self-contradiction", weight: -0.15, text: prior });
      }
    }
    this.priorAssertions.push(lower);
    if (this.priorAssertions.length > 200) this.priorAssertions.shift();

    // Graph contradiction: if any asserted relationship with directTruth=0
    // contains tokens present in this utterance, flag.
    if (this.opts.store) {
      const tokens = new Set(lower.split(/\W+/).filter((t) => t.length > 3));
      for (const r of this.opts.store.relationships()) {
        if (r.directTruth !== undefined && r.directTruth < 0.5) {
          const subj = this.opts.store.getEntity(r.subjectId)?.canonical.toLowerCase();
          const obj = this.opts.store.getEntity(r.objectId)?.canonical.toLowerCase();
          if ((subj && tokens.has(subj)) || (obj && tokens.has(obj))) {
            signals.push({
              kind: "graph-contradiction",
              weight: -0.2,
              text: `${subj ?? r.subjectId} ${r.predicate} ${obj ?? r.objectId}`,
            });
            break;
          }
        }
      }
    }

    const decay = this.opts.decay ?? 0.05;
    const towardsNeutral = (0.5 - this.score) * decay;
    const signalTotal = signals.reduce((s, x) => s + x.weight, 0);
    const next = Math.max(0, Math.min(1, this.score + towardsNeutral + signalTotal));
    const delta = next - this.score;
    this.score = next;
    return { score: next, delta, signals };
  }
}

// Streaming driver wired to an async iterator of cue texts.
export async function* stream(
  scorer: SkepticScorer,
  chunks: AsyncIterable<string>,
): AsyncGenerator<ScoreUpdate> {
  for await (const chunk of chunks) {
    yield scorer.ingest(chunk);
  }
}

// Small local HTTP endpoint for the UI to subscribe to (server-sent events).
// Caller constructs this and plugs updates in; we keep the transport glue
// minimal so the scorer itself stays pure and easy to test.
import { createServer, IncomingMessage, ServerResponse } from "node:http";

export interface SkepticApi {
  push(update: ScoreUpdate): void;
  close(): Promise<void>;
}

export function startSkepticApi(port = 4174): SkepticApi {
  const subscribers: ServerResponse[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/skeptic/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      subscribers.push(res);
      req.on("close", () => {
        const i = subscribers.indexOf(res);
        if (i >= 0) subscribers.splice(i, 1);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port);
  return {
    push(update) {
      const payload = `data: ${JSON.stringify(update)}\n\n`;
      for (const s of subscribers) s.write(payload);
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
