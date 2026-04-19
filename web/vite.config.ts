import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { createReadStream, statSync } from "fs";
import { extname } from "path";
import type { Plugin } from "vite";

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain",
};

// Base path for the site. Override via VITE_BASE=/foo/ when deploying to a
// different repo path or root domain. Must start and end with `/`.
const base = process.env.VITE_BASE || "/WFD/";

/** Serve repo `data/` directory at `<base>data/` (and bare `/data/`) during dev. */
function serveData(): Plugin {
  const dataRoot = resolve(__dirname, "../data");
  const prefixes = [base + "data/", "/data/"];
  return {
    name: "serve-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const prefix = prefixes.find((p) => req.url!.startsWith(p));
        if (!prefix) return next();
        const rel = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]);
        if (rel.includes("..")) { res.statusCode = 400; res.end(); return; }
        const abs = resolve(dataRoot, rel);
        if (!abs.startsWith(dataRoot)) { res.statusCode = 400; res.end(); return; }
        try {
          const stat = statSync(abs);
          if (!stat.isFile()) { res.statusCode = 404; res.end(); return; }
          const ext = extname(abs);
          res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
          res.setHeader("Content-Length", stat.size);
          createReadStream(abs).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveData()],
  base,
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // Proxy admin API routes to the local Node server (npm run dev at repo root)
      "/api": {
        target: "http://localhost:4173",
        changeOrigin: true,
      },
      "/admin": {
        target: "http://localhost:4173",
        changeOrigin: true,
      },
    },
  },
});
