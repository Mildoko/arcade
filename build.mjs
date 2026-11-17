/**
 * 静态站生成器（零依赖，Node 18+）
 *
 *   node build.mjs            生成 public/
 *   node build.mjs --clean    先删 public/ 再生成
 *
 * 一次生成：
 *   /                                  首页（网格 + 长尾入口）
 *   /g/<slug>/                         每作一个静态 SEO 页（canonical + OGP + VideoGame JSON-LD）
 *   /play/<slug>/                      站内游玩容器（带反盗链闸门）
 *   /embed/<slug>/                     官方嵌入组件（唯一允许被别家 iframe 的入口）
 *   /s/<slug>/                         干净分享链（只做 OGP + 跳转，noindex）
 *   /tag/<tag>/                        标签组合页（长尾）
 *   /like/<key>/                       「像 X 的游戏」页（最稳的搜索入口）
 *   /sitemap.xml /robots.txt
 *   /assets/*.js|css                   运行时资源
 *   /assets/covers/<slug>.svg          自动封面图
 *   /assets/og/default.png             兜底社交卡（换成真截图更好）
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "public");
const clean = process.argv.includes("--clean");

const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const games = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "games.json"), "utf8"));
const likes = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "like.json"), "utf8"));

const ORIGIN = site.url.replace(/\/+$/, "");

/* basePath 允许写成 "arcade" / "/arcade/" / "/arcade"，都归一成 "/arcade"。
   还要挡住 Git-Bash 的路径转换：ARCADE_BASE_PATH=/arcade 会被 MSYS 变成
   "C:/Program Files/Git/arcade"，这里按最后一段救回来。 */
function normalizeBase(v) {
  v = String(v || "").trim().split("\\").join("/");
  if (!v || v === "/") return "";
  if (/^[a-zA-Z]:/.test(v)) v = "/" + v.split("/").filter(Boolean).pop();
  return "/" + v.replace(/^\/+/, "").replace(/\/+$/, "");
}
// 子路径部署（GitHub Pages 项目站是 /<repo>/）。环境变量优先，方便 CI 不改编配置。
const BP = normalizeBase(process.env.ARCADE_BASE_PATH ?? site.basePath ?? "");
const BASE = ORIGIN + BP;
const abs = (p) => BASE + p;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad2 = (n) => String(n).padStart(2, "0");
const bySlug = Object.fromEntries(games.map((g) => [g.slug, g]));

/* ---------------------------------------------------------------- 写文件工具 */
function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = /\.(html|js|css)$/i.test(rel) ? relocate(content) : content;
  fs.writeFileSync(file, text);
  return rel;
}
/* 子路径部署：把 "/assets/…" 这类根绝对路径挪到 basePath 下。
   只认白名单前缀，且要求前面是引号/括号/等号，避免误伤数据里的字符串。 */
const ROOT_PREFIXES = ["assets", "g", "play", "embed", "s", "tag", "like", "games", "submit", "privacy"];
const RELOCATE_RE = new RegExp('(["\'(=])(/(?:' + ROOT_PREFIXES.join("|") + ')/)', "g");
function relocate(text) {
  if (!BP) return text;
  return text
    .replace(RELOCATE_RE, (m, pre, p) => pre + BP + p)
    .replace(/href="\/(?=["#?])/g, 'href="' + BP + "/");
}
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (/\.(html|js|css)$/i.test(e.name)) fs.writeFileSync(b, relocate(fs.readFileSync(a, "utf8")));
    else fs.copyFileSync(a, b);
  }
}

