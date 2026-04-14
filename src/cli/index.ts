#!/usr/bin/env node
// captions — CLI entrypoint.
//
// Commands:
//   captions add <url-or-id>         seed a row in the catalog
//   captions ingest                  load data/seeds/videos.txt, then fetch
//                                    all pending/failed-retryable transcripts
//   captions heal                    reset failed rows + clear stale
//                                    transcriptPath fields
//   captions pipeline [flags]        run stale stages against the catalog
//     --video <id>                   restrict to a single video
//     --stage <name>                 restrict to a single stage
//     --dry-run                      print what would run, do nothing
//   captions audit                   read-only state report
//   captions status [--video <id>]   show per-row stage map
//   captions catalog sync-meta       copy `meta` from each on-disk transcript
//                                    into its catalog row (offline, no fetch)
//
// All commands operate on the default data/ directory relative to the repo
// root. Pass CAPTIONS_DATA_DIR to override.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Catalog, parseIdList, StageName, GraphStageName, VideoMeta } from "../catalog/catalog.js";
import { NormalizedTranscript } from "../ingest/transcript.js";
import { loadSeedFile } from "../catalog/seed-loader.js";
import { Ingester } from "../ingest/ingester.js";
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
      "  ingest                     load seeds file, then fetch pending transcripts",
      "  heal                       reset failed rows + clear stale transcript paths",
      "  pipeline [--video <id>] [--stage <name>] [--dry-run]",
      "                             run all stale stages",
      "  audit                      print a state summary of the catalog",
      "  status [--video <id>]      print per-row stage status",
      "  catalog sync-meta          backfill catalog rows from on-disk transcript meta (offline)",
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

async function cmdIngest(): Promise<number> {
  const dir = dataDir();
  const catalog = catalogFromDataDir(dir);
  const seed = loadSeedFile(catalog);
  if (seed.exists) {
    console.log(`seed: parsed=${seed.parsed} added=${seed.added} (${seed.path})`);
  } else {
    console.log(`seed: no file at ${seed.path}`);
  }
  const ingester = new Ingester({ catalog, dataDir: dir });
  await ingester.start();
  const snap = ingester.snapshot();
  console.log(
    `ingest: done=${snap.done} failed=${snap.failed}` +
      (snap.lastError ? `\n  last error: ${snap.lastError}` : ""),
  );
  return 0;
}

async function cmdHeal(): Promise<number> {
  const catalog = catalogFromDataDir(dataDir());
  const reset = catalog.resetFailed();
  let cleared = 0;
  for (const row of catalog.all()) {
    if (row.transcriptPath && !existsSync(row.transcriptPath)) {
      catalog.update(row.videoId, { transcriptPath: undefined });
      cleared++;
    }
  }
  console.log(`heal: reset=${reset} transcriptPath-cleared=${cleared}`);
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
        ? (flags.stage as StageName | GraphStageName)
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
  // Per-stage breakdown of every entry in the run result, grouped so it's
  // obvious which stages did real work, which are awaiting external input,
  // which were skipped, and which never even fired because they were not
  // stale. The runner doesn't push "not stale" entries into the result, so
  // re-derive that count by walking the catalog: total rows minus the rows
  // we observed a stage run for.
  const allRows = catalog.all();
  const totalRows = allRows.length;
  const stageNames = new Set<string>();
  for (const v of result.videoStagesRan) stageNames.add(v.stage);
  for (const g of result.graphStagesRan) stageNames.add(`graph:${g.stage}`);

  console.log("\nper-video stage outcomes:");
  const byStage = new Map<
    string,
    { ok: number; awaiting: number; skip: number }
  >();
  for (const v of result.videoStagesRan) {
    const b = byStage.get(v.stage) ?? { ok: 0, awaiting: 0, skip: 0 };
    if (v.outcome.kind === "ok") b.ok += 1;
    else if (v.outcome.kind === "awaiting") b.awaiting += 1;
    else b.skip += 1;
    byStage.set(v.stage, b);
  }
  if (byStage.size === 0) {
    console.log(`  (no per-video stages ran; ${totalRows} rows all up to date)`);
  } else {
    for (const [stage, b] of byStage) {
      const touched = b.ok + b.awaiting + b.skip;
      const upToDate = totalRows - touched;
      console.log(
        `  ${stage.padEnd(10)}  ok=${b.ok}  awaiting=${b.awaiting}  skip=${b.skip}  up-to-date=${upToDate}`,
      );
    }
  }

  console.log("\ngraph stage outcomes:");
  if (result.graphStagesRan.length === 0) {
    console.log("  (no graph stages ran; watermark clean)");
  } else {
    for (const g of result.graphStagesRan) {
      console.log(`  ${g.stage.padEnd(15)}  ${g.outcome.kind}`);
    }
  }

  const ok = result.videoStagesRan.filter((v) => v.outcome.kind === "ok").length;
  const awaiting = result.videoStagesRan.filter((v) => v.outcome.kind === "awaiting").length;
  const skipped = result.videoStagesRan.filter((v) => v.outcome.kind === "skip").length;
  const okG = result.graphStagesRan.filter((v) => v.outcome.kind === "ok").length;
  console.log(
    `\ntotal: ${ok} ok, ${awaiting} awaiting, ${skipped} skipped video-stage runs across ${totalRows} rows; ${okG} graph-stage runs`,
  );
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

async function updateWithRetry(
  catalog: Catalog,
  videoId: string,
  patch: Partial<VideoMeta>,
): Promise<void> {
  // Windows can briefly hold catalog.json open (search indexer / AV) between
  // rapid rename-based writes, surfacing as EPERM. Short retry loop.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      catalog.update(videoId, patch);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EPERM" || attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

async function cmdCatalogSyncMeta(): Promise<number> {
  const catalog = catalogFromDataDir(dataDir());
  const rows = catalog.all();
  let updated = 0;
  let missing = 0;
  let unchanged = 0;
  for (const row of rows) {
    const path = row.transcriptPath;
    if (!path || !existsSync(path)) {
      missing++;
      continue;
    }
    let parsed: NormalizedTranscript;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as NormalizedTranscript;
    } catch (e) {
      console.error(`skip ${row.videoId}: ${(e as Error).message}`);
      missing++;
      continue;
    }
    const meta = parsed.meta;
    if (!meta) {
      unchanged++;
      continue;
    }
    const patch: Partial<VideoMeta> = {};
    for (const key of Object.keys(meta) as Array<keyof VideoMeta>) {
      const incoming = meta[key];
      if (incoming === undefined) continue;
      if ((row as VideoMeta)[key] !== incoming) {
        (patch as Record<string, unknown>)[key] = incoming;
      }
    }
    if (Object.keys(patch).length === 0) {
      unchanged++;
      continue;
    }
    await updateWithRetry(catalog, row.videoId, patch);
    updated++;
    console.log(`ok  ${row.videoId}  fields=${Object.keys(patch).join(",")}`);
  }
  console.log(
    `\nsync-meta: updated=${updated} unchanged=${unchanged} missing-transcript=${missing} total=${rows.length}`,
  );
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
    case "ingest":
      code = await cmdIngest();
      break;
    case "heal":
      code = await cmdHeal();
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
    case "catalog": {
      const sub = parsed.positional[0];
      if (sub === "sync-meta") {
        code = await cmdCatalogSyncMeta();
      } else {
        console.error(`unknown catalog subcommand: ${sub ?? "(none)"}`);
        code = 2;
      }
      break;
    }
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
