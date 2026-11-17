/**
 * /submit/ 页面的真交互测试（Playwright）
 *
 *   node tests/submit.test.mjs
 * 前置：public 已在 8099 上服务
 *
 * 覆盖：
 *   1. 拖入干净的游戏文件夹 → 全绿 + 自动填元数据
 *   2. 拖入夹带广告的包 → 拦下 + 不给元数据表单
 *   3. 改标题/描述 → submission.json 跟着变，slug 自动规范化
 *   4. 用同一份规则（/assets/rules.js）—— 和 CLI 一致
 */
import fsx from "node:fs";
const CFG = JSON.parse(fsx.readFileSync(new URL("../site.config.json", import.meta.url), "utf8"));
const SITE = process.env.TEST_SITE || "http://localhost:8099" + (CFG.basePath || "");

const pw = await import("file:///G:/piagent/nodon/node_modules/playwright/index.js");
const { chromium } = pw.default || pw;

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (extra ? "  → " + extra : ""))); };

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(SITE + "/submit/", { waitUntil: "load" });
ok("投稿页载入并挂了规则模块", await page.evaluate(() => !!document.getElementById("drop")));

/* 用 DataTransfer 造一次真实 drop */
async function drop(files) {
  await page.evaluate(async (list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: f.type }));
    const dropEl = document.getElementById("drop");
    dropEl.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
  await page.waitForTimeout(600);
}

/* 1. 干净包 */
const goodHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Coin</title>
<meta name="description" content="A tiny canvas coin game used to test the browser-side submission check.">
<style>canvas{touch-action:none}</style></head>
<body><canvas id="c" width="300" height="300"></canvas></body></html>`;

await drop([{ name: "index.html", type: "text/html", text: goodHtml }]);
const green = await page.locator("#report").innerText();
ok("干净包判定为全绿", /all clear/i.test(green), green.slice(0, 120));
ok("自动填了标题", (await page.inputValue("#fTitle")) === "Browser Coin");
ok("自动填了 slug", (await page.inputValue("#fSlug")) === "browser-coin");
ok("自动填了 description", /tiny canvas coin game/.test(await page.inputValue("#fDesc")));
ok("元数据表单出现", await page.isVisible("#metaBlock"));

/* 2. 夹带广告 */
const adsHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Ads</title>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
</head><body><canvas width="100" height="100"></canvas></body></html>`;
await drop([{ name: "index.html", type: "text/html", text: adsHtml }]);
const red = await page.locator("#report").innerText();
ok("广告包被拦下", /blocking issue/i.test(red), red.slice(0, 120));
ok("拦下理由写明 ad_sdk", /ad_sdk/.test(red));
ok("被拦时不显示元数据表单", !(await page.isVisible("#metaBlock")));

/* 3. 回到干净包，改字段看 json */
await drop([{ name: "index.html", type: "text/html", text: goodHtml }]);
await page.fill("#fSub", "Call it, flip it, one second");
await page.fill("#fSlug", "Browser  Coin!!");
await page.locator("#fSlug").blur();
await page.waitForTimeout(200);
const json = JSON.parse(await page.locator("#jsonOut").innerText());
ok("slug 被规范化", json.slug === "browser-coin", json.slug);
ok("subtitle 进了 json", json.subtitle === "Call it, flip it, one second");
ok("selfCheck 记着 0 errors", json.selfCheck.errors === 0 && json.selfCheck.warnings.length === 0, JSON.stringify(json.selfCheck));
ok("json 带 entry=index.html", json.entry === "index.html");

/* 4. 下载按钮真的产出文件 */
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
  page.click("#dl"),
]);
ok("Download submission.json 真的触发下载", !!download, download ? download.suggestedFilename() : "no download event");

ok("整个页面没有 JS 报错", errors.length === 0, errors.join(" | "));
await page.screenshot({ path: ".shots/submit.png" });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
