import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 套餐 / 钱包 / 签到 / 免费额度 / 余额这套从 MonkeyCode 商业版移植过来的功能已删除。
 * 这份契约测试确保活跃前端（排除从上游 swagger 生成的 Api.ts 快照）不再引用任何
 * 相关方法名、事件名或组件，否则控制台启动时会出现未映射请求或加载不到组件。
 */

const FRONTEND_ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:\/)/, "");
const EXCLUDE_DIRS = new Set(["node_modules"]);
const EXCLUDE_FILES = new Set(["api/Api.ts", "api/ApiBypass.ts"]);

const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "v1UsersWallet* / v1UsersSubscription*", pattern: /v1Users(Wallet|Subscription)[A-Za-z]*/ },
  { name: "DomainSubscriptionResp", pattern: /DomainSubscriptionResp/ },
  { name: "open-wallet-dialog event", pattern: /open-wallet-dialog/ },
  { name: "deleted commercial nav components", pattern: /from\s+"@\/components\/console\/nav\/(nav-balance|nav-checkin|wallet-dialog|subscription-plan-dialog|free-model-usage-indicator)"/ },
  { name: "subscription model gating helpers", pattern: /canUseModelBySubscription|hasProSubscription|getSubscriptionPlanLabel|getSubscriptionPlanShortLabel/ },
  { name: "pricing utils import", pattern: /from\s+"@\/utils\/pricing"/ },
  { name: "#pricing dead anchor", pattern: /#pricing/ },
];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(t|j)sx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walk(FRONTEND_ROOT).map((f) => path.relative(FRONTEND_ROOT, f).replace(/\\/g, "/"));
const activeFiles = allFiles.filter((rel) => !EXCLUDE_FILES.has(rel));

test("活跃前端不再引用已删除的商业化接口/组件/事件", () => {
  const violations: string[] = [];
  for (const rel of activeFiles) {
    const source = readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");
    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${rel} → ${name}`);
      }
    }
  }
  assert.deepEqual(violations, [], `发现遗留商业代码引用:\n${violations.join("\n")}`);
});
