# 1 Minute Arcade · 静态小游戏站骨架

> 一套**零依赖、零后端**的浏览器小游戏站骨架。一次 `node build.mjs` 生成：
> 每作一个静态 SEO 页、官方 embed 组件、干净分享链、标签/「像 X 的游戏」长尾页、sitemap。
>
> 设计依据见 [`../_research/zounoashi-browser-games/`](../_research/zounoashi-browser-games/)：
> 内容节奏抄 zounoashi，开放上架/分成抄 itch.io，上架合同抄 CrazyGames。

## 30 秒跑起来

```bash
node build.mjs                                    # 生成 public/
python -m http.server -d public 8099              # 起本地服务
# 打开 http://localhost:8099/
```

## 目录

```
arcade/
├─ site.config.json      站点身份：域名、语言、渠道白名单、配色（唯一的"配置"）
├─ data/games.json       游戏清单：一个 JSON 决定所有页面（自家的 + 第三方的）
├─ data/like.json        「像 X 的游戏」长尾页
├─ games/<slug>/         游戏本体（自己写 index.html，canvas 玩法）
├─ src/                  运行时资源：engine.js 共享引擎 / channel.js 归因 / guard.js 反盗链 / rules.js 投稿规则 / theme.css
├─ build.mjs             生成器（fs + zlib，无第三方包）
├─ pages/submit.html     /submit/ 页面（浏览器端自检 + 生成 submission.json）
├─ tools/gate.mjs        收稿闸门：对一个目录跑全部检测（可 --boot 真启动）
├─ tools/intake.mjs      入库：过闸门 → 拷文件 → 写 games.json → build → check
├─ tools/check.mjs       静态体检（CI 用，0 failed 才算过关）
├─ tools/indexnow.mjs    IndexNow 推送（Bing / AI 搜索的入口）
├─ tests/smoke.mjs       Playwright 真交互冒烟（点 PLAY → 真玩一局 → 分享）
└─ public/               生成物（不提交，.gitignore 已排除）
```

## 生成出来的 URL

| URL | 是什么 | 索引 |
|---|---|---|
| `/` | 首页网格 | ✅ |
| `/g/<slug>/` | **每作一个静态 SEO 页**（canonical + OGP + VideoGame JSON-LD + 怎么玩/技巧/正文） | ✅ |
| `/play/<slug>/` | 站内游玩容器（带反盗链闸门） | ❌ noindex |
| `/embed/<slug>/` | **官方嵌入组件**（唯一允许被别家 iframe 的入口，带回流链接） | ❌ noindex |
| `/s/<slug>/` | 干净分享链（只有 OGP，负责跳转） | ❌ noindex |
| `/tag/<tag>/` | 标签组合页（吃长尾） | ✅ |
| `/like/<key>/` | 「像 Suika Game 的游戏」这类页（最稳的搜索入口） | ✅ |
| `/games/<slug>/` | 游戏本体（canvas），被 `/play/` 嵌 | ❌ noindex |

## 加一个游戏（自家或第三方，同一套流程）

1. `games/<slug>/index.html`：照 `games/reflex/` 抄，脚本引 `/assets/config.js` → `/assets/guard.js` → `/assets/engine.js`。
2. `data/games.json` 加一条：`slug / type(own|third) / title / subtitle / desc / tags / date / author / entry / controls / howto / tips / body / similar`。
3. `node build.mjs && node tools/check.mjs`。

**第三方作品就是 `type: "third"`**——同一容器、同一闸门、同一分享卡，只是页面上会标 `COMMUNITY SUBMISSION`，作者行指向投稿人。下架 = 从 JSON 里删掉 + 重新生成，页面/embed/sitemap 一起消失。

## 收稿流水线（这是「承接第三方」那条腿）

规则只写一份：`src/rules.js`。Node 和浏览器都 import 它，所以作者自测和收稿判定**不可能不一致**。

```
作者                /submit/ 页面（拖文件夹）        → 原地看到拦下的原因 + 生成 submission.json
收稿                node tools/gate.mjs <dir> --boot → 同一套规则 + 无头 Chrome 真启动一次 + 截图
入库                node tools/intake.mjs <dir>      → 拷 games/ + 写 games.json + build + check
```

**闸门查什么**（`src/rules.js` 的表就是唯一出处）

| 类别 | 规则 | 结果 |
|---|---|---|
| 入口 | 必须是根目录 `index.html` | 拒 |
| 体积 | 整包 ≤50MB、单文件 ≤25MB、≤400 文件 | 拒 |
| 广告 | `adsbygoogle` / googlesyndication / doubleclick | 拒 |
| 别家门户 | Poki / CrazyGames / GameDistribution / GamePix / GameMonetize / Famobi | 拒 |
| 追踪 | GTM / GA / Facebook 像素 / Mixpanel / Hotjar | 拒 |
| 外链资源 | `<script|link|img src="https://…">`（必须自包含） | 拒 |
| 本地路径 | `localhost` / `127.0.0.1` / `file:///C:` | 拒 |
| 缺文件 | 相对引用在包里找不到（`/assets/engine.js` 等站点共享资源除外） | 拒 |
| 外链 / 跳出 | 游戏内外链、`top.location` 改顶层窗口 | 警告 |
| 移动端 | 没 viewport、没 touch-action（用了共享引擎就免检） | 警告 |
| 内容 | 成人/暴力关键词、cookie 写入、`eval` | 警告 |
| 启动 | `--boot`：JS 报错 or canvas 全黑 | 拒 |

