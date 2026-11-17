/* 投稿规则（唯一的一份）
 *
 * 这个文件同时被两边用：
 *   - Node：tools/gate.mjs / tools/intake.mjs  （收稿时自动检测）
 *   - 浏览器：/submit/ 页面（作者自己先跑一遍，改完再发）
 *
 * 输入统一是“文件清单”：
 *   files = [{ path: "index.html", size: 1234, text: "...内容..." }]
 *   text 只对文本类文件有值（二进制传 null）
 *
 * 输出：
 *   { errors: [...], warnings: [...], stats: {...}, meta: {...}, slugSuggestion }
 *   errors 里有一条就不收；warnings 收但标出来。
 */

export const LIMITS = {
  maxTotalBytes: 50 * 1024 * 1024, // 整包 50MB
  maxFileBytes: 25 * 1024 * 1024,  // 单文件 25MB（也正好是 Cloudflare Pages 的上限）
  maxFiles: 400,
  maxTextScanBytes: 2 * 1024 * 1024,
};

export const TEXT_EXT = [
  "html", "htm", "js", "mjs", "css", "json", "txt", "md", "svg", "xml", "csv",
];
export const OK_EXT = [
  ...TEXT_EXT,
  "png", "jpg", "jpeg", "webp", "gif", "avif", "ico",
  "mp3", "ogg", "wav", "m4a", "webm", "mp4",
  "woff", "woff2", "ttf", "otf",
  "glb", "gltf", "obj", "atlas", "fnt", "tmx", "tsx", "wasm", "data", "bin", "zip",
];