/* ---------------------------------------------------------------- 最小 PNG 写手（只为兜底社交卡） */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- 封面 SVG */
const PALETTES = [
  ["#16223a", "#ffc93c"],
  ["#e8483f", "#ffffff"],
  ["#ffc93c", "#16223a"],
  ["#1f3d2b", "#ffc93c"],
  ["#2a2140", "#2fd47a"],
];
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function wrapWords(text, perLine) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine && cur) { lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
function coverSvg(g) {
  const [bg, fg] = PALETTES[hash(g.slug) % PALETTES.length];
  const lines = wrapWords(g.title, 10);
  const fs0 = lines.length > 2 ? 112 : 132;
  const text = lines
    .map((l, i) => `<text x="72" y="${300 + i * (fs0 * 1.02)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs0}" font-weight="850" fill="${fg}" letter-spacing="-4">${esc(l)}</text>`)
    .join("");
  const badge = g.type === "third" ? `<text x="72" y="152" font-family="ui-sans-serif,sans-serif" font-size="34" font-weight="700" fill="${fg}" opacity=".75">COMMUNITY SUBMISSION</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" width="1200" height="750" role="img" aria-label="${esc(g.title)}">
<rect width="1200" height="750" fill="${bg}"/>
<rect x="0" y="0" width="1200" height="16" fill="${fg}"/>
${badge}${text}
<text x="72" y="${300 + lines.length * fs0 * 1.02 + 40}" font-family="ui-sans-serif,sans-serif" font-size="38" fill="${fg}" opacity=".7">${esc(site.name)}</text>
</svg>`;
}

/* ---------------------------------------------------------------- head / shell */
function gtagBlock() {
  if (!site.gaId) return "";
  const id = esc(site.gaId);
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});</script>`;
}

function head(o) {
  const image = o.image ? abs(o.image) : abs("/assets/og/default.png");
  const jsonld = (o.jsonld || []).map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n");
  const alternates = (site.locales || ["en"])
    .map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(BASE + (l === site.lang ? o.path : "/" + l + o.path))}">`)
    .join("\n");
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${esc(abs(o.path))}">
${o.robots ? `<meta name="robots" content="${esc(o.robots)}">` : ""}
<meta property="og:type" content="${o.ogType || "website"}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(abs(o.path))}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${esc(image)}">
${alternates}
${jsonld}
<script src="/assets/config.js"></script>
<script src="/assets/channel.js"></script>
${gtagBlock()}
${o.headExtra || ""}
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/theme.css">
<link rel="icon" href="/assets/favicon.svg">`;
}

function header() {
  return `<header class="site"><div class="wrap bar">
<a class="logo" href="/">1<span>min</span> Arcade</a>
<nav>
<a href="/">All games</a>
<a href="/tag/1-minute/">1-minute</a>
<a href="/like/one-minute-games/">Best of</a>
<a href="/submit/">Submit a game</a>
</nav>
</div></header>`;
}

function footer() {
  return `<footer class="site"><div class="wrap">
<div class="row">
<span>${esc(site.name)} — ${esc(site.tagline)}</span>
<a href="/privacy/">Privacy</a>
<a href="/submit/">For creators</a>
<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
</div>
</div></footer>`;
}

function page(o) {
  return `<!DOCTYPE html>
<html lang="${esc(site.lang)}">
<head>
${head(o)}
</head>
<body>
${o.noChrome ? "" : header()}
${o.body}
${o.noChrome ? "" : footer()}
</body>
</html>`;
}

function card(g) {
  const cover = g.cover ? `<img src="${esc(g.cover)}" alt="${esc(g.title)} cover" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : `<img src="/assets/covers/${g.slug}.svg" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`;
  return `<a class="card" href="/g/${g.slug}/">
<div class="cover" style="padding:0">${cover}</div>
<div class="body">
<h3>${esc(g.title)}</h3>
<p>${esc(g.subtitle)}</p>
<div class="meta"><span>${esc(g.tags.slice(0, 2).join(" · "))}</span>${g.type === "third" ? '<span class="third">third-party</span>' : "<span>★ ours</span>"}</div>
</div></a>`;
}

function gameGrid(list) {
  return `<div class="grid">${list.map(card).join("\n")}</div>`;
}

