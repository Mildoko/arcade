# arcade · 项目宪法

> 这是一个**静态小游戏站骨架**：1 人 + AI，既要发自己的游戏，也要承接第三方游戏。
> 定位来源：[`../_research/zounoashi-browser-games/`](../_research/zounoashi-browser-games/)（结论在第 04 篇）。

## 三条不变量

1. **无运行时依赖**：`build.mjs` 只用 `fs` / `path` / `zlib` / `url`。不引框架、不引字体 CDN、不引包。要加包先证明"不加就做不成"。
2. **一个 JSON 决定全站**：新增/下架游戏只改 `data/games.json`，不许手写 `public/` 里的任何东西（`public/` 随时会被 `--clean` 删掉）。
3. **规则只写一份**：投稿规则全部在 `src/rules.js`，Node 和浏览器都 import 它。⛔ 不许在 `/submit/` 页面里另写一套判断，那样两边一定会不一致。
4. **闸门只有一把钥匙**：第三方能嵌的只有 `/embed/`。`/play/` 与 `/games/` 一律拦（见 `src/guard.js` 的三层规则），传播放行、资产守住。

## 判据（只认看得见的落点）

| 干完什么 | 判据 |
|---|---|
| 生成器改完 | `node build.mjs && node tools/check.mjs` → `0 failed` |
| 玩法/引擎改完 | `node tests/smoke.mjs` → 全 PASS（其中"真玩一局出结算"必须过） |
| 加了一个游戏 | `node tools/intake.mjs <dir>` 后 `check` 证明四件套 + entry + 社交卡都在；sitemap 条数 +N |
| 收稿规则改了 | `npm test` 全绿（gate 的"该拒的必须拒"+ intake 的"坏包不留痕"都要过） |
| 反盗链改完 | smoke 的「盗链被拦」「直嵌 play 被拦」「官方 embed 可玩」三条同时 PASS |
| 归因改完 | smoke 的 `?c=tt` / `other` / `/s/` 保留渠道 三条同时 PASS |
| 投稿页改完 | `node tests/submit.test.mjs` 全绿（拖文件夹 → 全绿 / 广告包 → 拦下 / json 同步 / 真下载） |

**反例要求**：每个判据都要能举出"它该失败"的例子。例如把 `guard.js` 的 `parentIsOurSandbox` 改坏 → 「官方 embed 可玩」必须 FAIL；把 `channel.js` 的白名单去掉 → 「未知渠道归一为 other」必须 FAIL。

## 命令

```bash
node build.mjs --clean        # 生成 public/
node tools/check.mjs          # 静态体检（8 类）
node tools/gate.mjs <dir> --boot   # 收稿闸门（同一份 src/rules.js）
node tools/intake.mjs <dir>        # 入库（过闸门才算）
python -m http.server -d public 8099
cd tests/fixtures && python -m http.server 8100   # 假装别家站点
node tests/smoke.mjs          # Playwright 真交互
node tools/indexnow.mjs       # 推 Bing/AI 搜索
```

## 边界（别在这里做）

- ❌ 不做后端/数据库/账号系统（要联机再单开一个项目，别把这个搞重）
- ❌ 不在 `public/` 里手改任何文件
- ❌ 不加广告位（等有 5 万访问、有 CMP 再说；`site.config.json` 里没有广告配置就是故意的）
- ❌ 不为单个游戏写特例模板（模板只能有一个，例外进 `data/` 字段）

## 已知坑

- Windows Git-Bash 下 `python -m http.server` 的 `/tmp` 与 python 的 `/tmp` 不是同一个地方，测脚本别往 `/tmp` 写文件。
- Pages 免费版上限：20,000 文件 / 单文件 25 MiB / 500 次构建每月。游戏多了要搬 R2（出网免费）。
- 社交卡：`public/assets/og/<slug>.png` 是按 slug 上色的**占位图**；放真截图要改 `build.mjs` 生成逻辑或加 `cover` 字段，别直接往 `public/` 里丢。
