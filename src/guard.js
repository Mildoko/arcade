/* 反盗链闸门（game hijack guard）
 *
 * 规则：
 *   1) 自家页面正常打开            → 放行
 *   2) 被别人用 iframe 嵌进他们的站 → 拦下：停止加载 + 只剩一个「去本家玩」按钮
 *   3) 走官方 /embed/ 组件         → 放行（父级是本家的 /embed/ 页面）
 *
 * 为什么这么设计：我们既想让人嵌入（免费外链 + 永久入口），又不想让别家
 * 直接把 /play/ 当自己的游戏用。所以「钥匙」只有一个：/embed/ 页面。
 * 想给某个合作方单独开口子，加到 PARTNER_HOSTS（最好再带签名参数）。
 */
(function () {
  "use strict";

  var HOME = (window.ZSITE && ZSITE.url) || location.origin; // 已含 basePath
  var SELF = location.hostname;
  // 子路径部署时 pathname 是 /arcade/play/…，比较前先去掉前缀
  var BASE = (window.ZSITE && ZSITE.base) || "";
  var PARTNER_HOSTS = []; // 例：["partner.example.com"]

  function ourHost(h) {
    h = String(h || "").toLowerCase();
    if (h === SELF) return true;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(h)) return true;
    if (/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h)) return true;
    for (var i = 0; i < PARTNER_HOSTS.length; i++) if (h === PARTNER_HOSTS[i]) return true;
    return false;
  }

  // 父级是我们自己的沙箱页面吗？（/play/ 或 /embed/，同源才读得到 parent.location）
  // 两层都各自带闸门：embed 允许被别家嵌；play 只允许被 embed 嵌；
  // games 只允许被 play 嵌 —— 于是第三方最多只能走到官方组件为止。
  function parentIsOurSandbox() {
    try {
      var p = window.parent;
      if (!p || p === window) return false;
      if (p.location.hostname !== SELF) return false;
      var pn = p.location.pathname;
      if (BASE && pn.indexOf(BASE + "/") === 0) pn = pn.slice(BASE.length);
      return /^\/(embed|play)\//.test(pn);
    } catch (e) {
      return false;
    }
  }

  function allowed() {
    if (location.protocol === "file:") return true;
    if (window.top === window.self) return true;
    if (!ourHost(SELF)) return true; // 自建镜像/预览环境不拦
    if (parentIsOurSandbox()) return true;

    var origins = location.ancestorOrigins;
    if (origins && origins.length) {
      for (var i = 0; i < origins.length; i++) {
        try { if (!ourHost(new URL(origins[i]).hostname)) return false; } catch (e) { return false; }
      }
      return true;
    }
    try { return ourHost(window.top.location.hostname); } catch (e) {}
    return false; // 跨域且读不到 top，一律按盗链处理
  }

  if (allowed()) return;

  var slug = (/\/games\/([a-z0-9-]+)\//.exec(location.pathname) || [])[1] || "";
  var target = HOME + (slug ? "/g/" + slug + "/?c=hj" : "/");
  var label = /^ja\b/i.test(navigator.language || "") ? "本家で遊ぶ" : "Play on the original site";
  var title = (document.title || "").replace(/</g, "&lt;");

  try { window.stop(); } catch (e) {}
  document.documentElement.innerHTML =
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + title + "</title><style>" +
    "html,body{margin:0;height:100%;background:#0c1220;color:#fff;font-family:system-ui,sans-serif}" +
    "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:20px;text-align:center}" +
    "h1{margin:0;font-size:clamp(18px,5vw,30px)}" +
    "a{display:inline-block;padding:14px 26px;border-radius:999px;background:#fff;color:#0c1220;font-weight:800;text-decoration:none;font-size:17px}" +
    "</style></head><body>" + (title ? "<h1>" + title + "</h1>" : "") +
    '<a href="' + target + '" target="_top" rel="noopener">' + label + "</a></body>";
})();
