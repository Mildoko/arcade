/**
 * 入库流水线的端到端测试（会临时改动 data/games.json 和 games/，测试结束自动还原）
 *
 *   node tests/intake.test.mjs
 *
 * 覆盖：
 *   1. 好包 → intake 成功，四个页面 + sitemap 条目一起出现
 *   2. 坏包（夹带广告）→ intake 拒绝，什么都没写进去
 *   3. 同一 slug 再入库 → 拒绝（--force 才覆盖）
 *   4. 还原干净，check 仍然 0 failed
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAMES = path.join(ROOT, "data", "games.json");
const SLUG = "zz-test-intake";
const backup = fs.readFileSync(GAMES, "utf8");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (extra ? "  → " + extra : ""))); };
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
const cleanup = () => {
  fs.writeFileSync(GAMES, backup);
  for (const p of [path.join(ROOT, "games", SLUG), path.join(ROOT, "public", "g", SLUG), path.join(ROOT, "public", "play", SLUG), path.join(ROOT, "public", "embed", SLUG), path.join(ROOT, "public", "s", SLUG)]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  run(["build.mjs"]);
};

/* ---------- 1. 坏包：必须拒绝，且不留痕 ---------- */
{
  const r = run(["tools/intake.mjs", "tests/fixtures/games/ads", "--slug=zz-should-not-exist"]);
  ok("坏包被拒（退出码 1）", r.status === 1, "status " + r.status);
  ok("坏包没被拷进 games/", !fs.existsSync(path.join(ROOT, "games", "zz-should-not-exist")));
  ok("坏包没被写进 games.json", !fs.readFileSync(GAMES, "utf8").includes("zz-should-not-exist"));
  ok("拒绝理由出现在输出里", /ad_sdk/.test(r.stdout + r.stderr));
}

/* ---------- 2. 好包：入库成功 ---------- */
{
  const r = run(["tools/intake.mjs", "tests/fixtures/games/good", "--slug=" + SLUG, "--author=QA Bot"]);
  ok("好包入库成功（退出码 0）", r.status === 0, "status " + r.status + "\n" + (r.stderr || "").slice(0, 400));
  ok("游戏文件已落地", fs.existsSync(path.join(ROOT, "games", SLUG, "index.html")));
  for (const p of ["g", "play", "embed", "s"]) {
    ok(`/${p}/${SLUG}/ 已生成`, fs.existsSync(path.join(ROOT, "public", p, SLUG, "index.html")));
  }
  ok("sitemap 里有了它", fs.readFileSync(path.join(ROOT, "public", "sitemap.xml"), "utf8").includes(`/g/${SLUG}/`));

  const games = JSON.parse(fs.readFileSync(GAMES, "utf8"));
  const entry = games.find((g) => g.slug === SLUG);
  ok("games.json 里有这一条", !!entry);
  ok("标题从包里自动填了", entry && entry.title === "Fixture Coin", entry && entry.title);
  ok("作者写的是我们传的", entry && entry.author.name === "QA Bot", entry && entry.author.name);
  ok("默认 type=third", entry && entry.type === "third");
  ok("长文案留了 TODO（提醒人补）", entry && entry.body.some((b) => b.startsWith("TODO")));
  ok("check 仍然 0 failed", run(["tools/check.mjs"]).status === 0);
}

/* ---------- 3. 重复 slug：必须拒绝，加 --force 才覆盖 ---------- */
{
  const r = run(["tools/intake.mjs", "tests/fixtures/games/good", "--slug=" + SLUG]);
  ok("重复 slug 被拒（退出码 1）", r.status === 1, "status " + r.status);
  ok("并提示加 --force", /--force/.test(r.stdout + r.stderr));
  const forced = run(["tools/intake.mjs", "tests/fixtures/games/good", "--slug=" + SLUG, "--force"]);
  ok("--force 可以覆盖", forced.status === 0, "status " + forced.status);
}

/* ---------- 4. 还原 ---------- */
cleanup();
ok("测试后 games.json 已还原", fs.readFileSync(GAMES, "utf8") === backup);
ok("测试后 games/ 已清理", !fs.existsSync(path.join(ROOT, "games", SLUG)));
ok("还原后 check 仍然 0 failed", run(["tools/check.mjs"]).status === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