/* ---------------------------------------------------------------- 首页 */
const homeJsonld = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: site.name,
  alternateName: [site.shortName],
  url: BASE + "/",
  description: site.tagline,
  inLanguage: site.lang,
};

function buildHome() {
  const own = games.filter((g) => g.type === "own");
  const third = games.filter((g) => g.type === "third");
  const tags = [...new Set(games.flatMap((g) => g.tags))];
  const body = `<main>
<section class="hero"><div class="wrap">
<h1>Tiny browser games you can finish in <em>one&nbsp;minute</em>.</h1>
<p class="lead">${games.length} games so far — ${own.length} built in-house, ${third.length} from the community. Every game loads in under a second and gets its own page, so you can link straight to the one you mean.</p>
<div class="stats">
${tags.map((t) => `<a class="chip" href="/tag/${t}/">#${esc(t)}</a>`).join("")}
<a class="chip" href="/like/one-minute-games/">Best of</a>
</div>
</div></section>

<section class="games"><div class="wrap">
<h2>Play now (${games.length})</h2>
${gameGrid(games)}
</div></section>

<section class="games"><div class="wrap">
<h2>Lookup by mood</h2>
<div class="grid">
<a class="card" href="/like/suika-game/"><div class="cover pale">like Suika</div><div class="body"><h3>Games like Suika Game</h3><p>Stacking, merging, one more try.</p></div></a>
<a class="card" href="/like/wordle/"><div class="cover pale">like Wordle</div><div class="body"><h3>Games like Wordle</h3><p>One round a day, no account.</p></div></a>
<a class="card" href="/tag/1-minute/"><div class="cover">#1-minute</div><div class="body"><h3>All 1-minute games</h3><p>Nothing here takes more than 60 seconds.</p></div></a>
</div>
</div></section>
</main>`;
  return page({
    title: `${site.name} — ${games.length} tiny browser games, one minute each`,
    desc: site.tagline,
    path: "/",
    jsonld: [homeJsonld],
    body,
  });
}

/* ---------------------------------------------------------------- 每作 SEO 页 */
function buildGamePage(g) {
  const url = abs("/g/" + g.slug + "/");
  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: g.title,
      url,
      description: g.desc,
      inLanguage: site.lang,
      applicationCategory: "Game",
      gamePlatform: "Web browser",
      operatingSystem: "Any (browser)",
      genre: g.tags,
      datePublished: g.date,
      isAccessibleForFree: true,
      author: g.author && g.author.name ? { "@type": "Person", name: g.author.name } : undefined,
      publisher: { "@type": "Organization", name: site.name },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      image: abs(g.cover || "/assets/covers/" + g.slug + ".svg"),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "All games", item: BASE + "/" },
        { "@type": "ListItem", position: 2, name: g.title, item: url },
      ],
    },
  ];

  const similar = (g.similar || []).map((s) => bySlug[s]).filter(Boolean);
  const cover = g.cover || "/assets/covers/" + g.slug + ".svg";

  const embedCode = `<iframe src="${abs("/embed/" + g.slug + "/")}" width="640" height="400" style="border:0;max-width:100%" title="${esc(g.title)}" loading="lazy" allowfullscreen></iframe>`;

  const body = `<main>
<div class="wrap">
<section class="game-head">
<div class="kicker">${g.type === "third" ? "Community submission" : "Free browser game"} · ${esc(g.date)}</div>
<h1>${esc(g.title)}</h1>
<p class="sub">${esc(g.subtitle)}</p>
</section>

<div class="playbox" id="playbox">
<button class="poster" id="poster" aria-label="Play ${esc(g.title)}" style="all:unset;display:block;width:100%;height:100%;cursor:pointer;position:relative">
<img src="${esc(cover)}" alt="${esc(g.title)}" style="width:100%;height:100%;object-fit:cover;display:block">
<span style="position:absolute;inset:0;display:grid;place-items:center">
<span class="btn primary" style="font-size:20px;padding:14px 30px">▶ PLAY</span>
</span>
</button>
</div>

<div class="actions">
<a class="btn" href="/s/${g.slug}/?c=sh">Share</a>
<button class="btn" id="copyLink" data-link="${esc(abs("/g/" + g.slug + "/"))}">Copy link</button>
<button class="btn" id="copyEmbed" data-code="${esc(embedCode)}">Copy embed code</button>
<a class="btn" href="/tag/${esc(g.tags[0] || "1-minute")}/">More #${esc(g.tags[0] || "1-minute")}</a>
</div>

<div class="cols">
<article class="prose">
<h2>How to play</h2>
<ol>${g.howto.map((h) => `<li>${esc(h)}</li>`).join("")}</ol>
<h2>Three tips</h2>
<ul>${g.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
<h2>About this game</h2>
${g.body.map((p) => `<p>${esc(p)}</p>`).join("")}
</article>
<aside class="side">
<div class="panel">
<h3>Details</h3>
<dl>
<dt>Released</dt><dd>${esc(g.date)}</dd>
<dt>Made by</dt><dd>${esc((g.author && g.author.name) || "Us")}</dd>
<dt>Hosting</dt><dd>${g.type === "third" ? "Community upload" : "In-house"}</dd>
<dt>Controls</dt><dd>${esc(g.controls.join(" / "))}</dd>
<dt>Cost</dt><dd>Free, no login</dd>
<dt>Tags</dt><dd>${g.tags.map((t) => `<a href="/tag/${t}/">#${esc(t)}</a>`).join(" ")}</dd>
</dl>
</div>
<div class="panel">
<h3>Embed this game</h3>
<p style="font-size:13px;color:var(--ink-soft)">Blogs and fan sites may embed the official widget. Direct iframing of the game itself is blocked on purpose.</p>
<pre class="code">${esc(embedCode)}</pre>
</div>
</aside>
</div>
</div>

<section class="similar"><div class="wrap">
<h2>Play next</h2>
${gameGrid(similar.length ? similar : games.filter((x) => x.slug !== g.slug).slice(0, 3))}
</div></section>
</main>
<script>
(function(){
  var box = document.getElementById("playbox");
  var poster = document.getElementById("poster");
  poster.addEventListener("click", function(){
    var ch = (window.ZCH && ZCH.current) || "direct";
    var f = document.createElement("iframe");
    f.src = "/play/${g.slug}/?c=" + encodeURIComponent(ch);
    f.title = ${JSON.stringify(g.title)};
    f.allow = "fullscreen; gamepad";
    f.setAttribute("loading", "eager");
    box.innerHTML = "";
    box.appendChild(f);
    if (window.ZCH && ZCH.send) ZCH.send("play_open", { slug: ${JSON.stringify(g.slug)}, ch: ch });
  });
  function copy(text, btn){
    var done = function(){ var t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(function(){ btn.textContent = t; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else { var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); }
  }
  var cl = document.getElementById("copyLink");
  if (cl) cl.addEventListener("click", function(){ copy(cl.dataset.link, cl); });
  var ce = document.getElementById("copyEmbed");
  if (ce) ce.addEventListener("click", function(){ copy(ce.dataset.code, ce); });
})();
</script>`;

  return page({
    title: `${g.title} — free browser game, no install`,
    desc: g.desc,
    path: "/g/" + g.slug + "/",
    ogType: "article",
    image: "/assets/og/" + g.slug + ".png",
    jsonld,
    body,
  });
}

/* ---------------------------------------------------------------- 游玩容器（反盗链） */
function buildPlayPage(g) {
  const body = `<main style="height:100dvh;display:flex;flex-direction:column;background:#0c1220">
<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0c1220;color:#f4f7fb;border-bottom:1px solid #22304a;font:14px ui-sans-serif,system-ui,sans-serif">
<a href="/g/${g.slug}/" style="color:#ffc93c;text-decoration:none">← ${esc(g.title)}</a>
<span style="opacity:.5">·</span>
<a href="/" style="color:#8fa2bd;text-decoration:none">${esc(site.name)}</a>
<span style="margin-left:auto"></span>
<a href="/s/${g.slug}/?c=sh" style="color:#8fa2bd;text-decoration:none">Share</a>
</div>
<iframe id="game" data-src="/${g.entry}" title="${esc(g.title)}" style="flex:1;border:0;width:100%" allow="fullscreen; gamepad; autoplay"></iframe>
</main>
<script>
(function(){
  var ch = (window.ZCH && ZCH.current) || "direct";
  var iframe = document.getElementById("game");
  try {
    var u = new URL(iframe.dataset.src || iframe.src, location.origin);
    u.searchParams.set("c", ch);
    iframe.src = u.pathname + u.search;
  } catch (e) { iframe.src = iframe.dataset.src; }
  window.addEventListener("message", function(e){
    if (!e.data || e.data.zkind !== "gamedata") return;
    var p = e.data.payload || {};
    if (window.ZCH && ZCH.send) ZCH.send(p.event || "game_event", Object.assign({ slug: p.slug, ch: ch }, p));
  });
})();
</script>`;
  return page({
    title: g.title + " — " + site.name,
    desc: g.desc,
    path: "/play/" + g.slug + "/",
    robots: "noindex,follow",
    noChrome: true,
    headExtra: '<script src="/assets/guard.js"></script>',
    body,
  });
}

/* ---------------------------------------------------------------- 官方 embed 组件 */
function buildEmbedPage(g) {
  const cover = g.cover || "/assets/covers/" + g.slug + ".svg";
  const body = `<div id="wrap" style="position:fixed;inset:0;background:#0c1220;font:14px ui-sans-serif,system-ui,sans-serif;overflow:hidden">
<button id="go" style="all:unset;display:block;width:100%;height:100%;cursor:pointer;position:relative">
<img src="${esc(cover)}" alt="${esc(g.title)}" style="width:100%;height:100%;object-fit:contain;background:#16223a;display:block">
<span style="position:absolute;inset:0;display:grid;place-items:center">
<span style="background:#fff;color:#16223a;font-weight:800;font-size:16px;padding:12px 24px;border-radius:999px;border:3px solid #16223a">▶ PLAY ${esc(g.title)}</span>
</span>
</button>
<a id="brand" href="/g/${g.slug}/?c=embed" target="_blank" rel="noopener"
   style="position:absolute;right:8px;bottom:8px;background:rgba(12,18,32,.82);color:#f4f7fb;
          font-size:11px;padding:4px 9px;border-radius:999px;text-decoration:none;letter-spacing:.02em">
${esc(site.name)} ↗
</a>
</div>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var ch = (q.get("c") || "embed").replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || "embed";
  document.getElementById("go").addEventListener("click", function(){
    var f = document.createElement("iframe");
    f.src = "/play/${g.slug}/?c=" + encodeURIComponent(ch) + "&embed=1";
    f.title = ${JSON.stringify(g.title)};
    f.allow = "fullscreen; gamepad; autoplay";
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    var wrap = document.getElementById("wrap");
    wrap.innerHTML = "";
    wrap.appendChild(f);
    var a = document.createElement("a");
    a.href = "/g/${g.slug}/?c=embed";
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = ${JSON.stringify(site.name + " ↗")};
    a.style.cssText = "position:absolute;right:8px;top:8px;background:rgba(12,18,32,.72);color:#f4f7fb;font-size:11px;padding:3px 8px;border-radius:999px;text-decoration:none;opacity:.55";
    wrap.appendChild(a);
  });
})();
</script>`;
  return page({
    title: g.title + " — embed",
    desc: g.desc,
    path: "/embed/" + g.slug + "/",
    robots: "noindex",
    noChrome: true,
    body,
  });
}

/* ---------------------------------------------------------------- 分享链（干净 OGP） */
function buildSharePage(g) {
  const cover = abs(g.cover || "/assets/covers/" + g.slug + ".svg");
  const target = abs("/g/" + g.slug + "/");
  return `<!DOCTYPE html>
<html lang="${esc(site.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.title)} — ${esc(site.name)}</title>
<meta name="description" content="${esc(g.desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(g.title)} — ${esc(g.subtitle)}">
<meta property="og:description" content="${esc(g.desc)}">
<meta property="og:url" content="${esc(abs("/s/" + g.slug + "/"))}">
<meta property="og:image" content="${esc(cover)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="750">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(g.title)} — ${esc(g.subtitle)}">
<meta name="twitter:description" content="${esc(g.desc)}">
<meta name="twitter:image" content="${esc(cover)}">
</head>
<body style="margin:0;background:#0c1220;color:#f4f7fb;font:16px ui-sans-serif,system-ui,sans-serif">
<p style="padding:24px">Opening <a href="${esc(target)}" style="color:#ffc93c">${esc(g.title)}</a>…</p>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var c = (q.get("c") || "sh").replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || "sh";
  try { sessionStorage.setItem("zch_last", c); } catch(e){}
  location.replace("${new URL(target).pathname}?c=" + encodeURIComponent(c));
})();
</script>
</body>
</html>`;
}

/* ---------------------------------------------------------------- 标签页 / 像 X 的页 */
function buildTagPage(tag) {
  const list = games.filter((g) => g.tags.includes(tag));
  if (!list.length) return null;
  const body = `<main><div class="wrap">
