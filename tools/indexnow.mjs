/**
 * IndexNow 推送（Bing / Yandex / Seznam / Naver 共用；ChatGPT、Copilot 走 Bing 索引）
 *
 *   node tools/indexnow.mjs                # 推 sitemap.xml 里的全部 URL
 *   node tools/indexnow.mjs /g/reflex/     # 只推一条
 *
 * 前置：在项目根放一个 `.indexnow-key`（32~128 位十六进制或字母数字），
 *      工具会写 public/<key>.txt（Search Console 验证用），并 POST 给 api.indexnow.org。
 * 这一步不做，你在 AI 搜索里基本等于不存在。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "public");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const BASE = site.url.replace(/\/+$/, "");

const keyFile = path.join(ROOT, ".indexnow-key");
if (!fs.existsSync(keyFile)) {
  console.error("缺 .indexnow-key。生成一个：\n  node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\" > .indexnow-key");
  process.exit(1);
}
const key = fs.readFileSync(keyFile, "utf8").trim();
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error(".indexnow-key 内容不合法（只允许字母数字和连字符，8~128 位）");
  process.exit(1);
}
if (BASE.includes("example.com")) {
  console.error("site.config.json 的 url 还是 example.com，先把真实域名填上");
  process.exit(1);
}

// 验证文件：IndexNow 会来抓 https://<domain>/<key>.txt
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, key + ".txt"), key);

const args = process.argv.slice(2).filter((a) => a.startsWith("/"));
let urls;
if (args.length) {
  urls = args.map((p) => BASE + p);
} else {
  const sm = fs.readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
  urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const body = {
  host: new URL(BASE).host,
  key,
  keyLocation: `${BASE}/${key}.txt`,
  urlList: urls.slice(0, 10000), // 单次上限
};

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

console.log(`IndexNow → ${urls.length} URLs, status ${res.status} ${res.statusText}`);
if (res.status >= 400) {
  console.log(await res.text().catch(() => ""));
  console.log("\n常见原因：域名还没解析好 / key 文件访问不到 / URL 不在该 host 下");
  process.exit(1);
}
console.log("已推送。Bing 通常几分钟内开始抓取。");
