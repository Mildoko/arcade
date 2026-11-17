/**
 * 入库：把通过闸门的一个游戏目录变成站内一个作品（页面、embed、sitemap 一起出来）
 *
 *   node tools/intake.mjs ../my-game
 *   node tools/intake.mjs ../my-game --slug=coin-flip --author="Somebody" --type=third
 *   node tools/intake.mjs ../my-game --force      # 覆盖同名作品
 *
 * 做四件事：
 *   1. 跑 src/rules.js 的全部检测（有 error 就停）
 *   2. 拷到 games/<slug>/
 *   3. 往 data/games.json 追加一条（标题/描述/入口自动填，长文案留 TODO）
 *   4. build + check，把结果打出来
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkSubmission, formatReport, LIMITS, isTextFile } from "../src/rules.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, dflt = "") => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const has = (name) => argv.includes("--" + name);

const src = positional[0];
if (!src) {
  console.error('用法: node tools/intake.mjs <游戏目录> [--slug=x] [--author="名字"] [--type=third|own] [--force]');
  process.exit(2);
}
const abs = path.resolve(ROOT, src);
if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
  console.error(`读不到目录: ${abs}`);
  process.exit(2);
}

/* 1. 收集 + 检测 */
function collect(root) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(root, p).split(path.sep).join("/");
        const size = fs.statSync(p).size;
        let text = null;
        if (isTextFile(rel) && size <= LIMITS.maxTextScanBytes) {
          try { text = fs.readFileSync(p, "utf8"); } catch (e) {}
        }
        files.push({ path: rel, size, text });
      }
    }
  })(root);
  return files;
}

const files = collect(abs);
const gate = checkSubmission(files, { slug: flag("slug") });
console.log(`\n① 收稿检查 ${path.relative(ROOT, abs)}\n`);
console.log(formatReport(gate));
if (gate.errors.length) {
  console.error("\n有 errors，不入库。改完再跑一次。");
  process.exit(1);
}

const slug = (flag("slug") || gate.slugSuggestion || "").trim();
if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)) {
  console.error(`\nslug 不合法: "${slug}"（只允许小写字母/数字/连字符，2~48 位）。用 --slug=xxx 指定。`);
  process.exit(1);
}

const gamesPath = path.join(ROOT, "data", "games.json");
const games = JSON.parse(fs.readFileSync(gamesPath, "utf8"));
const exists = games.some((g) => g.slug === slug);
if (exists && !has("force")) {
  console.error(`\n${slug} 已存在。要覆盖就加 --force。`);
  process.exit(1);
}

/* 2. 拷文件 */
const destDir = path.join(ROOT, "games", slug);
if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
fs.cpSync(abs, destDir, { recursive: true });
console.log(`\n② 已拷到 games/${slug}/`);

/* 3. 生成条目 */
const type = flag("type", "third") === "own" ? "own" : "third";
const author = flag("author", type === "third" ? "Community submission" : "Us");
const tagsArg = flag("tags"); // 逗号分隔
const today = new Date().toISOString().slice(0, 10);

const entry = {
  slug,
  type,
  title: gate.meta.title || slug,
  subtitle: gate.meta.desc ? gate.meta.desc.slice(0, 60) : "TODO：一句话说清玩法（≤60 字）",
  desc: gate.meta.desc || "TODO：meta description，140~160 字，写清「免费 / 手机可玩 / 不用安装」",
  tags: tagsArg ? tagsArg.split(",").map((t) => t.trim()).filter(Boolean) : ["1-minute", "third-party"],
  date: today,
  author: { name: author, url: "" },
  entry: `games/${slug}/index.html`,
  controls: ["Tap / click"],
  howto: ["TODO：第 1 步", "TODO：第 2 步", "TODO：第 3 步"],
  tips: ["TODO：一条真能用上的技巧"],
  body: [
    "TODO：200~400 字正文。写三件事就够了——它从哪来的、玩法核心是什么、为什么值得一分钟。",
    "TODO：第二段，讲一个具体的设计决定（为什么这么判定/这么反馈）。",
    "TODO：第三段，写清它是第三方投稿或自家作品，以及数据留在本地这类事实。",
  ],
  similar: games.filter((g) => g.slug !== slug).slice(0, 2).map((g) => g.slug),
};

const idx = games.findIndex((g) => g.slug === slug);
if (idx >= 0) games[idx] = entry;
else games.push(entry);

/* 保持数组里最新的在前（和 zounoashi 的编号习惯一致） */
games.sort((a, b) => String(b.date).localeCompare(String(a.date)));
fs.writeFileSync(gamesPath, JSON.stringify(games, null, 2) + "\n");
console.log(`③ data/games.json 已${idx >= 0 ? "更新" : "追加"} ${slug}（共 ${games.length} 个）`);

/* 4. build + check */
console.log("\n④ 重新生成页面…");
const build = spawnSync(process.execPath, ["build.mjs"], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
const check = spawnSync(process.execPath, ["tools/check.mjs"], { cwd: ROOT, stdio: "inherit" });

/* 5. 收尾提示 */
const todos = [];
if (entry.subtitle.startsWith("TODO")) todos.push("subtitle（一句话玩法）");
if (entry.desc.startsWith("TODO")) todos.push("desc（meta description）");
if (entry.howto.some((h) => h.startsWith("TODO"))) todos.push("howto（玩法步骤）");
if (entry.tips.some((t) => t.startsWith("TODO"))) todos.push("tips（技巧）");
if (entry.body.some((b) => b.startsWith("TODO"))) todos.push("body（200~400 字正文）");
if (gate.warnings.length) todos.push(`人工过一眼 ${gate.warnings.length} 条 warning`);

console.log(`\n完成: /g/${slug}/ · /embed/${slug}/ · /s/${slug}/`);
if (todos.length) {
  console.log(`\n还差这些（改 data/games.json 里 ${slug} 那一条，然后 node build.mjs）:`);
  for (const t of todos) console.log(`  · ${t}`);
}
process.exit(check.status || 0);
