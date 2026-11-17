/* 渠道记账（能归因，才谈得上投放）
 *
 * 用法：任何落地页在 <head> 里最早加载本文件。
 *   /g/<slug>/?c=tt      → 渠道 tt（tiktok）
 *   /s/<slug>/?c=yt      → 分享链把 c 带到详情页
 *
 * 产出三样东西：
 *   window.ZCH = { current, first, slug, isNew }
 *   localStorage.zch_first  （首次触点，永久）
 *   sessionStorage.zch_last （本次会话触点）
 *   gtag('event','channel_hit',{...})  —— 有 GA 就发，没有就静默
 *
 * 规则：只认白名单里的渠道名，未知值归一为 "other"，长度截断，防注入。
 */
(function () {
  "use strict";

  var ALLOW = (window.ZSITE && ZSITE.channels) || [];
  var KEY_F = "zch_first", KEY_L = "zch_last";

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function ss(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      sessionStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  var q = new URLSearchParams(location.search);
  var raw = (q.get("c") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 16);
  var ch = raw && ALLOW.indexOf(raw) >= 0 ? raw : raw ? "other" : "";
  if (!ch) ch = ss(KEY_L) || "direct";

  var first = ls(KEY_F);
  var isNew = !first;
  if (isNew) { first = ch; ls(KEY_F, ch); }
  ss(KEY_L, ch);

  // 子路径部署（/arcade/g/xxx/）也要能认出 slug
  var bp = (window.ZSITE && ZSITE.base) || "";
  var pathNoBase = bp && location.pathname.indexOf(bp + "/") === 0 ? location.pathname.slice(bp.length) : location.pathname;
  var slug = (/^\/(?:g|play|embed|s)\/([a-z0-9-]+)\//.exec(pathNoBase) || [])[1] || "home";

  window.ZCH = { current: ch, first: first, slug: slug, isNew: isNew, raw: raw };

  function send(event, params) {
    // GA4 直连
    if (typeof window.gtag === "function") { window.gtag("event", event, params); return; }
    // GTM / 其他容器
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event }, params));
  }
  window.ZCH.send = send;

  send("channel_hit", {
    ch: ch,
    ch_first: first,
    slug: slug,
    new_visitor: isNew,
    page: location.pathname
  });

  // 把渠道塞进站内链接，避免站内跳转丢归因
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href^='/']");
    if (!a) return;
    try {
      var u = new URL(a.href, location.origin);
      if (!u.searchParams.get("c") && u.pathname.indexOf("/s/") !== 0) {
        u.searchParams.set("c", ch);
        a.href = u.pathname + u.search + u.hash;
      }
    } catch (err) {}
  });
})();
