/**
 * 收稿闸门的单元测试（不需要浏览器，秒级）
 *
 *   node tests/gate.test.mjs
 *
 * 判据是可失败的：每个规则都必须能举出一个"它该失败"的例子，并且真的失败。
 * 所以这里不只测"好游戏能过"，主要测"坏游戏必须被拒，且拒在正确的 code 上"。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkSubmission, LIMITS, isTextFile } from "../src/rules.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, "tests", "fixtures", "games");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

function readDir(dir) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(dir, p).split(path.sep).join("/");
        const size = fs.statSync(p).size;
        let text = null;
        if (isTextFile(rel) && size <= LIMITS.maxTextScanBytes) text = fs.readFileSync(p, "utf8");
        files.push({ path: rel, size, text });
      }
    }
  })(dir);
  return files;
}
const codes = (r) => [...r.errors, ...r.warnings].map((x) => x.code);

/* ---------- 1. 干净的自包含游戏：必须过 ---------- */
{
  const r = checkSubmission(readDir(path.join(FIX, "good")));
  ok("好包 0 errors", r.errors.length === 0, JSON.stringify(r.errors));
  ok("好包 元数据能自动填", r.meta.title === "Fixture Coin", r.meta.title);
  ok("好包 推出 slug", r.slugSuggestion === "fixture-coin", r.slugSuggestion);
}

/* ---------- 2. 夹带广告：必须拒 ---------- */
{
  const r = checkSubmission(readDir(path.join(FIX, "ads")));
  ok("广告包被拒", r.errors.some((e) => e.code === "ad_sdk"), JSON.stringify(codes(r)));
  ok("广告包报行号", r.errors.some((e) => /:\d+$/.test(e.path || "")), JSON.stringify(r.errors));
}

/* ---------- 3. 在线拉资源：必须拒 ---------- */
{
  const r = checkSubmission(readDir(path.join(FIX, "remote")));
  ok("在线资源被拒", r.errors.some((e) => e.code === "remote_asset"), JSON.stringify(codes(r)));
}

/* ---------- 4. 没有根 index.html：必须拒 ---------- */
{
  const r = checkSubmission(readDir(path.join(FIX, "nested")));
  ok("嵌套目录被拒", r.errors.some((e) => e.code === "no_entry"), JSON.stringify(codes(r)));
  ok("并提示把内容提到最外层", r.errors.some((e) => e.code === "no_entry" && e.msg.includes("最外层")));
}

/* ---------- 5. 引用了不存在的文件：必须拒 ---------- */
{
  const r = checkSubmission(readDir(path.join(FIX, "missing-ref")));
  ok("缺文件被拒", r.errors.some((e) => e.code === "missing_ref"), JSON.stringify(codes(r)));
}

/* ---------- 6. 站点共享引擎（/assets/*）不算缺文件 ---------- */
{
  const files = [
    { path: "index.html", size: 900, text: '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Shared Engine</title><script src="/assets/engine.js"></script></head><body><canvas></canvas></body></html>' },
  ];
  const r = checkSubmission(files);
  ok("引用 /assets/engine.js 不算缺文件", !r.errors.some((e) => e.code === "missing_ref"), JSON.stringify(codes(r)));
  ok("用了共享引擎就不再抱怨 touch-action", !r.warnings.some((w) => w.code === "no_touch_action"));
  ok("但乱写的绝对路径仍然算缺文件", (() => {
    const r2 = checkSubmission([
      { path: "index.html", size: 200, text: '<!doctype html><title>x</title><script src="/cdn/whatever.js"></script>' },
    ]);
    return r2.errors.some((e) => e.code === "missing_ref");
  })());
}

/* ---------- 7. 体积上限 ---------- */
{
  const big = { path: "big.bin", size: LIMITS.maxFileBytes + 1, text: null };
  const r = checkSubmission([{ path: "index.html", size: 500, text: "<!doctype html><title>Big</title>" }, big]);
  ok("单文件超 25MB 被拒", r.errors.some((e) => e.code === "file_too_big"), JSON.stringify(codes(r)));

  const many = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => ({ path: `f${i}.js`, size: 1, text: "" }));
  const r2 = checkSubmission([{ path: "index.html", size: 500, text: "<!doctype html><title>Many</title>" }, ...many]);
  ok("文件数超限被拒", r2.errors.some((e) => e.code === "too_many_files"), JSON.stringify(codes(r2)));

  const huge = Array.from({ length: 3 }, (_, i) => ({ path: `part${i}.bin`, size: 20 * 1024 * 1024, text: null }));
  const r3 = checkSubmission([{ path: "index.html", size: 500, text: "<!doctype html><title>Huge</title>" }, ...huge]);
  ok("整包超 50MB 被拒", r3.errors.some((e) => e.code === "too_big"), JSON.stringify(codes(r3)));
}

/* ---------- 8. 软性警告：能收但要标出来 ---------- */
{
  const files = [
    {
      path: "index.html",
      size: 800,
      text: '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Soft</title></head><body><canvas></canvas><a href="https://myblog.example.com">credits</a><script>top.location="https://evil.example.com";document.cookie="a=1"</script></body></html>',
    },
  ];
  const r = checkSubmission(files);
  ok("软警告不影响收稿", r.errors.length === 0, JSON.stringify(codes(r)));
  for (const code of ["outbound_link", "frame_escape", "cookie_write"]) {
    ok(`软警告命中 ${code}`, r.warnings.some((w) => w.code === code), JSON.stringify(codes(r)));
  }
}

/* ---------- 9. 真正的自家游戏也要能过闸门 ---------- */
{
  let all = 0, bad = 0;
  for (const slug of fs.readdirSync(path.join(ROOT, "games"))) {
    const dir = path.join(ROOT, "games", slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const r = checkSubmission(readDir(dir), { slug });
    all++;
    if (r.errors.length) { bad++; console.log(`         ${slug}: ${JSON.stringify(r.errors)}`); }
  }
  ok(`站内 ${all} 个游戏都能过闸门`, bad === 0);
}

/* ---------- 10. CLI 退出码 ---------- */
{
  const run = (dir) => spawnSync(process.execPath, [path.join(ROOT, "tools/gate.mjs"), dir, "--json"], { cwd: ROOT, encoding: "utf8" });
  const good = run("tests/fixtures/games/good");
  ok("CLI 好包退出码 0", good.status === 0, "status " + good.status);
  const bad = run("tests/fixtures/games/ads");
  ok("CLI 坏包退出码 1", bad.status === 1, "status " + bad.status);
  const missing = spawnSync(process.execPath, [path.join(ROOT, "tools/gate.mjs"), "no-such-dir"], { cwd: ROOT, encoding: "utf8" });
  ok("CLI 目录不存在退出码 2", missing.status === 2, "status " + missing.status);
  const parsed = JSON.parse(good.stdout);
  ok("CLI --json 输出可解析且带 meta", parsed.meta && parsed.meta.title === "Fixture Coin");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