<section class="game-head">
<div class="kicker">Tag</div>
<h1>#${esc(tag)} browser games</h1>
<p class="sub">${list.length} free ${esc(tag)} games you can play in one sitting — no install, no login.</p>
</section>
<section class="games"><div class="wrap">${gameGrid(list)}</div></section>
</div></main>`;
  return [
    "tag/" + tag + "/index.html",
    page({
      title: `#${tag} browser games — play free, no install | ${site.name}`,
      desc: `${list.length} free ${tag} browser games. One minute each, no install, works on phones.`,
      path: "/tag/" + tag + "/",
      body,
    }),
  ];
}

function buildLikePage(key, meta) {
  const list = meta.games.map((s) => bySlug[s]).filter(Boolean);
  if (!list.length) return null;
  const title = `Games like ${meta.title} — free in your browser, no install`;
  const body = `<main><div class="wrap">
<section class="game-head">
<div class="kicker">Because you liked ${esc(meta.title)}</div>
<h1>Games like ${esc(meta.title)}</h1>
<p class="sub">If you searched for ${esc(meta.title)} and want something with the same itch, start here. Each one loads in a second and finishes in a minute.</p>
</section>
<section class="games"><div class="wrap">${gameGrid(list)}</div></section>
<div class="wrap" style="padding-bottom:60px">
<article class="prose">
<h2>Why these</h2>
<p>${esc(meta.title)} works because of a short loop you can repeat without thinking. These picks keep the loop under a minute and drop everything else: no accounts, no tutorials, no progression systems. If you finish one and want a different feel, use the tags — every game page links to games with the same tag, not the same genre label.</p>
<h2>Missing one?</h2>
<p>Send us a link and we will play it. We add community submissions to the same container, so a game you make this weekend can be listed here by Monday.</p>
</article>
</div></div></main>`;
  return [
    "like/" + key + "/index.html",
    page({ title, desc: `Hand-picked alternative games like ${meta.title}. Free, no install, one minute each.`, path: "/like/" + key + "/", body }),
  ];
}

