/**
 * 静态体检（CI 可跑）：node tools/check.mjs
 *
 * 判据都是"看得见的落点"，不看"我记得写了"：
 *   - 每个页面必须有 title / meta description / og:title / og:image（noindex 页豁免）
 *   - canonical 必须是绝对地址，且和 sitemap 里的 loc 一致
 *   - sitemap 里每个 URL 都必须在 public/ 里存在
 *   - 每个游戏四件套都在：/g/ /play/ /embed/ /s/
 *   - 站内链接（href="/..."）必须能落到文件
 *   - /assets 引用必须存在
 *   - 内联脚本必须能通过语法编译
 *   - 全站不能出现 localhost / 127.0.0.1 的绝对地址
 *   - site.config.json 的 url 还是 example.com 时给警告
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "public");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const games = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "games.json"), "utf8"));
// 生成物里的站内路径带 basePath（/arcade/…）：BASE 是"域名+子路径"，找文件时再去掉
const BP = (site.basePath || "").replace(/\/+$/, "");
const BASE = site.url.replace(/\/+$/, "") + BP;
const strip = (p) => (BP && p.startsWith(BP + "/") ? p.slice(BP.length) : p === BP ? "/" : p);

let fail = 0, warn = 0;
const failMsg = (m) => { fail++; console.log("  FAIL  " + m); };
const warnMsg = (m) => { warn++; console.log("  WARN  " + m); };
const okMsg = (m) => console.log("  ok    " + m);

if (!fs.existsSync(OUT)) {
  console.error("public/ 不存在，先跑 node build.mjs");
  process.exit(1);
}

/* 收集所有 html */
const htmls = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) htmls.push(p);
  }
})(OUT);

const rel = (p) => "/" + path.relative(OUT, p).split(path.sep).join("/");
const exists = (urlPath) => {
  const clean = strip(urlPath.split("?")[0].split("#")[0]);
  const target = path.join(OUT, decodeURIComponent(clean));
  if (target.endsWith("/") || clean.endsWith("/")) return fs.existsSync(path.join(target, "index.html"));
  return fs.existsSync(target);
};

