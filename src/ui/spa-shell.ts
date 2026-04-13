// Dev-server HTML. Single source of truth lives in src/ui/client/index.html —
// the same file the static deploy ships. We do two explicit literal
// substitutions: flip __STATIC__ off and append the livereload snippet. If
// either token is missing we throw, so a refactor of index.html can't silently
// break the dev server.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, "client", "index.html");

const STATIC_FLAG = "window.__STATIC__ = true";
const BODY_END = "</body>";

const LIVERELOAD = `<script>
(function(){
  let wasConnected = false;
  function connect() {
    const es = new EventSource("/api/livereload");
    es.addEventListener("hello", () => { if (wasConnected) location.reload(); wasConnected = true; });
    es.onerror = () => { es.close(); setTimeout(connect, 500); };
  }
  connect();
})();
</script>
</body>`;

let cached: string | null = null;
function render(): string {
  const raw = readFileSync(templatePath, "utf8");
  if (!raw.includes(STATIC_FLAG)) {
    throw new Error(`spa-shell: index.html missing literal token "${STATIC_FLAG}"`);
  }
  if (!raw.includes(BODY_END)) {
    throw new Error(`spa-shell: index.html missing "${BODY_END}"`);
  }
  return raw.replace(STATIC_FLAG, "window.__STATIC__ = false").replace(BODY_END, LIVERELOAD);
}

export function renderSpaShell(): string {
  if (!cached) cached = render();
  return cached;
}