/* ---------------------------------------------------------------- 静态页：submit / privacy */
function buildStaticPages() {
  // 投稿页是一份独立的 HTML 模板（带交互），不塞进这个大字符串
  const submit = fs
    .readFileSync(path.join(ROOT, "pages", "submit.html"), "utf8")
    .replace(/\{\{EMAIL\}\}/g, esc(site.email));

  const privacy = `<main><div class="wrap"><div class="cols" style="padding:30px 0 60px">
<article class="prose">
<h1 style="font-size:34px;letter-spacing:-.02em">Privacy</h1>
<h2>What we collect</h2>
<p>Aggregate page views and a channel tag (which link you arrived from, e.g. <code>?c=tt</code>). Stored in your browser's local storage and in our analytics. No accounts, no email capture required, no game progress uploaded.</p>
<h2>Cookies</h2>
<p>Analytics cookies only, and only if you accept them through the consent banner once ads are enabled. Until then the site runs without advertising cookies.</p>
<h2>Children</h2>
<p>This site is aimed at a general audience. If we ever show personalised ads, consent and parental gates will be required first — which is exactly why ads are currently off.</p>
<h2>Contact</h2>
<p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
</article>
<aside class="side"><div class="panel"><h3>Status</h3><p style="font-size:13px;color:var(--ink-soft)">No ad network connected yet. No third-party trackers besides analytics.</p></div></aside>
</div></div></main>`;

  const notFound = `<main><div class="wrap" style="padding:60px 0 120px;text-align:center">
<h1 style="font-size:40px;letter-spacing:-.03em">404</h1>
<p style="color:var(--ink-soft);margin:8px 0 22px">That page moved, or the game was pulled.</p>
<a class="btn primary" href="/">Back to the arcade</a>
</div></main>`;

  return [
    ["submit/index.html", page({ title: "Submit a game — open slot, 90% revenue share", desc: "Upload a self-contained browser game. No review queue, no exclusivity, you keep the copyright.", path: "/submit/", body: submit })],
    ["privacy/index.html", page({ title: "Privacy", desc: "What this site collects, what it stores, and why ads are currently off.", path: "/privacy/", body: privacy })],
    ["404.html", page({ title: "404 — page not found", desc: "That page moved.", path: "/404.html", robots: "noindex", body: notFound })],
  ];
}