/* 1. 每页必需的 head 字段 */
let headIssues = 0;
for (const f of htmls) {
  const s = fs.readFileSync(f, "utf8");
  // /games/ 下的游戏本体是 app 页面，天生 noindex（真正的 SEO 页是 /g/）
  const noindex = rel(f).startsWith("/games/") || /name="robots"[^>]*noindex/.test(s) || /content="noindex/.test(s);
  const need = [[/<title>[^<]{3,}<\/title>/, "title"]];
  if (!noindex) {
    need.push([/<meta name="description" content="[^"]{20,}"/, "meta description"]);
    need.push([/<meta property="og:title"/, "og:title"]);
    need.push([/<meta property="og:image" content="https?:\/\//, "og:image(绝对地址)"]);
    need.push([/<link rel="canonical" href="https?:\/\//, "canonical(绝对地址)"]);
  }
  for (const [re, label] of need) {
    if (!re.test(s)) { failMsg(`${rel(f)} 缺 ${label}`); headIssues++; }
  }
}
if (!headIssues) okMsg(`${htmls.length} 个页面的 head 字段齐全`);

/* 2. canonical 唯一 + 与 sitemap 一致 */
const canon = new Map();
for (const f of htmls) {
  const s = fs.readFileSync(f, "utf8");
  const m = /<link rel="canonical" href="([^"]+)"/.exec(s);
  if (!m) continue;
  if (canon.has(m[1])) failMsg(`重复 canonical: ${m[1]}（${rel(f)} 与 ${canon.get(m[1])}）`);
  canon.set(m[1], rel(f));
}
okMsg(`canonical 共 ${canon.size} 条，无重复`);

/* 3. sitemap 指向真实页面 */
const smPath = path.join(OUT, "sitemap.xml");
if (!fs.existsSync(smPath)) failMsg("缺 sitemap.xml");
else {
  const sm = fs.readFileSync(smPath, "utf8");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  let bad = 0;
  for (const loc of locs) {
    if (!loc.startsWith(BASE)) { failMsg(`sitemap 里的地址不在 ${BASE} 下: ${loc}`); bad++; continue; }
    const p = loc.slice(BASE.length) || "/";
    const f = path.join(OUT, p.endsWith("/") ? p + "index.html" : p);
    if (!exists(p)) { failMsg(`sitemap 指向不存在的页面: ${p}`); bad++; continue; }
    const html = fs.readFileSync(f, "utf8");
    if (p !== "/" && !html.includes(`rel="canonical" href="${loc}"`)) {
      failMsg(`canonical 与 sitemap 不一致: ${p}`);
      bad++;
    }
  }
  if (!bad) okMsg(`sitemap ${locs.length} 条全部有效且 canonical 一致`);
}

/* 4. 每个游戏四件套 */
for (const g of games) {
  for (const p of [`/g/${g.slug}/`, `/play/${g.slug}/`, `/embed/${g.slug}/`, `/s/${g.slug}/`]) {
    if (!exists(p)) failMsg(`缺页面 ${p}`);
  }
  if (!exists("/" + g.entry)) failMsg(`${g.slug} 的 entry 不存在: /${g.entry}`);
  if (!exists(`/assets/og/${g.slug}.png`)) failMsg(`缺社交卡 /assets/og/${g.slug}.png`);
  if (g.body.filter((p) => p.length > 60).length < 3) warnMsg(`${g.slug} 的正文少于 3 段（SEO 厚度不够）`);
}
okMsg(`${games.length} 个游戏的四件套 + entry + 社交卡都在`);

/* 5. 站内链接与资源引用 */
let linkBad = 0;
for (const f of htmls) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const u = m[1];
    if (u.startsWith("//")) continue;
    if (!exists(u)) { failMsg(`${rel(f)} 引用了不存在的 ${u}`); linkBad++; }
  }
}
if (!linkBad) okMsg("站内链接与 /assets 引用全部存在");

/* 6. 内联脚本可编译 */
let jsBad = 0;
for (const f of htmls) {
  const s = fs.readFileSync(f, "utf8");
  const scripts = [...s.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const m of scripts) {
    const isModule = /type\s*=\s*["']module["']/.test(m[1]);
    const code = m[2];
    if (!code.trim()) continue;
    if (isModule) {
      // ESM 只能用 node --check 验（vm.Script 不认 import）
      const tmp = path.join(ROOT, `.chk-${process.pid}-${jsBad}.mjs`);
      fs.writeFileSync(tmp, code);
      const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      fs.rmSync(tmp, { force: true });
      if (r.status !== 0) {
        const line = (r.stderr || "").split("\n").filter(Boolean).slice(-1)[0] || "无法解析";
        failMsg(`${rel(f)} 的内联 module 脚本语法错误: ${line}`);
        jsBad++;
      }
    } else {
      try { new vm.Script(code, { filename: rel(f) }); }
      catch (e) { failMsg(`${rel(f)} 的内联脚本语法错误: ${e.message}`); jsBad++; }
    }
  }
}
if (!jsBad) okMsg("内联脚本全部可编译");

/* 7. 不该出现的绝对地址 */
let leak = 0;
for (const f of htmls.concat([path.join(OUT, "sitemap.xml"), path.join(OUT, "robots.txt")])) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(s)) { failMsg(`${rel(f)} 泄露了本地地址`); leak++; }
}
if (!leak) okMsg("没有本地地址泄露");

/* 8. 配置检查 */
if (/example\.com/.test(site.url)) warnMsg("site.config.json 的 url 还是 example.com —— 上线前必须改，否则 canonical/sitemap 全错");
if (!site.gaId) warnMsg("没配 gaId：渠道归因只写 localStorage，不会上报（上线前填上）");
if (!games.length) failMsg("data/games.json 是空的");

console.log(`\n${fail} failed, ${warn} warnings`);
process.exit(fail ? 1 : 0);
