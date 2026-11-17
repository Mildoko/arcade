/**
 * 换域名：一条命令把 site.config.json 调到"根域名部署"或"项目子路径部署"
 *
 *   node tools/set-domain.mjs arcade.is-a.dev     # 自定义域名（根路径）
 *   node tools/set-domain.mjs --project           # 回到 mildoko.github.io/arcade/ 子路径
 *
 * 为什么要工具化：换域名要同时改对三处（url / basePath / customDomain），
 * 改漏一处的结果是 canonical 与 sitemap 全指向错地址，而且静态检查不一定看得出来。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CFG_PATH = path.join(ROOT, "site.config.json");
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
const arg = process.argv[2];

function save(next, note) {
  fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`\n${note}`);
  console.log(`  url          ${next.url}`);
  console.log(`  basePath     ${JSON.stringify(next.basePath)}`);
  console.log(`  customDomain ${JSON.stringify(next.customDomain)}`);
  console.log(`\n下一步: node build.mjs --clean && node tools/check.mjs && node tools/check-links.mjs`);
  console.log(`然后 commit + push，GitHub Actions 会自动重新部署。\n`);
}

if (!arg || arg === "-h" || arg === "--help") {
  console.log("用法:\n  node tools/set-domain.mjs <域名>   例: arcade.is-a.dev\n  node tools/set-domain.mjs --project  回到 <user>.github.io/<repo>/ 子路径");
  process.exit(0);
}

if (arg === "--project") {
  const repo = cfg.projectRepo || "arcade";
  const user = cfg.githubUser || "Mildoko";
  save(
    { ...cfg, url: `https://${user.toLowerCase()}.github.io`, basePath: "/" + repo, customDomain: "" },
    "已切回 GitHub Pages 项目子路径部署"
  );
  process.exit(0);
}

const domain = arg
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "");
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
  console.error(`域名不像域名: ${domain}`);
  process.exit(1);
}

save({ ...cfg, url: `https://${domain}`, basePath: "", customDomain: domain }, `已切到自定义域名 ${domain}（根路径部署）`);
console.log(`提醒：自定义域名要在 GitHub 仓库 Settings → Pages → Custom domain 里也填一次，`);
console.log(`      并勾选 Enforce HTTPS（CNAME 记录生效后才会出现这个选项）。`);
