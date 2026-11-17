/**
 * 链接巡检：从首页开始爬一遍，把站内每个链接/资源都真的请求一次
 *
 *   node tools/check-links.mjs                              # 默认 http://localhost:8099/
 *   node tools/check-links.mjs http://localhost:8098/arcade/ # 子路径部署
 *
 * 存在的意义：**子路径部署（mildoko.github.io/arcade/）最容易坏在绝对路径上**，
 * 静态体检看不出来，只有真的请求一遍才知道。
 */
import fsx from "node:fs";
const cfg = JSON.parse(fsx.readFileSync(new URL("../site.config.json", import.meta.url), "utf8"));
const START = (process.argv[2] || "http://localhost:8099" + (cfg.basePath || "") + "/").replace(/\/?$/, "/");
const MAX = Number(process.env.MAX_URLS || 250);

const base = new URL(START);
const basePath = base.pathname.replace(/\/$/, ""); // "" 或 "/arcade"

const seen = new Set();
const queue = [START];
const bad = [];
let checked = 0;

const sameSite = (u) => u.origin === base.origin && u.pathname.startsWith(basePath || "/");

async function head(url) {
  for (const method of ["GET"]) {
    try {
      const res = await fetch(url, { method, redirect: "manual" });
      const type = res.headers.get("content-type") || "";
      const body = type.includes("text/html") ? await res.text() : "";
      return { status: res.status, type, body };
    } catch (e) {
      return { status: 0, type: "", body: "", error: e.message };
    }
  }
}

while (queue.length && checked < MAX) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  checked++;

  const r = await head(url);
  if (r.status !== 200) {
    bad.push({ url, status: r.status, error: r.error });
    continue;
  }
  if (!r.body) continue;

  for (const m of r.body.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("data:") || raw.startsWith("javascript:")) continue;
    let u;
    try { u = new URL(raw, url); } catch (e) { continue; }
    u.hash = "";
    if (!sameSite(u)) continue;
    const key = u.href;
    if (!seen.has(key)) queue.push(key);
  }
}

console.log(`起点 ${START}`);
console.log(`basePath ${basePath || "(根)"}`);
console.log(`检查 ${checked} 个链接，失败 ${bad.length} 个\n`);
for (const b of bad.slice(0, 40)) console.log(`  ✗ ${b.status || "ERR"} ${b.url}${b.error ? "  " + b.error : ""}`);
if (bad.length > 40) console.log(`  … 还有 ${bad.length - 40} 个`);
process.exit(bad.length ? 1 : 0);
