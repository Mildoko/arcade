/* 共享游戏引擎（一个文件，所有小游戏共用）
 *
 * 设计目标：新游戏只写玩法，其它全部从这里拿。
 *
 *   const st = Z.stage(canvas, 720, 720);   // 固定逻辑尺寸 + 自动适配 + 指针坐标
 *   Z.start({ title, sub, button }, () => { run(); });   // 开场层
 *   Z.ui.show(html, handler) / Z.ui.hide()               // 任意 DOM 层
 *   Z.result({ value, unit, title, lines, onRetry })      // 结算 + 分享卡
 *   Z.share({ text, canvas })                             // 系统分享 / X intent
 *   Z.report("play_start", { slug })                      // 埋点（父页 + GA）
 *
 * 约定：逻辑坐标永远 0..W / 0..H，DPR 与窗口尺寸由 stage 处理。
 */
(function (global) {
  "use strict";

  var Z = {};
  var SLUG = (function () {
    var m = /\/games\/([a-z0-9-]+)\//.exec(location.pathname);
    return m ? m[1] : "";
  })();

  /* ---------------- 基础工具 ---------------- */
  Z.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  Z.lerp = function (a, b, t) { return a + (b - a) * t; };
  Z.rand = function (a, b) { return a + Math.random() * (b - a); };
  Z.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  Z.now = function () { return performance.now(); };
  Z.slug = SLUG;

  Z.report = function (event, data) {
    var payload = Object.assign({ slug: SLUG, event: event, ch: (global.ZCH && ZCH.current) || "" }, data || {});
    try { if (parent !== global) parent.postMessage({ zkind: "gamedata", payload: payload }, "*"); } catch (e) {}
    try {
      if (ZCH && ZCH.send) ZCH.send("game_" + event, payload);
      else if (typeof gtag === "function") gtag("event", "game_" + event, payload);
    } catch (e) {}
  };

  /* ---------------- 舞台（自适应 + 指针） ---------------- */
  Z.stage = function (canvas, W, H) {
    var ctx = canvas.getContext("2d");
    var st = { W: W, H: H, scale: 1, ctx: ctx, canvas: canvas };
    var listeners = {};

    function resize() {
      var vw = global.innerWidth || W, vh = global.innerHeight || H;
      var s = Math.min(vw / W, vh / H);
      var cssW = Math.max(1, Math.round(W * s));
      var cssH = Math.max(1, Math.round(H * s));
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
      st.scale = s;
    }
    st.resize = resize;
    resize();
    global.addEventListener("resize", resize);
    global.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

    function toStage(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      return { x: (clientX - r.left) / st.scale, y: (clientY - r.top) / st.scale };
    }
    st.toStage = toStage;

    // 指针按下/抬起。down: 按下、up: 松开（哪怕在画布外松开也算，手机拖出屏幕不会卡死）
    function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    st.on = on;
    function fire(type, p) {
      (listeners[type] || []).forEach(function (f) { f(p); });
    }

    var down = false;
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      down = true;
      fire("down", toStage(e.clientX, e.clientY));
    });
    function release(e) {
      if (!down) return;
      down = false;
      var p = toStage(e.clientX, e.clientY);
      fire("up", p);
      fire("tap", p);
    }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", function (e) { if (down) { down = false; fire("up", toStage(e.clientX, e.clientY)); } });
    global.addEventListener("blur", function () { if (down) { down = false; fire("up", {}); } });

    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.style.touchAction = "none";

    // 画布外框：让 canvas 始终居中在屏幕上
    document.body.style.margin = "0";
    document.body.style.display = "grid";
    document.body.style.placeItems = "center";
    document.body.style.minHeight = "100vh";
    document.body.style.background = "#0c1220";
    document.body.style.fontFamily =
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", sans-serif';
    document.body.style.overscrollBehavior = "none";
    return st;
  };

  /* ---------------- 循环 ---------------- */
  Z.loop = function (fn) {
    var last = Z.now();
    function frame(t) {
      var dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      fn(dt, t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  /* ---------------- DOM 层 ---------------- */
  var layer = null;
  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "zui";
    layer.style.cssText =
      "position:fixed;inset:0;display:none;place-items:center;padding:18px;" +
      "background:rgba(8,14,26,.86);z-index:50;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)";
    document.body.appendChild(layer);
    return layer;
  }

  Z.ui = {};
  Z.ui.show = function (html, onClick) {
    var l = ensureLayer();
    l.style.display = "grid";
    l.innerHTML = '<div class="zcard">' + html + "</div>";
    if (onClick) {
      l.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("[data-zbtn]")) onClick(e);
      });
    }
    return l;
  };
  Z.ui.hide = function () {
    if (!layer) return;
    layer.style.display = "none";
    layer.innerHTML = "";
  };

  // 一次性注入卡片样式（各游戏不必自己写）
  (function () {
    var css = document.createElement("style");
    css.textContent =
      ".zcard{max-width:min(520px,92vw);text-align:center;color:#f4f7fb;font-family:inherit;" +
      "font-size:17px;line-height:1.6}" +
      ".zcard h1{margin:0 0 6px;font-size:clamp(24px,6vw,38px);letter-spacing:-.02em;line-height:1.15}" +
      ".zcard p{margin:0 0 6px;opacity:.82;font-size:15px}" +
      ".zcard .big{display:block;font-size:clamp(46px,16vw,84px);font-weight:850;letter-spacing:-.03em;" +
      "line-height:1.05;margin:8px 0 4px;font-variant-numeric:tabular-nums}" +
      ".zcard .rank{display:inline-block;margin:8px auto 16px;padding:3px 14px;border-radius:999px;" +
      "background:#ffc93c;color:#16223a;font-weight:800;font-size:14px}" +
      ".zcard ul{display:table;text-align:left;margin:4px auto 10px;padding-left:20px;font-size:15px;opacity:.86}" +
      ".zcard li{margin-bottom:4px}" +
      ".zcard .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px}" +
      ".zcard button{font:inherit;font-weight:800;font-size:16px;padding:12px 22px;border-radius:999px;" +
      "border:3px solid #f4f7fb;background:transparent;color:#f4f7fb;cursor:pointer}" +
      ".zcard button.primary{background:#f4f7fb;color:#16223a}" +
      ".zcard button:hover{border-color:#ffc93c;color:#ffc93c}" +
      ".zcard button.primary:hover{background:#ffc93c;border-color:#ffc93c;color:#16223a}";
    document.head.appendChild(css);
  })();

  /* ---------------- 开场 ---------------- */
  Z.start = function (opts, onStart) {
    opts = opts || {};
    Z.ui.show(
      (opts.title ? "<h1>" + opts.title + "</h1>" : "") +
        (opts.sub ? "<p>" + opts.sub + "</p>" : "") +
        (opts.hint ? "<p>" + opts.hint + "</p>" : "") +
        '<div class="btns"><button class="primary" data-zbtn="start">' +
        (opts.button || "START") +
        "</button></div>",
      function () {
        Z.ui.hide();
        Z.report("play_start");
        onStart && onStart();
      }
    );
  };

  /* ---------------- 结算 ---------------- */
  Z.result = function (opts) {
    var lines = (opts.lines || []).map(function (l) { return "<li>" + l + "</li>"; }).join("");
    Z.ui.show(
      (opts.title ? "<h1>" + opts.title + "</h1>" : "") +
        (opts.value != null ? '<div class="big">' + opts.value + (opts.unit ? "<span style='font-size:.35em;opacity:.7'> " + opts.unit + "</span>" : "") + "</div>" : "") +
        (opts.rank ? '<div class="rank">' + opts.rank + "</div>" : "") +
        (lines ? "<ul>" + lines + "</ul>" : "") +
        '<div class="btns">' +
        '<button class="primary" data-zbtn="retry">' + (opts.retryLabel || "PLAY AGAIN") + "</button>" +
        '<button data-zbtn="share">SHARE</button>' +
        "</div>",
      function (e) {
        var b = e.target.closest("[data-zbtn]");
        if (b.dataset.zbtn === "retry") {
          Z.ui.hide();
          Z.report("play_retry");
          opts.onRetry && opts.onRetry();
        } else if (b.dataset.zbtn === "share") {
          Z.share({ text: opts.shareText || "", canvas: opts.canvas });
        }
      }
    );
    Z.report("play_result", { value: opts.value, unit: opts.unit });
  };

  /* ---------------- 分享 ---------------- */
  Z.share = function (o) {
    o = o || {};
    var base = (global.ZSITE && ZSITE.url) || location.origin;
    var url = base + (SLUG ? "/s/" + SLUG + "/?c=sh" : "/");
    var text = o.text || document.title;
    Z.report("share_click");

    // 有系统分享就用（手机上是"发到微信/WhatsApp/TikTok"）
    if (navigator.share) {
      navigator.share({ title: document.title, text: text, url: url }).catch(function () {});
      return;
    }
    // 桌面：X intent
    var intent = "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    var w = global.open(intent, "_blank", "noopener,width=600,height=520");
    if (!w) location.href = intent;
  };

  /* ---------------- 结果卡（可保存/分享的图） ---------------- */
  // 把「大数字 + 一句话」画成一张 1200×630 的图，返回 dataURL。游戏可以拿来当分享卡。
  Z.shareCard = function (o) {
    var c = document.createElement("canvas");
    c.width = 1200; c.height = 630;
    var g = c.getContext("2d");
    g.fillStyle = "#0c1220"; g.fillRect(0, 0, 1200, 630);
    g.fillStyle = "#ffc93c";
    g.fillRect(0, 0, 1200, 14);
    g.fillStyle = "#f4f7fb";
    g.font = "800 44px ui-sans-serif, system-ui, sans-serif";
    g.fillText(o.title || document.title, 80, 150);
    g.font = "900 200px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#ffc93c";
    g.fillText(String(o.value != null ? o.value : ""), 72, 400);
    g.fillStyle = "#f4f7fb";
    g.font = "600 40px ui-sans-serif, system-ui, sans-serif";
    g.fillText(o.sub || "", 80, 500);
    g.font = "500 28px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#8fa2bd";
    g.fillText((global.ZSITE && ZSITE.name) || "", 80, 570);
    return c.toDataURL("image/png");
  };

  global.Z = Z;
})(window);
