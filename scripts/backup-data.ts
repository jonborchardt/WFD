// One-shot safety snapshot of data/.
//
// Copies data/ (minus .backup-* directories and the logs dir) to
// data/.backup-YYYYMMDD/. Refuses to overwrite an existing backup dir so a
// mis-timed re-run can't clobber the prior snapshot.
//
// Invoked as `tsx scripts/backup-data.ts` before any destructive migration.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const dataDir = join(repoRoot, "data");

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function main(): void {
  if (!existsSync(dataDir)) {
    console.error(`backup: ${dataDir} does not exist`);
    process.exit(1);
  }
  const target = join(dataDir, `.backup-${stamp()}`);
  if (existsSync(target)) {
    console.error(
      `backup: refusing to overwrite existing ${target}. Rename or delete it first.`,
    );
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });

  let files = 0;
  for (const name of readdirSync(dataDir)) {
    if (name.startsWith(".backup-")) continue;
    if (name === "logs") continue;
    const src = join(dataDir, name);
    const dst = join(target, name);
    cpSync(src, dst, { recursive: true });
    files += countFiles(dst);
  }
  console.log(`backup: wrote ${files} files → ${target}`);
}

function countFiles(p: string): number {
  const st = statSync(p);
  if (!st.isDirectory()) return 1;
  let n = 0;
  for (const name of readdirSync(p)) n += countFiles(join(p, name));
  return n;
}

main();