**入库会自动做的事**：拷到 `games/<slug>/`、给游戏本体插 `noindex`（不让它和 `/g/` 的 SEO 页抢排名）、生成 entry（标题/描述从包里抠）、把长文案留成 `TODO` 并用最后一段输出"还差这些"。

## 共享引擎（`src/engine.js`）

```js
const st = Z.stage(canvas, 720, 720);   // 固定逻辑尺寸 + DPR/窗口自适应 + 指针坐标
Z.start({title, sub, hint, button}, onStart);   // 开场层 + 自动埋点 play_start
Z.result({value, unit, rank, lines, shareText, onRetry});  // 结算 + 分享
Z.share({text});                        // 手机上系统分享，桌面走 X intent
Z.report("play_hit", {round: 3});       // 埋点：父页 → GA4
```
新游戏只写玩法，其它从引擎拿（这是 token 成本能降 60% 的原因）。

## 渠道归因（这是唯一能判断"该加倍哪个渠道"的东西）

任何落地页带 `?c=tt`：

```
/s/reflex/?c=tt   → /g/reflex/?c=tt   → play 容器 → 游戏 iframe
```
- `channel.js` 写 `localStorage.zch_first`（首次触点，永久）+ `sessionStorage.zch_last`（本次会话）
- 站内点击自动带上当前渠道（不丢归因）
- 有 `gaId` 时发 `/channel_hit/` 事件，参数 `ch` / `ch_first` / `slug` / `new_visitor`
- 渠道名只认 `site.config.json` 的 `channels` 白名单，未知值归一为 `other`（防脏数据）

GA4 里就用 `ch` 做维度看「访问 / 游玩率 / 分享率」。

## 反盗链 ↔ 官方 embed（同一件事的两面）

```
g/<slug>/  →  play/<slug>/  →  games/<slug>/
                  ↑ 闸门：只允许被 /embed/ 或 /play/ 同源嵌
embed/<slug>/  ←  允许被任意第三方嵌，带水印 + 回流链接 ?c=embed
```

- 别家直接 iframe `/games/xxx/` 或 `/play/xxx/` → 游戏立即停、只剩「Play on the original site」按钮（带 `?c=hj`，还能算得出被谁偷了）。
- 想正式合作：把人加到 `src/guard.js` 的 `PARTNER_HOSTS`，或让对方走 `/embed/`。
- 传播放行、资产守住：SNS 分享与实况直播允许，擅自转载/嵌入不允许（`/submit/` 里写明）。

## 上线前必做（3 件）

1. 改 `site.config.json` 的 `url` 与 `gaId`（`check` 会 WARN 提醒）。
2. 每作放一张真截图到 `public/assets/og/<slug>.png`？—— 不行，`public/` 会被清。放到 `assets/og-src/` 后自行复制，或直接改 `data` 里加 `cover` 字段。**默认的社交卡是按 slug 上色生成的，能看，但真截图转化高得多。**
3. 把 `.gitignore` 里的 `public/` 交给 CI 部署（GitHub Pages / Cloudflare Pages 都行），并跑一次 `node tools/indexnow.mjs`。

## 体检与测试

```bash
npm run verify                 # build + check（静态 8 类断言）
npm test                       # gate 24 项 + intake 23 项，不需要浏览器，秒级
npm run serve                  # 终端 A：站点 8099
npm run serve:fixtures         # 终端 B：假装"别家网站" 8100
npm run test:browser           # 终端 C：Playwright 真交互
```

| 测试 | 项数 | 覆盖 | 需要什么 |
|---|---|---|---|
| `tests/gate.test.mjs` | 24 | 好包能过；广告包/在线资源/嵌套目录/缺文件/超体积**必须被拒且拒在正确的 code 上**；站点共享引擎不算缺文件；自家 3 个游戏都能过闸门；CLI 退出码 0/1/2 | 无 |
| `tests/intake.test.mjs` | 23 | 坏包不留痕；好包四页 + sitemap 一起出现；重复 slug 拒绝、`--force` 覆盖；测试后**自动还原** games.json | 无 |
| `tests/smoke.mjs` | 24 | 详情页 head / 点 PLAY 装载 / **真玩一局出结算** / 渠道归因 / `/s/` 跳转保留渠道 / 盗链被拦 / 直嵌 play 被拦 / 官方 embed 可玩 / 移动端 | 8099 + 8100 |
| `tests/submit.test.mjs` | 15 | 拖文件夹 → 全绿 + 自动填元数据；广告包 → 拦下且不给表单；改字段 → json 同步；下载真的产出文件 | 8099 |

## 还没做的（按价值排序）

1. `cover` 真截图 + 每作一段 15 秒录屏（社交卡与短视频是同一个素材）
2. 投稿走线上而不是邮件：`/submit/` 生成的 submission.json + R2 直传（现在要附件发邮件）
3. `/en/ /ja/ /zh/` 目录级多语言 + hreflang（现在只有 en，模板已留 `locales`）
4. Cloudflare R2 接管 `games/`（Pages 免费版 20,000 文件天花板）
5. 每日挑战 / 房间码（garticphone 那条路，先有 1 个爆款再做）
6. 分账账本：`plays` 计数 + 90/10 月度结算表（现在规则写了，账没记）