/* ---------------------------------------------------------------- sitemap / robots */
function buildSitemap() {
  const urls = ["/", "/submit/", "/privacy/"];
  for (const g of games) urls.push("/g/" + g.slug + "/");
  for (const t of new Set(games.flatMap((g) => g.tags))) urls.push("/tag/" + t + "/");
  for (const k of Object.keys(likes)) urls.push("/like/" + k + "/");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => {
    const g = games.find((x) => u === "/g/" + x.slug + "/");
    return `  <url><loc>${esc(abs(u))}</loc>${g ? `<lastmod>${esc(g.date)}</lastmod>` : ""}</url>`;
  })
  .join("\n")}
</urlset>`;
  const robots = `User-agent: *
Allow: /
Disallow: /play/
Disallow: /s/
Disallow: /embed/

Sitemap: ${abs("/sitemap.xml")}
`;
  return [["sitemap.xml", xml], ["robots.txt", robots]];
}

/* ---------------------------------------------------------------- main */
if (clean && fs.existsSync(OUT)) {
  // 目录被本地服务占用时（Windows），退化为"清空内容"而不是"删掉目录"
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
  } catch (e) {
    for (const name of fs.readdirSync(OUT)) {
      try { fs.rmSync(path.join(OUT, name), { recursive: true, force: true }); } catch (e2) {}
    }
    console.log("note: public/ 被占用，已清空内容而不是删除目录");
  }
}
fs.mkdirSync(OUT, { recursive: true });

const written = [];

// 1. 静态资源
copyDir(path.join(ROOT, "src"), path.join(OUT, "assets"));
copyDir(path.join(ROOT, "games"), path.join(OUT, "games"));
written.push(
  write(
    "assets/config.js",
    `/* 由 build.mjs 从 site.config.json 生成，不要手改 */\nwindow.ZSITE = ${JSON.stringify(
      { name: site.name, shortName: site.shortName, origin: ORIGIN, base: BP, url: BASE, lang: site.lang, channels: site.channels, email: site.email },
      null,
      2
    )};\n`
  )
);
write(
  "assets/tokens.css",
  "/* generated by build.mjs from site.config.json colors */\n:root {\n" +
    Object.entries(site.colors || {})
      .map(([k, v]) => "  --" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + ": " + v + ";")
      .join("\n") +
    "\n}\n"
);

write(
  "assets/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#16223a"/><rect x="8" y="8" width="48" height="10" fill="#ffc93c"/><text x="32" y="46" font-family="ui-sans-serif,sans-serif" font-size="26" font-weight="850" fill="#fff" text-anchor="middle">1m</text></svg>`
);

