// Static server for fixtures/sites. No dependencies, loopback only.
// Usage: node serve.mjs [--port 4000]   (or `pnpm fixtures:serve` from the repo root)
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SITES_DIR = fileURLToPath(new URL("./sites/", import.meta.url));
export const SITE_NAMES = /** @type {const} */ (["clean", "messy", "woocommerce"]);

const CONTENT_TYPES = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
});

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mendwell fixture sites</title></head>
<body><h1>Mendwell fixture sites</h1><ul>${SITE_NAMES.map((n) => `<li><a href="/${n}/">${n}</a></li>`).join("")}</ul>
<p>Planted issues are listed in fixtures/README.md and fixtures/manifest.json.</p></body></html>`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><h1>404 — not found</h1></body></html>`;

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} [headers]
 */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

/** @param {string} path */
async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { allow: "GET, HEAD" });

  const url = new URL(req.url ?? "/", "http://fixtures.local");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad request");
  }

  if (pathname === "/") return send(res, 200, INDEX_HTML);
  if (pathname === "/robots.txt") return send(res, 200, "User-agent: *\nAllow: /\n", { "content-type": "text/plain; charset=utf-8" });

  const filePath = normalize(join(SITES_DIR, pathname));
  if (!filePath.startsWith(SITES_DIR)) return send(res, 404, NOT_FOUND_HTML);

  let target = filePath;
  const info = await statOrNull(target);
  if (info?.isDirectory()) {
    // Mirror WordPress permalinks: /about -> /about/
    if (!pathname.endsWith("/")) return send(res, 301, "", { location: `${pathname}/${url.search}` });
    target = join(filePath, "index.html");
  }

  const file = target === filePath ? info : await statOrNull(target);
  const isHidden = relative(SITES_DIR, target).split(sep).some((part) => part.startsWith("."));
  if (!file?.isFile() || isHidden) return send(res, 404, NOT_FOUND_HTML);

  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
    "content-length": String(file.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

/**
 * Start the fixture server. Pass port 0 for a random free port (tests).
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startFixtureServer({ port = 4000, host = "127.0.0.1" } = {}) {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, "Internal error"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://localhost:${actualPort}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portFlag = process.argv.indexOf("--port");
  const port = portFlag > -1 ? Number(process.argv[portFlag + 1]) : Number(process.env.PORT ?? 4000);
  const { url } = await startFixtureServer({ port });
  console.log(`Fixture sites on ${url}`);
  for (const name of SITE_NAMES) console.log(`  ${url}/${name}/`);
}
