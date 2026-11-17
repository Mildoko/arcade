/**
 * 本地预览服务器（零依赖，比 python -m http.server 更贴合线上）
 *
 *   node tools/serve.mjs              # 默认 8099
 *   node tools/serve.mjs 8100
 *
 * 为什么不用 python -m http.server：
 *   线上是子路径部署（mildoko.github.io/arcade/），本地必须也是 /arcade/，
 *   否则"本地好好的、上线全断"的绝对路径问题永远测不出来。
 *   这个服务器会按 site.config.json 的 basePath 自动把 / 重定向到 /arcade/，
 *   并且只在这个前缀下提供文件 —— 和线上的行为一致。
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "public");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const BP = (site.basePath || "").replace(/\/+$/, "");
const PORT = Number(process.argv[2] || process.env.PORT || 8099);

if (!fs.existsSync(OUT)) {
  console.error("public/ 不存在，先跑 node build.mjs");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const log = (code) => console.log(`${code} ${req.method} ${urlPath}${BP ? "" : ""}`);

  // 根路径 → 跳到 basePath（和 GitHub Pages 项目站的体验一致）
  if (BP && (urlPath === "/" || urlPath === BP)) {
    res.writeHead(302, { Location: BP + "/" });
    log(302);
    return res.end();
  }
  if (BP && !urlPath.startsWith(BP + "/")) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    log(404);
    return res.end(`只在 ${BP}/ 下提供文件（basePath 来自 site.config.json）`);
  }

  const relPath = BP ? urlPath.slice(BP.length) : urlPath;
  let file = path.join(OUT, relPath);
  if (relPath.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(OUT)) {
    res.writeHead(403); log(403); return res.end();
  }

  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
  if (!fs.existsSync(file) && fs.existsSync(path.join(OUT, "404.html"))) {
    res.writeHead(404, { "content-type": MIME[".html"] });
    log(404);
    return res.end(fs.readFileSync(path.join(OUT, "404.html")));
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    log(404);
    return res.end("404");
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": "no-store", // 本地预览别缓存，改完刷新就生效
  });
  log(200);
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  ${site.name}`);
  console.log(`  ${base}${BP}/   ${BP ? "(会自动从 / 跳过来)" : ""}`);
  console.log(`  目录 ${OUT}\n  Ctrl+C 停止\n`);
});