// 2. 封面 SVG
for (const g of games) write(`assets/covers/${g.slug}.svg`, coverSvg(g));

// 3. 兜底社交卡 PNG（1200×630）
const [bgHex, fgHex] = PALETTES[0];
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex2rgb(bgHex), FG = hex2rgb(fgHex);
const png = makePng(1200, 630, (x, y) => {
  if (y < 16) return FG;
  const d = Math.hypot(x - 940, y - 500);
  if (d < 150) return FG.map((c, i) => Math.round(c * 0.85 + BG[i] * 0.15));
  if (y > 470 && y < 500 && x > 72 && x < 72 + 380) return FG;
  return BG;
});
fs.mkdirSync(path.join(OUT, "assets/og"), { recursive: true });
for (const g of games) {
  const ogPath = path.join(OUT, "assets/og", g.slug + ".png");
  if (fs.existsSync(ogPath)) continue; // 有真截图就不覆盖
  const [b, f] = PALETTES[hash(g.slug) % PALETTES.length].map(hex2rgb);
  const img = makePng(1200, 630, (x, y) => {
    if (y < 16) return f;
    if (((x + y) % 64) < 10 && x > 700) return f.map((c, i) => Math.round(c * 0.16 + b[i] * 0.84));
    const d = Math.hypot(x - 980, y - 470);
    if (d < 190) return f.map((c, i) => Math.round(c * 0.75 + b[i] * 0.25));
    if (y > 440 && y < 470 && x > 72 && x < 72 + 420) return f;
    if (y > 500 && y < 512 && x > 72 && x < 72 + 260) return f.map((c, i) => Math.round(c * 0.5 + b[i] * 0.5));
    return b;
  });
  fs.writeFileSync(ogPath, img);
}

