#!/usr/bin/env node
// captions — CLI entrypoint.
//
// Commands:
//   captions add <url-or-id>         seed a row in the catalog
//   captions pipeline [flags]        run stale stages against the catalog
//     --video <id>                   restrict to a single video
//     --stage <name>                 restrict to a single stage
//     --dry-run                      print what would run, do nothing
//   captions audit                   read-only state report
//   captions status [--video <id>]   show per-row stage map
//
// All commands operate on the default data/ directory relative to the repo
// root. Pass CAPTIONS_DATA_DIR to override.

import { join, resolve } from "node:path";
import { Catalog, parseIdList, StageName } from "../catalog/catalog.js";
import { runPipeline } from "../pipeline/run.js";

function dataDir(): string {
  return process.env.CAPTIONS_DATA_DIR
    ? resolve(process.env.CAPTIONS_DATA_DIR)
    : resolve(process.cwd(), "data");
}

function catalogFromDataDir(dir: string): Catalog {
  return new Catalog(join(dir, "catalog", "catalog.json"));
}

function usage(): void {
  console.log(
    [
      "captions <command> [options]",
      "",
      "commands:",
      "  add <url-or-id>           seed a new video into the catalog",
      "  pipeline [--video <id>] [--stage <name>] [--dry-run]",
      "                             run all stale stages",
      "  audit                      print a state summary of the catalog",
      "  status [--video <id>]      print per-row stage status",
      "",
    ].join("\n"),
  );
}

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdAdd(arg: string | undefined): Promise<number> {
  if (!arg) {
    console.error("captions add: missing url or id");
    return 2;
  }
  const parsed = parseIdList(arg);
  if (parsed.length === 0) {
    console.error(`captions add: could not parse a YouTube id or URL from "${arg}"`);
    return 2;
  }
  const catalog = catalogFromDataDir(dataDir());
  const added = catalog.seed(parsed);
  console.log(
    added > 0
      ? `added ${parsed[0].videoId} (total new rows: ${added})`
      : `${parsed[0].videoId} already in catalog`,
  );
  console.log("run `captions pipeline` to fetch and process");
  return 0;
}

async function cmdPipeline(flags: Parsed["flags"]): Promise<number> {
  const dir = dataDir();
  const catalog = catalogFromDataDir(dir);
  const result = await runPipeline({
    catalog,
    dataDir: dir,
    onlyVideoId: typeof flags.video === "string" ? flags.video : undefined,
    onlyStage:
      typeof flags.stage === "string"
        ? (flags.stage as StageName | "propagation" | "contradictions" | "novel")
        : undefined,
    dryRun: flags["dry-run"] === true,
  });
  for (const v of result.videoStagesRan) {
    const line =
      v.outcome.kind === "ok"
        ? `ok  ${v.videoId} ${v.stage}${v.outcome.notes ? "  " + v.outcome.notes : ""}`
        : v.outcome.kind === "awaiting"
        ? `... ${v.videoId} ${v.stage}  ${v.outcome.notes}`
        : `--  ${v.videoId} ${v.stage}  ${v.outcome.reason}`;
    console.log(line);
  }
  for (const g of result.graphStagesRan) {
    const line =
      g.outcome.kind === "ok"
        ? `ok  graph:${g.stage}${g.outcome.notes ? "  " + g.outcome.notes : ""}`
        : g.outcome.kind === "awaiting"
        ? `... graph:${g.stage}  ${g.outcome.notes}`
        : `--  graph:${g.stage}  ${g.outcome.reason}`;
    console.log(line);
  }
  const ok = result.videoStagesRan.filter((v) => v.outcome.kind === "ok").length;
  const okG = result.graphStagesRan.filter((v) => v.outcome.kind === "ok").length;
  console.log(`\ntotal: ${ok} video-stage runs, ${okG} graph-stage runs`);
  return 0;
}

async function cmdAudit(): Promise<number> {
  const catalog = catalogFromDataDir(dataDir());
  const rows = catalog.all();
  const byStatus: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    for (const name of Object.keys(row.stages ?? {})) {
      stageCounts[name] = (stageCounts[name] ?? 0) + 1;
    }
  }
  const g = catalog.graphState();
  console.log("=== catalog audit ===");
  console.log(`rows: ${rows.length}`);
  console.log("status:", byStatus);
  console.log("stages completed:", stageCounts);
  console.log("graph.dirtyAt:", g.dirtyAt);
  console.log("graph.stages:", g.stages);
  return 0;
}

async function cmdStatus(flags: Parsed["flags"]): Promise<number> {
  const catalog = catalogFromDataDir(dataDir());
  const rows =
    typeof flags.video === "string"
      ? catalog.all().filter((r) => r.videoId === flags.video)
      : catalog.all();
  for (const row of rows) {
    const stageList = Object.entries(row.stages ?? {})
      .map(([k, v]) => `${k}@v${v?.version}`)
      .join(",");
    console.log(`${row.videoId}\t${row.status}\t${stageList || "-"}`);
  }
  return 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
    process.exit(0);
  }
  const [command, ...rest] = argv;
  const parsed = parseArgs(rest);
  let code = 0;
  switch (command) {
    case "add":
      code = await cmdAdd(parsed.positional[0]);
      break;
    case "pipeline":
      code = await cmdPipeline(parsed.flags);
      break;
    case "audit":
      code = await cmdAudit();
      break;
    case "status":
      code = await cmdStatus(parsed.flags);
      break;
    case "--help":
    case "-h":
    case "help":
      usage();
      break;
    default:
      console.error(`unknown command: ${command}`);
      usage();
      code = 2;
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