/* ---------------------------------------------------------------- 规则表 */
// 出现就拒收：广告 / 别家门户 SDK / 追踪器
const HARD_BLOCK = [
  { re: /\badsbygoogle\b|googlesyndication\.com|doubleclick\.net/i, code: "ad_sdk", msg: "夹带了广告代码（AdSense 等）" },
  { re: /poki\.com|poki-cdn|poki\.sdk/i, code: "portal_sdk", msg: "夹带了 Poki 的 SDK / 品牌" },
  { re: /crazygames\.(com|cloud)|crazygames\.sdk/i, code: "portal_sdk", msg: "夹带了 CrazyGames 的 SDK / 品牌" },
  { re: /gamedistribution\.com|gamepix\.com|gamemonetize|gameartery|famobi\.com/i, code: "portal_sdk", msg: "夹带了别家游戏门户的分发脚本" },
  { re: /googletagmanager\.com|google-analytics\.com|gtag\/js|segment\.(io|com)|mixpanel\.com|hotjar\.com/i, code: "tracker", msg: "夹带了第三方统计/追踪脚本" },
  { re: /facebook\.net|connect\.facebook|fbq\(/i, code: "tracker", msg: "夹带了 Facebook 像素" },
  { re: /http:\/\/localhost|https?:\/\/127\.0\.0\.1|file:\/\/\/[a-z]:\//i, code: "local_path", msg: "写死了本地地址，别人打开会白屏" },
];

// 外链资源（脚本/样式/字体）必须在包里，不能在线拉
const REMOTE_ASSET = /<(?:script|link|img|source|audio|video|iframe)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:)?\/\//i;

// 出现就警告：能收，但要人看一眼
const SOFT_FLAG = [
  { re: /\b(?:window\.)?top\.location\b|window\.top\s*!==?\s*window\.self|parent\.location\s*=/i, code: "frame_escape", msg: "试图跳转顶层窗口（frame busting），在我们的容器里会被拦" },
  { re: /<a\b[^>]*href\s*=\s*["']https?:/i, code: "outbound_link", msg: "游戏里有外链，规则是不允许（改成纯文字 credits）" },
  { re: /\b(?:porn|xxx|hentai|nude|gore|nsfw)\b/i, code: "adult_flag", msg: "命中成人/暴力关键词，需要人工看一眼" },
  { re: /document\.cookie/i, code: "cookie_write", msg: "写了 cookie，隐私声明里要写清楚" },
  { re: /eval\(|new Function\(/i, code: "dynamic_code", msg: "用了 eval / new Function，注意 CSP 兼容性" },
  { re: /navigator\.share|navigator\.clipboard/i, code: "needs_secure_context", msg: "用了需要 HTTPS + 用户手势的 API，非按钮触发会被浏览器拒绝" },
];

const ADULT_HINT = /\b(?:18\+|adult only)\b/i;

// 站点自己提供的共享资源：允许以 /assets/ 绝对路径引用（收稿后照样能跑）
export const HOST_PROVIDED = [
  "/assets/config.js",
  "/assets/channel.js",
  "/assets/engine.js",
  "/assets/guard.js",
  "/assets/rules.js",
  "/assets/theme.css",
  "/assets/tokens.css",
];

/* ---------------------------------------------------------------- 工具 */
const ext = (p) => (p.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ""])[1];
const isText = (p) => TEXT_EXT.includes(ext(p));
export const isTextFile = isText;
const fmt = (n) => (n > 1024 * 1024 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

/* 从 html 里抠出能自动填的元数据 */
function extractMeta(files) {
  const entry = files.find((f) => f.path === "index.html") || files.find((f) => /(^|\/)index\.html$/.test(f.path));
  const html = entry && entry.text ? entry.text : "";
  const title =
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
    "";
  const desc =
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || "";
  const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  return {
    entry: entry ? entry.path : null,
    title: title.trim().slice(0, 80),
    desc: desc.trim().slice(0, 160),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    canvas: /<canvas|<svg|createElement\(["']canvas["']\)/i.test(html),
    touchAction: /touch-action\s*:/i.test(html),
    scripts,
    usesEngine: scripts.some((x) => /\/assets\/engine\.js/.test(x)),
    lang: (html.match(/<html[^>]+lang=["']([^"']+)/i) || [])[1] || "",
  };
}

/* 相对引用是否都在包里 */
function missingRefs(files) {
  const paths = new Set(files.map((f) => f.path));
  const dirs = new Set();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const missing = [];
  for (const f of files) {
    if (!f.text || !/\.(html|css)$/i.test(f.path)) continue;
    const base = f.path.split("/").slice(0, -1).join("/");
    const refs = [...f.text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("mailto:")) continue;
      if (HOST_PROVIDED.includes(ref.split("?")[0])) continue; // 站点提供的共享引擎
      const clean = ref.split("?")[0].split("#")[0];
      if (!clean || clean.endsWith("/")) continue;
      const resolved = base ? base + "/" + clean : clean;
      const normalized = resolved.replace(/^\.\//, "").replace(/[^/]+\/\.\.\//g, "");
      if (paths.has(normalized)) continue;
      if (dirs.has(normalized)) continue;
      missing.push({ path: f.path, ref: clean });
    }
  }
  return missing;
}

/* ---------------------------------------------------------------- 主函数 */
export function checkSubmission(files, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (code, msg, path) => errors.push({ code, msg, path });
  const warn = (code, msg, path) => warnings.push({ code, msg, path });

  if (!Array.isArray(files) || files.length === 0) {
    err("empty", "没有文件");
    return { errors, warnings, stats: null, meta: null, slugSuggestion: "" };
  }

  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  const biggest = files.reduce((a, f) => (f.size > a.size ? f : a), files[0]);

  /* 1. 体积/数量 */
  if (total > LIMITS.maxTotalBytes) err("too_big", `整包 ${fmt(total)}，超过 ${fmt(LIMITS.maxTotalBytes)}`, biggest.path);
  if (biggest.size > LIMITS.maxFileBytes) err("file_too_big", `单文件 ${fmt(biggest.size)} 超过 ${fmt(LIMITS.maxFileBytes)}`, biggest.path);
  if (files.length > LIMITS.maxFiles) err("too_many_files", `${files.length} 个文件，超过 ${LIMITS.maxFiles}`);

  /* 2. 必须有根目录 index.html */
  if (!files.some((f) => f.path === "index.html")) {
    const nested = files.find((f) => /(^|\/)index\.html$/.test(f.path));
    err(
      "no_entry",
      nested
        ? `找不到根目录的 index.html（发现 ${nested.path}，请把里面的内容提到包的最外层）`
        : "找不到 index.html"
    );
  }

  /* 3. 文件类型 */
  for (const f of files) {
    if (!OK_EXT.includes(ext(f.path))) warn("unknown_type", `.${ext(f.path)} 不在常见类型里`, f.path);
    if (f.path.includes("..")) err("path_traversal", "路径里有 ..", f.path);
    if (/^[a-z]:/i.test(f.path)) err("absolute_path", "文件路径是绝对路径", f.path);
  }

  /* 4. 文本内容扫描 */
  for (const f of files) {
    const t = f.text;
    if (!t) continue;
    const lines = t.split("\n");
    for (const rule of HARD_BLOCK) {
      const m = rule.re.exec(t);
      if (m) {
        const lineNo = t.slice(0, m.index).split("\n").length;
        err(rule.code, `${rule.msg}：${m[0].slice(0, 60)}`, `${f.path}:${lineNo}`);
      }
    }
    if (/\.(html|htm)$/i.test(f.path) && REMOTE_ASSET.test(t)) {
      const m = t.match(REMOTE_ASSET);
      const lineNo = t.slice(0, t.indexOf(m[0])).split("\n").length;
      err("remote_asset", `引用了在线资源（必须自包含）：${m[0].slice(0, 70)}`, `${f.path}:${lineNo}`);
    }
    for (const rule of SOFT_FLAG) {
      const m = rule.re.exec(t);
      if (m) {
        const lineNo = t.slice(0, m.index).split("\n").length;
        warn(rule.code, `${rule.msg}：${m[0].slice(0, 40)}`, `${f.path}:${lineNo}`);
      }
    }
    if (ADULT_HINT.test(t)) warn("adult_flag", "命中 18+ 标记，需要人工看一眼", f.path);
    if (lines.length === 1 && t.length > 40000) warn("one_line_file", "整个文件压成一行，人工 review 会很痛苦", f.path);
  }

  /* 5. 相对引用是否都在包里 */
  for (const m of missingRefs(files)) {
    err("missing_ref", `引用了包里不存在的文件：${m.ref}`, m.path);
  }

  /* 6. 元数据 */
  const meta = extractMeta(files);
  if (!meta.title) warn("no_title", "没有 <title>，详情页标题只能靠猜");
  if (!meta.viewport) warn("no_viewport", "没有 viewport meta，手机上会缩成一团");
  if (!meta.canvas) warn("no_canvas", "没检测到 canvas/svg，确认一下它真的是游戏");
  if (!meta.touchAction && !meta.usesEngine) warn("no_touch_action", "没写 touch-action，手机上按住拖动可能会滚动页面");
  if (meta.title && meta.title.length > 60) warn("title_long", "标题超过 60 字，搜索结果会被截断");
  if (meta.desc && meta.desc.length > 160) warn("desc_long", "description 超过 160 字，搜索结果会被截断");

  const slugSuggestion = slugify(opts.slug || meta.title || "");
  if (!slugSuggestion) warn("no_slug", "没能从标题推出 slug，投稿时手动提供一个");

  const stats = {
    files: files.length,
    totalBytes: total,
    totalText: fmt(total),
    biggest: { path: biggest.path, size: fmt(biggest.size || 0) },
    textScanned: files.filter((f) => f.text).length,
  };

  return { errors, warnings, stats, meta, slugSuggestion };
}

/* 人类可读的报告 */
export function formatReport(result) {
  const out = [];
  if (result.stats) {
    out.push(
      `files ${result.stats.files} · ${result.stats.totalText} · 最大单文件 ${result.stats.biggest.size}（${result.stats.biggest.path}）`
    );
  }
  if (result.errors.length) {
    out.push(`\n拒收（${result.errors.length}）:`);
    for (const e of result.errors) out.push(`  ✗ [${e.code}] ${e.msg}${e.path ? "  →  " + e.path : ""}`);
  }
  if (result.warnings.length) {
    out.push(`\n要人看一眼（${result.warnings.length}）:`);
    for (const w of result.warnings) out.push(`  ! [${w.code}] ${w.msg}${w.path ? "  →  " + w.path : ""}`);
  }
  if (!result.errors.length && !result.warnings.length) out.push("\n全过，可以直接收。");
  return out.join("\n");
}