fs.mkdirSync(path.join(OUT, "assets/og"), { recursive: true });
fs.writeFileSync(path.join(OUT, "assets/og/default.png"), png);
written.push("assets/og/default.png");

// 4. 页面
written.push(write("index.html", buildHome()));
for (const g of games) {
  written.push(write(`g/${g.slug}/index.html`, buildGamePage(g)));
  written.push(write(`play/${g.slug}/index.html`, buildPlayPage(g)));
  written.push(write(`embed/${g.slug}/index.html`, buildEmbedPage(g)));
  written.push(write(`s/${g.slug}/index.html`, buildSharePage(g)));
}
for (const t of new Set(games.flatMap((g) => g.tags))) {
  const r = buildTagPage(t);
  if (r) written.push(write(r[0], r[1]));
}
for (const [k, meta] of Object.entries(likes)) {
  const r = buildLikePage(k, meta);
  if (r) written.push(write(r[0], r[1]));
}
for (const [rel, html] of buildStaticPages()) written.push(write(rel, html));
for (const [rel, txt] of buildSitemap()) written.push(write(rel, txt));

console.log(`built ${written.length} files → public/`);
console.log(`  games: ${games.length} (own ${games.filter((g) => g.type === "own").length}, third-party ${games.filter((g) => g.type === "third").length})`);
console.log(`  sitemap urls: ${(fs.readFileSync(path.join(OUT, "sitemap.xml"), "utf8").match(/<loc>/g) || []).length}`);
console.log(`\n  serve it:  python -m http.server -d public 8080`);
console.log(`  then open: http://localhost:8080/`);
