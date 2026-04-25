// Plan 05 metrics CLI entry — wired up in package.json as:
//   "metrics":           "node dist/metrics/cli.js"
//   "metrics:baseline":  "node dist/metrics/cli.js --baseline"
//   "metrics:check":     "node dist/metrics/cli.js --check"
//
// `metrics:check` exits non-zero on any regression relative to the
// committed baseline. CI calls it post-tests.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeAll,
  readBaselineFile,
  readTargetsFile,
  runGate,
  writeBaselineFile,
} from "./index.js";
import type { MetricsSnapshot } from "./types.js";

const args = process.argv.slice(2);
const mode: "print" | "baseline" | "check" =
  args.includes("--baseline") ? "baseline"
    : args.includes("--check") ? "check"
      : "print";
const json = args.includes("--json");
const asMarkdown = args.includes("--markdown");

function parseArg(flag: string, defVal: string): string {
  const i = args.indexOf(flag);
  if (i < 0) return defVal;
  return args[i + 1] ?? defVal;
}

const dataDir = parseArg("--data", "data");
const targetsPath = parseArg("--targets", "config/metrics-targets.json");
const baselinePath = parseArg("--baseline-path", "config/metrics-baseline.json");
const historyDir = parseArg("--history", "data/metrics/history");

function tryGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const snapshot: MetricsSnapshot = await computeAll(dataDir);
  const targets = readTargetsFile(targetsPath);
  const baseline = readBaselineFile(baselinePath);

  if (mode === "baseline") {
    writeBaselineFile(baselinePath, snapshot, tryGitCommit());
    // Also drop into history so we can sparkline later.
    if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
    const day = snapshot.generatedAt.slice(0, 10);
    writeFileSync(
      join(historyDir, `${day}.json`),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, baselinePath, metrics: snapshot.metrics.length }) + "\n");
    } else {
      process.stdout.write(
        `wrote ${snapshot.metrics.length} metric baselines to ${baselinePath}\n`,
      );
    }
    return;
  }

  const gate = runGate(snapshot, targets, baseline);

  if (json) {
    process.stdout.write(JSON.stringify({ snapshot, gate }, null, 2) + "\n");
    if (mode === "check" && !gate.ok) process.exit(1);
    return;
  }

  if (mode === "check") {
    if (gate.ok) {
      const improved = gate.rows.filter((r) => r.status === "improved").length;
      process.stdout.write(
        `ok · ${gate.rows.length} metrics checked · ${improved} improved · 0 regressions\n`,
      );
      return;
    }
    process.stderr.write(`FAIL · ${gate.regressions.length} regression(s):\n`);
    for (const r of gate.regressions) {
      process.stderr.write(
        `  - ${r.name}: current=${fmt(r.current)} baseline=${fmt(r.baseline)} — ${r.reason ?? "regressed"}\n`,
      );
    }
    process.exit(1);
  }

  // Print mode — grouped dashboard.
  if (asMarkdown) {
    process.stdout.write(toMarkdown(snapshot, gate));
    return;
  }
  process.stdout.write(toHumanText(snapshot, gate));
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function toHumanText(
  snapshot: MetricsSnapshot,
  gate: ReturnType<typeof runGate>,
): string {
  const lines: string[] = [];
  lines.push(`metrics · ${snapshot.generatedAt}`);
  const bySec = new Map<string, typeof snapshot.metrics>();
  for (const m of snapshot.metrics) {
    if (!bySec.has(m.section)) bySec.set(m.section, []);
    bySec.get(m.section)!.push(m);
  }
  const byName = new Map(gate.rows.map((r) => [r.name, r] as const));
  for (const [section, rows] of bySec) {
    lines.push("");
    lines.push(`  [${section}]`);
    for (const m of rows) {
      const g = byName.get(m.name);
      const bits: string[] = [];
      bits.push(`  ${m.name.padEnd(46)}`);
      bits.push(fmt(m.value).padStart(10));
      if (g?.baseline !== null && g?.baseline !== undefined) {
        bits.push(`  base=${fmt(g.baseline)}`);
      }
      if (g?.status === "regressed") bits.push(`  ✗ ${g.reason ?? ""}`);
      else if (g?.status === "improved") bits.push(`  ↑ improved`);
      else if (g?.status === "new") bits.push(`  · ${g.reason ?? "new"}`);
      else if (g?.status === "missing") bits.push(`  ! missing`);
      if (g?.targetWarning) bits.push(`  ⚑ ${g.targetWarning}`);
      if (m.unit === "pct") bits[1] = `${bits[1].trim()}%`.padStart(11);
      lines.push(bits.join(""));
    }
  }
  lines.push("");
  lines.push(
    `total: ${gate.rows.length} metrics · regressions: ${gate.regressions.length} · ok: ${gate.ok ? "yes" : "no"}`,
  );
  return lines.join("\n") + "\n";
}

function toMarkdown(
  snapshot: MetricsSnapshot,
  gate: ReturnType<typeof runGate>,
): string {
  const lines: string[] = [];
  lines.push(`# metrics · ${snapshot.generatedAt.slice(0, 10)}`);
  const bySec = new Map<string, typeof snapshot.metrics>();
  for (const m of snapshot.metrics) {
    if (!bySec.has(m.section)) bySec.set(m.section, []);
    bySec.get(m.section)!.push(m);
  }
  const byName = new Map(gate.rows.map((r) => [r.name, r] as const));
  for (const [section, rows] of bySec) {
    lines.push("");
    lines.push(`## ${section}`);
    lines.push("");
    lines.push("| metric | current | baseline | status |");
    lines.push("|---|---:|---:|---|");
    for (const m of rows) {
      const g = byName.get(m.name);
      lines.push(`| ${m.name} | ${fmt(m.value)}${m.unit === "pct" ? "%" : ""} | ${g?.baseline !== null && g?.baseline !== undefined ? fmt(g.baseline) : "—"} | ${g?.status ?? "ok"} |`);
    }
  }
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  process.stderr.write(`metrics CLI failed: ${(err as Error).message}\n`);
  process.exit(2);
});
