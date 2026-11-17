/**
 * 收稿闸门：对一个游戏目录跑全部自动检测
 *
 *   node tools/gate.mjs games/pocket-coin
 *   node tools/gate.mjs ../somewhere/my-game --slug my-game --json
 *   node tools/gate.mjs my-game --boot        # 额外用无头 Chrome 真启动一次（需要 playwright）
 *
 * 退出码：0 = 可以收，1 = 有 errors 拒收，2 = 目录读不到
 * 这个脚本是「自动检测代替人工审核」的落点：作者先在 /submit/ 页面自测，
 * 收稿时再跑一次，两次用的是同一份 src/rules.js。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSubmission, formatReport, LIMITS, isTextFile } from "../src/rules.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const dir = positional[0];
const wantJson = flags.has("--json");
const wantBoot = flags.has("--boot");
const slugArg = (argv.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || "";

if (!dir) {
  console.error("用法: node tools/gate.mjs <游戏目录> [--slug=xxx] [--json] [--boot]");
  process.exit(2);
}
const abs = path.resolve(ROOT, dir);
if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
  console.error(`读不到目录: ${abs}`);
  process.exit(2);
}

/* 收集文件清单（与浏览器端同一形状） */
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
const result = checkSubmission(files, { slug: slugArg });

/* --- 可选：真启动一次，看有没有 console error / 白屏 --- */
async function bootCheck() {
  let chromium;
  try {
    const pw = await import("file:///G:/piagent/nodon/node_modules/playwright/index.js");
    chromium = (pw.default || pw).chromium;
  } catch (e) {
    return { skipped: "没装 playwright，跳过启动检查" };
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  const requestFailures = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => requestFailures.push(r.url().slice(0, 120)));
  const url = "file:///" + path.join(abs, "index.html").replace(/\\/g, "/");
  await page.goto(url, { waitUntil: "load", timeout: 15000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1200);
  const pixels = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { canvas: false };
    let data = null;
    try {
      const g = c.getContext("2d");
      data = g ? g.getImageData(0, 0, Math.min(c.width, 64), Math.min(c.height, 64)).data : null;
    } catch (e) {}
    const nonBlank = data ? data.some((v, i) => i % 4 !== 3 && v > 8) : null;
    return { canvas: true, w: c.width, h: c.height, nonBlank };
  });
  await page.screenshot({ path: path.join(ROOT, ".shots", "gate-boot.png") }).catch(() => {});
  await browser.close();
  return { errors, requestFailures, pixels };
}

const boot = wantBoot ? await bootCheck() : null;

if (wantJson) {
  console.log(JSON.stringify({ dir: abs, ...result, boot }, null, 2));
} else {
  console.log(`\n收稿检查: ${path.relative(ROOT, abs) || abs}\n`);
  console.log(formatReport(result));
  if (result.meta) {
    const m = result.meta;
    console.log(`\n自动填的元数据:`);
    console.log(`  title       ${m.title || "(空)"}`);
    console.log(`  desc        ${m.desc || "(空)"}`);
    console.log(`  slug        建议 ${result.slugSuggestion || "(空)"}`);
    console.log(`  viewport    ${m.viewport ? "有" : "无"} · canvas ${m.canvas ? "有" : "无"} · lang ${m.lang || "(未标)"}`);
  }
  if (boot) {
    if (boot.skipped) console.log(`\n启动检查: 跳过（${boot.skipped}）`);
    else {
      console.log(`\n启动检查:`);
      console.log(`  canvas: ${boot.pixels.canvas ? `${boot.pixels.w}×${boot.pixels.h}，${boot.pixels.nonBlank === null ? "无法读像素" : boot.pixels.nonBlank ? "有内容" : "是空的"}` : "没有 canvas"}`);
      console.log(`  JS 报错: ${boot.errors.length ? boot.errors.length + " 条" : "0"}`);
      for (const e of boot.errors.slice(0, 5)) console.log(`    ✗ ${e}`);
      if (boot.requestFailures.length) {
        console.log(`  加载失败: ${boot.requestFailures.length} 个`);
        for (const r of boot.requestFailures.slice(0, 5)) console.log(`    ✗ ${r}`);
      }
      if (boot.errors.length || !boot.pixels.nonBlank) result.errors.push({ code: "boot_failed", msg: "启动检查没通过（见上）" });
    }
    console.log(`\n截图: .shots/gate-boot.png`);
  }
  const verdict = result.errors.length ? "拒收" : result.warnings.length ? "可收，但标出来让人看一眼" : "可收";
  console.log(`\n结论: ${verdict}（${result.errors.length} errors / ${result.warnings.length} warnings）`);
  if (!result.errors.length) {
    console.log(`\n下一步:  node tools/intake.mjs ${dir}${slugArg ? " --slug=" + slugArg : ""}`);
  }
}

process.exit(result.errors.length ? 1 : 0);
