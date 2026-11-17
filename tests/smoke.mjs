/**
 * 冒烟测试：用系统 Chrome（Playwright）跑真实交互
 *
 *   node tests/smoke.mjs
 *
 * 前置：两个静态服务已启动（脚本不会自己起服务）
 *   cd public && python -m http.server 8099
 *   cd .chk   && python -m http.server 8100     # 假装"别家网站"
 *
 * 覆盖：
 *   1. 首页 → 详情页 → 点 PLAY 装载 iframe
 *   2. 真玩一局（reflex）→ 结算卡片出现
 *   3. 渠道归因 ?c=tt 落到 localStorage / ZCH
 *   4. /s/ 分享链跳转保留渠道
 *   5. 反盗链：别家用 iframe 直接嵌 /games/ → 被拦
 *   6. 官方 embed：别家嵌 /embed/ → 可玩
 */
import fsx from "node:fs";
const CFG = JSON.parse(fsx.readFileSync(new URL("../site.config.json", import.meta.url), "utf8"));
const SITE = process.env.TEST_SITE || "http://localhost:8099" + (CFG.basePath || "");
const THIEF = "http://127.0.0.2:8100"; // 换个回环地址，模拟"真的不是本家"


const pw = await import("file:///G:/piagent/nodon/node_modules/playwright/index.js");
const { chromium } = pw.default || pw;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
}

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

/* ---------- 1 + 2：详情页 → 点击 PLAY → 真玩一局 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(SITE + "/g/reflex/", { waitUntil: "load" });
  ok("详情页标题正确", (await page.title()).includes("0.5s Reflex"));
  ok("详情页有 canonical", (await page.locator('link[rel=canonical]').count()) === 1);
  ok("详情页有 VideoGame JSON-LD", (await page.locator('script[type="application/ld+json"]').count()) === 2);

  await page.click("#poster");
  const playFrame = page.frameLocator("#playbox iframe");
  await playFrame.locator("#game").waitFor({ timeout: 8000 });
  ok("点 PLAY 后装载 play 容器", true);
  const frame = playFrame.frameLocator("#game");
  await frame.locator("button[data-zbtn=start]").waitFor({ timeout: 8000 });
  ok("play 容器里出现 START", true);

  await frame.locator("button[data-zbtn=start]").click();
  await page.waitForTimeout(2700);           // 闪光发生在 0.8–2.5s 之间，此时已闪
  await frame.locator("canvas").click({ position: { x: 360, y: 360 } });
  await frame.locator(".zcard .big").waitFor({ timeout: 5000 });
  const ms = (await frame.locator(".zcard .big").innerText()).trim();
  ok("结算显示毫秒数", /^\d+\s*ms$/.test(ms.replace(/\s+/g, " ")), "got: " + ms);
  const rank = await frame.locator(".zcard .rank").innerText();
  ok("结算显示评级", rank.length > 0, rank);
  ok("整局没有 JS 报错", errors.length === 0, errors.join(" | "));

  await page.screenshot({ path: ".shots/test-result.png" });
  await page.close();
}

/* ---------- 3：渠道归因 ---------- */
{
  const page = await browser.newPage();
  await page.goto(SITE + "/g/reflex/?c=tt", { waitUntil: "load" });
  const attr = await page.evaluate(() => ({
    first: localStorage.getItem("zch_first"),
    cur: window.ZCH && ZCH.current,
    sent: (window.dataLayer || []).some((e) => e && e.event === "channel_hit"),
  }));
  ok("?c=tt 记到 first-touch", attr.first === "tt", JSON.stringify(attr));
  ok("ZCH.current 正确", attr.cur === "tt");
  ok("发了 channel_hit 事件", attr.sent === true);

  await page.goto(SITE + "/g/reflex/?c=zzzz", { waitUntil: "load" });
  ok("未知渠道归一为 other", (await page.evaluate(() => ZCH.current)) === "other");
  await page.close();
}

/* ---------- 4：/s/ 分享链 ---------- */
{
  const page = await browser.newPage();
  await page.goto(SITE + "/s/reflex/?c=yt", { waitUntil: "load" });
  await page.waitForTimeout(400);
  const u = new URL(page.url());
  const bp = CFG.basePath || "";
  ok("/s/ 跳转到详情页", u.pathname.replace(bp, "") === "/g/reflex/", page.url());
  ok("/s/ 保留渠道参数", u.searchParams.get("c") === "yt", page.url());
  await page.close();
}

/* ---------- 5：反盗链 ---------- */
{
  const page = await browser.newPage();
  await page.goto(THIEF + "/thief.html", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const inner = page.frames().find((f) => f.url().includes("/games/reflex/"));
  ok("盗链页面找到了被嵌的 frame", !!inner);
  const body = inner ? await inner.evaluate(() => document.body.innerText) : "";
  ok("盗链被拦下（只剩回流按钮）", /Play on the original site/.test(body), body.slice(0, 80));
  const href = inner ? await inner.evaluate(() => (document.querySelector("a") || {}).href || "") : "";
  ok("回流按钮带 c=hj", href.includes("c=hj"), href);
  await page.screenshot({ path: ".shots/test-guard.png" });
  await page.close();
}

/* ---------- 5b：直接嵌 /play/ 也要被拦 ---------- */
{
  const page = await browser.newPage();
  await page.goto(THIEF + "/thief2.html", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const inner = page.frames().find((f) => f.url().includes("/play/reflex/"));
  const body = inner ? await inner.evaluate(() => document.body.innerText) : "";
  ok("直嵌 /play/ 被拦（必须走 /embed/）", /Play on the original site/.test(body), body.slice(0, 60));
  await page.close();
}

/* ---------- 6：官方 embed ---------- */
{
  const page = await browser.newPage();
  await page.goto(THIEF + "/partner.html", { waitUntil: "load" });
  await page.waitForTimeout(800);
  const emb = page.frames().find((f) => f.url().includes("/embed/pocket-coin/"));
  ok("embed 组件被装载", !!emb);
  const brand = emb ? await emb.evaluate(() => (document.querySelector("#brand") || {}).href || "") : "";
  ok("embed 带回流链接 ?c=embed", brand.includes("c=embed"), brand);

  // 点 embed 里的 PLAY → 进 play → 游戏层应放行
  await emb.click("#go");
  await page.waitForTimeout(2000);
  const play = page.frames().find((f) => f.url().includes("/play/pocket-coin/"));
  ok("play 容器装载", !!play);
  const game = page.frames().find((f) => f.url().includes("/games/pocket-coin/"));
  ok("游戏本体装载（未被闸门拦下）", !!game, game ? "" : "frame not found");
  const hasStart = game ? await game.evaluate(() => !!document.querySelector("[data-zbtn=start]")) : false;
  ok("embed 内可以真的开始玩", hasStart);
  await page.screenshot({ path: ".shots/test-embed.png" });
  await page.close();
}

/* ---------- 7：移动端截图 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(SITE + "/g/hold/", { waitUntil: "load" });
  await page.screenshot({ path: ".shots/test-mobile.png", fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok("移动端无横向溢出", !overflow);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
